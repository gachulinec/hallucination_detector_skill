import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  fetchForClaim,
  isNetworkFailure,
  lookupEvidence,
  readClaimPassages,
  searchForClaim,
} from "../../src/hd/evidence-store.js";
import { readNetwork, runPaths } from "../../src/hd/run-state.js";
import type { PageFetchResult } from "../../src/utils/page-fetcher.js";
import { PAGE_TEXT, STANDARD_TEXT, extractClaims, makeRun } from "./helpers.js";

const page = async (): Promise<PageFetchResult> => ({ text: PAGE_TEXT, method: "direct" });

function extracted() {
  const ctx = makeRun(STANDARD_TEXT);
  extractClaims(ctx);
  return ctx;
}

describe("fetchForClaim", () => {
  test("stores the page and numbers its passages per claim", async () => {
    const ctx = extracted();
    const first = await fetchForClaim(ctx.paths, 2, "https://example.org/eiffel", "Eiffel Tower", page);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.items[0]).toMatchObject({ id: "E2.1", url: "https://example.org/eiffel", title: "Eiffel Tower", origin: "fetch" });
      expect(first.items[0].text).toContain("1889");
    }
    expect(readdirSync(ctx.paths.pages)).toHaveLength(1);
    expect(lookupEvidence(ctx.paths, 2, "E2.1")?.url).toBe("https://example.org/eiffel");
    expect(readNetwork(ctx.paths)).toBe(true);
    expect(readFileSync(ctx.paths.audit, "utf-8")).toContain("Fetched https://example.org/eiffel");

    const second = await fetchForClaim(ctx.paths, 2, "https://example.org/other", undefined, page);
    expect(second.ok && second.items[0]).toMatchObject({ id: "E2.2", title: "https://example.org/other" });
    expect(readClaimPassages(ctx.paths, 2).fetched_urls).toHaveLength(2);
  });

  // Review finding: a refetch downloaded the page again and stored its passages twice
  test("returns the stored passages when a page is fetched again for the same claim", async () => {
    const ctx = extracted();
    let downloads = 0;
    const counted = async (): Promise<PageFetchResult> => {
      downloads++;
      return { text: PAGE_TEXT, method: "direct" };
    };
    const first = await fetchForClaim(ctx.paths, 2, "https://example.org/eiffel", "Eiffel Tower", counted);
    const again = await fetchForClaim(ctx.paths, 2, "https://example.org/eiffel", "Eiffel Tower", counted);
    expect(downloads).toBe(1);
    expect(again).toEqual(first);
    expect(readClaimPassages(ctx.paths, 2).items).toHaveLength(first.ok ? first.items.length : -1);
  });

  test("stores a page once when two fetches of it run in parallel", async () => {
    const ctx = extracted();
    const both = await Promise.all([
      fetchForClaim(ctx.paths, 2, "https://example.org/eiffel", undefined, page),
      fetchForClaim(ctx.paths, 2, "https://example.org/eiffel", undefined, page),
    ]);
    expect(both[1]).toEqual(both[0]);
    expect(readClaimPassages(ctx.paths, 2).items).toHaveLength(both[0].ok ? both[0].items.length : -1);
  });

  test("stops at four pages per claim", async () => {
    const ctx = extracted();
    for (let i = 1; i <= 4; i++) {
      expect((await fetchForClaim(ctx.paths, 1, `https://example.org/${i}`, undefined, page)).ok).toBe(true);
    }
    const fifth = await fetchForClaim(ctx.paths, 1, "https://example.org/5", undefined, page);
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.message).toContain("limit");
  });

  // Review finding (reproduced): the first unreachable site switched the whole run to "no network"
  test("decides that hd has no network only after network failures on two sites", async () => {
    const ctx = extracted();
    const down = async (): Promise<PageFetchResult> => ({ text: null, method: "none", reason: "fetch failed (ECONNREFUSED)" });
    const first = await fetchForClaim(ctx.paths, 1, "https://one.example/page", undefined, down);
    expect(!first.ok && first.message).toContain("Could not read https://one.example/page");
    expect(readNetwork(ctx.paths)).toBeNull();

    const second = await fetchForClaim(ctx.paths, 1, "https://two.example/page", undefined, down);
    expect(!second.ok && second.message).toContain("no network access");
    expect(readNetwork(ctx.paths)).toBe(false);

    await fetchForClaim(ctx.paths, 2, "https://three.example/page", undefined, page);
    expect(readNetwork(ctx.paths)).toBe(true);
  });

  test("explains a page it cannot read without touching the network flag", async () => {
    const ctx = extracted();
    const out = await fetchForClaim(ctx.paths, 1, "https://example.org", undefined, async () => ({ text: null, method: "none", reason: "HTTP 403" }));
    expect(!out.ok && out.message).toContain("Could not read https://example.org: HTTP 403");
    expect(readNetwork(ctx.paths)).toBeNull();
  });

  // Review finding: a mistyped run path said "The claims are not extracted yet"
  test("says that a mistyped run path is not a run", async () => {
    const ctx = extracted();
    const wrong = runPaths(`${ctx.paths.root}-typo`);
    await expect(fetchForClaim(wrong, 1, "https://example.org", undefined, page)).rejects.toThrow(/No run at .*-typo/);
    await expect(searchForClaim(wrong, 1, "q", async () => ({ results: [] }))).rejects.toThrow(/No run at .*-typo/);
  });

  test("refuses an unknown claim and an address that is not a web page", async () => {
    const ctx = extracted();
    await expect(fetchForClaim(ctx.paths, 99, "https://example.org", undefined, page)).rejects.toThrow(/no claim 99/);
    const out = await fetchForClaim(ctx.paths, 1, "file:///etc/passwd", undefined, page);
    expect(!out.ok && out.message).toContain("Not a web address");
  });

  // Scenario 1 (Claude Code): one transient "fetch failed" after many read pages switched the run to "no network"
  test("does not take one failed fetch for missing network once a page was read", async () => {
    const ctx = extracted();
    await fetchForClaim(ctx.paths, 1, "https://example.org/ok", undefined, page);
    const out = await fetchForClaim(ctx.paths, 1, "https://example.org/flaky", undefined, async () => ({ text: null, method: "none", reason: "fetch failed" }));
    expect(!out.ok && out.message).toContain("Could not read https://example.org/flaky");
    expect(readNetwork(ctx.paths)).toBe(true);
  });

  test("remembers the pages hd could not read", async () => {
    const ctx = extracted();
    await fetchForClaim(ctx.paths, 1, "https://example.org/blocked", undefined, async () => ({ text: null, method: "none", reason: "HTTP 403" }));
    expect(readClaimPassages(ctx.paths, 1).failed_urls).toEqual(["https://example.org/blocked"]);
  });

  test("isNetworkFailure tells network errors from page errors", () => {
    expect(isNetworkFailure("fetch failed")).toBe(true);
    expect(isNetworkFailure("getaddrinfo ENOTFOUND example.org")).toBe(true);
    expect(isNetworkFailure("HTTP 404")).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});

describe("searchForClaim", () => {
  test("stores search results as evidence with IDs", async () => {
    const ctx = extracted();
    const out = await searchForClaim(ctx.paths, 2, "Eiffel Tower completed", async () => ({
      results: [{ title: "Eiffel", url: "https://a.example/e", content: "The tower was completed in 1889." }],
    }));
    expect(out.ok && out.items[0]).toMatchObject({ id: "E2.1", origin: "searxng", url: "https://a.example/e", text: "The tower was completed in 1889." });
  });

  test("passes on a search error", async () => {
    const ctx = extracted();
    const out = await searchForClaim(ctx.paths, 2, "q", async () => ({ results: [], error: "SearXNG search failed: fetch failed" }));
    expect(!out.ok && out.message).toContain("Use your own web search tool");
  });
});
