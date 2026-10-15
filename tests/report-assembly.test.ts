import { describe, expect, test } from "vitest";
import { assembleFaithfulnessReport, assembleStandardReport, formatAnnotatedMarkdown, type ReportMeta } from "../src/method/report.js";
import { HallucinationReportSchema, type Verdict } from "../src/schemas/index.js";

const TEXT = "The tower is 330 m tall. It opened in 1899. It is in Paris.";

function verdict(id: number, text: string, value: Verdict["verdict"]): Verdict {
  return {
    claim_id: id,
    claim_text: text,
    verdict: value,
    confidence: 0.9,
    hallucination_type: value === "HALLUCINATION" ? "numeric_fabrication" : value === "VERIFIED" ? "none" : null,
    consistency_score: 0.5,
    evidence: [],
    reasoning: "r",
    severity: value === "HALLUCINATION" ? "major" : null,
  };
}

const verdicts = [
  verdict(1, "The tower is 330 m tall", "VERIFIED"),
  verdict(2, "It opened in 1899", "HALLUCINATION"),
  verdict(3, "It is in Paris", "UNVERIFIABLE"),
];

const meta: ReportMeta = {
  warnings: ["w"],
  search_provider: "agent",
  models_used: [],
  run_info: { tool: "hallucination-check-skill", version: "1.0.0", profile: "thorough", origin: "external", independence: "subagents", network: true },
  modules_used: ["claim-extractor"],
  total_api_calls: 4,
  processing_time_ms: 1000,
};

describe("assembleStandardReport", () => {
  test("counts verdicts, rounds rates and keeps the run facts", () => {
    const report = assembleStandardReport({ text: TEXT }, verdicts, meta);
    expect(report.total_claims).toBe(3);
    expect(report.hallucination_count).toBe(1);
    expect(report.hallucination_rate).toBe(0.333);
    expect(report.numeric_fabrications).toBe(1);
    expect(report.major_count).toBe(1);
    expect(report.search_provider).toBe("agent");
    expect(report.run_info?.profile).toBe("thorough");
    expect(report.annotated_text).toContain("[✗ HALLUCINATION] It opened in 1899");
    expect(() => HallucinationReportSchema.parse(report)).not.toThrow();
    expect(formatAnnotatedMarkdown(report)).toContain("# Hallucination Detection Report");
  });

  test("leaves out optional facts that were not given", () => {
    const report = assembleStandardReport({ text: TEXT }, verdicts, { warnings: [], modules_used: [], total_api_calls: 0, processing_time_ms: 0 });
    expect("search_provider" in report).toBe(false);
    expect("run_info" in report).toBe(false);
    expect("usage" in report).toBe(false);
  });
});

describe("assembleFaithfulnessReport", () => {
  test("marks only flagged claims and keeps the unrounded rate", () => {
    const report = assembleFaithfulnessReport({ text: TEXT, sourceDocument: "source" }, verdicts, meta);
    expect(report.source_document).toBe("source");
    expect(report.hallucination_rate).toBeCloseTo(1 / 3, 10);
    expect(report.annotated_text).not.toContain("VERIFIED]");
    expect(report.annotated_text).toContain("[✗ HALLUCINATION]");
    expect(() => HallucinationReportSchema.parse(report)).not.toThrow();
  });
});
