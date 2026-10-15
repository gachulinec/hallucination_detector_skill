import { describe, expect, test } from "vitest";
import { buildJudgeVerdict, decideWithoutJudge } from "../src/method/verdicts.js";
import type { Claim, Evidence } from "../src/schemas/index.js";
import type { VerificationResult } from "../src/method/retrieval.js";
import type { ConsistencyResult } from "../src/method/consistency.js";

const claim: Claim = {
  id: 7,
  text: "The Eiffel Tower is 330 m tall",
  source_position: { start: 0, end: 30 },
  type: "numeric",
  original_sentence: "The Eiffel Tower is 330 m tall.",
};

function webEvidence(url: string, relation: Evidence["support_relation"]): Evidence {
  return {
    source_url: url,
    source_title: url,
    relevant_text: `text from ${url}`,
    retrieval_method: "web_search",
    support_relation: relation,
    confidence: 0.8,
  };
}

/** Contradicting evidence from two independent websites */
const twoSourcesContradict = [
  webEvidence("https://en.wikipedia.org/wiki/Eiffel_Tower", "contradicts"),
  webEvidence("https://www.toureiffel.paris/en", "contradicts"),
];

function verification(overrides: Partial<VerificationResult>): VerificationResult {
  return {
    claim_id: 7,
    claim_text: claim.text,
    search_queries: ["eiffel tower height"],
    evidence: [],
    verification_status: "INSUFFICIENT",
    explanation: "",
    ...overrides,
  };
}

describe("decideWithoutJudge", () => {
  test("marks a claim UNVERIFIABLE when verification failed with an error", () => {
    const verdict = decideWithoutJudge(
      claim,
      undefined,
      verification({ error: "Tavily API returned 401" }),
      { flaggedIds: [7], sourceIsAnonymized: false }
    );

    expect(verdict?.verdict).toBe("UNVERIFIABLE");
    expect(verdict?.reasoning).toMatch(/Tavily API returned 401/);
  });

  test("maps SUPPORTED to VERIFIED without calling the judge", () => {
    const verdict = decideWithoutJudge(
      claim,
      undefined,
      verification({ verification_status: "SUPPORTED", explanation: "matches" }),
      { flaggedIds: [7], sourceIsAnonymized: false }
    );

    expect(verdict?.verdict).toBe("VERIFIED");
  });

  test("leaves INSUFFICIENT evidence without an error to the judge", () => {
    const verdict = decideWithoutJudge(claim, undefined, verification({}), {
      flaggedIds: [7],
      sourceIsAnonymized: false,
    });

    expect(verdict).toBeNull();
  });
});

describe("decideWithoutJudge with conflicting consistency samples", () => {
  const consistency = (judgments: Array<"supports" | "contradicts" | "not_addressed">): ConsistencyResult => ({
    claim_id: 7,
    claim_text: claim.text,
    consistency_score: judgments.filter((j) => j === "supports").length / judgments.length,
    mode: "multi_sample",
    samples: ["a", "b", "c"],
    sample_judgments: judgments,
    flagged: true,
  });
  const ctx = { flaggedIds: [7], sourceIsAnonymized: false };

  test("sends SUPPORTED evidence to the judge when most samples contradict the claim", () => {
    const verdict = decideWithoutJudge(
      claim,
      consistency(["contradicts", "contradicts", "contradicts"]),
      verification({ verification_status: "SUPPORTED" }),
      ctx
    );

    expect(verdict).toBeNull();
  });

  test("sends CONTRADICTED evidence to the judge when every sample supports the claim", () => {
    const verdict = decideWithoutJudge(
      claim,
      consistency(["supports", "supports", "supports"]),
      verification({ verification_status: "CONTRADICTED" }),
      ctx
    );

    expect(verdict).toBeNull();
  });

  test("keeps the direct verdict when evidence and samples agree", () => {
    expect(
      decideWithoutJudge(claim, consistency(["supports", "supports", "contradicts"]), verification({ verification_status: "SUPPORTED" }), ctx)?.verdict
    ).toBe("VERIFIED");
    expect(
      decideWithoutJudge(
        claim,
        consistency(["contradicts", "supports", "contradicts"]),
        verification({ verification_status: "CONTRADICTED", evidence: twoSourcesContradict }),
        ctx
      )?.verdict
    ).toBe("HALLUCINATION");
  });

  test("keeps the direct verdict when the consistency check produced no judgments", () => {
    const failed: ConsistencyResult = { ...consistency([]), consistency_score: 0.5, samples: [] };

    expect(decideWithoutJudge(claim, failed, verification({ verification_status: "SUPPORTED" }), ctx)?.verdict).toBe("VERIFIED");
  });
});

