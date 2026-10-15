import { describe, expect, test } from "vitest";
import {
  clamp01,
  normalizeHallucinationType,
  normalizeRelation,
  normalizeSeverity,
  normalizeVerdict,
  normalizeVerificationStatus,
} from "../src/utils/validate.js";

describe("normalizeVerificationStatus", () => {
  test("accepts valid values regardless of case and whitespace", () => {
    expect(normalizeVerificationStatus(" supported ")).toBe("SUPPORTED");
    expect(normalizeVerificationStatus("CONTRADICTED")).toBe("CONTRADICTED");
  });

  test("maps anything else to INSUFFICIENT", () => {
    expect(normalizeVerificationStatus("PARTIALLY_SUPPORTED")).toBe("INSUFFICIENT");
    expect(normalizeVerificationStatus(undefined)).toBe("INSUFFICIENT");
  });
});

describe("normalizeVerdict", () => {
  test("accepts valid verdicts", () => {
    expect(normalizeVerdict("hallucination")).toBe("HALLUCINATION");
  });

  test("returns null for an invalid verdict so the caller can mark it UNVERIFIABLE", () => {
    expect(normalizeVerdict("SUPPORTED")).toBeNull();
    expect(normalizeVerdict(42)).toBeNull();
  });
});

describe("normalizeHallucinationType", () => {
  test("accepts valid types", () => {
    expect(normalizeHallucinationType("numeric_fabrication")).toBe("numeric_fabrication");
  });

  test("returns null for unknown types", () => {
    expect(normalizeHallucinationType("made_up")).toBeNull();
  });
});

describe("normalizeSeverity", () => {
  test("accepts valid severities and rejects others", () => {
    expect(normalizeSeverity("Major")).toBe("major");
    expect(normalizeSeverity("high")).toBeNull();
  });
});

describe("normalizeRelation", () => {
  test("maps unknown relations to neutral", () => {
    expect(normalizeRelation("SUPPORTS")).toBe("supports");
    expect(normalizeRelation("refutes")).toBe("neutral");
  });
});

describe("clamp01", () => {
  test("clamps numbers into [0, 1]", () => {
    expect(clamp01(1.4, 0.5)).toBe(1);
    expect(clamp01(-2, 0.5)).toBe(0);
    expect(clamp01(0, 0.5)).toBe(0);
  });

  test("uses the fallback for non-numeric values instead of producing NaN", () => {
    expect(clamp01("high", 0.5)).toBe(0.5);
    expect(clamp01(Number.NaN, 0.3)).toBe(0.3);
    expect(clamp01(undefined, 0.3)).toBe(0.3);
  });
});
