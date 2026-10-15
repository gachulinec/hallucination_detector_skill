/**
 * Page Fetcher — downloads a web page and returns its readable text
 * (direct fetch + Mozilla Readability). Pages that are not HTML (PDF) or are
 * rendered by JavaScript yield no text; the claim then keeps its snippet result.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface PageFetchResult {
  text: string | null;
  method: "direct" | "none";
  reason?: string;
}

export interface PageFetcherOptions {
  fetchImpl?: typeof fetch;
  minTextChars?: number;
  directTimeoutMs?: number;
}

export interface PageFetcher {
  fetchPageText(url: string): Promise<PageFetchResult>;
}

const MAX_HTML_CHARS = 5_000_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extracts the main readable text of an HTML page.
 */
export function extractReadableText(html: string): string {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll("script, style, noscript, template")) {
    el.remove();
  }

  // Readability's types expect a DOM Document; linkedom provides a compatible one.
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], {
    charThreshold: 200,
  }).parse();
  if (article?.textContent && article.textContent.trim().length > 0) {
    return normalizeWhitespace(article.textContent);
  }

  // Fallback: whole body without navigation chrome
  for (const el of document.querySelectorAll("nav, header, footer, aside")) {
    el.remove();
  }
  return normalizeWhitespace(document.body?.textContent ?? "");
}

function claimNumbers(claim: string): string[] {
  return [...new Set(claim.match(/\d+(?:[.,]\d+)?/g) ?? [])];
}

function claimKeywords(claim: string): string[] {
  return [
    ...new Set(
      claim
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 3 && !/^\d+$/.test(w))
    ),
  ];
}

function containsNumber(window: string, num: string): boolean {
  const escaped = num.replace(/[.]/g, "\\.");
  return new RegExp(`(?<![\\d.,])${escaped}(?![\\d])`).test(window);
}

/**
 * Picks the k most relevant passages of `size` chars for a claim.
 * Numbers from the claim weigh more than keywords: they decide most factual checks.
 */
export function selectPassages(text: string, claim: string, k: number, size: number): string[] {
  if (text.length <= size) return [text];

  const numbers = claimNumbers(claim);
  const keywords = claimKeywords(claim);
  const step = Math.max(1, Math.floor(size / 4));
  const scored: Array<{ start: number; score: number }> = [];

  for (let start = 0; start < text.length; start += step) {
    const window = text.slice(start, start + size);
    const lower = window.toLowerCase();
    const score =
      numbers.reduce((sum, n) => sum + (containsNumber(window, n) ? 3 : 0), 0) +
      keywords.reduce((sum, kw) => sum + (lower.includes(kw) ? 1 : 0), 0);
    scored.push({ start, score });
    if (start + size >= text.length) break;
  }

  scored.sort((a, b) => b.score - a.score || a.start - b.start);
  const selected: number[] = [];
  for (const s of scored) {
    if (selected.every((prev) => Math.abs(prev - s.start) >= size)) {
      selected.push(s.start);
      if (selected.length >= k) break;
    }
  }

  return selected.map((start) => text.slice(start, start + size).trim());
}

export function createPageFetcher(options: PageFetcherOptions = {}): PageFetcher {
  const fetchImpl = options.fetchImpl ?? fetch;
  const minTextChars = options.minTextChars ?? 300;
  const directTimeoutMs = options.directTimeoutMs ?? 10_000;

  return {
    async fetchPageText(url: string): Promise<PageFetchResult> {
      try {
        const res = await fetchImpl(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(directTimeoutMs),
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          },
        });
        if (!res.ok) return { text: null, method: "none", reason: `HTTP ${res.status}` };

        const contentType = res.headers.get("content-type") ?? "";
        if (!/html|xml/i.test(contentType)) {
          return { text: null, method: "none", reason: `unsupported content type: ${contentType || "unknown"}` };
        }

        const html = (await res.text()).slice(0, MAX_HTML_CHARS);
        const text = extractReadableText(html);
        if (text.length < minTextChars) {
          return {
            text: null,
            method: "none",
            reason: `too little text (${text.length} chars), page likely rendered by JavaScript`,
          };
        }
        return { text, method: "direct" };
      } catch (error) {
        return { text: null, method: "none", reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
