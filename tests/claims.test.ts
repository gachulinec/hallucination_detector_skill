import { describe, expect, test } from "vitest";
import { finalizeExtractedClaims, normalizeExtractedClaims } from "../src/method/claims.js";
import type { Claim } from "../src/schemas/index.js";

const TEXT = [
  "# Survey",
  "",
  "The survey covered 250 firms. The director said John Smith led it.",
  "",
  "| Country | Firms |",
  "|---|---|",
  "| Slovakia | 120 |",
  "",
].join("\n");

function claim(id: number, text: string, type: Claim["type"], sentence: string): Claim {
  return { id, text, type, original_sentence: sentence, source_position: { start: 0, end: 0 } };
}

describe("normalizeExtractedClaims", () => {
  test("keeps claims with text and fills missing fields", () => {
    expect(normalizeExtractedClaims([{ text: "A fact", type: "bogus" }, { text: "  " }, 5, null])).toEqual([
      { id: 0, text: "A fact", source_position: { start: 0, end: 0 }, type: "factual", original_sentence: "A fact" },
    ]);
  });
});

describe("finalizeExtractedClaims", () => {
  const extracted = [
    claim(1, "The survey covered 250 firms", "numeric", "The survey covered 250 firms."),
    claim(2, "The survey was impressive", "subjective", "The survey covered 250 firms."),
    claim(3, "The director said John Smith led the survey", "entity", "The director said John Smith led it."),
  ];

  test("drops subjective claims, adds table claims and context", () => {
    const { output, tableClaimsGenerated, tableClaimsAdded } = finalizeExtractedClaims(extracted, TEXT, undefined, { total: 1, failed: 0 });
    expect(output.claims.map((c) => c.id)).not.toContain(2);
    expect(tableClaimsGenerated).toBe(1);
    expect(tableClaimsAdded).toBe(1);
    expect(output.claims.some((c) => c.text === "Slovakia has a Firms of 120")).toBe(true);
    expect(output.claims[0].context).toContain("The survey covered 250 firms.");
    expect(output.document_title).toBe("Survey");
    expect(output.chunks_total).toBe(1);
    expect(output.source_is_anonymized).toBeUndefined();
  });

  test("flags attributions when the source is anonymized", () => {
    const { output } = finalizeExtractedClaims(extracted, TEXT, "All names have been anonymized.", { total: 1, failed: 0 });
    expect(output.source_is_anonymized).toBe(true);
    expect(output.claims.find((c) => c.id === 3)?.attribution_check).toBe(true);
    expect(output.claims.find((c) => c.id === 1)?.attribution_check).toBeUndefined();
  });
});
