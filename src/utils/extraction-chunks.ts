/**
 * Splits a document into chunks for claim extraction, so long documents are
 * not sent to the extractor in a single call (which drops claims).
 *
 * Chunks are contiguous slices of the document: nothing is dropped, only the
 * whitespace between two chunks. Breaks fall on paragraph boundaries, inside
 * an oversized paragraph on sentence boundaries, and as a last resort mid-text.
 */

import type { Claim } from "../schemas/index.js";

export interface ExtractionChunk {
  id: number;
  title: string;
  text: string;
  /** Offset of the chunk text in the full document */
  start: number;
  end: number;
}

interface Span {
  start: number;
  end: number;
}

/** Splits [start, end) at matches of `separator`; the spans keep every non-separator character. */
function splitSpan(text: string, span: Span, separator: RegExp): Span[] {
  const spans: Span[] = [];
  const re = new RegExp(separator.source, separator.flags.includes("g") ? separator.flags : separator.flags + "g");
  re.lastIndex = span.start;
  let pieceStart = span.start;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null && match.index < span.end) {
    if (match.index > pieceStart) spans.push({ start: pieceStart, end: match.index });
    pieceStart = match.index + match[0].length;
    if (match[0].length === 0) re.lastIndex++;
  }
  if (pieceStart < span.end) spans.push({ start: pieceStart, end: span.end });
  return spans;
}

/** Units no longer than maxChars: paragraphs, then sentences, then hard cuts. */
function units(text: string, maxChars: number): Span[] {
  const result: Span[] = [];
  for (const paragraph of splitSpan(text, { start: 0, end: text.length }, /\n\s*\n/)) {
    if (paragraph.end - paragraph.start <= maxChars) {
      result.push(paragraph);
      continue;
    }
    // Sentence ends: punctuation followed by whitespace, so "3.5" and "U.S." inside a sentence stay intact
    for (const sentence of splitSpan(text, paragraph, /(?<=[.!?])\s+/)) {
      for (let s = sentence.start; s < sentence.end; s += maxChars) {
        result.push({ start: s, end: Math.min(sentence.end, s + maxChars) });
      }
    }
  }
  return result;
}

export function chunkForExtraction(text: string, maxChars: number): ExtractionChunk[] {
  if (text.length <= maxChars) {
    return [{ id: 1, title: "Text", text, start: 0, end: text.length }];
  }

  const chunks: ExtractionChunk[] = [];
  let current: Span | null = null;
  const flush = () => {
    if (!current) return;
    chunks.push({
      id: chunks.length + 1,
      title: `Part ${chunks.length + 1}`,
      text: text.slice(current.start, current.end),
      start: current.start,
      end: current.end,
    });
    current = null;
  };

  for (const unit of units(text, maxChars)) {
    if (current && unit.end - current.start <= maxChars) {
      current.end = unit.end;
    } else {
      flush();
      current = { ...unit };
    }
  }
  flush();
  return chunks;
}

/**
 * Merges claims extracted from separate chunks: sequential IDs, positions
 * shifted to the full document.
 */
export function mergeChunkClaims(
  chunks: Array<{ offset: number; claims: Claim[] }>
): Claim[] {
  const merged: Claim[] = [];
  for (const chunk of chunks) {
    for (const claim of chunk.claims) {
      merged.push({
        ...claim,
        id: merged.length + 1,
        // LLM output is not schema-checked, so the position may be missing
        source_position: {
          start: (claim.source_position?.start ?? 0) + chunk.offset,
          end: (claim.source_position?.end ?? 0) + chunk.offset,
        },
      });
    }
  }
  return merged;
}
