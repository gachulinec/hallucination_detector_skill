import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { fetchForClaim } from "../../src/hd/evidence-store.js";
import { taskFile, writeNetwork } from "../../src/hd/run-state.js";
import { verificationMap } from "../../src/hd/steps/step.js";
import { verifyStep } from "../../src/hd/steps/verify.js";
import type { PageFetchResult } from "../../src/utils/page-fetcher.js";
import { PAGE_TEXT, STANDARD_TEXT, extractClaims, makeRun, type RunFixtureOptions } from "./helpers.js";

const page = async (): Promise<PageFetchResult> => ({ text: PAGE_TEXT, method: "direct" });

async function ready(options: RunFixtureOptions = {}) {
  const ctx = makeRun(STANDARD_TEXT, options);
  extractClaims(ctx);
  await fetchForClaim(ctx.paths, 1, "https://a.example/eiffel", "A", page); // E1.1
  await fetchForClaim(ctx.paths, 2, "https://a.example/eiffel", "A", page); // E2.1
  return ctx;
}

const supported = (id: number | string, evidenceId: string) => ({
  claim_id: id,
  search_queries: ["q"],
  evidence: [{ id: evidenceId, relation: "supports", confidence: 0.9 }],
  verification_status: "SUPPORTED",
  explanation: "e",
});

