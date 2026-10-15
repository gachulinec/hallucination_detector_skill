import { describe, expect, test } from "vitest";
import { groundedResultsToVerdicts } from "../src/method/grounded.js";
import type { AtomicClaim, GroundedResult } from "../src/method/grounded.js";

const claims: AtomicClaim[] = [
  { id: 1, text: "Revenue grew by 35% in 2023", sectionId: 1 },
  { id: 2, text: "The survey had 250 respondents", sectionId: 1 },
  { id: 3, text: "Costs fell by 10%", sectionId: 1 },
];
const sections = [{ id: 1, title: "Results" }];

function result(overrides: Partial<GroundedResult> & Pick<GroundedResult, "claim_id">): GroundedResult {
  const claim = claims.find((c) => c.id === overrides.claim_id)!;
  return {
    claim_text: claim.text,
    status: "SUPPORTED",
    quote: null,
    source_says: null,
    explanation: "",
    ...overrides,
  };
}

describe("groundedResultsToVerdicts", () => {
  test("maps SUPPORTED to VERIFIED and CONTRADICTED to HALLUCINATION", () => {
    const verdicts = groundedResultsToVerdicts(
      [
        result({ claim_id: 1, status: "SUPPORTED", quote: "Revenue grew by 35% in 2023" }),
        result({ claim_id: 2, status: "CONTRADICTED", quote: "200 respondents", source_says: "200" }),
      ],
      claims.slice(0, 2),
      sections
    );

    expect(verdicts.map((v) => v.verdict)).toEqual(["VERIFIED", "HALLUCINATION"]);
    expect(verdicts[1].evidence[0]).toMatchObject({
      relevant_text: "200 respondents",
      support_relation: "contradicts",
    });
  });

  test("maps NOT_IN_SOURCE to HALLUCINATION", () => {
    const [verdict] = groundedResultsToVerdicts(
      [result({ claim_id: 3, status: "NOT_IN_SOURCE" })],
      [claims[2]],
      sections
    );

    expect(verdict.verdict).toBe("HALLUCINATION");
  });

  test("treats NOT_IN_SOURCE as UNVERIFIABLE when only passages of the source were checked", () => {
    const [verdict] = groundedResultsToVerdicts(
      [result({ claim_id: 3, status: "NOT_IN_SOURCE" })],
      [claims[2]],
      sections,
      { partialSource: true }
    );

    expect(verdict.verdict).toBe("UNVERIFIABLE");
  });

  test("marks a failed verification UNVERIFIABLE with the reason", () => {
    const [verdict] = groundedResultsToVerdicts(
      [result({ claim_id: 1, status: null, error: "claude CLI error: usage limit reached" })],
      [claims[0]],
      sections
    );

    expect(verdict.verdict).toBe("UNVERIFIABLE");
    expect(verdict.reasoning).toMatch(/usage limit reached/);
  });

  test("reports claims without a result as UNVERIFIABLE", () => {
    const verdicts = groundedResultsToVerdicts(
      [result({ claim_id: 1, status: "SUPPORTED", quote: "Revenue grew by 35% in 2023" })],
      claims,
      sections
    );

    expect(verdicts).toHaveLength(3);
    expect(verdicts.filter((v) => v.verdict === "UNVERIFIABLE").map((v) => v.claim_id)).toEqual([2, 3]);
  });
});
