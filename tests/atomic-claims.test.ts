import { describe, expect, test } from "vitest";
import { toAtomicClaims } from "../src/method/grounded.js";
import type { Claim } from "../src/schemas/index.js";

const text = "# Dam\n\nThe dam is 185 m high.\n\n## Operation\n\nThe plant has four turbines built by Škoda.";
const sections = [
  { id: 1, start: 0, end: text.indexOf("## Operation") },
  { id: 2, start: text.indexOf("## Operation"), end: text.length },
];

function claim(id: number, claimText: string, sentence: string): Claim {
  return {
    id,
    text: claimText,
    source_position: { start: 0, end: 0 },
    type: "entity",
    original_sentence: sentence,
    context: `context of claim ${id}`,
  };
}

describe("toAtomicClaims", () => {
  test("keeps the extractor's id, text and context, and finds the section of the claim's sentence", () => {
    const [result] = toAtomicClaims(
      [claim(7, "The dam's turbines were built by Škoda", "The plant has four turbines built by Škoda.")],
      sections,
      text
    );

    expect(result).toEqual({
      id: 7,
      text: "The dam's turbines were built by Škoda",
      sectionId: 2,
      context: "context of claim 7",
    });
  });

  test("falls back to the first section when the sentence is not in the text", () => {
    const [result] = toAtomicClaims([claim(1, "The dam is tall", "A paraphrased sentence.")], sections, text);

    expect(result.sectionId).toBe(1);
  });
});