describe("verify step", () => {
  test("issues batches whose task files show the fetch command with the quoted run path", async () => {
    const ctx = await ready();
    const tasks = verifyStep.issue(ctx);
    expect(tasks.map((t) => t.claim_ids)).toEqual([[1, 2, 3]]);
    expect(tasks[0].independence).toBe("recommended");
    const file = readFileSync(taskFile(ctx.paths, tasks[0].id), "utf-8");
    expect(file).toContain(`node "/skill/scripts/hd.mjs" fetch "${ctx.paths.root}" <claim_id> "<url>"`);
    expect(file).toContain("# Retrieval Verifier");
    expect(file).toContain("do not copy it from search results");
    expect(file).toContain("hd rejects inline evidence for any other page");
    expect(file).toContain("one or two web search queries");
  });

  test("makes verification independent in a self-check and asks for one query in the quick profile", async () => {
    const ctx = await ready({ origin: "self", profile: "quick" });
    const [task] = verifyStep.issue(ctx);
    expect(task.independence).toBe("required");
    expect(readFileSync(taskFile(ctx.paths, task.id), "utf-8")).toContain("one web search query");
  });

  test("fills evidence text from hd and marks inline evidence unconfirmed", async () => {
    const ctx = await ready();
    // Inline evidence is accepted only for pages hd fetch could not read
    const blocked = async (): Promise<PageFetchResult> => ({ text: null, method: "none", reason: "HTTP 403" });
    await fetchForClaim(ctx.paths, 2, "https://b.example/x", undefined, blocked);
    await fetchForClaim(ctx.paths, 3, "https://c.example/y", undefined, blocked);
    const [task] = verifyStep.issue(ctx);
    const outcome = verifyStep.accept(ctx, task, {
      results: [
        supported("1", "E1.1"),
        {
          claim_id: 2,
          search_queries: ["q"],
          evidence: [
            { id: "E2.1", relation: "contradicts", confidence: 0.9 },
            { url: "https://b.example/x", title: "B", text: "The tower was finished in 1889, says B.", relation: "contradicts", confidence: 0.7 },
          ],
          verification_status: "CONTRADICTED",
          explanation: "e",
        },
        {
          claim_id: 3,
          search_queries: ["q"],
          evidence: [{ url: "https://c.example/y", text: "Gustave Eiffel's company built the tower.", relation: "supports", confidence: 0.8 }],
          verification_status: "SUPPORTED",
          explanation: "e",
        },
      ],
    });
    expect(outcome).toEqual({});
    expect(verifyStep.complete(ctx)).toBe("judge");
    const results = verificationMap(ctx);
    expect(results.get(1)?.evidence[0]).toMatchObject({ source_url: "https://a.example/eiffel", checked: true });
    expect(results.get(1)?.evidence[0].relevant_text).toContain("330 metres");
    expect(results.get(2)?.evidence[1]).toMatchObject({ source_url: "https://b.example/x", checked: false });
    expect(results.get(3)?.evidence[0].source_title).toBe("https://c.example/y");
    expect(ctx.state.warnings.join(" ")).toContain("written by the verifying agent");
  });

  // Scenario 1 (Claude Code): verifying subagents wrote search results inline instead of fetching the pages through hd
  test("accepts inline evidence only for a page hd fetch could not read", async () => {
    const ctx = await ready();
    const [task] = verifyStep.issue(ctx);
    const inlineResult = {
      claim_id: 3,
      search_queries: ["q"],
      evidence: [{ url: "https://c.example/y", text: "Gustave Eiffel's company built the tower.", relation: "supports", confidence: 0.8 }],
      verification_status: "SUPPORTED",
      explanation: "e",
    };
    const outcome = verifyStep.accept(ctx, { ...task, claim_ids: [3] }, { results: [inlineResult] });
    expect(outcome.retry?.feedback).toContain("hd fetch has not tried https://c.example/y");

    await fetchForClaim(ctx.paths, 3, "https://c.example/y", undefined, async () => ({ text: null, method: "none", reason: "HTTP 403" }));
    expect(verifyStep.accept(ctx, { ...task, claim_ids: [3] }, { results: [inlineResult] })).toEqual({});
  });

  test("asks for a retry of the claims with problems only", async () => {
    const ctx = await ready();
    const [task] = verifyStep.issue(ctx);
    const outcome = verifyStep.accept(ctx, task, {
      results: [
        supported(1, "E1.1"),
        { claim_id: 2, search_queries: ["q"], evidence: [{ id: "E2.9", relation: "supports" }], verification_status: "SUPPORTED" },
        { claim_id: 3, search_queries: [], evidence: [], verification_status: "SUPPORTED" },
      ],
    });
    expect(outcome.retry?.claimIds).toEqual([2, 3]);
    expect(outcome.retry?.feedback).toContain("E2.9");
    expect(outcome.retry?.feedback).toContain("search_queries");
    expect(outcome.retry?.feedback).toContain("SUPPORTED needs at least one evidence item");
  });

  test("asks once to look further when the status is INSUFFICIENT in the thorough profile", async () => {
    const ctx = await ready();
    const [task] = verifyStep.issue(ctx);
    const insufficient = { claim_id: 1, search_queries: ["q"], evidence: [], verification_status: "INSUFFICIENT", explanation: "e" };
    expect(verifyStep.accept(ctx, { ...task, claim_ids: [1] }, { results: [insufficient] }).retry?.feedback).toContain("escalated");
    expect(verifyStep.accept(ctx, { ...task, id: "verify-01-retry", attempt: 2, claim_ids: [1] }, { results: [insufficient] })).toEqual({});
  });

  test("records failures as errors and stops when no claim could be verified", async () => {
    const ctx = await ready();
    const [task] = verifyStep.issue(ctx);
    verifyStep.fail(ctx, task, "no web search tool");
    expect(verifyStep.complete(ctx)).toBe("failed");
    expect(ctx.state.failure).toContain("Web search was unavailable");
    expect(verificationMap(ctx).get(1)?.error).toBe("no web search tool");
  });

  test("tells the agent to use its own fetch when hd has no network", () => {
    const ctx = makeRun(STANDARD_TEXT);
    extractClaims(ctx);
    writeNetwork(ctx.paths, { network: false, reason: "fetch failed" });
    const [task] = verifyStep.issue(ctx);
    expect(readFileSync(taskFile(ctx.paths, task.id), "utf-8")).toContain("hd has no network access in this environment");
  });
});
