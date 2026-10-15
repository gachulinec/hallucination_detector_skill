import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { taskFile } from "../../src/hd/run-state.js";
import { groundStep } from "../../src/hd/steps/ground.js";
import { FAITH_SOURCE, FAITH_TEXT, extractClaims, makeRun } from "./helpers.js";

describe("task files", () => {
  // Scenario 2 (Claude Code): subagents read "run this task in a subagent" as an order to delegate again
  test("address the independence note to the main agent and tell a subagent to do the task itself", () => {
    const ctx = makeRun(FAITH_TEXT, { source: FAITH_SOURCE });
    extractClaims(ctx);
    const [task] = groundStep.issue(ctx);
    const file = readFileSync(taskFile(ctx.paths, task.id), "utf-8");
    expect(file).toContain("- Independence: required — the main agent gives this task to a subagent with a fresh context");
    expect(file).toContain("If you received this file as a subagent, do the task yourself now: do not hand it to another subagent.");
  });

  // Evaluation (Claude Code, 5 of 20 documents): subagents that did a sample task wrote "executed_by": "main"
  test("say that a subagent reports itself as subagent even though it does the task itself", () => {
    const ctx = makeRun(FAITH_TEXT, { source: FAITH_SOURCE });
    extractClaims(ctx);
    const [task] = groundStep.issue(ctx);
    const file = readFileSync(taskFile(ctx.paths, task.id), "utf-8");
    expect(file).toContain('Set "executed_by" to "subagent" if another agent gave you this file — also when you do the task yourself as asked above.');
    expect(file).toContain('Set it to "main" only if you are the agent that runs hd next.');
  });
});
