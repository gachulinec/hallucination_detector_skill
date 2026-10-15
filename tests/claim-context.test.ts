import { describe, expect, test } from "vitest";
import { attachClaimContext, claimPassage, describeClaim, documentTitle } from "../src/utils/claim-context.js";
import type { Claim } from "../src/schemas/index.js";

function claim(text: string, sentence: string): Claim {
  return { id: 1, text, source_position: { start: 0, end: 0 }, type: "factual", original_sentence: sentence };
}

describe("documentTitle", () => {
  test("takes the markdown heading on the first line", () => {
    expect(documentTitle("# Slovak ice hockey and the 2002 World Championship\n\nThe team began in 1994.")).toBe(
      "Slovak ice hockey and the 2002 World Championship"
    );
  });

  test("takes a short first line without sentence punctuation as the title", () => {
    expect(documentTitle("Bratislava Castle\nThe castle stands on a hill above the Danube.")).toBe("Bratislava Castle");
  });

  test("returns nothing when the text starts with a sentence", () => {
    expect(documentTitle("The castle stands on a hill. It burned in 1811.")).toBeUndefined();
  });

  test("ignores a section heading further down", () => {
    expect(documentTitle("The castle stands on a hill.\n\n## History\n\nIt burned in 1811.")).toBeUndefined();
  });
});

describe("claimPassage", () => {
  const text =
    "# Slovak ice hockey\n\nThe Slovak team began in 1994 in group C, which it won at home. A year later it won group B in Bratislava. In 1996 it played among the elite.";

  test("gives the sentence together with the text before it", () => {
    expect(claimPassage(text, "A year later it won group B in Bratislava.")).toBe(
      "The Slovak team began in 1994 in group C, which it won at home. A year later it won group B in Bratislava."
    );
  });

  test("leaves out heading lines, since the title is given separately", () => {
    expect(claimPassage(text, "The Slovak team began in 1994 in group C, which it won at home.")).toBe(
      "The Slovak team began in 1994 in group C, which it won at home."
    );
  });

  test("keeps only the last part of a long preceding text, cut at a word", () => {
    const passage = claimPassage(text, "In 1996 it played among the elite.", 33);

    expect(passage).toBe("… it won group B in Bratislava. In 1996 it played among the elite.");
  });

  test("falls back to the sentence when it is not in the text", () => {
    expect(claimPassage(text, "A sentence the model paraphrased.")).toBe("A sentence the model paraphrased.");
  });
});

describe("attachClaimContext", () => {
  test("adds the passage around each claim's sentence", () => {
    const text = "Stodola studied in Budapest. He then graduated in Zurich in 1881.";
    const [result] = attachClaimContext([claim("Stodola graduated in 1881", "He then graduated in Zurich in 1881.")], text);

    expect(result.context).toBe("Stodola studied in Budapest. He then graduated in Zurich in 1881.");
  });
});

describe("describeClaim", () => {
  test("gives the claim with the document title and passage as context", () => {
    const described = describeClaim(
      { text: "The final took place on 11 May 2002", context: "In the final on 11 May 2002 Slovakia beat Russia 4:3." },
      "Slovak ice hockey and the 2002 World Championship"
    );

    expect(described).toContain('Claim: "The final took place on 11 May 2002"');
    expect(described).toContain("Document title: Slovak ice hockey and the 2002 World Championship");
    expect(described).toContain('Passage: "In the final on 11 May 2002 Slovakia beat Russia 4:3."');
    expect(described).toMatch(/only to identify what the claim refers to/);
  });

  test("gives only the claim when there is no context", () => {
    expect(describeClaim({ text: "Paris is the capital of France" })).toBe('Claim: "Paris is the capital of France"');
  });

  test("gives the title alone when there is no passage", () => {
    const described = describeClaim({ text: "It burned in 1811" }, "Bratislava Castle");

    expect(described).toContain("Document title: Bratislava Castle");
    expect(described).not.toContain("Passage:");
  });
});
