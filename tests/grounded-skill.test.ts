import { describe, expect, test } from "vitest";
import { GROUNDED_QUESTION, buildGroundedRules, resolveGroundedAnswer, validateGroundedFields } from "../src/method/grounded.js";

const SOURCE =
  "The reservoir holds 375.5 million m³ of water. The survey covered 250 small businesses in Slovakia. In total, 62% of respondents used a cloud service.";
const base = { claim_id: 1, claim_text: "", quote: null, source_says: null, explanation: "" };

describe("validateGroundedFields", () => {
  test("rejects a quote that is not in the source", () => {
    const v = validateGroundedFields({ status: "CONTRADICTED", quote: "The survey covered 300 small firms" }, SOURCE, "The survey covered 300 firms");
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.quoteRejected).toBe(true);
      expect(v.feedback).toMatch(/was not found in the source document/);
    }
  });

  test("rejects a SUPPORTED quote that does not state the claim's number", () => {
    const v = validateGroundedFields(
      { status: "SUPPORTED", quote: "The survey covered 250 small businesses in Slovakia" },
      SOURCE,
      "62% of respondents used a cloud service"
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.feedback).toMatch(/does not state the number/);
  });

  test("accepts a CONTRADICTED answer with a verbatim quote", () => {
    const v = validateGroundedFields(
      { status: "contradicted", quote: "The survey covered 250 small businesses", source_says: "250", explanation: "x" },
      SOURCE,
      "The survey covered 300 small businesses"
    );
    expect(v).toEqual({ ok: true, status: "CONTRADICTED", quote: "The survey covered 250 small businesses", source_says: "250", explanation: "x" });
  });
});

describe("resolveGroundedAnswer", () => {
  test("a retreat to NOT_IN_SOURCE after a rejected quote is no finding", () => {
    const r = resolveGroundedAnswer(base, { ok: true, status: "NOT_IN_SOURCE", quote: null, source_says: null, explanation: "" }, true, "c");
    expect(r.status).toBeNull();
    expect(r.error).toMatch(/after its quote was rejected/);
  });

  test("a rounded approximate value is SUPPORTED", () => {
    const quote = "The reservoir holds 375.5 million m³ of water";
    const r = resolveGroundedAnswer(
      base,
      { ok: true, status: "CONTRADICTED", quote, source_says: "375.5", explanation: "" },
      false,
      "The reservoir holds about 380 million m³ of water"
    );
    expect(r.status).toBe("SUPPORTED");
  });
});

describe("grounded rules", () => {
  test("take the explanation language and forbid outside knowledge", () => {
    const rules = buildGroundedRules("English");
    expect(rules).toContain("Write the explanation in English.");
    expect(rules).toMatch(/outside knowledge/i);
  });

  test("ask the pipeline's question", () => {
    expect(GROUNDED_QUESTION).toBe(
      "Does the source document confirm this exact number/fact? If the number or fact is different, what does the source say?"
    );
  });
});
