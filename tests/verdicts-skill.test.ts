import { describe, expect, test } from "vitest";
import type { ConsistencyResult } from "../src/method/consistency.js";
import type { VerificationResult } from "../src/method/retrieval.js";
import {
  buildJudgeClaimContext,
  buildJudgeVerdict,
  decideWithoutJudge,
  singleSourceContradiction,
} from "../src/method/verdicts.js";
import type { Claim, Evidence } from "../src/schemas/index.js";

const claim: Claim = {
  id: 7,
  text: "The Eiffel Tower is 330 m tall",
  source_position: { start: 0, end: 30 },
  type: "numeric",
  original_sentence: "The Eiffel Tower is 330 m tall.",
};

function evidence(url: string, relation: Evidence["support_relation"], checked?: boolean): Evidence {
  return {
    source_url: url,
    source_title: url,
    relevant_text: `text from ${url}`,
    retrieval_method: "web_search",
    support_relation: relation,
    confidence: 0.8,
    ...(checked === undefined ? {} : { checked }),
  };
}

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

const consistency: ConsistencyResult = {
  claim_id: 7,
  claim_text: claim.text,
  consistency_score: 0.67,
  mode: "multi_sample",
  samples: ["330 m", "324 m", "330 metres"],
  sample_judgments: ["supports", "contradicts", "supports"],
  flagged: true,
};

const ctx = { flaggedIds: [7], sourceIsAnonymized: false };

describe("buildJudgeClaimContext", () => {
  test("keeps the pipeline's text when a consistency result exists", () => {
    const text = buildJudgeClaimContext(
      claim,
      consistency,
      verification({
        verification_status: "CONTRADICTED",
        evidence: [evidence("https://en.wikipedia.org/wiki/Eiffel_Tower", "contradicts")],
        explanation: "Wikipedia gives 330 m.",
      })
    );
    expect(text).toBe(
      [
        "## Claim to judge:",
        "ID: 7",
        'Text: "The Eiffel Tower is 330 m tall"',
        "Type: numeric",
        'Original sentence: "The Eiffel Tower is 330 m tall."',
        "",
        "## Module 2 — Consistency Score: 0.67",
        "Mode: multi_sample",
        "Samples (independent answers by a model, with their relation to the claim): ",
        "  1. [supports] 330 m",
        "  2. [contradicts] 324 m",
        "  3. [supports] 330 metres",
        "",
        "## Module 3 — Retrieval Evidence:",
        "[1] CONTRADICTS (conf: 0.8)",
        "  Source: https://en.wikipedia.org/wiki/Eiffel_Tower (https://en.wikipedia.org/wiki/Eiffel_Tower)",
        '  Text: "text from https://en.wikipedia.org/wiki/Eiffel_Tower"',
        "Verification status: CONTRADICTED",
        "Explanation: Wikipedia gives 330 m.",
      ].join("\n")
    );
  });

  test("says when consistency was not measured", () => {
    const text = buildJudgeClaimContext(claim, undefined, undefined);
    expect(text).toContain("## Module 2 — Consistency Score: not measured");
    expect(text).not.toContain("Mode: unknown");
  });

  test("marks unconfirmed evidence", () => {
    const text = buildJudgeClaimContext(claim, consistency, verification({ evidence: [evidence("https://a.example/x", "supports", false)] }));
    expect(text).toContain("[1] SUPPORTS (conf: 0.8) [unconfirmed]");
  });
});

describe("decisions with unconfirmed evidence", () => {
  test("support that rests only on unconfirmed evidence goes to the judge", () => {
    const v = verification({ verification_status: "SUPPORTED", evidence: [evidence("https://a.example/x", "supports", false)] });
    expect(decideWithoutJudge(claim, undefined, v, ctx)).toBeNull();
  });

  test("one confirmed supporting item is enough for VERIFIED", () => {
    const v = verification({
      verification_status: "SUPPORTED",
      evidence: [evidence("https://a.example/x", "supports", false), evidence("https://b.example/y", "supports", true)],
    });
    expect(decideWithoutJudge(claim, undefined, v, ctx)?.verdict).toBe("VERIFIED");
  });

  test("SUPPORTED without supporting items keeps the pipeline's behavior", () => {
    const v = verification({ verification_status: "SUPPORTED", evidence: [] });
    expect(decideWithoutJudge(claim, undefined, v, ctx)?.verdict).toBe("VERIFIED");
  });

  test("an unconfirmed site does not count toward two contradicting sites", () => {
    const v = verification({
      verification_status: "CONTRADICTED",
      evidence: [evidence("https://a.example/x", "contradicts", true), evidence("https://b.example/y", "contradicts", false)],
    });
    expect(singleSourceContradiction(v)).toBe(true);
    expect(decideWithoutJudge(claim, undefined, v, ctx)).toBeNull();
  });

  test("two confirmed contradicting sites decide HALLUCINATION without the judge", () => {
    const v = verification({
      verification_status: "CONTRADICTED",
      evidence: [evidence("https://a.example/x", "contradicts", true), evidence("https://b.example/y", "contradicts")],
    });
    expect(decideWithoutJudge(claim, undefined, v, ctx)?.verdict).toBe("HALLUCINATION");
  });

  test("the confidence cap counts confirmed contradicting evidence only", () => {
    const judged = { verdict: "HALLUCINATION", confidence: 0.95, reasoning: "r" };
    expect(buildJudgeVerdict(claim, judged, 0.5, [evidence("https://a.example/x", "contradicts", false)]).confidence).toBe(0.7);
    expect(buildJudgeVerdict(claim, judged, 0.5, [evidence("https://a.example/x", "contradicts")]).confidence).toBe(0.95);
  });
});
