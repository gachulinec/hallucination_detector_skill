/**
 * Checks that a quote returned by a model really appears in the source
 * document. This is the deterministic guard against invented evidence.
 */

// A quote must be long enough to point at a specific passage
const MIN_QUOTE_CHARS = 15;
const MIN_QUOTE_WORDS = 3;

/** Text compared loosely: quote and dash variants, case, diacritics and whitespace ignored. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/ /g, " ")
    // Words hyphenated across a line break in PDF text: "adop-\ntion" → "adoption"
    .replace(/(\p{L})-[ \t]*\r?\n\s*(\p{Ll})/gu, "$1$2")
    .toLowerCase()
    // Diacritics: a quote that drops or changes an accent ("časti" for "častí") still points at the passage
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The same source is checked once per claim; normalizing it once is enough
let cachedSource: string | null = null;
let cachedNormalized = "";

function normalizedSource(source: string): string {
  if (source !== cachedSource) {
    cachedSource = source;
    cachedNormalized = normalizeForMatch(source);
  }
  return cachedNormalized;
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

export function verifyQuote(quote: string, source: string): boolean {
  // Surrounding quote marks and ellipses are not part of the quoted text
  const q = normalizeForMatch(quote).replace(/^["'\s.…]+|["'\s…]+$/g, "");
  if (q.length < MIN_QUOTE_CHARS || q.split(" ").length < MIN_QUOTE_WORDS) return false;

  const src = normalizedSource(source);
  // Match on word boundaries only: "4.5%" must not match inside "14.5%"
  for (let idx = src.indexOf(q); idx !== -1; idx = src.indexOf(q, idx + 1)) {
    const startsClean = !isWordChar(q[0]) || !isWordChar(src[idx - 1]);
    const endsClean = !isWordChar(q[q.length - 1]) || !isWordChar(src[idx + q.length]);
    if (startsClean && endsClean) return true;
  }
  return false;
}
