import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { resultFile, taskFile } from "../../src/hd/run-state.js";
import { extractStep } from "../../src/hd/steps/extract.js";
import { readClaims } from "../../src/hd/steps/step.js";
import { FAITH_CLAIMS, FAITH_SOURCE, FAITH_TEXT, STANDARD_CLAIMS, STANDARD_TEXT, makeRun } from "./helpers.js";

describe("extract step", () => {
  test("issues one task per chunk with the extractor prompt, the text and the result path", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const tasks = extractStep.issue(ctx);
    expect(tasks.map((t) => t.id)).toEqual(["extract-01"]);
    expect(tasks[0]).toMatchObject({ kind: "extract", chunk_id: 1, independence: "recommended", attempt: 1, status: "pending" });
    const file = readFileSync(taskFile(ctx.paths, "extract-01"), "utf-8");
    expect(file).toContain("# Claim Extractor");
    expect(file).toContain("The Eiffel Tower is 330 metres tall.");
    expect(file).toContain(resultFile(ctx.paths, "extract-01"));
    expect(file).toContain("Do not run `hd next`");
  });

  test("splits a long text into several tasks", () => {
    const text = Array.from({ length: 160 }, (_, i) => `Paragraph ${i} says that the value is ${i * 7}.`).join("\n\n");
    const tasks = extractStep.issue(makeRun(text));
    expect(tasks.length).toBeGreaterThan(1);
    expect(tasks[1].id).toBe("extract-02");
  });

  test("accepts valid claims and writes claims.json with context and positions", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = extractStep.issue(ctx);
    expect(extractStep.accept(ctx, task, { claims: STANDARD_CLAIMS })).toEqual({});
    expect(extractStep.complete(ctx)).toBe("questions");
    const claims = readClaims(ctx);
    expect(claims.claims).toHaveLength(3);
    expect(claims.document_title).toBe("Eiffel Tower");
    expect(claims.claims[1].context).toContain("It was completed in 1899.");
    expect(claims.claims[0].source_position.start).toBe(STANDARD_TEXT.indexOf("The Eiffel Tower is 330"));
  });

  test("asks for a retry when a sentence is not in the text or a number has no claim", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = extractStep.issue(ctx);
    const outcome = extractStep.accept(ctx, task, {
      claims: [STANDARD_CLAIMS[0], { text: "Gustave Eiffel's company built the Eiffel Tower", type: "entity", original_sentence: "Eiffel built it." }],
    });
    expect(outcome.retry?.feedback).toContain('"Eiffel built it."');
    expect(outcome.retry?.feedback).toContain("1899");
    expect(outcome.retry?.claimIds).toBeUndefined();
  });

  test("keeps the claims of a retry and reports what is still wrong", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = extractStep.issue(ctx);
    const retry = { ...task, id: "extract-01-retry", attempt: 2 };
    expect(extractStep.accept(ctx, retry, { claims: [STANDARD_CLAIMS[0], STANDARD_CLAIMS[2]] })).toEqual({});
    expect(ctx.state.warnings.join(" ")).toContain("1899");
    expect(extractStep.complete(ctx)).toBe("questions");
    expect(readClaims(ctx).claims).toHaveLength(2);
  });

  // Review finding: a retry that returns only the corrected claims silently dropped the others
  test("keeps the valid claims of the first attempt that the retry left out", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = extractStep.issue(ctx);
    const wrongSentence = { text: "The Eiffel Tower was completed in 1899", type: "numeric", original_sentence: "It was finished in 1899." };
    expect(extractStep.accept(ctx, task, { claims: [STANDARD_CLAIMS[0], wrongSentence, STANDARD_CLAIMS[2]] }).retry).toBeDefined();
    const retry = { ...task, id: "extract-01-retry", attempt: 2 };
    expect(extractStep.accept(ctx, retry, { claims: [STANDARD_CLAIMS[1]] })).toEqual({});
    extractStep.complete(ctx);
    expect(readClaims(ctx).claims.map((c) => c.text)).toEqual(STANDARD_CLAIMS.map((c) => c.text));
  });

  test("asks for a retry when the result has no claims array", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = extractStep.issue(ctx);
    expect(extractStep.accept(ctx, task, { claims: "none" }).retry?.feedback).toContain('no "claims" array');
  });

  test("keeps the first attempt's claims when the retry fails", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = extractStep.issue(ctx);
    extractStep.accept(ctx, task, { claims: [STANDARD_CLAIMS[0], STANDARD_CLAIMS[2]] });
    extractStep.fail(ctx, { ...task, id: "extract-01-retry", attempt: 2 }, "not valid JSON");
    expect(ctx.state.warnings.join(" ")).toContain("first attempt were kept");
    expect(extractStep.complete(ctx)).toBe("questions");
  });

  test("fails the run when no part of the text could be extracted", () => {
    const ctx = makeRun(STANDARD_TEXT);
    const [task] = extractStep.issue(ctx);
    extractStep.fail(ctx, task, "error");
    expect(extractStep.complete(ctx)).toBe("failed");
    expect(ctx.state.failure).toContain("all 1 parts");
  });

  test("goes to verification in the quick profile and without subagents", () => {
    const quick = makeRun(STANDARD_TEXT, { profile: "quick" });
    extractStep.accept(quick, extractStep.issue(quick)[0], { claims: STANDARD_CLAIMS });
    expect(extractStep.complete(quick)).toBe("verify");

    const solo = makeRun(STANDARD_TEXT, { subagents: false });
    extractStep.accept(solo, extractStep.issue(solo)[0], { claims: STANDARD_CLAIMS });
    expect(extractStep.complete(solo)).toBe("verify");
    expect(solo.state.warnings.join(" ")).toContain("consistency check was skipped");
  });

  test("goes to grounded verification in faithfulness mode and writes the sections", () => {
    const ctx = makeRun(FAITH_TEXT, { source: FAITH_SOURCE });
    extractStep.accept(ctx, extractStep.issue(ctx)[0], { claims: FAITH_CLAIMS });
    expect(extractStep.complete(ctx)).toBe("ground");
    expect(existsSync(ctx.paths.sections)).toBe(true);
  });

  test("finishes at once when the text has no claims", () => {
    const ctx = makeRun("# Note\n\nThis is an opinion about art.\n");
    extractStep.accept(ctx, extractStep.issue(ctx)[0], { claims: [] });
    expect(extractStep.complete(ctx)).toBe("done");
  });
});
