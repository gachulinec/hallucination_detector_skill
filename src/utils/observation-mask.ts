import type { Evidence } from "../schemas/index.js";

interface SearchResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
  score?: number;
}

/**
 * Masks search results down to concise evidence extracts.
 * Reduces context by 60-80% while preserving key information.
 */
export function maskSearchResults(
  results: SearchResult[],
  claimText: string,
  snippetChars = 200
): Evidence[] {
  return results
    .filter((r) => r.content || r.raw_content)
    .slice(0, 5)
    .map((result) => {
      const fullText = result.content || result.raw_content || "";
      const relevantSnippet = extractRelevantSnippet(fullText, claimText, snippetChars);

      return {
        source_url: result.url || "unknown",
        source_title: result.title || "Unknown",
        relevant_text: relevantSnippet,
        retrieval_method: "web_search" as const,
        support_relation: "neutral" as const,
        confidence: result.score || 0.5,
      };
    });
}

/**
 * Extracts the most relevant snippet from a long text,
 * centered around keywords from the claim.
 */
function extractRelevantSnippet(
  text: string,
  claim: string,
  maxLength: number
): string {
  if (text.length <= maxLength) return text;

  const keywords = claim
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  let bestStart = 0;
  let bestScore = 0;

  const windowSize = maxLength;
  for (let i = 0; i <= text.length - windowSize; i += 50) {
    const window = text.slice(i, i + windowSize).toLowerCase();
    const score = keywords.reduce(
      (sum, kw) => sum + (window.includes(kw) ? 1 : 0),
      0
    );
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }

  return text.slice(bestStart, bestStart + maxLength).trim();
}

/**
 * Formats evidence array into a concise reference string for context.
 */
export function formatEvidenceSummary(evidence: Evidence[]): string {
  return evidence
    .map(
      (e, i) =>
        `[Evidence ${i + 1}] ${e.support_relation.toUpperCase()}: &quot;${e.relevant_text.slice(0, 150)}&quot; — ${e.source_title}`
    )
    .join("\n");
}
