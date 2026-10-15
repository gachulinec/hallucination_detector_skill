/**
 * The report of a check (from the pipeline's report generator and
 * faithfulness pipeline, commit 82f9de2): counts, annotated text and the
 * run's facts, in the pipeline's report schema.
 */

import type { HallucinationReport, Verdict } from "../schemas/index.js";
import { generateAnnotatedText as annotateFlagged } from "./grounded.js";

export interface ReportInput {
  text: string;
  source_document?: string;
  model_analyzed?: string;
}

/** Facts about the run that the report records besides the verdicts. */
export interface ReportMeta {
  warnings: string[];
  search_provider?: string;
  models_used?: string[];
  usage?: HallucinationReport["usage"];
  run_info?: HallucinationReport["run_info"];
  modules_used: string[];
  total_api_calls: number;
  processing_time_ms: number;
}

function getVerdictMarker(verdict: "VERIFIED" | "HALLUCINATION" | "UNVERIFIABLE"): string {
  switch (verdict) {
    case "VERIFIED":
      return "[✓ VERIFIED]";
    case "HALLUCINATION":
      return "[✗ HALLUCINATION]";
    case "UNVERIFIABLE":
      return "[? UNVERIFIABLE]";
  }
}

/** The text with a marker in front of every claim found in it (longest claims first). */
function annotateAll(originalText: string, verdicts: Verdict[]): string {
  let annotated = originalText;
  const sortedVerdicts = [...verdicts].sort((a, b) => b.claim_text.length - a.claim_text.length);
  for (const verdict of sortedVerdicts) {
    const idx = annotated.indexOf(verdict.claim_text);
    if (idx !== -1) {
      annotated =
        annotated.slice(0, idx) +
        `${getVerdictMarker(verdict.verdict)} ${verdict.claim_text}` +
        annotated.slice(idx + verdict.claim_text.length);
    }
  }
  return annotated;
}

function optionalFacts(meta: ReportMeta): Pick<HallucinationReport, "search_provider" | "models_used" | "usage" | "run_info"> {
  return {
    ...(meta.search_provider !== undefined ? { search_provider: meta.search_provider } : {}),
    ...(meta.models_used !== undefined ? { models_used: meta.models_used } : {}),
    ...(meta.usage !== undefined ? { usage: meta.usage } : {}),
    ...(meta.run_info !== undefined ? { run_info: meta.run_info } : {}),
  };
}

function counts(verdicts: Verdict[]) {
  const hallucinations = verdicts.filter((v) => v.verdict === "HALLUCINATION");
  return {
    hallucinations,
    fields: {
      total_claims: verdicts.length,
      verified_count: verdicts.filter((v) => v.verdict === "VERIFIED").length,
      hallucination_count: hallucinations.length,
      unverifiable_count: verdicts.filter((v) => v.verdict === "UNVERIFIABLE").length,
      factual_hallucinations: hallucinations.filter((v) => v.hallucination_type === "factual").length,
      faithfulness_hallucinations: hallucinations.filter((v) => v.hallucination_type === "faithfulness").length,
      entity_fabrications: hallucinations.filter((v) => v.hallucination_type === "entity_fabrication").length,
      numeric_fabrications: hallucinations.filter((v) => v.hallucination_type === "numeric_fabrication").length,
      critical_count: hallucinations.filter((v) => v.severity === "critical").length,
      major_count: hallucinations.filter((v) => v.severity === "major").length,
      minor_count: hallucinations.filter((v) => v.severity === "minor").length,
    },
  };
}

/** The standard-mode report: rates rounded, every claim marked in the text. */
export function assembleStandardReport(input: ReportInput, verdicts: Verdict[], meta: ReportMeta): HallucinationReport {
  const { hallucinations, fields } = counts(verdicts);
  const total = verdicts.length;
  const rate = total > 0 ? hallucinations.length / total : 0;
  const avgConfidence = total > 0 ? verdicts.reduce((sum, v) => sum + v.confidence, 0) / total : 0;
  return {
    timestamp: new Date().toISOString(),
    input_text: input.text,
    source_document: input.source_document ?? null,
    model_analyzed: input.model_analyzed ?? null,
    ...fields,
    hallucination_rate: Math.round(rate * 1000) / 1000,
    average_confidence: Math.round(avgConfidence * 1000) / 1000,
    verdicts,
    annotated_text: annotateAll(input.text, verdicts),
    warnings: meta.warnings,
    ...optionalFacts(meta),
    modules_used: meta.modules_used,
    total_api_calls: meta.total_api_calls,
    processing_time_ms: meta.processing_time_ms,
  };
}

