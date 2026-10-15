/**
 * Verdict rules of the method (from the pipeline's verdict judge, commit
 * 82f9de2): what decides a claim without the judge, what the judge sees, and
 * the guardrails on the judge's verdict. Evidence that a skill run marks as
 * the verifier's own text (checked: false) never decides a claim on its own.
 */

import type { Claim, Evidence, Verdict } from "../schemas/index.js";
import type { AuditLogger } from "../utils/audit-logger.js";
import { clamp01, normalizeHallucinationType, normalizeSeverity, normalizeVerdict } from "../utils/validate.js";
import { METHOD } from "./config.js";
import type { ConsistencyResult } from "./consistency.js";
import type { VerificationResult } from "./retrieval.js";

/** Evidence counts as confirmed unless it is marked as the verifier's own text. */
function confirmed(e: Evidence): boolean {
  return e.checked !== false;
}

/**
 * Confidence guardrails: no HALLUCINATION above the threshold without
 * confirmed contradicting evidence, and a low cap when consistency is high
 * and evidence supports the claim.
 */
function applyGuardrails(
  claim: Claim,
  verdict: Verdict["verdict"],
  confidence: number,
  consistencyScore: number,
  evidence: Evidence[],
  logger?: AuditLogger
): number {
  let finalConfidence = confidence;

  if (
    verdict === "HALLUCINATION" &&
    finalConfidence > METHOD.hallucination_confidence &&
    evidence.filter((e) => e.support_relation === "contradicts" && confirmed(e)).length === 0
  ) {
    // Rounded so the cap is exactly 0.7, not 0.7000000000000001
    finalConfidence = Math.round((METHOD.hallucination_confidence - 0.1) * 100) / 100;
    logger?.log({
      event: "guardrail_triggered",
      module: "verdict-judge",
      claim_id: claim.id,
      details: { reason: "Confidence capped — no contradicting evidence" },
    });
  }

  if (consistencyScore >= 0.9 && evidence.some((e) => e.support_relation === "supports") && verdict === "HALLUCINATION") {
    finalConfidence = Math.min(finalConfidence, 0.5);
    logger?.log({
      event: "guardrail_triggered",
      module: "verdict-judge",
      claim_id: claim.id,
      details: { reason: "Potential false positive — high consistency + supporting evidence" },
    });
  }

  return finalConfidence;
}

/**
 * Turns the judge's raw answer into a verdict: validates every field and
 * applies the guardrails. An invalid verdict value becomes UNVERIFIABLE.
 */
export function buildJudgeVerdict(
  claim: Claim,
  judgeResult: Record<string, unknown>,
  consistencyScore: number,
  evidence: Evidence[],
  logger?: AuditLogger
): Verdict {
  const verdict = normalizeVerdict(judgeResult.verdict);
  if (!verdict) {
    return {
      claim_id: claim.id,
      claim_text: claim.text,
      verdict: "UNVERIFIABLE",
      confidence: 0.3,
      hallucination_type: null,
      consistency_score: consistencyScore,
      evidence,
      reasoning: `Judge returned an invalid verdict: ${JSON.stringify(judgeResult.verdict)}`,
      severity: null,
    };
  }

  return {
    claim_id: claim.id,
    claim_text: claim.text,
    verdict,
    confidence: applyGuardrails(claim, verdict, clamp01(judgeResult.confidence, 0.5), consistencyScore, evidence, logger),
    hallucination_type: normalizeHallucinationType(judgeResult.hallucination_type),
    consistency_score: consistencyScore,
    evidence,
    reasoning:
      typeof judgeResult.reasoning === "string" && judgeResult.reasoning ? judgeResult.reasoning : "No reasoning provided",
    severity: normalizeSeverity(judgeResult.severity),
  };
}

/**
 * True when the verification status disagrees with the consistency samples:
 * SUPPORTED while most samples contradict the claim, or CONTRADICTED while
 * every sample supports it.
 */
