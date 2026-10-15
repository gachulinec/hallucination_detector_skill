/**
 * Section Splitter — splits text into logical sections for chapter-by-chapter verification.
 *
 * Detection priority:
 * 1. Markdown headings (# ## ###)
 * 2. Numbered sections (1. / 1.1 / Section 1)
 * 3. All-caps or bold headings
 * 4. Fallback: chunk by ~1500 chars at paragraph boundaries
 */

export interface TextSection {
  id: number;
  title: string;
  text: string;
  start: number;
  end: number;
}

/**
 * Split text into sections based on structure detection.
 */
export function splitIntoSections(text: string, maxChunkSize = 1500): TextSection[] {
  // Try numbered sections first (most precise — top-level only), then headings, then fallback
  let sections = splitByNumberedSections(text);
  if (sections.length <= 2) {
    sections = splitByHeadings(text);
  }
  if (sections.length <= 1) {
    // Fallback: chunk by paragraphs
    return splitByParagraphChunks(text, maxChunkSize);
  }

  // Merge tiny sections (< 200 chars) with previous section
  const merged: TextSection[] = [];
  for (const section of sections) {
    if (section.text.length < 200 && merged.length > 0) {
      const prev = merged[merged.length - 1];
      prev.text += "\n\n" + section.text;
      prev.end = section.end;
    } else {
      merged.push({ ...section });
    }
  }

  // Re-number
  return merged.map((s, i) => ({ ...s, id: i + 1 }));
}

/**
 * Split by markdown headings (# ## ###), all-caps lines, or standalone title lines.
 * A standalone title line is: preceded by empty line, short (< 100 chars),
 * no period at end, followed by paragraph text.
 */
function splitByHeadings(text: string): TextSection[] {
  const lines = text.split("\n");
  const matches: { index: number; title: string }[] = [];
  let charPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const prevLine = i > 0 ? lines[i - 1].trim() : "";
    const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : "";

    const isHeading =
      // Markdown heading
      /^#{1,4}\s+.+/.test(trimmed) ||
      // All-caps line (5+ chars)
      (/^[A-ZÁÄČĎÉÍĽŇÓÔŔŠŤÚÝŽ][A-ZÁÄČĎÉÍĽŇÓÔŔŠŤÚÝŽ\s\d.,:'–-]{4,}$/.test(trimmed)) ||
      // Standalone title: preceded by blank line, short, no period, capitalized
      (prevLine === "" &&
        trimmed.length > 5 &&
        trimmed.length < 100 &&
        !trimmed.endsWith(".") &&
        !trimmed.endsWith(",") &&
        /^[A-ZÁÄČĎÉÍĽŇÓÔŔŠŤÚÝŽ"\u201C]/.test(trimmed) &&
        nextLine !== "" &&
        // Avoid matching data lines (contain lots of numbers or special chars)
        !/\d.*\d.*\d/.test(trimmed));

    if (isHeading && trimmed.length > 0) {
      matches.push({
        index: charPos,
        title: trimmed.replace(/^#+\s*/, ""),
      });
    }

    charPos += line.length + 1; // +1 for \n
  }

  if (matches.length < 2) return [];

  return buildSectionsFromSplitPoints(text, matches);
}

/**
 * Split by numbered sections — only top-level (1. 2. 3. ...), not sub-sections (1.1, 2.2).
 * Sub-sections get merged into their parent chapter, mimicking manual chapter-by-chapter analysis.
 */
function splitByNumberedSections(text: string): TextSection[] {
  // Match both top-level (1. 2. 3.) and sub-sections (1.1, 2.2, 10.3)
  const allNumberedPattern = /^(?:\d{1,2}\.(?:\d{1,2}\.?)?\s+.+|(?:Section|Sekcia|Kapitola|Časť)\s+\d+[.:]\s*.+)$/gim;
  // Match ONLY top-level sections (1. 2. 3. ... 12.) — no dot-dot patterns like 2.1
  const topLevelPattern = /^(?:\d{1,2}\.\s+[^\d].+|(?:Section|Sekcia|Kapitola|Časť)\s+\d+[.:]\s*.+)$/i;

  const allMatches: { index: number; title: string; isTopLevel: boolean }[] = [];

  for (const match of text.matchAll(allNumberedPattern)) {
    const title = match[0].trim();
    const isTopLevel = topLevelPattern.test(title);
    allMatches.push({ index: match.index ?? 0, title, isTopLevel });
  }

  // Use only top-level sections as split points
  const topLevelMatches = allMatches.filter((m) => m.isTopLevel);

  if (topLevelMatches.length < 2) return [];

  return buildSectionsFromSplitPoints(text, topLevelMatches);
}

/**
 * Build sections from detected split points.
 */
function buildSectionsFromSplitPoints(
  text: string,
  points: { index: number; title: string }[]
): TextSection[] {
  const sections: TextSection[] = [];

  // If there's content before the first heading, include it
  if (points[0].index > 0) {
    const preText = text.slice(0, points[0].index).trim();
    if (preText.length > 50) {
      sections.push({
        id: 1,
        title: "Úvod",
        text: preText,
        start: 0,
        end: points[0].index,
      });
    }
  }

  for (let i = 0; i < points.length; i++) {
    const start = points[i].index;
    const end = i < points.length - 1 ? points[i + 1].index : text.length;
    const sectionText = text.slice(start, end).trim();

    if (sectionText.length > 20) {
      sections.push({
        id: sections.length + 1,
        title: points[i].title,
        text: sectionText,
        start,
        end,
      });
    }
  }

  return sections;
}

/**
 * Fallback: split into chunks at paragraph boundaries.
 */
function splitByParagraphChunks(text: string, maxSize: number): TextSection[] {
  const paragraphs = text.split(/\n\s*\n/);
  const sections: TextSection[] = [];
  let currentText = "";
  let currentStart = 0;
  let pos = 0;

  for (const para of paragraphs) {
    const paraWithGap = para + "\n\n";

    if (currentText.length + paraWithGap.length > maxSize && currentText.length > 0) {
      sections.push({
        id: sections.length + 1,
        title: `Časť ${sections.length + 1}`,
        text: currentText.trim(),
        start: currentStart,
        end: pos,
      });
      currentText = "";
      currentStart = pos;
    }

    currentText += paraWithGap;
    pos += paraWithGap.length;
  }

  // Last chunk
  if (currentText.trim().length > 0) {
    sections.push({
      id: sections.length + 1,
      title: `Časť ${sections.length + 1}`,
      text: currentText.trim(),
      start: currentStart,
      end: text.length,
    });
  }

  return sections;
}
