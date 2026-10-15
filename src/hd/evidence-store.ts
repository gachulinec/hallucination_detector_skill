/**
 * Evidence text comes from code, not from the agent: hd fetch downloads a page
 * and stores the passages most relevant to the claim, hd search stores search
 * snippets; the agent refers to them by ID (E<claim>.<n>). Each claim has its
 * own store file, so subagents working on different claims never collide.
 */

import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaimsOutput } from "../schemas/index.js";
import { atomicWriteJSON, readJSON } from "../utils/atomic-write.js";
import { AuditLogger } from "../utils/audit-logger.js";
import { maskSearchResults } from "../utils/observation-mask.js";
import { selectPassages, type PageFetchResult } from "../utils/page-fetcher.js";
import type { WebSearchOutcome } from "../utils/searxng-search.js";
import { SKILL_LIMITS } from "./config.js";
import { readNetwork, writeNetwork, type RunPaths } from "./run-state.js";

export interface StoredEvidence {
  id: string;
  url: string;
  title: string;
  text: string;
  origin: "fetch" | "searxng";
}

export interface ClaimPassages {
  claim_id: number;
  fetched_urls: string[];
  /** Pages hd fetch could not read: only these may be given as inline evidence */
  failed_urls?: string[];
  items: StoredEvidence[];
}

export type EvidenceOutcome = { ok: true; items: StoredEvidence[] } | { ok: false; message: string };

function storeFile(paths: RunPaths, claimId: number): string {
  return join(paths.passages, `claim_${claimId}.json`);
}

export function readClaimPassages(paths: RunPaths, claimId: number): ClaimPassages {
  const file = storeFile(paths, claimId);
  return existsSync(file) ? readJSON<ClaimPassages>(file) : { claim_id: claimId, fetched_urls: [], items: [] };
}

function addItems(
  paths: RunPaths,
  claimId: number,
  entries: Array<Omit<StoredEvidence, "id">>,
  fetchedUrl?: string
): StoredEvidence[] {
  const store = readClaimPassages(paths, claimId);
  const added = entries.map((entry, i) => ({ id: `E${claimId}.${store.items.length + i + 1}`, ...entry }));
  store.items.push(...added);
  if (fetchedUrl && !store.fetched_urls.includes(fetchedUrl)) store.fetched_urls.push(fetchedUrl);
  atomicWriteJSON(storeFile(paths, claimId), store);
  return added;
}

function recordFailedUrl(paths: RunPaths, claimId: number, url: string): void {
  const store = readClaimPassages(paths, claimId);
  const failed = store.failed_urls ?? [];
  if (failed.includes(url)) return;
  atomicWriteJSON(storeFile(paths, claimId), { ...store, failed_urls: [...failed, url] });
}

/**
 * Evidence by ID. An ID names the claim it was fetched for (E<claim>.<n>), and
 * a page fetched for one claim may support another: the text still comes from hd.
 */
export function lookupEvidence(paths: RunPaths, claimId: number, id: string): StoredEvidence | undefined {
  const wanted = id.trim();
  const owner = /^E(\d+)\.\d+$/.exec(wanted);
  const storeOf = owner ? Number(owner[1]) : claimId;
  return readClaimPassages(paths, storeOf).items.find((item) => item.id === wanted);
}

function claimText(paths: RunPaths, claimId: number): string {
  if (!existsSync(paths.claims)) {
    throw new Error("The claims are not extracted yet: fetch evidence during the verification tasks.");
  }
  const claim = readJSON<ClaimsOutput>(paths.claims).claims.find((c) => c.id === claimId);
  if (!claim) throw new Error(`There is no claim ${claimId} in this run.`);
  return claim.text;
}

const NETWORK_FAILURE = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|getaddrinfo|network/i;

/** True for errors that mean hd cannot reach the web at all (sandboxed shell), not that one page failed. */
export function isNetworkFailure(reason: string | undefined): boolean {
  return reason !== undefined && NETWORK_FAILURE.test(reason);
}

export async function fetchForClaim(
  paths: RunPaths,
  claimId: number,
  url: string,
  title: string | undefined,
  fetchPage: (url: string) => Promise<PageFetchResult>
): Promise<EvidenceOutcome> {
  const text = claimText(paths, claimId);
  if (!/^https?:\/\//i.test(url)) return { ok: false, message: `Not a web address: ${url}` };

  const store = readClaimPassages(paths, claimId);
  if (!store.fetched_urls.includes(url) && store.fetched_urls.length >= SKILL_LIMITS.maxFetchesPerClaim) {
    return {
      ok: false,
      message: `Claim ${claimId} already has ${SKILL_LIMITS.maxFetchesPerClaim} fetched pages, the limit. Decide with the evidence you have.`,
    };
  }

  const page = await fetchPage(url);
  new AuditLogger(paths.audit).logToolUse(
    "skill",
    "page_fetch",
    claimId,
    page.text ? `Fetched ${url} (${page.text.length} chars)` : `Could not fetch ${url}: ${page.reason}`
  );
  if (!page.text) {
    recordFailedUrl(paths, claimId, url);
    // Once a page was read, a network error is about this page, not a missing network
    if (isNetworkFailure(page.reason) && readNetwork(paths) !== true) {
      writeNetwork(paths, { network: false, reason: page.reason });
      return {
        ok: false,
        message: `hd has no network access here (${page.reason}). Read pages with your own tools and add the evidence inline in the result (url, title, text); it will count as unconfirmed.`,
      };
    }
    return {
      ok: false,
      message: `Could not read ${url}: ${page.reason}. Try another source, or read it with your own tools and add the evidence inline (it will count as unconfirmed).`,
    };
  }

  writeNetwork(paths, { network: true });
  writeFileSync(join(paths.pages, `${createHash("sha256").update(url).digest("hex")}.txt`), page.text, "utf-8");
  const passages = selectPassages(page.text, text, SKILL_LIMITS.passagesPerFetch, SKILL_LIMITS.passageChars);
  return {
    ok: true,
    items: addItems(
      paths,
      claimId,
      passages.map((passage) => ({ url, title: title?.trim() || url, text: passage, origin: "fetch" as const })),
      url
    ),
  };
}

export async function searchForClaim(
  paths: RunPaths,
  claimId: number,
  query: string,
  search: (query: string) => Promise<WebSearchOutcome>
): Promise<EvidenceOutcome> {
  const text = claimText(paths, claimId);
  const outcome = await search(query);
  if (outcome.error) return { ok: false, message: `${outcome.error}. Use your own web search tool instead.` };
  const evidence = maskSearchResults(outcome.results, text, SKILL_LIMITS.passageChars);
  if (evidence.length === 0) return { ok: false, message: `No results for: ${query}` };
  return {
    ok: true,
    items: addItems(
      paths,
      claimId,
      evidence.map((e) => ({ url: e.source_url, title: e.source_title, text: e.relevant_text, origin: "searxng" as const }))
    ),
  };
}
