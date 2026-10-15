/**
 * Step 2 (thorough profile): consistency. Each claim becomes a question;
 * three subagents that never see the claims answer the questions; the answers
 * are judged against the claims and scored in code (SelfCheckGPT-style), as
 * in the pipeline.
 */

import { existsSync } from "node:fs";
import {
  QUESTION_INSTRUCTIONS,
  SAMPLE_INSTRUCTIONS,
  SAMPLE_JUDGMENT_RULES,
  scoreSampleJudgments,
  type ConsistencyResult,
} from "../../method/consistency.js";
import { METHOD } from "../../method/config.js";
import { atomicWriteJSON, readJSON } from "../../utils/atomic-write.js";
import { SKILL_LIMITS } from "../config.js";
import { entriesById, type ResultObject } from "../results.js";
import { readAccepted, updateAccepted } from "../run-state.js";
import { claimsSection, newTask, writeTaskFile } from "../tasks.js";
import type { Stage, TaskRecord } from "../types.js";
import { addWarning, claimMap, readClaims, type AcceptOutcome, type Step, type StepContext } from "./step.js";

interface QuestionEntry {
  claim_id: number;
  question: string;
}

const QUESTIONS = "questions";
const SAMPLES = "samples";
const CONSISTENCY = "consistency";

const sampleNumbers = (): number[] => Array.from({ length: SKILL_LIMITS.sampleCount }, (_, i) => i + 1);
const sampleKey = (sample: number, questionId: number): string => `${sample}:${questionId}`;

function readQuestions(ctx: StepContext): QuestionEntry[] {
  return existsSync(ctx.paths.questions) ? readJSON<{ questions: QuestionEntry[] }>(ctx.paths.questions).questions : [];
}

/** The samples' answers to one question, in sample order ("" when a sample gave none) */
function answersFor(ctx: StepContext, questionId: number): string[] {
  const accepted = readAccepted<string>(ctx.paths, SAMPLES);
  return sampleNumbers().map((n) => accepted[sampleKey(n, questionId)] ?? "");
}

