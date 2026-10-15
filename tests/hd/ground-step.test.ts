import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { GROUNDED_RETRY_SUFFIX } from "../../src/method/grounded.js";
import type { Verdict } from "../../src/schemas/index.js";
import { taskFile } from "../../src/hd/run-state.js";
import { groundStep } from "../../src/hd/steps/ground.js";
import { readJSON } from "../../src/utils/atomic-write.js";
import { FAITH_SOURCE, FAITH_TEXT, extractClaims, makeRun } from "./helpers.js";

function grounded(source = FAITH_SOURCE) {
  const ctx = makeRun(FAITH_TEXT, { source });
  extractClaims(ctx);
  return ctx;
}

function verdicts(ctx: { paths: { verdicts: string } }): Verdict[] {
  return readJSON<{ verdicts: Verdict[] }>(ctx.paths.verdicts).verdicts;
}

const contradicted = { claim_id: 1, status: "CONTRADICTED", quote: "Construction of the dam began in 1931.", source_says: "1931", explanation: "e" };
const supported = { claim_id: 2, status: "SUPPORTED", quote: "The dam is 221 metres tall.", source_says: null, explanation: "e" };

describe("ground step", () => {
  test("issues independent tasks that point to the whole source", () => {
    const ctx = grounded();
    const [task] = groundStep.issue(ctx);
    expect(task).toMatchObject({ id: "ground-01", claim_ids: [1, 2], independence: "required" });
    const file = readFileSync(taskFile(ctx.paths, task.id), "utf-8");
    expect(file).toContain(`Read the whole source document from ${ctx.paths.source}`);
    expect(file).toContain("# Grounded Verifier");
    expect(file).toContain("Write the explanation in English.");
  });

  test("gives passages instead of the path when the source is long", () => {
    const ctx = grounded(FAITH_SOURCE + "Filler sentence about the river. ".repeat(4000));
    const [task] = groundStep.issue(ctx);
    const file = readFileSync(taskFile(ctx.paths, task.id), "utf-8");
    expect(file).toContain("<source_passages>");
    expect(file).not.toContain("Read the whole source document");
  });

  test("accepts verbatim quotes and turns them into verdicts", () => {
    const ctx = grounded();
    const [task] = groundStep.issue(ctx);
    expect(groundStep.accept(ctx, task, { results: [contradicted, { ...supported, claim_id: "2" }] })).toEqual({});
    expect(groundStep.complete(ctx)).toBe("done");
    expect(verdicts(ctx).map((v) => v.verdict)).toEqual(["HALLUCINATION", "VERIFIED"]);
  });

  test("retries a quote that is not in the source and does not accept a retreat to NOT_IN_SOURCE", () => {
    const ctx = grounded();
    const [task] = groundStep.issue(ctx);
    const outcome = groundStep.accept(ctx, task, {
      results: [{ ...contradicted, quote: "Construction started in the year 1931 exactly." }, supported],
    });
    expect(outcome.retry?.claimIds).toEqual([1]);
    expect(outcome.retry?.feedback).toContain("was not found in the source document");
    expect(outcome.retry?.feedback).toContain(GROUNDED_RETRY_SUFFIX);

    const retry = { ...task, id: "ground-01-retry", attempt: 2, claim_ids: [1] };
    groundStep.accept(ctx, retry, { results: [{ claim_id: 1, status: "NOT_IN_SOURCE", quote: null }] });
    groundStep.complete(ctx);
    expect(verdicts(ctx)[0]).toMatchObject({ verdict: "UNVERIFIABLE", reasoning: expect.stringContaining("after its quote was rejected") });
    expect(ctx.state.warnings.join(" ")).toContain("1 of 2 claims could not be verified against the source");
  });

  test("marks the claims of a failed task UNVERIFIABLE", () => {
    const ctx = grounded();
    const [task] = groundStep.issue(ctx);
    groundStep.fail(ctx, task, "the subagent crashed");
    groundStep.complete(ctx);
    expect(verdicts(ctx).map((v) => v.verdict)).toEqual(["UNVERIFIABLE", "UNVERIFIABLE"]);
    expect(verdicts(ctx)[0].reasoning).toContain("the subagent crashed");
  });
});
