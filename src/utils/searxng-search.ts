/**
 * Web search through a local SearXNG instance (scripts/searxng.sh). SearXNG
 * queries several public search engines at once; engines that rate-limit or
 * answer with a CAPTCHA are skipped by SearXNG and listed as unresponsive.
 *
 * A search fails only when nothing answered — SearXNG unreachable, or no
 * results while every engine was unresponsive. Failures are retried after a
 * wait, then reported as an error, never as "no evidence".
 */

export interface WebSearchResult {
  title?: string;
  url?: string;
  content?: string;
}

export interface WebSearchOutcome {
  results: WebSearchResult[];
  /** Set when the search failed (SearXNG unreachable, no engine answered, invalid answer) */
  error?: string;
  /** Engines that delivered the returned results */
  engines?: string[];
}

export interface SearxngSearcherOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Results kept per search */
  limit?: number;
  timeoutMs?: number;
  /** Minimum gap between searches, to avoid flooding the public engines */
  minIntervalMs?: number;
  /** Waits before each retry of a failed search */
  retryDelaysMs?: number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SearxngSearcher {
  search(query: string): Promise<WebSearchOutcome>;
}

const START_HINT = "is SearXNG running? Start it with: bash scripts/searxng.sh start";

interface SearxngResponse {
  results?: Array<{ url?: string; title?: string; content?: string; engines?: string[] }>;
  unresponsive_engines?: Array<[string, string]>;
}

type Attempt = { outcome: WebSearchOutcome; retry: boolean };

function searchUrl(baseUrl: string, query: string): string {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "auto");
  return url.toString();
}

async function searchOnce(query: string, options: SearxngSearcherOptions): Promise<Attempt> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(searchUrl(options.baseUrl, query), {
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      headers: { accept: "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: { results: [], error: `SearXNG search failed: ${message} (${START_HINT})` }, retry: true };
  }
  if (!res.ok) {
    // 403 usually means the JSON format is not enabled in searxng/settings.yml
    return { outcome: { results: [], error: `SearXNG search failed: HTTP ${res.status}` }, retry: res.status >= 500 };
  }

  let body: SearxngResponse;
  try {
    body = (await res.json()) as SearxngResponse;
  } catch {
    return { outcome: { results: [], error: "SearXNG search failed: invalid (non-JSON) response" }, retry: false };
  }

  const results = (body.results ?? []).slice(0, options.limit ?? 5);
  const unresponsive = body.unresponsive_engines ?? [];
  if (results.length === 0 && unresponsive.length > 0) {
    const engines = unresponsive.map(([name, reason]) => `${name} (${reason})`).join(", ");
    return { outcome: { results: [], error: `SearXNG search failed: no engine answered — ${engines}` }, retry: true };
  }

  return {
    outcome: {
      results: results.map((r) => ({ url: r.url, title: r.title, content: r.content })),
      engines: [...new Set(results.flatMap((r) => r.engines ?? []))].sort(),
    },
    retry: false,
  };
}

/**
 * A searcher shared by all claims of a run: searches go out one at a time,
 * spaced by minIntervalMs; failed searches are retried after a wait.
 */
export function createSearxngSearcher(options: SearxngSearcherOptions): SearxngSearcher {
  const minIntervalMs = options.minIntervalMs ?? 1_500;
  const retryDelaysMs = options.retryDelaysMs ?? [10_000, 30_000, 60_000];
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;

  const throttled = (query: string): Promise<Attempt> => {
    const run = queue.then(async () => {
      const wait = lastStart + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return searchOnce(query, options);
    });
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    async search(query: string): Promise<WebSearchOutcome> {
      for (let attempt = 0; ; attempt++) {
        const { outcome, retry } = await throttled(query);
        if (!outcome.error || !retry || attempt >= retryDelaysMs.length) return outcome;
        await sleep(retryDelaysMs[attempt]);
      }
    },
  };
}

/** Startup check: null when SearXNG answers with JSON, otherwise what is wrong. */
export async function checkSearxng(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(searchUrl(baseUrl, "test"), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return `SearXNG at ${baseUrl} answered HTTP ${res.status} (is the JSON format enabled in searxng/settings.yml?)`;
    }
    await res.json();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `SearXNG at ${baseUrl} is not answering (${message}); ${START_HINT}`;
  }
}