/** The faithfulness-mode report: rates unrounded, only flagged claims marked in the text. */
export function assembleFaithfulnessReport(
  input: { text: string; sourceDocument: string; modelAnalyzed?: string },
  verdicts: Verdict[],
  meta: ReportMeta
): HallucinationReport {
  const { hallucinations, fields } = counts(verdicts);
  const total = verdicts.length;
  return {
    timestamp: new Date().toISOString(),
    input_text: input.text,
    source_document: input.sourceDocument,
    model_analyzed: input.modelAnalyzed || null,
    ...fields,
    hallucination_rate: total > 0 ? hallucinations.length / total : 0,
    average_confidence: total > 0 ? verdicts.reduce((sum, v) => sum + v.confidence, 0) / total : 0,
    verdicts,
    annotated_text: annotateFlagged(input.text, verdicts.filter((v) => v.verdict !== "VERIFIED")),
    warnings: meta.warnings,
    ...optionalFacts(meta),
    modules_used: meta.modules_used,
    total_api_calls: meta.total_api_calls,
    processing_time_ms: meta.processing_time_ms,
  };
}

/** A full Markdown report with the summary and per-claim details. */
export function formatAnnotatedMarkdown(report: HallucinationReport): string {
  const lines: string[] = [
    "# Hallucination Detection Report",
    "",
    `**Generated:** ${report.timestamp}`,
    `**Processing time:** ${report.processing_time_ms}ms`,
    `**API calls:** ${report.total_api_calls}`,
    `**Models:** ${report.models_used?.join(", ") || "unknown"}`,
    `**Search provider:** ${report.search_provider ?? "n/a"}`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total claims | ${report.total_claims} |`,
    `| Verified | ${report.verified_count} |`,
    `| Hallucinations | ${report.hallucination_count} |`,
    `| Unverifiable | ${report.unverifiable_count} |`,
    `| Hallucination rate | ${(report.hallucination_rate * 100).toFixed(1)}% |`,
    `| Average confidence | ${(report.average_confidence * 100).toFixed(1)}% |`,
    "",
  ];

  if (report.warnings && report.warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  if (report.hallucination_count > 0) {
    lines.push("## Severity Breakdown", "");
    lines.push(`- Critical: ${report.critical_count}`);
    lines.push(`- Major: ${report.major_count}`);
    lines.push(`- Minor: ${report.minor_count}`);
    lines.push("");
    lines.push("## Hallucination Types", "");
    lines.push(`- Factual: ${report.factual_hallucinations}`);
    lines.push(`- Faithfulness: ${report.faithfulness_hallucinations}`);
    lines.push(`- Entity fabrication: ${report.entity_fabrications}`);
    lines.push(`- Numeric fabrication: ${report.numeric_fabrications}`);
    lines.push("");
  }

  lines.push("## Annotated Text", "");
  lines.push(report.annotated_text);
  lines.push("");
  lines.push("## Per-Claim Details", "");

  for (const v of report.verdicts) {
    const icon = v.verdict === "VERIFIED" ? "✓" : v.verdict === "HALLUCINATION" ? "✗" : "?";
    lines.push(`### ${icon} Claim ${v.claim_id}: ${v.verdict} (${(v.confidence * 100).toFixed(0)}%)`, "");
    lines.push(`> ${v.claim_text}`);
    lines.push("");
    lines.push(`- **Consistency score:** ${v.consistency_score}`);
    if (v.hallucination_type && v.hallucination_type !== "none") lines.push(`- **Type:** ${v.hallucination_type}`);
    if (v.severity) lines.push(`- **Severity:** ${v.severity}`);
    lines.push(`- **Reasoning:** ${v.reasoning}`);
    if (v.evidence.length > 0) {
      lines.push(`- **Evidence:**`);
      for (const e of v.evidence) {
        lines.push(`  - [${e.support_relation}] ${e.source_title}: "${e.relevant_text.slice(0, 100)}..."`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
