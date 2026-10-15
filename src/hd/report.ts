/**
 * The end of a run: report.json in the pipeline's schema (plus run_info), the
 * annotated text, and summary.md, the short result the agent presents.
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assembleFaithfulnessReport, assembleStandardReport, formatAnnotatedMarkdown, type ReportMeta } from "../method/report.js";
import type { VerificationResult } from "../method/retrieval.js";
import type { HallucinationReport, Verdict } from "../schemas/index.js";
import { atomicWriteJSON, readJSON } from "../utils/atomic-write.js";
import { SKILL_VERSION } from "./config.js";
import type { ClaimPassages } from "./evidence-store.js";
import { readNetwork, type RunPaths } from "./run-state.js";
import { addWarning, type StepContext } from "./steps/step.js";
import type { RunState } from "./types.js";

type Independence = NonNullable<HallucinationReport["run_info"]>["independence"];

/** Whether the tasks that needed a fresh context got one. */
export function independenceOf(state: RunState): Independence {
  if (!state.subagents) return "none";
  const required = state.tasks.filter((t) => t.independence === "required" && t.status === "done");
  const byMain = required.filter((t) => t.executed_by !== "subagent");
  if (byMain.length === 0) return "subagents";
  return byMain.length === required.length ? "none" : "partial";
}

/** Where the evidence came from: the agent's own search and fetches, SearXNG through hd, or both. */
function searchProvider(paths: RunPaths): string {
  const origins = new Set(
    existsSync(paths.passages)
      ? readdirSync(paths.passages).flatMap((f) => readJSON<ClaimPassages>(join(paths.passages, f)).items.map((i) => i.origin))
      : []
  );
  if (!origins.has("searxng")) return "agent";
  const evidence = existsSync(paths.evidence)
    ? readJSON<{ results: VerificationResult[] }>(paths.evidence).results.flatMap((r) => r.evidence)
    : [];
  return origins.has("fetch") || evidence.some((e) => e.checked === false) ? "agent+searxng" : "searxng";
}

export function buildSummary(report: HallucinationReport, paths: RunPaths): string {
  const flagged = report.verdicts.filter((v) => v.verdict === "HALLUCINATION");
  const unverifiable = report.verdicts.filter((v) => v.verdict === "UNVERIFIABLE");
  const lines = [
    "# Hallucination check",
    "",
    `${report.total_claims} claims: ${report.hallucination_count} HALLUCINATION, ${report.unverifiable_count} UNVERIFIABLE, ${report.verified_count} VERIFIED.`,
    "",
  ];
  if (flagged.length > 0) {
    lines.push("## Hallucinations", "");
    flagged.forEach((v, i) => {
      lines.push(`${i + 1}. **${v.claim_text}** (claim ${v.claim_id}${v.severity ? `, ${v.severity}` : ""})`, `   ${v.reasoning}`);
      for (const e of v.evidence.filter((item) => item.support_relation !== "neutral").slice(0, 3)) {
        const where = e.source_url === "source_document" ? "source document" : e.source_url;
        lines.push(`   - [${e.support_relation}${e.checked === false ? ", unconfirmed" : ""}] ${where}: "${e.relevant_text.replace(/\s+/g, " ").slice(0, 300)}"`);
      }
      lines.push("");
    });
  }
  if (unverifiable.length > 0) {
    lines.push("## Could not be verified", "");
    for (const v of unverifiable) lines.push(`- **${v.claim_text}** (claim ${v.claim_id}): ${v.reasoning}`);
    lines.push("");
  }
  if (report.warnings && report.warnings.length > 0) {
    lines.push("## Warnings", "", ...report.warnings.map((w) => `- ${w}`), "");
  }
  lines.push(`Full report: ${paths.report}`, `Annotated text: ${paths.annotated}`, "");
  return lines.join("\n");
}

export function finalizeRun(ctx: StepContext, now: Date = new Date()): HallucinationReport {
  const { paths, state } = ctx;
  const verdicts = existsSync(paths.verdicts) ? readJSON<{ verdicts: Verdict[] }>(paths.verdicts).verdicts : [];
  if (!existsSync(paths.verdicts)) atomicWriteJSON(paths.verdicts, { verdicts });

  const byMain = state.tasks
    .filter((t) => t.independence === "required" && t.status === "done" && t.executed_by !== "subagent")
    .map((t) => t.id);
  if (byMain.length > 0) {
    addWarning(state, `Tasks that need a fresh context were done without one, so their independence is not ensured: ${byMain.join(", ")}.`);
  }

  const standard = state.mode === "standard";
  const meta: ReportMeta = {
    warnings: state.warnings,
    ...(standard ? { search_provider: searchProvider(paths) } : {}),
    models_used: state.models,
    run_info: {
      tool: "hallucination-check-skill",
      version: SKILL_VERSION,
      profile: state.profile,
      origin: state.origin,
      ...(state.agent ? { agent: state.agent } : {}),
      independence: independenceOf(state),
      network: readNetwork(paths),
    },
    modules_used: standard
      ? [
          "claim-extractor",
          ...(existsSync(paths.consistency) ? ["consistency-checker"] : []),
          "retrieval-verifier",
          "verdict-judge",
          "report-generator",
        ]
      : ["section-splitter", "claim-extractor", "grounded-verifier", "report-generator"],
    total_api_calls: state.tasks.filter((t) => t.status === "done").length,
    processing_time_ms: Math.max(0, now.getTime() - Date.parse(state.created)),
  };

  const report = standard
    ? assembleStandardReport({ text: ctx.text }, verdicts, meta)
    : assembleFaithfulnessReport({ text: ctx.text, sourceDocument: ctx.source ?? "" }, verdicts, meta);
  atomicWriteJSON(paths.report, report);
  writeFileSync(paths.annotated, standard ? formatAnnotatedMarkdown(report) : report.annotated_text, "utf-8");
  writeFileSync(paths.summary, buildSummary(report, paths), "utf-8");
  state.finished = now.toISOString();
  return report;
}