export function consistencyConflicts(
  status: VerificationResult["verification_status"] | undefined,
  consistencyResult: ConsistencyResult | undefined
): boolean {
  const judgments = consistencyResult?.sample_judgments;
  if (!judgments?.length) return false;
  const contradicting = judgments.filter((j) => j === "contradicts").length;
  const supporting = judgments.filter((j) => j === "supports").length;
  if (status === "SUPPORTED") return contradicting > judgments.length / 2;
  if (status === "CONTRADICTED") return supporting === judgments.length;
  return false;
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * True when a CONTRADICTED status rests on fewer than two independent
 * websites: a single site may give an outdated value or count something else.
 * A source document is authoritative and decided directly. Evidence the
 * verifying agent wrote itself does not count as a site.
 */
export function singleSourceContradiction(verificationResult: VerificationResult | undefined): boolean {
  if (verificationResult?.verification_status !== "CONTRADICTED") return false;
  const contradicting = verificationResult.evidence.filter((e) => e.support_relation === "contradicts" && confirmed(e));
  if (contradicting.some((e) => e.retrieval_method === "source_document")) return false;
  return new Set(contradicting.map((e) => siteOf(e.source_url))).size < 2;
}

function mapClaimTypeToHallucinationType(
  claimType: string
): "factual" | "faithfulness" | "entity_fabrication" | "numeric_fabrication" | "none" {
  switch (claimType) {
    case "factual":
      return "factual";
    case "faithfulness":
      return "faithfulness";
    case "entity":
      return "entity_fabrication";
    case "numeric":
      return "numeric_fabrication";
    default:
      return "factual";
  }
}

function determineSeverity(claimType: string): "critical" | "major" | "minor" {
  switch (claimType) {
    case "entity":
      return "critical";
    case "factual":
      return "critical";
    case "numeric":
      return "major";
    case "faithfulness":
      return "major";
    default:
      return "minor";
  }
}

/**
 * Verdicts that need no judge: attribution fabrication, failed verification,
 * clear SUPPORTED / CONTRADICTED evidence. Returns null when the judge has to
 * decide.
 */
export function decideWithoutJudge(
  claim: Claim,
  consistencyResult: ConsistencyResult | undefined,
  verificationResult: VerificationResult | undefined,
  ctx: { flaggedIds: number[]; sourceIsAnonymized: boolean }
): Verdict | null {
  // Anonymized source + specific attribution → HALLUCINATION
  if (ctx.sourceIsAnonymized && claim.attribution_check) {
    return {
      claim_id: claim.id,
      claim_text: claim.text,
      verdict: "HALLUCINATION",
      confidence: 0.9,
      hallucination_type: "entity_fabrication",
      consistency_score: consistencyResult?.consistency_score ?? 0.5,
      evidence: verificationResult?.evidence ?? [],
      reasoning:
        "Source document contains anonymization clause. This claim attributes a quote to a specific named person/company, which contradicts the source's anonymization policy.",
      severity: "critical",
    };
  }

  // Not flagged and no retrieval evidence → VERIFIED (never reached when every claim is verified)
  if (!ctx.flaggedIds.includes(claim.id) && !verificationResult) {
    return {
      claim_id: claim.id,
      claim_text: claim.text,
      verdict: "VERIFIED",
      confidence: Math.min(0.9, (consistencyResult?.consistency_score ?? 0.8) + 0.1),
      hallucination_type: "none",
      consistency_score: consistencyResult?.consistency_score ?? 0.8,
      evidence: [],
      reasoning: `Passed consistency check (score: ${consistencyResult?.consistency_score ?? 0.8}, threshold: ${METHOD.consistency_threshold}).`,
      severity: null,
    };
  }

  // Verification failed → no evidence-free guess by the judge
  if (verificationResult?.error) {
    return {
      claim_id: claim.id,
      claim_text: claim.text,
      verdict: "UNVERIFIABLE",
      confidence: 0.3,
      hallucination_type: null,
      consistency_score: consistencyResult?.consistency_score ?? 0.5,
      evidence: verificationResult.evidence,
      reasoning: `Verification failed: ${verificationResult.error}`,
      severity: null,
    };
  }

  // Evidence and the independent answers disagree → the judge decides
  if (consistencyConflicts(verificationResult?.verification_status, consistencyResult)) {
    return null;
  }

  // Clear SUPPORTED — unless every supporting item is the verifier's own, unconfirmed text
  if (verificationResult?.verification_status === "SUPPORTED") {
    const supporting = verificationResult.evidence.filter((e) => e.support_relation === "supports");
    if (supporting.length > 0 && !supporting.some(confirmed)) return null;
    return {
      claim_id: claim.id,
      claim_text: claim.text,
      verdict: "VERIFIED",
      confidence: 0.85,
      hallucination_type: "none",
      consistency_score: consistencyResult?.consistency_score ?? 0.5,
      evidence: verificationResult.evidence,
      reasoning: `Evidence supports the claim: ${verificationResult.explanation}`,
      severity: null,
    };
  }

  // Contradicted by one website only → the judge weighs it before a HALLUCINATION verdict
  if (singleSourceContradiction(verificationResult)) {
    return null;
  }

  // Clear CONTRADICTED
  if (verificationResult?.verification_status === "CONTRADICTED") {
    return {
      claim_id: claim.id,
      claim_text: claim.text,
      verdict: "HALLUCINATION",
      confidence: 0.85,
      hallucination_type: mapClaimTypeToHallucinationType(claim.type),
      consistency_score: consistencyResult?.consistency_score ?? 0.5,
      evidence: verificationResult.evidence,
      reasoning: `Evidence contradicts the claim: ${verificationResult.explanation}`,
      severity: determineSeverity(claim.type),
    };
  }

  return null;
}

/**
 * The claim with its consistency samples and its evidence, as the judge sees
 * it. Evidence the verifying agent wrote itself is marked unconfirmed.
 */
export function buildJudgeClaimContext(
  claim: Claim,
  consistencyResult: ConsistencyResult | undefined,
  verificationResult: VerificationResult | undefined
): string {
  const evidence = verificationResult?.evidence ?? [];
  const consistency = consistencyResult
    ? `## Module 2 — Consistency Score: ${consistencyResult.consistency_score}
Mode: ${consistencyResult.mode}
Samples (independent answers by a model, with their relation to the claim): ${consistencyResult.samples?.map((s, i) => `\n  ${i + 1}. [${consistencyResult.sample_judgments?.[i] ?? "unjudged"}] ${s}`).join("") ?? "None"}`
    : "## Module 2 — Consistency Score: not measured";

  return `## Claim to judge:
ID: ${claim.id}
Text: "${claim.text}"
Type: ${claim.type}
Original sentence: "${claim.original_sentence}"

${consistency}

## Module 3 — Retrieval Evidence:
${
  evidence.length > 0
    ? evidence
        .map(
          (e, i) =>
            `[${i + 1}] ${e.support_relation.toUpperCase()} (conf: ${e.confidence})${confirmed(e) ? "" : " [unconfirmed]"}\n  Source: ${e.source_title} (${e.source_url})\n  Text: "${e.relevant_text}"`
        )
        .join("\n")
    : "No evidence retrieved"
}
Verification status: ${verificationResult?.verification_status ?? "NOT_VERIFIED"}
Explanation: ${verificationResult?.explanation ?? "N/A"}`;
}
