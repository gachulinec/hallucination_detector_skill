import { describe, expect, test } from "vitest";
import { METHOD } from "../src/method/config.js";
import { QUESTION_INSTRUCTIONS, SAMPLE_INSTRUCTIONS, SAMPLE_JUDGMENT_RULES } from "../src/method/consistency.js";
import { NLI_RULES, QUERY_INSTRUCTIONS } from "../src/method/retrieval.js";

describe("the method keeps the pipeline's wording", () => {
  test("consistency instructions", () => {
    expect(QUESTION_INSTRUCTIONS).toBe(
      "Convert this factual claim into a direct question that can be answered with a specific fact. The question must name the claim's specific subject (person, event, place, time), taken from the claim or its context, so it can be answered without the document."
    );
    expect(SAMPLE_INSTRUCTIONS).toBe("Answer this question with a specific, factual answer. Be direct and concise.");
    expect(SAMPLE_JUDGMENT_RULES).toBe(
      [
        "For each answer, decide how it relates to the CLAIM:",
        '- "supports": the answer states the same fact or value as the claim (a value rounded to the claim\'s precision counts as the same)',
        '- "contradicts": the answer states a different fact or value for what the claim asserts',
        '- "not_addressed": the answer does not give that fact, or is unsure',
      ].join("\n")
    );
  });

  test("web verification instructions", () => {
    expect(QUERY_INSTRUCTIONS).toBe(
      "Each query must name the claim's specific subject (person, event, place, time), taken from the claim or its context, so the results are about the same subject."
    );
    expect(NLI_RULES).toBe(
      [
        "Be CONSERVATIVE — only mark as CONTRADICTED when evidence CLEARLY refutes the claim.",
        "Verify only the claim; the context only tells which subject it is about. Evidence about a different subject (a namesake, another event, place or year) is NEUTRAL, not a contradiction.",
      ].join("\n")
    );
  });

  test("thresholds and limits", () => {
    expect(METHOD).toMatchObject({
      consistency_threshold: 0.8,
      hallucination_confidence: 0.8,
      extraction_chunk_chars: 6000,
      max_evidence_per_claim: 5,
      passages_per_page: 3,
      passage_chars: 800,
      source_passages_chars: 30_000,
      consistency_samples: 3,
    });
  });
});
