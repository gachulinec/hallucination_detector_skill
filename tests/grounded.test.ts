import { describe, expect, test } from "vitest";
import { verifyQuote } from "../src/utils/quote-match.js";
import { buildSourceContext } from "../src/method/grounded.js";

const SOURCE = `Annual Survey of Digital Adoption 2025

The survey covered 250 small businesses in Slovakia. In total, 62% of respondents reported using at least one cloud service, up from 48% in 2023. The average annual IT budget was 18,400 euros.`;

const claim = { id: 1, text: "72% of respondents reported using at least one cloud service", sectionId: 1 };


describe("verifyQuote", () => {
  test("finds a verbatim quote", () => {
    expect(verifyQuote("62% of respondents reported using", SOURCE)).toBe(true);
  });

  test("ignores differences in whitespace, line breaks and case", () => {
    expect(verifyQuote("the survey   covered 250\nsmall businesses", SOURCE)).toBe(true);
  });

  test("ignores curly versus straight quotes and dash variants", () => {
    const source = 'He said "adoption is slow" in the 2020-2023 period.';
    expect(verifyQuote("He said “adoption is slow” in the 2020–2023 period", source)).toBe(true);
  });

  test("joins words hyphenated across a PDF line break", () => {
    const source = "Cloud adop-\ntion grew quickly.";
    expect(verifyQuote("Cloud adoption grew quickly", source)).toBe(true);
  });

  test("ignores differences in diacritics", () => {
    const source = "Bola zbúraná značná časť Podhradia vrátane historicky hodnotných častí Vydrice.";
    expect(verifyQuote("vrátane historicky hodnotných časti Vydrice", source)).toBe(true);
  });

  test("still rejects a quote whose letters differ, not only their diacritics", () => {
    const source = "Bola zbúraná značná časť Podhradia vrátane historicky hodnotných častí Vydrice.";
    expect(verifyQuote("vrátane historicky hodnotných častí Petržalky", source)).toBe(false);
  });

  test("rejects a quote that is not in the source", () => {
    expect(verifyQuote("72% of respondents reported using", SOURCE)).toBe(false);
  });

  test("rejects an empty quote", () => {
    expect(verifyQuote("  ", SOURCE)).toBe(false);
  });

  test("rejects a quote that matches only part of a number", () => {
    expect(verifyQuote("4.5% of the budget in 2023", "Growth was 14.5% of the budget in 2023.")).toBe(false);
  });

  test("rejects a quote too short to identify a passage", () => {
    expect(verifyQuote("the survey", SOURCE)).toBe(false);
  });
});


describe("buildSourceContext", () => {
  test("uses the whole source when it fits", () => {
    expect(buildSourceContext(SOURCE, claim.text, 10_000)).toBe(SOURCE);
  });

  test("falls back to the most relevant passages for a very long source", () => {
    const filler = "Unrelated background about the methodology of the survey. ".repeat(400);
    const longSource = filler + "Exactly 62% of respondents used a cloud service. " + filler;

    const context = buildSourceContext(longSource, claim.text, 5_000);

    expect(context.length).toBeLessThan(longSource.length);
    expect(context).toContain("62% of respondents used a cloud service");
  });
});
