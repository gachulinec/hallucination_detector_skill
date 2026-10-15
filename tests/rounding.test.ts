import { describe, expect, test } from "vitest";
import { isRoundedMatch, parseNumbers, quoteStatesClaimNumber } from "../src/utils/rounding.js";

describe("parseNumbers", () => {
  test("reads decimal commas, decimal points and thousands separators", () => {
    expect(parseNumbers("objem vody: 375,5 mil. m³").map((n) => n.value)).toEqual([375.5]);
    expect(parseNumbers("height of 8,848.86 m").map((n) => n.value)).toEqual([8848.86]);
    expect(parseNumbers("na rozlohe 19 763 ha").map((n) => n.value)).toEqual([19763]);
    expect(parseNumbers("about 1,500 workers and 34.7%").map((n) => n.value)).toEqual([1500, 34.7]);
  });

  test("keeps separate numbers apart", () => {
    expect(parseNumbers("prietok 2 × 50 m³/s v roku 1998 a 1999").map((n) => n.value)).toEqual([2, 50, 1998, 1999]);
  });
});

describe("isRoundedMatch", () => {
  test("accepts an approximate claim value that is the source value rounded", () => {
    expect(isRoundedMatch("Priehrada zadržiava približne 380 miliónov m³ vody", "objem vody: 375,5 mil. m³")).toBe(true);
    expect(isRoundedMatch("The plant employs about 2 million people", "it employs 1.96 million people")).toBe(true);
  });

  test("requires the claim to say the value is approximate", () => {
    expect(isRoundedMatch("Priehrada zadržiava 380 miliónov m³ vody", "objem vody: 375,5 mil. m³")).toBe(false);
  });

  test("rejects a difference larger than the claim's rounding", () => {
    expect(isRoundedMatch("Nádrž zaberá približne 30 km²", "rozloha pri plnom napustení: 35 km²")).toBe(false);
    expect(isRoundedMatch("about 70% of respondents", "62% of respondents")).toBe(false);
  });

  test("does not apply when the numbers match exactly, so the contradiction is about something else", () => {
    expect(isRoundedMatch("Nádrž zaberá približne 35 km²", "rozloha pri plnom napustení: 35 km²")).toBe(false);
  });

  test("requires every number of the claim to be found in the quote", () => {
    expect(isRoundedMatch("V roku 1980 zadržiavala približne 380 mil. m³", "objem vody: 375,5 mil. m³")).toBe(false);
  });
});

describe("quoteStatesClaimNumber", () => {
  test("accepts a quote that states the claim's number", () => {
    expect(quoteStatesClaimNumber("The Hubble Space Telescope has a 2.4 m mirror", "Hubble features a 2.4 m (7 ft 10 in) mirror")).toBe(true);
  });

  test("accepts a value rounded to the claim's precision", () => {
    expect(quoteStatesClaimNumber("35% of respondents use cloud services", "34.7% of respondents use cloud services")).toBe(true);
  });

  test("accepts a quote with one of several claim numbers", () => {
    expect(quoteStatesClaimNumber("Hubble, launched in 1990, has a 2.4 m mirror", "Hubble features a 2.4 m mirror")).toBe(true);
  });

  test("applies to claims with numbers only", () => {
    expect(quoteStatesClaimNumber("The mirror was ground incorrectly", "its main mirror had been ground incorrectly")).toBe(true);
  });

  test("rejects a quote that states a different number for the claim's value", () => {
    expect(
      quoteStatesClaimNumber(
        "The magnesium fluoride coating on the Hubble mirror is 65 nm thick",
        "a protective coating of 25‑nm‑thick magnesium fluoride"
      )
    ).toBe(false);
  });
});
