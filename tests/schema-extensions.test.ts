import { describe, expect, test } from "vitest";
import { EvidenceSchema, HallucinationReportSchema } from "../src/schemas/index.js";
import { normalizeForMatch } from "../src/utils/quote-match.js";

describe("schema extensions", () => {
  const evidence = {
    source_url: "https://a.example",
    source_title: "A",
    relevant_text: "t",
    retrieval_method: "web_search",
    support_relation: "supports",
    confidence: 0.5,
  };

  test("evidence may be marked unconfirmed", () => {
    expect(EvidenceSchema.parse({ ...evidence, checked: false }).checked).toBe(false);
    expect(EvidenceSchema.parse(evidence).checked).toBeUndefined();
  });

  test("a report may say how a skill run ran", () => {
    const runInfo = HallucinationReportSchema.shape.run_info;
    expect(runInfo.parse(undefined)).toBeUndefined();
    expect(
      runInfo.parse({ tool: "hallucination-check-skill", version: "1.0.0", profile: "quick", origin: "self", independence: "partial", network: null })
    ).toMatchObject({ profile: "quick" });
    expect(() => runInfo.parse({ tool: "t", version: "1", profile: "fast", origin: "self", independence: "none", network: true })).toThrow();
  });
});

describe("normalizeForMatch", () => {
  test("ignores case, quote and dash variants, diacritics and whitespace", () => {
    expect(normalizeForMatch("„Veľký“  —  Požiar")).toBe(normalizeForMatch('"velky" - poziar'));
  });
});
