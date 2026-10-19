import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { HallucinationReportSchema } from "../../src/schemas/index.js";
import { fetchForClaim } from "../../src/hd/evidence-store.js";
import { formatNext } from "../../src/hd/format.js";
import { runNext, runStatus, type NextOutput } from "../../src/hd/next.js";
import { loadState, runPaths } from "../../src/hd/run-state.js";
import type { PageFetchResult } from "../../src/utils/page-fetcher.js";
import { fakeAgentDo, type FakeWorld } from "./fake-agent.js";
import { FAITH_SOURCE, FAITH_TEXT, PAGE_TEXT, STANDARD_CLAIMS, STANDARD_TEXT, makeRun } from "./helpers.js";

const page = async (): Promise<PageFetchResult> => ({ text: PAGE_TEXT, method: "direct" });

function world(extra: Partial<FakeWorld> = {}): FakeWorld {
  return {
    wrong: ["1899"],
    // One site per claim: a contradiction by a single site goes to the judge
    pageUrl: (claim) => `https://site${claim.id}.example/page`,
    fetchEvidence: async (root, claimId, url) => {
      const out = await fetchForClaim(runPaths(root), claimId, url, undefined, page);
      return out.ok ? out.items.map((item) => item.id) : [];
    },
    ...extra,
  };
}

async function runToEnd(root: string, w: FakeWorld = world()): Promise<NextOutput> {
  let out = runNext(root);
  for (let i = 0; i < 20 && !out.done && !out.failure; i++) {
    await fakeAgentDo(root, out.tasks, w);
    out = runNext(root);
  }
  return out;
}

const past = (): Date => new Date(Date.now() - 10_000);

describe("runNext", () => {
  test("runs a standard check from the first task to the report", async () => {
    const ctx = makeRun(STANDARD_TEXT);
    const out = await runToEnd(ctx.paths.root);
    expect(out.failure).toBeUndefined();
    expect(out.done).toBe(true);
    expect(out.counts).toEqual({ claims: 3, hallucination: 1, unverifiable: 0, verified: 2 });
    const report = HallucinationReportSchema.parse(JSON.parse(readFileSync(ctx.paths.report, "utf-8")));
    expect(report.run_info).toMatchObject({ independence: "subagents", profile: "thorough", network: true });
    expect(report.verdicts.find((v) => v.claim_text.includes("1899"))?.verdict).toBe("HALLUCINATION");
    expect(loadState(ctx.paths).tasks.map((t) => t.id)).toEqual([
      "extract-01",
      "questions",
      "sample-1",
      "sample-2",
      "sample-3",
      "sample-judgments",
      "verify-01",
      "judge-01",
    ]);
    const audit = readFileSync(ctx.paths.audit, "utf-8");
    expect(audit).toContain("task_accepted");
    expect(audit).toContain("stage_complete");
  });

  test("runs a faithfulness check", async () => {
    const ctx = makeRun(FAITH_TEXT, { source: FAITH_SOURCE });
    const out = await runToEnd(ctx.paths.root);
    expect(out.counts).toEqual({ claims: 2, hallucination: 1, unverifiable: 0, verified: 1 });
    expect(loadState(ctx.paths).tasks.map((t) => t.id)).toEqual(["extract-01", "ground-01"]);
  });

  test("runs a quick self-check without the consistency step and with independent verification", async () => {
    const ctx = makeRun(STANDARD_TEXT, { profile: "quick", origin: "self" });
    expect((await runToEnd(ctx.paths.root)).done).toBe(true);
    const tasks = loadState(ctx.paths).tasks;
    expect(tasks.map((t) => t.id)).toEqual(["extract-01", "verify-01", "judge-01"]);
    expect(tasks[1].independence).toBe("required");
  });

  test("changes nothing when called again without new results, also after DONE", async () => {
    const ctx = makeRun(STANDARD_TEXT);
    const first = runNext(ctx.paths.root);
    expect(runNext(ctx.paths.root).tasks).toEqual(first.tasks);
    expect(loadState(ctx.paths).tasks).toHaveLength(1);

    const done = await runToEnd(ctx.paths.root);
    const report = readFileSync(ctx.paths.report, "utf-8");
    expect(runNext(ctx.paths.root)).toEqual({ ...done, processed: [] });
    expect(readFileSync(ctx.paths.report, "utf-8")).toBe(report);
  });

  test("waits for a result that is still being written, then asks for one retry", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = runNext(ctx.paths.root).tasks;
    writeFileSync(task.result_file, '{"claims": [');
    const waiting = runNext(ctx.paths.root);
    expect(waiting.waiting).toEqual(["extract-01"]);
    expect(waiting.tasks.map((t) => t.id)).toEqual(["extract-01"]);

    utimesSync(task.result_file, past(), past());
    const retried = runNext(ctx.paths.root);
    expect(retried.processed).toEqual([
      { id: "extract-01", outcome: "retry", detail: expect.stringContaining("not a valid JSON object") },
    ]);
    expect(retried.tasks.map((t) => t.id)).toEqual(["extract-01-retry"]);
    // Review finding: a rejected attempt is not a task done (independence, task count)
    expect(loadState(ctx.paths).tasks.find((t) => t.id === "extract-01")?.status).toBe("retried");
    expect(readFileSync(retried.tasks[0].task_file, "utf-8")).toContain("## This is a retry");
  });

  test("fails the task after a second invalid result", () => {
    const ctx = makeRun(STANDARD_TEXT);
    let out = runNext(ctx.paths.root);
    for (let i = 0; i < 2; i++) {
      writeFileSync(out.tasks[0].result_file, "not json");
      utimesSync(out.tasks[0].result_file, past(), past());
      out = runNext(ctx.paths.root);
    }
    expect(out.failure).toContain("Claim extraction failed for all 1 parts");
  });

  test("fails a task without a retry when the agent reports an error", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = runNext(ctx.paths.root).tasks;
    writeFileSync(task.result_file, JSON.stringify({ executed_by: "main", error: "cannot read the text" }));
    const out = runNext(ctx.paths.root);
    expect(out.processed).toEqual([{ id: "extract-01", outcome: "failed", detail: "cannot read the text" }]);
    expect(out.warnings.join(" ")).toContain("could not be done: cannot read the text");
    expect(out.failure).toBeDefined();
  });

  test("accepts a valid result that also reports an error, with a warning", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = runNext(ctx.paths.root).tasks;
    writeFileSync(
      task.result_file,
      JSON.stringify({ executed_by: "main", error: "one sentence was unclear", claims: STANDARD_CLAIMS })
    );
    const out = runNext(ctx.paths.root);
    expect(out.processed).toEqual([{ id: "extract-01", outcome: "accepted" }]);
    expect(out.failure).toBeUndefined();
    expect(out.stage).toBe("questions");
    expect(out.warnings.join(" ")).toContain("Task extract-01 reported a problem: one sentence was unclear");
  });

  test("records that required tasks were done by the main agent", async () => {
    const ctx = makeRun(STANDARD_TEXT);
    await runToEnd(ctx.paths.root, world({ executedBy: "main" }));
    const report = HallucinationReportSchema.parse(JSON.parse(readFileSync(ctx.paths.report, "utf-8")));
    expect(report.run_info?.independence).toBe("none");
    expect(report.warnings?.join(" ")).toContain("independence is not ensured");
  });
});