function missingRetry(ids: number[], what: string): AcceptOutcome {
  return ids.length > 0 ? { retry: { feedback: `No ${what} for ${ids.map((id) => `#${id}`).join(", ")}.`, claimIds: ids } } : {};
}

// --- Questions ---

function issueQuestions(ctx: StepContext): TaskRecord[] {
  const task = newTask({
    id: "questions",
    kind: "questions",
    claim_ids: readClaims(ctx).claims.map((c) => c.id),
    independence: "none",
    model_tier: "standard",
  });
  renderQuestions(ctx, task);
  return [task];
}

function renderQuestions(ctx: StepContext, task: TaskRecord, feedback?: string): void {
  const { claims, document_title: title } = readClaims(ctx);
  writeTaskFile(
    ctx,
    task,
    {
      title: "turn each claim into a question",
      body: [
        "For each claim below, write one question.",
        "",
        QUESTION_INSTRUCTIONS,
        "",
        "## Claims",
        "",
        claimsSection(claims.filter((c) => task.claim_ids.includes(c.id)), title),
      ].join("\n"),
      output: '{"executed_by": "main", "questions": [{"claim_id": 1, "question": "In which year was Albert Einstein born?"}]}',
      outputRules: ["One question per claim, for every claim listed."],
    },
    feedback
  );
}

function acceptQuestions(ctx: StepContext, task: TaskRecord, value: ResultObject): AcceptOutcome {
  const entries = entriesById(value.questions, "claim_id");
  const missing: number[] = [];
  for (const id of task.claim_ids) {
    const question = entries.get(id)?.question;
    if (typeof question === "string" && question.trim()) updateAccepted(ctx.paths, QUESTIONS, id, question.trim());
    else missing.push(id);
  }
  return missingRetry(missing, "question for claim");
}

function failQuestions(ctx: StepContext, task: TaskRecord, reason: string, claimIds: number[] = task.claim_ids): void {
  addWarning(ctx.state, `${claimIds.length} claims got no question (${reason}); their consistency was not measured.`);
}

function completeQuestions(ctx: StepContext): Stage {
  const accepted = readAccepted<string>(ctx.paths, QUESTIONS);
  const questions = readClaims(ctx)
    .claims.filter((c) => accepted[c.id] !== undefined)
    .map((c) => ({ claim_id: c.id, question: accepted[c.id] }));
  atomicWriteJSON(ctx.paths.questions, { questions });
  return questions.length > 0 ? "samples" : "verify";
}

export const questionsStep: Step = {
  stage: "questions",
  issue: issueQuestions,
  render: renderQuestions,
  accept: acceptQuestions,
  fail: failQuestions,
  complete: completeQuestions,
};

// --- Independent samples ---

function issueSamples(ctx: StepContext): TaskRecord[] {
  const ids = readQuestions(ctx).map((q) => q.claim_id);
  return sampleNumbers().map((n) => {
    const task = newTask({
      id: `sample-${n}`,
      kind: "sample",
      claim_ids: ids,
      sample_index: n,
      independence: "required",
      model_tier: "standard",
    });
    renderSample(ctx, task);
    return task;
  });
}

function renderSample(ctx: StepContext, task: TaskRecord, feedback?: string): void {
  const questions = readQuestions(ctx).filter((q) => task.claim_ids.includes(q.claim_id));
  writeTaskFile(
    ctx,
    task,
    {
      title: "answer the questions from your own knowledge",
      body: [
        `Answer each question below. ${SAMPLE_INSTRUCTIONS}`,
        "",
        "Answer from your own knowledge only: do not search the web, do not open other files and do not use other tools. If you do not know an answer, say so.",
        "",
        "## Questions",
        "",
        questions.map((q) => `### Question ${q.claim_id}\n${q.question}`).join("\n\n"),
      ].join("\n"),
      output: '{"executed_by": "subagent", "answers": [{"question_id": 1, "answer": "1879"}]}',
      outputRules: ["One answer per question, for every question listed."],
    },
    feedback
  );
}

function acceptSample(ctx: StepContext, task: TaskRecord, value: ResultObject): AcceptOutcome {
  const entries = entriesById(value.answers, "question_id");
  const missing: number[] = [];
  for (const id of task.claim_ids) {
    const answer = entries.get(id)?.answer;
    if (typeof answer === "string" && answer.trim()) {
      updateAccepted(ctx.paths, SAMPLES, sampleKey(task.sample_index ?? 0, id), answer.trim());
    } else {
      missing.push(id);
    }
  }
  return missingRetry(missing, "answer to question");
}

function failSample(ctx: StepContext, task: TaskRecord, _reason: string, claimIds: number[] = task.claim_ids): void {
  // A missing answer counts as not addressing the claim
  for (const id of claimIds) updateAccepted(ctx.paths, SAMPLES, sampleKey(task.sample_index ?? 0, id), "");
}

/** Answers count only when every sample came from a subagent that never saw the claims (spec §6.2). */
function completeSamples(ctx: StepContext): Stage {
  const byMain = ctx.state.tasks.filter((t) => t.kind === "sample" && t.status === "done" && t.executed_by !== "subagent");
  if (byMain.length > 0) {
    addWarning(
      ctx.state,
      `The consistency check was skipped: ${byMain.map((t) => t.id).join(", ")} was not answered by an independent subagent. The rules that use it did not apply.`
    );
    return "verify";
  }
  return "sample-judgments";
}

export const samplesStep: Step = {
  stage: "samples",
  issue: issueSamples,
  render: renderSample,
  accept: acceptSample,
  fail: failSample,
  complete: completeSamples,
};

// --- Judging the samples against the claims ---

function issueJudgments(ctx: StepContext): TaskRecord[] {
  const task = newTask({
    id: "sample-judgments",
    kind: "sample-judgments",
    claim_ids: readQuestions(ctx).map((q) => q.claim_id),
    independence: "none",
    model_tier: "standard",
  });
  renderJudgments(ctx, task);
  return [task];
}

function renderJudgments(ctx: StepContext, task: TaskRecord, feedback?: string): void {
  const claims = claimMap(ctx);
  const blocks = readQuestions(ctx)
    .filter((q) => task.claim_ids.includes(q.claim_id))
    .map((q) =>
      [
        `### Claim ${q.claim_id}`,
        `Claim: "${claims.get(q.claim_id)?.text ?? ""}"`,
        `Question asked: ${q.question}`,
        ...answersFor(ctx, q.claim_id).map((answer, i) => `Answer ${i + 1}: ${answer}`),
      ].join("\n")
    );
  writeTaskFile(
    ctx,
    task,
    {
      title: "compare the independent answers with each claim",
      body: [
        "For each claim below, decide how each independent answer relates to the claim.",
        "",
        SAMPLE_JUDGMENT_RULES,
        "",
        "## Claims",
        "",
        blocks.join("\n\n"),
      ].join("\n"),
      output: '{"executed_by": "main", "judgments": [{"claim_id": 1, "judgments": ["supports", "contradicts", "not_addressed"]}]}',
      outputRules: [`One label per answer, in the order of the answers (${SKILL_LIMITS.sampleCount} labels per claim).`],
    },
    feedback
  );
}

function acceptJudgments(ctx: StepContext, task: TaskRecord, value: ResultObject): AcceptOutcome {
  const entries = entriesById(value.judgments, "claim_id");
  const claims = claimMap(ctx);
  const problems: string[] = [];
  const retry: number[] = [];
  for (const id of task.claim_ids) {
    try {
      const { score, judgments } = scoreSampleJudgments({ judgments: entries.get(id)?.judgments }, SKILL_LIMITS.sampleCount);
      const result: ConsistencyResult = {
        claim_id: id,
        claim_text: claims.get(id)?.text ?? "",
        consistency_score: score,
        mode: "multi_sample",
        samples: answersFor(ctx, id),
        sample_judgments: judgments,
        flagged: score < METHOD.consistency_threshold,
      };
      updateAccepted(ctx.paths, CONSISTENCY, id, result);
    } catch (error) {
      problems.push(`Claim ${id}: ${error instanceof Error ? error.message : String(error)}`);
      retry.push(id);
    }
  }
  return retry.length > 0 ? { retry: { feedback: problems.join("\n"), claimIds: retry } } : {};
}

function failJudgments(ctx: StepContext, task: TaskRecord, reason: string, claimIds: number[] = task.claim_ids): void {
  addWarning(ctx.state, `${claimIds.length} claims have no consistency score (${reason}).`);
}

function completeJudgments(ctx: StepContext): Stage {
  const accepted = readAccepted<ConsistencyResult>(ctx.paths, CONSISTENCY);
  const results = readClaims(ctx)
    .claims.map((c) => accepted[c.id])
    .filter((r): r is ConsistencyResult => r !== undefined);
  atomicWriteJSON(ctx.paths.consistency, {
    results,
    flagged_claim_ids: results.filter((r) => r.flagged).map((r) => r.claim_id),
  });
  return "verify";
}

export const sampleJudgmentsStep: Step = {
  stage: "sample-judgments",
  issue: issueJudgments,
  render: renderJudgments,
  accept: acceptJudgments,
  fail: failJudgments,
  complete: completeJudgments,
};
