import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { HallucinationReportSchema, type Verdict } from "../../src/schemas/index.js";
import { finalizeRun, independenceOf } from "../../src/hd/report.js";
import type { TaskRecord } from "../../src/hd/types.js";
import { atomicWriteJSON } from "../../src/utils/atomic-write.js";
import { FAITH_SOURCE, FAITH_TEXT, STANDARD_TEXT, extractClaims, makeRun } from "./helpers.js";

function verdict(id: number, text: string, value: Verdict["verdict"], extra: Partial<Verdict> = {}): Verdict {
  return {
    claim_id: id,
    claim_text: text,
    verdict: value,
    confidence: 0.9,
    hallucination_type: value === "HALLUCINATION" ? "numeric_fabrication" : value === "VERIFIED" ? "none" : null,
    consistency_score: 0.5,
    evidence: [],
    reasoning: `reason ${id}`,
    severity: value === "HALLUCINATION" ? "major" : null,
    ...extra,
  };
}

function task(id: string, executedBy: TaskRecord["executed_by"]): TaskRecord {
  return { id, kind: "judge", attempt: 1, claim_ids: [], independence: "required", model_tier: "strongest", status: "done", executed_by: executedBy };
}

describe("finalizeRun", () => {
  test("writes the report, the annotated text and the summary of a standard run", () => {
    const ctx = makeRun(STANDARD_TEXT, { agent: "claude-code", models: ["claude-opus-5-5"] });
    extractClaims(ctx);
    atomicWriteJSON(ctx.paths.verdicts, {
      verdicts: [
        verdict(1, "The Eiffel Tower is 330 metres tall", "VERIFIED"),
        verdict(2, "The Eiffel Tower was completed in 1899", "HALLUCINATION", {
          evidence: [
            { source_url: "https://b.example/x", source_title: "B", relevant_text: "It was completed in 1889.", retrieval_method: "web_search", support_relation: "contradicts", confidence: 0.8, checked: false },
          ],
        }),
        verdict(3, "Gustave Eiffel's company built the Eiffel Tower", "UNVERIFIABLE"),
      ],
    });
    ctx.state.tasks.push(task("judge-01", "subagent"));

    const report = finalizeRun(ctx, new Date(Date.parse(ctx.state.created) + 5_000));
    expect(() => HallucinationReportSchema.parse(report)).not.toThrow();
    expect(report.search_provider).toBe("agent");
    expect(report.models_used).toEqual(["claude-opus-5-5"]);
    expect(report.processing_time_ms).toBe(5_000);
    expect(report.run_info).toEqual({
      tool: "hallucination-check-skill",
      version: "1.0.1",
      profile: "thorough",
      origin: "external",
      agent: "claude-code",
      independence: "subagents",
      network: null,
    });
    expect(ctx.state.finished).toBeDefined();

    const summary = readFileSync(ctx.paths.summary, "utf-8");
    expect(summary).toContain("3 claims: 1 HALLUCINATION, 1 UNVERIFIABLE, 1 VERIFIED.");
    expect(summary).toContain("## Hallucinations");
    expect(summary).toContain("**The Eiffel Tower was completed in 1899**");
    expect(summary).toContain("[contradicts, unconfirmed] https://b.example/x");
    expect(summary).toContain("## Could not be verified");
    expect(summary.indexOf("## Hallucinations")).toBeLessThan(summary.indexOf("## Could not be verified"));
    expect(readFileSync(ctx.paths.annotated, "utf-8")).toContain("# Hallucination Detection Report");
  });

  test("warns when a required task was done by the main agent", () => {
    const ctx = makeRun(STANDARD_TEXT);
    extractClaims(ctx);
    ctx.state.tasks.push(task("judge-01", "subagent"), task("judge-02", "main"));
    expect(independenceOf(ctx.state)).toBe("partial");
    finalizeRun(ctx);
    expect(ctx.state.warnings.join(" ")).toContain("judge-02");
  });

  test("reports no independence without subagents", () => {
    const ctx = makeRun(STANDARD_TEXT, { subagents: false });
    expect(independenceOf(ctx.state)).toBe("none");
  });

  test("writes a faithfulness report that marks only flagged claims", () => {
    const ctx = makeRun(FAITH_TEXT, { source: FAITH_SOURCE });
    extractClaims(ctx);
    atomicWriteJSON(ctx.paths.verdicts, {
      verdicts: [verdict(1, "Construction of the dam began in 1933", "HALLUCINATION"), verdict(2, "The dam is 221 metres tall", "VERIFIED")],
    });
    const report = finalizeRun(ctx);
    expect(report.source_document).toBe(FAITH_SOURCE);
    expect("search_provider" in report).toBe(false);
    expect(readFileSync(ctx.paths.annotated, "utf-8")).toContain("[✗ HALLUCINATION]");
    expect(readFileSync(ctx.paths.annotated, "utf-8")).not.toContain("VERIFIED]");
  });

  test("writes an empty report when there were no claims", () => {
    const ctx = makeRun("# Note\n\nThis is an opinion about art.\n");
    extractClaims(ctx, []);
    const report = finalizeRun(ctx);
    expect(report.total_claims).toBe(0);
    expect(readFileSync(ctx.paths.summary, "utf-8")).toContain("0 claims");
  });
});
