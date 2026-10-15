/**
 * Claim extraction of the method (from the pipeline's claim extractor, commit
 * 82f9de2): the fields of extracted claims, and claims.json from the merged
 * claims — subjective claims dropped, attributions flagged against an
 * anonymized source, table claims added, document context attached.
 */

import type { Claim, ClaimsOutput } from "../schemas/index.js";
import { attachClaimContext, documentTitle } from "../utils/claim-context.js";
import { generateTableClaims } from "../utils/table-parser.js";

const CLAIM_TYPES: readonly Claim["type"][] = ["factual", "faithfulness", "numeric", "entity", "subjective"];

/** True when the source document contains an anonymization or confidentiality clause. */
export function detectAnonymization(sourceDocument: string): boolean {
  return /anonymi[sz]ed|confidentiality\s+(agreement|polic)|company[- ]specific\s+data.*anonymi|quotes\s+have\s+been\s+anonymi|names?\s+(have\s+been\s+|were\s+)?(changed|removed|redacted)/i.test(
    sourceDocument
  );
}

/** True when a claim contains a specific attribution (named person or company in a quote context). */
function hasSpecificAttribution(claimText: string, originalSentence: string): boolean {
  const combined = `${claimText} ${originalSentence}`;
  const attributionPatterns = [
    /[""].+?[""].{0,30}(?:—|–|-)\s*[A-Z][a-z]+\s+[A-Z][a-z]+/, // "quote" — Firstname Lastname
    /(?:said|stated|noted|argued|explained|claimed)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/, // said Firstname Lastname
    /(?:Senior|Chief|Head|Director|VP|Partner|Manager|CEO|CTO|CFO)\s*,?\s*[A-Z]/, // Title, Company
    /(?:at|of|from)\s+(?:Goldman|Morgan|McKinsey|Deloitte|Google|Microsoft|Amazon|Meta|Apple|JPMorgan|Citigroup|KPMG|PwC|EY|Accenture)/i, // specific companies
  ];
  return attributionPatterns.some((p) => p.test(combined));
}

/** The claims of one chunk as the extractor returned them, with every field valid. */
export function normalizeExtractedClaims(raw: unknown[]): Claim[] {
  return (raw as Array<Partial<Claim> | null | undefined>)
    .filter((c): c is Partial<Claim> => typeof c?.text === "string" && c.text.trim().length > 0)
    .map((c) => ({
      id: typeof c.id === "number" ? c.id : 0,
      text: c.text as string,
      source_position: c.source_position ?? { start: 0, end: 0 },
      type: CLAIM_TYPES.includes(c.type as Claim["type"]) ? (c.type as Claim["type"]) : "factual",
      original_sentence: typeof c.original_sentence === "string" ? c.original_sentence : (c.text as string),
    }));
}

export interface FinalizedClaims {
  output: ClaimsOutput;
  tableClaimsGenerated: number;
  tableClaimsAdded: number;
}

export function finalizeExtractedClaims(
  extractedClaims: Claim[],
  text: string,
  sourceDocument: string | undefined,
  chunks: { total: number; failed: number }
): FinalizedClaims {
  const sourceIsAnonymized = sourceDocument ? detectAnonymization(sourceDocument) : false;
  const verifiableClaims = extractedClaims.filter((c) => c.type !== "subjective");

  if (sourceIsAnonymized) {
    for (const claim of verifiableClaims) {
      if (hasSpecificAttribution(claim.text, claim.original_sentence)) claim.attribution_check = true;
    }
  }

  // Claims of tables come from a deterministic parser, not from the model
  const tableClaims = generateTableClaims(text, sourceDocument);
  let tableClaimsAdded = 0;
  if (tableClaims.length > 0) {
    const existingTexts = new Set(verifiableClaims.map((c) => c.text.toLowerCase()));
    let nextId = verifiableClaims.length > 0 ? Math.max(...verifiableClaims.map((c) => c.id)) + 1 : 1;
    for (const tc of tableClaims) {
      if (existingTexts.has(tc.text.toLowerCase())) continue;
      verifiableClaims.push({
        id: nextId++,
        text: tc.text,
        source_position: tc.sourcePosition,
        type: tc.type,
        original_sentence: tc.originalRow,
      });
      tableClaimsAdded++;
    }
  }

  return {
    output: {
      // The sentence and the text before it, so later steps know what each claim refers to
      claims: attachClaimContext(verifiableClaims, text),
      document_title: documentTitle(text),
      source_is_anonymized: sourceIsAnonymized || undefined,
      chunks_total: chunks.total,
      chunks_failed: chunks.failed,
    },
    tableClaimsGenerated: tableClaims.length,
    tableClaimsAdded,
  };
}
