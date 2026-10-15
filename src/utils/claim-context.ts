/**
 * Document context for claims. An atomic claim such as "The premiere took
 * place in Cairo" does not say which premiere; without the document's title and
 * the surrounding text, search queries and checks guess the subject (another
 * event, a namesake) and judge the claim against the wrong facts.
 */

import type { Claim } from "../schemas/index.js";

/**
 * The document's title: a markdown heading on the first line, or a short first
 * line without sentence punctuation. Section headings further down are not titles.
 */
export function documentTitle(text: string): string | undefined {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;

  const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(firstLine);
  if (heading) return heading[1].trim();

  const looksLikeTitle = firstLine.length <= 100 && !/[.!?:;,]$/.test(firstLine) && text.trim() !== firstLine;
  return looksLikeTitle ? firstLine : undefined;
}

/**
 * The claim's sentence with up to `maxPreceding` characters of the text before
 * it (relative references such as "a year later" or "he" point back there).
 * Heading lines are left out, the title is given separately.
 */
export function claimPassage(text: string, sentence: string, maxPreceding = 300): string {
  const normalizedSentence = sentence.replace(/\s+/g, " ").trim();
  const at = normalizedSentence ? text.indexOf(sentence) : -1;
  if (at < 0) return normalizedSentence;

  const before = text
    .slice(0, at)
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!before) return normalizedSentence;
  if (before.length <= maxPreceding) return `${before} ${normalizedSentence}`;

  // Start at a word boundary: a word cut in half is dropped
  let start = before.length - maxPreceding;
  if (before[start - 1] !== " " && before[start] !== " ") {
    const space = before.indexOf(" ", start);
    start = space < 0 ? before.length : space;
  }
  const kept = before.slice(start).trim();
  return kept ? `… ${kept} ${normalizedSentence}` : normalizedSentence;
}

/** Adds each claim's passage (its sentence and the text before it) as `context`. */
export function attachClaimContext(claims: Claim[], text: string): Claim[] {
  return claims.map((claim) => ({ ...claim, context: claimPassage(text, claim.original_sentence) }));
}

/**
 * The claim for a model prompt, with the document title and passage that tell
 * what the claim refers to. The context is not itself to be verified.
 */
export function describeClaim(claim: Pick<Claim, "text" | "context">, title?: string): string {
  const claimLine = `Claim: "${claim.text}"`;
  const passage = claim.context?.trim();
  if (!title && !passage) return claimLine;

  const lines = [
    claimLine,
    "",
    "Context from the document (only to identify what the claim refers to: which person, event, place and time; do not verify the context itself):",
  ];
  if (title) lines.push(`Document title: ${title}`);
  if (passage) lines.push(`Passage: "${passage}"`);
  return lines.join("\n");
}
