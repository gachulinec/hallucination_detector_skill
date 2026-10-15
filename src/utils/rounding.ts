/**
 * Number checks for answers of the grounded verifier, done in code because
 * the model sometimes slips despite its rules:
 * - a text that says "about 380 million m³" where the source says "375.5
 *   million m³" states the source value rounded, not a contradiction;
 * - a SUPPORTED answer must quote a passage that states the claim's number.
 */

export interface ParsedNumber {
  value: number;
  /** The rounding unit the number is written to: 380 → 10, 2 → 1, 34.7 → 0.1 */
  step: number;
}

// Thousands groups separated by spaces ("19 763"), or digits with "." / "," separators
const NUMBER = /\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?(?!\d)|\d+(?:[.,]\d+)*/g;

// Words that mark a value as approximate (Slovak, Czech, English); "nearly" / "takmer" mean less than, not rounded
const APPROXIMATE = /(?<!\p{L})(približne|zhruba|okolo|cca|asi|přibližně|kolem|about|approximately|approx|around|roughly|some)(?!\p{L})|[~≈]/iu;

function parseToken(token: string): ParsedNumber {
  const compact = token.replace(/[   ]/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");

  let integer = compact;
  let fraction = "";
  if (lastComma >= 0 && lastDot >= 0) {
    // Both separators: the last one is the decimal separator ("8,848.86", "1.234,5")
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    [integer, fraction = ""] = compact.split(thousands).join("").split(decimal);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const parts = compact.split(separator);
    // "1,500" and "1.234.567" group thousands; "375,5" and "34.7" have decimals
    const groupsThousands =
      parts.length > 2 || (separator === "," && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== "0");
    if (groupsThousands) {
      integer = parts.join("");
    } else {
      [integer, fraction] = parts;
    }
  }

  const value = parseFloat(fraction ? `${integer}.${fraction}` : integer);
  const trailingZeros = value === 0 ? 0 : (/0+$/.exec(integer)?.[0].length ?? 0);
  const step = fraction ? 10 ** -fraction.length : 10 ** trailingZeros;
  return { value, step };
}

/** The numbers in a text, with the rounding unit each is written to. */
export function parseNumbers(text: string): ParsedNumber[] {
  return (text.match(NUMBER) ?? []).map(parseToken);
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
}

/**
 * True when the claim marks its value as approximate and every number in it
 * is a number of the quote, at least one of them rounded to the claim's
 * precision (375.5 → "about 380"). When all numbers match exactly, the
 * disagreement is about something else and this check does not apply.
 */
export function isRoundedMatch(claimText: string, quote: string): boolean {
  if (!APPROXIMATE.test(claimText)) return false;
  const claimNumbers = parseNumbers(claimText);
  const quoteValues = parseNumbers(quote).map((n) => n.value);
  if (claimNumbers.length === 0 || quoteValues.length === 0) return false;

  let rounded = false;
  for (const { value, step } of claimNumbers) {
    if (quoteValues.some((q) => same(q, value))) continue;
    if (quoteValues.some((q) => same(Math.round(q / step) * step, value))) {
      rounded = true;
      continue;
    }
    return false;
  }
  return rounded;
}

/**
 * True when the quote states at least one of the claim's numbers, exactly or
 * rounded to the claim's precision; claims without numbers always pass. A
 * SUPPORTED answer whose quote states none of them backs a different value.
 */
export function quoteStatesClaimNumber(claimText: string, quote: string): boolean {
  const claimNumbers = parseNumbers(claimText);
  if (claimNumbers.length === 0) return true;
  const quoteValues = parseNumbers(quote).map((n) => n.value);
  return claimNumbers.some(({ value, step }) =>
    quoteValues.some((q) => same(q, value) || same(Math.round(q / step) * step, value))
  );
}
