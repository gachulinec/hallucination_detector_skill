/**
 * Checks of extracted claims that the pipeline leaves to the prompt: an agent
 * running the method may shorten the work, so code checks it.
 */

import { normalizeForMatch } from "../utils/quote-match.js";
import { parseNumbers } from "../utils/rounding.js";

/**
 * Text without the Markdown that is not prose: link targets, bare URLs,
 * footnote markers, emphasis and code marks (AI answers are Markdown).
 */
export function plainText(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<https?:\/\/[^>]+>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*\[\^?\d+\]/g, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(?<![\w*])([*_])(?=\S)([^*_\n]*?\S)\1(?![\w*])/g, "$2")
    .replace(/`([^`]*)`/g, "$1");
}

/** The text as sentenceInText compares it. */
export function normalizeText(text: string): string {
  return normalizeForMatch(plainText(text));
}

/** True when the sentence occurs in the text normalized by normalizeText. */
export function sentenceInText(sentence: string, normalizedText: string): boolean {
  const s = normalizeText(sentence).replace(/^["'\s]+|["'\s]+$/g, "");
  return s.length > 0 && normalizedText.includes(s);
}

export interface UncoveredSentence {
  sentence: string;
  numbers: string[];
}

/** Prose sentences with digits. Headings and table rows are left out: the title is context, tables are parsed in code. */
function numericSentences(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("|"))
    // List markers are not numbers of the text
    .map((line) => plainText(line.replace(/^(?:\d+[.)]|[-*+])\s+/, "")))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .filter((sentence) => /\d/.test(sentence));
}

/** Sentences with numbers that none of the claims taken from that sentence states. */
export function uncoveredNumbers(
  text: string,
  claims: Array<{ text: string; original_sentence: string }>
): UncoveredSentence[] {
  const result: UncoveredSentence[] = [];
  for (const sentence of numericSentences(text)) {
    const normalized = normalizeText(sentence);
    const own = claims.filter((c) => {
      const claimSentence = normalizeText(c.original_sentence);
      return claimSentence.length > 0 && (normalized.includes(claimSentence) || claimSentence.includes(normalized));
    });
    const stated = new Set(own.flatMap((c) => parseNumbers(c.text).map((n) => n.value)));
    const missing = [...new Set(parseNumbers(sentence).map((n) => n.value))].filter((v) => !stated.has(v));
    if (missing.length > 0) result.push({ sentence, numbers: missing.map(String) });
  }
  return result;
}
