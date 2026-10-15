/**
 * Text Sanitizer — strips formatting noise before claim extraction.
 * Removes: markdown headings, chapter numberings, section markers.
 * Preserves: all numerical data, sentences, and factual content.
 */

/**
 * Sanitize text by removing structural noise that causes false positives.
 */
export function sanitizeText(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let cleaned = line;

      // Remove markdown headings (# ## ### ####)
      cleaned = cleaned.replace(/^#{1,4}\s+/, "");

      // Remove chapter numbering at start of line ONLY if it's a heading
      // (no numbers/data in the rest of the line)
      if (/^\d{1,2}\.(?:\d{1,2}\.?)?\s+/.test(cleaned) && !/\d.*\d/.test(cleaned.replace(/^\d{1,2}\.(?:\d{1,2}\.?)?\s+/, ""))) {
        cleaned = cleaned.replace(/^\d{1,2}\.(?:\d{1,2}\.?)?\s+/, "");
      }

      // Remove "Section X:" / "Sekcia X:" prefixes
      cleaned = cleaned.replace(
        /^(?:Section|Sekcia|Kapitola|Časť)\s+\d+[.:]\s*/i,
        ""
      );

      // Remove all-caps section titles ONLY if they have NO numbers/data
      if (
        /^[A-ZÁÄČĎÉÍĽŇÓÔŔŠŤÚÝŽ\s]{5,}$/.test(cleaned.trim()) &&
        !/\d/.test(cleaned) &&
        !/%/.test(cleaned) &&
        !/\$/.test(cleaned)
      ) {
        return "";
      }

      return cleaned;
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
}
