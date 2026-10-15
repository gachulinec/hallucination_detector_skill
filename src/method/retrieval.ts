/**
 * Web verification of the method (from the pipeline's retrieval verifier,
 * commit 82f9de2): the shape of a claim's verification and the rules the
 * skill's verification tasks repeat.
 */

import type { Evidence } from "../schemas/index.js";

export interface VerificationResult {
  claim_id: number;
  claim_text: string;
  search_queries: string[];
  evidence: Evidence[];
  verification_status: "SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT";
  explanation: string;
  /** Set when verification could not run; the claim is then UNVERIFIABLE */
  error?: string;
  /** True when full pages were fetched because the first evidence was insufficient */
  escalated?: boolean;
}

/** What makes a search query precise. */
export const QUERY_INSTRUCTIONS =
  "Each query must name the claim's specific subject (person, event, place, time), taken from the claim or its context, so the results are about the same subject.";

/** How evidence is judged against a claim. */
export const NLI_RULES = `Be CONSERVATIVE — only mark as CONTRADICTED when evidence CLEARLY refutes the claim.
Verify only the claim; the context only tells which subject it is about. Evidence about a different subject (a namesake, another event, place or year) is NEUTRAL, not a contradiction.`;
