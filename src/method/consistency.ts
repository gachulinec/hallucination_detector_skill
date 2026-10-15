/**
 * Consistency check of the method (from the pipeline's consistency checker,
 * commit 82f9de2): the instructions the skill's tasks use, and the score of
 * the independent answers.
 */

export type SampleJudgment = "supports" | "contradicts" | "not_addressed";

export interface ConsistencyResult {
  claim_id: number;
  claim_text: string;
  consistency_score: number;
  mode: string;
  samples: string[];
  /** How each sample relates to the claim */
  sample_judgments?: SampleJudgment[];
  flagged: boolean;
}

/**
 * Score = share of samples that support the claim (SelfCheckGPT-style).
 * Samples that agree with each other but not with the claim score 0.
 */
export function scoreSampleJudgments(
  raw: unknown,
  sampleCount: number
): { score: number; judgments: SampleJudgment[] } {
  const judgments = (raw as { judgments?: unknown } | null)?.judgments;
  if (!Array.isArray(judgments) || judgments.length !== sampleCount) {
    throw new Error(`Expected ${sampleCount} judgments, got ${JSON.stringify(judgments)}`);
  }
  const normalized = judgments.map((j): SampleJudgment => {
    const value = typeof j === "string" ? j.trim().toLowerCase() : "";
    return value === "supports" || value === "contradicts" ? value : "not_addressed";
  });
  return {
    score: normalized.filter((j) => j === "supports").length / sampleCount,
    judgments: normalized,
  };
}

/** How a claim becomes a question that names its subject. */
export const QUESTION_INSTRUCTIONS =
  "Convert this factual claim into a direct question that can be answered with a specific fact. The question must name the claim's specific subject (person, event, place, time), taken from the claim or its context, so it can be answered without the document.";

/** How an independent answer is written; the answerer never sees the claim. */
export const SAMPLE_INSTRUCTIONS = "Answer this question with a specific, factual answer. Be direct and concise.";

/**
 * How each answer is judged against the claim (not only against the other
 * answers: three answers that agree on a different value are evidence against it).
 */
export const SAMPLE_JUDGMENT_RULES = `For each answer, decide how it relates to the CLAIM:
- "supports": the answer states the same fact or value as the claim (a value rounded to the claim's precision counts as the same)
- "contradicts": the answer states a different fact or value for what the claim asserts
- "not_addressed": the answer does not give that fact, or is unsure`;
