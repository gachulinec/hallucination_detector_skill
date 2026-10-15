import { describe, expect, test } from "vitest";
import { chunkForExtraction, mergeChunkClaims } from "../src/utils/extraction-chunks.js";
import type { Claim } from "../src/schemas/index.js";

const paragraph = (n: number) =>
  `Paragraph ${n}. ` + "The study reported several figures about adoption and cost. ".repeat(8);

describe("chunkForExtraction", () => {
  test("splits a long text without headings into chunks under the limit", () => {
    const text = Array.from({ length: 60 }, (_, i) => paragraph(i)).join("\n\n");

    const chunks = chunkForExtraction(text, 4000);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4000);
    }
  });

  test("keeps every paragraph of the input", () => {
    const text = Array.from({ length: 60 }, (_, i) => paragraph(i)).join("\n\n");

    const joined = chunkForExtraction(text, 4000)
      .map((c) => c.text)
      .join("\n\n");

    for (let i = 0; i < 60; i++) {
      expect(joined).toContain(`Paragraph ${i}.`);
    }
  });

  test("splits an oversized chapter even when headings are present", () => {
    const text = [
      "# Introduction",
      paragraph(0),
      "# Results",
      ...Array.from({ length: 40 }, (_, i) => paragraph(i + 1)),
      "# Conclusion",
      paragraph(99),
    ].join("\n\n");

    const chunks = chunkForExtraction(text, 4000);

    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4000);
    }
  });

  test("returns a short text as a single chunk", () => {
    expect(chunkForExtraction("Paris is the capital of France.", 4000)).toHaveLength(1);
  });

  const nonWhitespace = (s: string) => s.replace(/\s+/g, "");

  test("keeps every character of a long paragraph with decimals and abbreviations", () => {
    const sentence = "Revenue was 3.5 million in the U.S. market on 1.2.2025 and margin reached 12.4% overall. ";
    const text = sentence.repeat(120); // one paragraph, no blank lines, ~10k chars

    const chunks = chunkForExtraction(text, 4000);

    expect(nonWhitespace(chunks.map((c) => c.text).join(""))).toBe(nonWhitespace(text));
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4000);
    }
  });

  test("keeps a short introduction before the first heading", () => {
    const sections = Array.from({ length: 30 }, (_, i) => `## Heading ${i}\n\n${paragraph(i)}`);
    const text = "Revenue hit $9 billion in 2024.\n\n" + sections.join("\n\n");

    const joined = chunkForExtraction(text, 6000).map((c) => c.text).join("\n\n");

    expect(joined).toContain("Revenue hit $9 billion in 2024.");
  });

  test("packs many small sections into few chunks", () => {
    const sections = Array.from({ length: 30 }, (_, i) => `## Heading ${i}\n\n${paragraph(i)}`);
    const text = sections.join("\n\n");

    const chunks = chunkForExtraction(text, 6000);

    expect(chunks.length).toBeLessThanOrEqual(Math.ceil(text.length / 6000) + 1);
  });

  test("reports chunk offsets that point at the chunk text in the document", () => {
    const text = Array.from({ length: 60 }, (_, i) => paragraph(i)).join("\n\n");

    for (const chunk of chunkForExtraction(text, 4000)) {
      expect(text.slice(chunk.start, chunk.start + 30)).toBe(chunk.text.slice(0, 30));
    }
  });
});

describe("mergeChunkClaims", () => {
  const claim = (id: number, start: number): Claim => ({
    id,
    text: `claim ${id}`,
    source_position: { start, end: start + 5 },
    type: "factual",
    original_sentence: `claim ${id}.`,
  });

  test("renumbers claims sequentially and shifts positions by the chunk offset", () => {
    const merged = mergeChunkClaims([
      { offset: 0, claims: [claim(1, 0), claim(2, 10)] },
      { offset: 1000, claims: [claim(1, 3)] },
    ]);

    expect(merged.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(merged[2].source_position).toEqual({ start: 1003, end: 1008 });
  });
});
