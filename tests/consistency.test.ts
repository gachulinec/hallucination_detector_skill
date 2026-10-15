import { describe, expect, test } from "vitest";
import { scoreSampleJudgments } from "../src/method/consistency.js";

describe("scoreSampleJudgments", () => {
  test("scores the share of samples that support the claim", () => {
    const result = scoreSampleJudgments({ judgments: ["supports", "supports", "contradicts"] }, 3);

    expect(result.judgments).toEqual(["supports", "supports", "contradicts"]);
    expect(result.score).toBeCloseTo(2 / 3);
  });

  test("gives 0 when every sample contradicts the claim, even if the samples agree with each other", () => {
    const result = scoreSampleJudgments({ judgments: ["contradicts", "contradicts", "contradicts"] }, 3);

    expect(result.score).toBe(0);
  });

  test("normalizes case and treats unknown labels as not_addressed", () => {
    const result = scoreSampleJudgments({ judgments: ["SUPPORTS", "maybe", "Contradicts"] }, 3);

    expect(result.judgments).toEqual(["supports", "not_addressed", "contradicts"]);
  });

  test("rejects an answer with the wrong number of judgments", () => {
    expect(() => scoreSampleJudgments({ judgments: ["supports"] }, 3)).toThrow(/3 judgments/);
    expect(() => scoreSampleJudgments({ score: 1 }, 3)).toThrow();
  });
});
