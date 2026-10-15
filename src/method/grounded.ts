/**
 * Faithfulness check of the method (from the pipeline's grounded verifier and
 * faithfulness pipeline, commit 82f9de2): an answer from the source document
 * only, its quote and numbers checked in code, and the verdicts.
 */

import type { Claim, Verdict } from "../schemas/index.js";
import { selectPassages } from "../utils/page-fetcher.js";
import { loadPrompt } from "../utils/prompts.js";
import { verifyQuote } from "../utils/quote-match.js";
import { isRoundedMatch, parseNumbers, quoteStatesClaimNumber } from "../utils/rounding.js";
import type { TextSection } from "../utils/section-splitter.js";

export interface AtomicClaim {
  id: number;
  text: string;
  sectionId: number;
  /** The claim's sentence in the checked text with the text before it */
  context?: string;
}

export type GroundedStatus = "SUPPORTED" | "CONTRADICTED" | "NOT_IN_SOURCE";

export interface GroundedResult {
  claim_id: number;
  claim_text: string;
  /** null when no valid answer could be obtained */
  status: GroundedStatus | null;
  quote: string | null;
  source_says: string | null;
  explanation: string;
  error?: string;
}

export type GroundedBase = Omit<GroundedResult, "status" | "error">;

const STATUSES: readonly GroundedStatus[] = ["SUPPORTED", "CONTRADICTED", "NOT_IN_SOURCE"];
const PASSAGE_CHARS = 1500;

/** The rules of an answer from the source document only. */
export function buildGroundedRules(language: string): string {
  return loadPrompt("grounded-verifier").replace("{{LANGUAGE}}", language);
}

/** The question asked for every claim. */
export const GROUNDED_QUESTION =
  "Does the source document confirm this exact number/fact? If the number or fact is different, what does the source say?";

/** Appended to the feedback of a retry: it asks only for an exact quote, never for a different status. */
export const GROUNDED_RETRY_SUFFIX = "Answer again. The quote must be copied character-for-character from the source document.";

/**
 * The whole source document when it fits within `maxChars`; otherwise the
 * passages most relevant to the claim.
 */
export function buildSourceContext(source: string, claimText: string, maxChars: number): string {
  if (source.length <= maxChars) return source;
  const k = Math.max(1, Math.floor(maxChars / PASSAGE_CHARS));
  return selectPassages(source, claimText, k, PASSAGE_CHARS).join("\n\n[...]\n\n");
}

export type GroundedValidation =
  | { ok: true; status: GroundedStatus; quote: string | null; source_says: string | null; explanation: string }
  | { ok: false; feedback: string; quoteRejected?: boolean };

/**
 * Checks the fields of one answer: a valid status, a verbatim quote for
 * SUPPORTED / CONTRADICTED, and the claim's number in a SUPPORTED quote.
 */
export function validateGroundedFields(answerFields: Record<string, unknown>, source: string, claimText: string): GroundedValidation {
  const status = typeof answerFields.status === "string" ? answerFields.status.trim().toUpperCase() : "";
  if (!(STATUSES as readonly string[]).includes(status)) {
    return { ok: false, feedback: `Your previous answer had an invalid status ${JSON.stringify(answerFields.status)}.` };
  }

  const quote = typeof answerFields.quote === "string" && answerFields.quote.trim() ? answerFields.quote.trim() : null;
  if (status !== "NOT_IN_SOURCE" && (!quote || !verifyQuote(quote, source))) {
    return {
      ok: false,
      quoteRejected: true,
      feedback: quote ? `The quote ${JSON.stringify(quote)} was not found in the source document.` : "Your previous answer had no quote.",
    };
  }

  // A SUPPORTED quote must state the value the claim is about, not another number
  if (status === "SUPPORTED" && quote && !quoteStatesClaimNumber(claimText, quote)) {
    const numbers = parseNumbers(claimText).map((n) => n.value).join(", ");
    return {
      ok: false,
      feedback: `Your quote does not state the number ${numbers} from the claim. Quote the passage of the source document that states the value the claim is about.`,
    };
  }

  return {
    ok: true,
    status: status as GroundedStatus,
    quote: quote && verifyQuote(quote, source) ? quote : null,
    source_says: typeof answerFields.source_says === "string" && answerFields.source_says.trim() ? answerFields.source_says.trim() : null,
    explanation: typeof answerFields.explanation === "string" ? answerFields.explanation : "",
  };
}

/**
 * The result of a valid answer. Retreating to NOT_IN_SOURCE after a rejected
 * quote is not a finding; a CONTRADICTED value that is the quoted source value
 * rounded is SUPPORTED.
 */