describe("formatNext and runStatus", () => {
  test("prints the tasks, the dispatch hint and the next command with quoted paths", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "hd-format-")), "runs ľ");
    mkdirSync(dir, { recursive: true });
    const ctx = makeRun(STANDARD_TEXT, { dir });
    const text = formatNext(runNext(ctx.paths.root));
    expect(ctx.paths.root).toContain("runs ľ");
    expect(text).toContain("Step: extract (0 of 1 tasks done)");
    expect(text).toContain("- extract-01 [independence: recommended, model: standard]");
    expect(text).toContain("subagents with a fresh context");
    expect(text).toContain(`node "/skill/scripts/hd.mjs" next "${ctx.paths.root}"`);
  });

  // Review finding (reproduced): a task still being written was listed as work to do, inviting a duplicate dispatch
  test("does not list a task whose result is being written as work to do", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = runNext(ctx.paths.root).tasks;
    writeFileSync(task.result_file, '{"claims": [');
    const text = formatNext(runNext(ctx.paths.root));
    expect(text).toContain("Still being written: extract-01");
    expect(text).not.toContain("- extract-01 [independence");
  });

  test("tells the agent not to dispatch a task twice", () => {
    const ctx = makeRun(STANDARD_TEXT);
    expect(formatNext(runNext(ctx.paths.root))).toContain("wait for its result instead of dispatching it again");
  });

  test("prints DONE with the counts and the summary file", async () => {
    const ctx = makeRun(STANDARD_TEXT);
    const text = formatNext(await runToEnd(ctx.paths.root));
    expect(text).toContain("DONE. 3 claims: 1 HALLUCINATION, 0 UNVERIFIABLE, 2 VERIFIED.");
    expect(text).toContain(`Summary: ${ctx.paths.summary}`);
  });

  test("runStatus shows the run without reading new results", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = runNext(ctx.paths.root).tasks;
    writeFileSync(task.result_file, JSON.stringify({ claims: [] }));
    expect(runStatus(ctx.paths.root).tasks.map((t) => t.id)).toEqual(["extract-01"]);
  });
});