describe("decideWithoutJudge with a single contradicting source", () => {
  const ctx = { flaggedIds: [7], sourceIsAnonymized: false };

  test("sends CONTRADICTED to the judge when only one website contradicts the claim", () => {
    const verdict = decideWithoutJudge(
      claim,
      undefined,
      verification({
        verification_status: "CONTRADICTED",
        evidence: [
          webEvidence("https://www.example-travel.cz/tower", "contradicts"),
          webEvidence("https://example-travel.cz/tower-history", "contradicts"),
          webEvidence("https://en.wikipedia.org/wiki/Eiffel_Tower", "neutral"),
        ],
      }),
      ctx
    );

    expect(verdict).toBeNull();
  });

  test("sends CONTRADICTED to the judge when no evidence item contradicts the claim", () => {
    expect(decideWithoutJudge(claim, undefined, verification({ verification_status: "CONTRADICTED" }), ctx)).toBeNull();
  });

  test("decides CONTRADICTED directly when two independent websites contradict the claim", () => {
    const verdict = decideWithoutJudge(
      claim,
      undefined,
      verification({ verification_status: "CONTRADICTED", evidence: twoSourcesContradict }),
      ctx
    );

    expect(verdict?.verdict).toBe("HALLUCINATION");
  });

  test("decides directly when the provided source document contradicts the claim", () => {
    const verdict = decideWithoutJudge(
      claim,
      undefined,
      verification({
        verification_status: "CONTRADICTED",
        evidence: [
          {
            source_url: "source_document",
            source_title: "Provided Source Document",
            relevant_text: "The tower is 300 m tall.",
            retrieval_method: "source_document",
            support_relation: "contradicts",
            confidence: 0.8,
          },
        ],
      }),
      ctx
    );

    expect(verdict?.verdict).toBe("HALLUCINATION");
  });
});

describe("buildJudgeVerdict", () => {
  const neutralEvidence: Evidence[] = [
    {
      source_url: "https://example.com",
      source_title: "Example",
      relevant_text: "The tower is tall.",
      retrieval_method: "web_search",
      support_relation: "neutral",
      confidence: 0.5,
    },
  ];

  test("turns an invalid verdict value into UNVERIFIABLE", () => {
    const verdict = buildJudgeVerdict(
      claim,
      { verdict: "SUPPORTED", confidence: 0.9, reasoning: "looks fine" },
      0.8,
      neutralEvidence
    );

    expect(verdict.verdict).toBe("UNVERIFIABLE");
    expect(verdict.reasoning).toMatch(/invalid verdict/i);
  });

  test("uses a numeric fallback when confidence is not a number", () => {
    const verdict = buildJudgeVerdict(
      claim,
      { verdict: "VERIFIED", confidence: "high", reasoning: "ok" },
      0.8,
      neutralEvidence
    );

    expect(Number.isFinite(verdict.confidence)).toBe(true);
  });

  test("caps HALLUCINATION confidence when no evidence contradicts the claim", () => {
    const verdict = buildJudgeVerdict(
      claim,
      {
        verdict: "HALLUCINATION",
        confidence: 0.95,
        hallucination_type: "numeric_fabrication",
        severity: "major",
        reasoning: "seems wrong",
      },
      0.5,
      neutralEvidence
    );

    expect(verdict.verdict).toBe("HALLUCINATION");
    expect(verdict.confidence).toBeLessThanOrEqual(0.7);
  });

  test("drops unknown hallucination types and severities", () => {
    const verdict = buildJudgeVerdict(
      claim,
      {
        verdict: "HALLUCINATION",
        confidence: 0.6,
        hallucination_type: "made_up",
        severity: "high",
        reasoning: "x",
      },
      0.5,
      neutralEvidence
    );

    expect(verdict.hallucination_type).toBeNull();
    expect(verdict.severity).toBeNull();
  });
});