export function resolveGroundedAnswer(
  base: GroundedBase,
  validation: Extract<GroundedValidation, { ok: true }>,
  quoteRejected: boolean,
  claimText: string
): GroundedResult {
  if (quoteRejected && validation.status === "NOT_IN_SOURCE") {
    return { ...base, status: null, error: "The model changed its answer to NOT_IN_SOURCE after its quote was rejected." };
  }
  if (validation.status === "CONTRADICTED" && validation.quote && isRoundedMatch(claimText, validation.quote)) {
    return {
      ...base,
      status: "SUPPORTED",
      quote: validation.quote,
      explanation: `Rounded value: the source states "${validation.quote}", which rounds to the claim's approximate value.`,
    };
  }
  return { ...base, status: validation.status, quote: validation.quote, source_says: validation.source_says, explanation: validation.explanation };
}

/**
 * The extractor's claims as claims for the grounded check: same id, text and
 * context, labeled with the section of the text their sentence is in.
 */
export function toAtomicClaims(claims: Claim[], sections: Pick<TextSection, "id" | "start" | "end">[], text: string): AtomicClaim[] {
  return claims.map((claim) => {
    const at = text.indexOf(claim.original_sentence);
    const section = at >= 0 ? sections.find((s) => at >= s.start && at < s.end) : undefined;
    return {
      id: claim.id,
      text: claim.text,
      sectionId: section?.id ?? sections[0]?.id ?? 0,
      context: claim.context,
    };
  });
}

/**
 * Grounded results as verdicts. A claim is VERIFIED only when the source
 * confirmed it with a checked quote; failures and claims without a result are
 * UNVERIFIABLE.
 */
export function groundedResultsToVerdicts(
  results: GroundedResult[],
  claims: AtomicClaim[],
  sections: { id: number; title: string }[],
  options: { partialSource?: boolean } = {}
): Verdict[] {
  const byClaimId = new Map(results.map((r) => [r.claim_id, r]));

  return claims.map((claim) => {
    const r = byClaimId.get(claim.id);
    const sectionTitle = sections.find((s) => s.id === claim.sectionId)?.title || "Unknown";

    // With only passages of a long source, "not found" may just mean the right passage was not selected
    const unverifiedAbsence = r?.status === "NOT_IN_SOURCE" && options.partialSource;

    if (!r || r.status === null || unverifiedAbsence) {
      return {
        claim_id: claim.id,
        claim_text: claim.text,
        verdict: "UNVERIFIABLE" as const,
        confidence: 0.3,
        hallucination_type: null,
        consistency_score: 0.5,
        evidence: [],
        reasoning: unverifiedAbsence
          ? "Not found in the passages selected from the (long) source document; the rest of the document was not checked."
          : r?.error
            ? `Verification against the source failed: ${r.error}`
            : "No verification result for this claim.",
        severity: null,
      };
    }

    const quoteEvidence = r.quote
      ? [
          {
            source_url: "source_document",
            source_title: `Source document — ${sectionTitle}`,
            relevant_text: r.quote,
            retrieval_method: "source_document" as const,
            support_relation: r.status === "SUPPORTED" ? ("supports" as const) : ("contradicts" as const),
            confidence: 0.9,
          },
        ]
      : [];

    if (r.status === "SUPPORTED") {
      return {
        claim_id: claim.id,
        claim_text: claim.text,
        verdict: "VERIFIED" as const,
        confidence: 0.9,
        hallucination_type: "none" as const,
        consistency_score: 1.0,
        evidence: quoteEvidence,
        reasoning: r.explanation || "The source document confirms this claim.",
        severity: null,
      };
    }

    const notInSource = r.status === "NOT_IN_SOURCE";
    return {
      claim_id: claim.id,
      claim_text: claim.text,
      verdict: "HALLUCINATION" as const,
      // Absence is weaker evidence than an explicit contradiction
      confidence: notInSource ? 0.75 : 0.9,
      hallucination_type: /\d/.test(claim.text) ? ("numeric_fabrication" as const) : ("faithfulness" as const),
      consistency_score: 0,
      evidence: quoteEvidence,
      reasoning:
        r.explanation ||
        (notInSource ? "The source document does not state this claim." : `The source document says: ${r.source_says ?? r.quote ?? "a different value"}`),
      severity: "major" as const,
    };
  });
}

/** The text with markers at the flagged claims (HALLUCINATION, UNVERIFIABLE). */
export function generateAnnotatedText(text: string, flagged: Verdict[]): string {
  let annotated = text;
  for (const h of [...flagged].reverse()) {
    const marker = h.verdict === "HALLUCINATION" ? "[✗ HALLUCINATION]" : "[? UNVERIFIABLE]";
    const searchText = h.claim_text.slice(0, 40).toLowerCase();
    const idx = annotated.toLowerCase().indexOf(searchText);
    if (idx >= 0) {
      annotated = annotated.slice(0, idx) + `${marker} ` + annotated.slice(idx);
    }
  }
  return annotated;
}
