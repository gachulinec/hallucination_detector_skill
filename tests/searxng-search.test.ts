import { describe, expect, test } from "vitest";
import { checkSearxng, createSearxngSearcher } from "../src/utils/searxng-search.js";

type FetchCall = { url: string; init?: RequestInit };

function fakeFetch(responses: Array<Response | Error>): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const result = (n: number) => ({
  url: `https://example.com/${n}`,
  title: `Result ${n}`,
  content: `Snippet ${n}`,
  engines: ["google cse"],
});

const okBody = {
  query: "q",
  results: [1, 2, 3, 4, 5, 6, 7].map(result),
  unresponsive_engines: [["duckduckgo", "CAPTCHA"]],
};

const noWait = { minIntervalMs: 0, sleep: async () => {} };

describe("createSearxngSearcher", () => {
  test("queries the local instance for JSON with automatic language", async () => {
    const { fetchImpl, calls } = fakeFetch([Response.json(okBody)]);
    const searcher = createSearxngSearcher({ baseUrl: "http://localhost:8888", fetchImpl, ...noWait });

    await searcher.search("Bratislavský hrad požiar 1811");

    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe("http://localhost:8888/search");
    expect(url.searchParams.get("q")).toBe("Bratislavský hrad požiar 1811");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("language")).toBe("auto");
  });

  test("returns the top results with title, url and snippet", async () => {
    const { fetchImpl } = fakeFetch([Response.json(okBody)]);
    const searcher = createSearxngSearcher({ baseUrl: "http://localhost:8888", fetchImpl, limit: 5, ...noWait });

    const outcome = await searcher.search("q");

    expect(outcome.error).toBeUndefined();
    expect(outcome.results).toHaveLength(5);
    expect(outcome.results[0]).toEqual({ url: "https://example.com/1", title: "Result 1", content: "Snippet 1" });
    expect(outcome.engines).toEqual(["google cse"]);
  });

  test("treats no results with every engine unresponsive as a failure and retries", async () => {
    const blocked = { query: "q", results: [], unresponsive_engines: [["google cse", "CAPTCHA"], ["seznam", "timeout"]] };
    const { fetchImpl, calls } = fakeFetch([Response.json(blocked), Response.json(okBody)]);
    const waits: number[] = [];
    const searcher = createSearxngSearcher({
      baseUrl: "http://localhost:8888",
      fetchImpl,
      minIntervalMs: 0,
      retryDelaysMs: [5000],
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    const outcome = await searcher.search("q");

    expect(calls).toHaveLength(2);
    expect(waits).toEqual([5000]);
    expect(outcome.results.length).toBeGreaterThan(0);
  });

  test("reports engines that keep failing after the retries", async () => {
    const blocked = { query: "q", results: [], unresponsive_engines: [["google cse", "CAPTCHA"]] };
    const { fetchImpl } = fakeFetch([Response.json(blocked), Response.json(blocked)]);
    const searcher = createSearxngSearcher({ baseUrl: "http://localhost:8888", fetchImpl, minIntervalMs: 0, retryDelaysMs: [1], sleep: async () => {} });

    const outcome = await searcher.search("q");

    expect(outcome.results).toEqual([]);
    expect(outcome.error).toMatch(/SearXNG search failed: no engine answered/);
    expect(outcome.error).toMatch(/google cse \(CAPTCHA\)/);
  });

  test("accepts an empty result list when the engines did answer", async () => {
    const { fetchImpl } = fakeFetch([Response.json({ query: "q", results: [], unresponsive_engines: [] })]);
    const searcher = createSearxngSearcher({ baseUrl: "http://localhost:8888", fetchImpl, ...noWait });

    const outcome = await searcher.search("q");

    expect(outcome.error).toBeUndefined();
    expect(outcome.results).toEqual([]);
  });

  test("tells how to start SearXNG when it is not running", async () => {
    const { fetchImpl } = fakeFetch([new Error("fetch failed"), new Error("fetch failed")]);
    const searcher = createSearxngSearcher({ baseUrl: "http://localhost:8888", fetchImpl, minIntervalMs: 0, retryDelaysMs: [1], sleep: async () => {} });

    const outcome = await searcher.search("q");

    expect(outcome.error).toMatch(/SearXNG search failed/);
    expect(outcome.error).toMatch(/scripts\/searxng\.sh start/);
  });

  test("spaces searches so the engines are not flooded", async () => {
    const { fetchImpl } = fakeFetch([Response.json(okBody), Response.json(okBody), Response.json(okBody)]);
    let clock = 0;
    const waits: number[] = [];
    const searcher = createSearxngSearcher({
      baseUrl: "http://localhost:8888",
      fetchImpl,
      minIntervalMs: 1500,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });

    await Promise.all([searcher.search("a"), searcher.search("b"), searcher.search("c")]);

    expect(waits).toEqual([1500, 1500]);
  });
});

describe("checkSearxng", () => {
  test("returns null when the instance answers with JSON", async () => {
    const { fetchImpl } = fakeFetch([Response.json(okBody)]);

    expect(await checkSearxng("http://localhost:8888", fetchImpl)).toBeNull();
  });

  test("explains how to start it when it does not answer", async () => {
    const { fetchImpl } = fakeFetch([new Error("ECONNREFUSED")]);

    expect(await checkSearxng("http://localhost:8888", fetchImpl)).toMatch(/scripts\/searxng\.sh start/);
  });
});
