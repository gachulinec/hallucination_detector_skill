import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { QUESTION_INSTRUCTIONS } from "../../src/method/consistency.js";
import { taskFile } from "../../src/hd/run-state.js";
import { questionsStep, sampleJudgmentsStep, samplesStep } from "../../src/hd/steps/consistency.js";
import { consistencyMap } from "../../src/hd/steps/step.js";
import { STANDARD_TEXT, extractClaims, makeRun } from "./helpers.js";

const QUESTIONS = [
  { claim_id: 1, question: "How tall is the Eiffel Tower?" },
  { claim_id: 2, question: "In which year was the Eiffel Tower completed?" },
  { claim_id: 3, question: "Whose company built the Eiffel Tower?" },
];

function withQuestions() {
  const ctx = makeRun(STANDARD_TEXT);
  extractClaims(ctx);
  const [task] = questionsStep.issue(ctx);
  questionsStep.accept(ctx, task, { questions: QUESTIONS });
  expect(questionsStep.complete(ctx)).toBe("samples");
  return ctx;
}

describe("questions", () => {
  test("issues one task with every claim and its context", () => {
    const ctx = makeRun(STANDARD_TEXT);
    extractClaims(ctx);
    const [task] = questionsStep.issue(ctx);
    expect(task).toMatchObject({ id: "questions", claim_ids: [1, 2, 3], independence: "none" });
    const file = readFileSync(taskFile(ctx.paths, "questions"), "utf-8");
    expect(file).toContain(QUESTION_INSTRUCTIONS);
    expect(file).toContain("### Claim 2");
    expect(file).toContain("Document title: Eiffel Tower");
  });

  test("retries only the claims without a question and accepts string IDs", () => {
    const ctx = makeRun(STANDARD_TEXT);
    extractClaims(ctx);
    const [task] = questionsStep.issue(ctx);
    const outcome = questionsStep.accept(ctx, task, { questions: QUESTIONS.slice(0, 2) });
    expect(outcome.retry?.claimIds).toEqual([3]);
    const retry = { ...task, id: "questions-retry", attempt: 2, claim_ids: [3] };
    expect(questionsStep.accept(ctx, retry, { questions: [{ claim_id: "3", question: QUESTIONS[2].question }] })).toEqual({});
    expect(questionsStep.complete(ctx)).toBe("samples");
  });

  test("goes straight to verification when no claim got a question", () => {
    const ctx = makeRun(STANDARD_TEXT);
    extractClaims(ctx);
    const [task] = questionsStep.issue(ctx);
    questionsStep.fail(ctx, task, "error");
    expect(questionsStep.complete(ctx)).toBe("verify");
    expect(ctx.state.warnings.join(" ")).toContain("consistency was not measured");
  });
});

describe("samples", () => {
  test("issues three independent tasks that show the questions but not the claims", () => {
    const ctx = withQuestions();
    const tasks = samplesStep.issue(ctx);
    expect(tasks.map((t) => [t.id, t.sample_index, t.independence])).toEqual([
      ["sample-1", 1, "required"],
      ["sample-2", 2, "required"],
      ["sample-3", 3, "required"],
    ]);
    const file = readFileSync(taskFile(ctx.paths, "sample-1"), "utf-8");
    expect(file).toContain("In which year was the Eiffel Tower completed?");
    expect(file).not.toContain("1899");
    expect(file).not.toContain("330");
    expect(file).toContain("do not search the web");
  });

  test("retries missing answers", () => {
    const ctx = withQuestions();
    const [task] = samplesStep.issue(ctx);
    const outcome = samplesStep.accept(ctx, task, { answers: [{ question_id: 1, answer: "330 m" }] });
    expect(outcome.retry?.claimIds).toEqual([2, 3]);
  });
});

describe("sample judgments", () => {
  function withSamples() {
    const ctx = withQuestions();
    for (const task of samplesStep.issue(ctx)) {
      samplesStep.accept(ctx, task, {
        answers: QUESTIONS.map((q) => ({ question_id: q.claim_id, answer: `answer ${task.sample_index} to ${q.claim_id}` })),
      });
    }
    expect(samplesStep.complete(ctx)).toBe("sample-judgments");
    return ctx;
  }

  test("shows each claim with its three answers", () => {
    const ctx = withSamples();
    const [task] = sampleJudgmentsStep.issue(ctx);
    const file = readFileSync(taskFile(ctx.paths, task.id), "utf-8");
    expect(file).toContain('Claim: "The Eiffel Tower was completed in 1899"');
    expect(file).toContain("Answer 3: answer 3 to 2");
  });

  test("scores the judgments in code and writes consistency.json", () => {
    const ctx = withSamples();
    const [task] = sampleJudgmentsStep.issue(ctx);
    const outcome = sampleJudgmentsStep.accept(ctx, task, {
      judgments: [
        { claim_id: "1", judgments: ["supports", "supports", "supports"] },
        { claim_id: 2, judgments: ["contradicts", "contradicts", "supports"] },
        { claim_id: 3, judgments: ["supports"] },
      ],
    });
    expect(outcome.retry?.claimIds).toEqual([3]);
    expect(outcome.retry?.feedback).toMatch(/Expected 3 judgments/);
    sampleJudgmentsStep.fail(ctx, { ...task, id: "sample-judgments-retry", attempt: 2, claim_ids: [3] }, "still wrong", [3]);
    expect(sampleJudgmentsStep.complete(ctx)).toBe("verify");

    const consistency = consistencyMap(ctx);
    expect(consistency.get(1)?.consistency_score).toBe(1);
    expect(consistency.get(2)?.consistency_score).toBeCloseTo(1 / 3);
    expect(consistency.get(2)?.flagged).toBe(true);
    expect(consistency.get(2)?.samples).toEqual(["answer 1 to 2", "answer 2 to 2", "answer 3 to 2"]);
    expect(consistency.has(3)).toBe(false);
  });
});
