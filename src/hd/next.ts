/**
 * hd next: the state machine of a run. It reads the results the agent wrote,
 * accepts them or asks for one retry, moves to the next stage when a stage is
 * complete, and finishes with the report. Called again without new results,
 * it changes nothing.
 */

import { existsSync } from "node:fs";
import type { HallucinationReport } from "../schemas/index.js";
import { readJSON } from "../utils/atomic-write.js";
import { AuditLogger } from "../utils/audit-logger.js";
import { SKILL_LIMITS } from "./config.js";
import { finalizeRun } from "./report.js";
import { readResult, type ReadResult } from "./results.js";
import { resultFile, saveState, taskFile } from "./run-state.js";
import { questionsStep, sampleJudgmentsStep, samplesStep } from "./steps/consistency.js";
import { extractStep } from "./steps/extract.js";
import { groundStep } from "./steps/ground.js";
import { judgeStep } from "./steps/judge.js";
import { addWarning, loadContext, type AcceptOutcome, type Step, type StepContext } from "./steps/step.js";
import { verifyStep } from "./steps/verify.js";
import type { ActiveStage, Independence, ModelTier, Stage, TaskKind, TaskRecord } from "./types.js";

const STEPS: Record<ActiveStage, Step> = {
  extract: extractStep,
  questions: questionsStep,
  samples: samplesStep,
  "sample-judgments": sampleJudgmentsStep,
  verify: verifyStep,
  judge: judgeStep,
  ground: groundStep,
};

const STAGE_OF: Record<TaskKind, ActiveStage> = {
  extract: "extract",
  questions: "questions",
  sample: "samples",
  "sample-judgments": "sample-judgments",
  verify: "verify",
  judge: "judge",
  ground: "ground",
};

export interface TaskView {
  id: string;
  kind: TaskKind;
  independence: Independence;
  model_tier: ModelTier;
  attempt: number;
  task_file: string;
  result_file: string;
}

export interface ProcessedView {
  id: string;
  outcome: "accepted" | "retry" | "failed";
  detail?: string;
}

export interface NextOutput {
  run: string;
  hd_command: string;
  stage: Stage;
  done: boolean;
  failure?: string;
  processed: ProcessedView[];
  /** Result files that are still being written */
  waiting: string[];
  tasks: TaskView[];
  /** Tasks of the current stage */
  progress: { done: number; total: number };
  counts?: { claims: number; hallucination: number; unverifiable: number; verified: number };
  summary_file?: string;
  warnings: string[];
}

function isActive(stage: Stage): stage is ActiveStage {
  return stage !== "done" && stage !== "failed";
}

type ReadyResult = Exclude<ReadResult, { state: "missing" } | { state: "settling" }>;

function handle(ctx: StepContext, task: TaskRecord, read: ReadyResult, audit: AuditLogger): ProcessedView {
  const step = STEPS[STAGE_OF[task.kind]];
  if (read.state === "ok") task.executed_by = read.executedBy;

  if (read.state === "ok" && read.error) {
    task.status = "failed";
    task.error = read.error;
    step.fail(ctx, task, read.error);
    addWarning(ctx.state, `Task ${task.id} could not be done: ${read.error}`);
    audit.log({ event: "task_failed", module: "skill", details: { task: task.id, error: read.error } });
    return { id: task.id, outcome: "failed", detail: read.error };
  }

  let outcome: AcceptOutcome;
  if (read.state === "invalid") {
    outcome = { retry: { feedback: read.feedback } };
  } else {
    try {
      outcome = step.accept(ctx, task, read.value);
    } catch (error) {
      outcome = { retry: { feedback: `The result could not be processed: ${error instanceof Error ? error.message : String(error)}` } };
    }
  }

  if (!outcome.retry) {
    task.status = "done";
    audit.log({ event: "task_accepted", module: "skill", details: { task: task.id, executed_by: task.executed_by } });
    return { id: task.id, outcome: "accepted" };
  }

  if (task.attempt < SKILL_LIMITS.maxAttempts) {
    const { executed_by: _executedBy, error: _error, ...rest } = task;
    const retry: TaskRecord = {
      ...rest,
      id: `${task.id}-retry`,
      attempt: task.attempt + 1,
      claim_ids: outcome.retry.claimIds ?? task.claim_ids,
      status: "pending",
    };
    step.render(ctx, retry, outcome.retry.feedback);
    ctx.state.tasks.push(retry);
    task.status = "done";
    audit.log({ event: "task_retry", module: "skill", details: { task: task.id, feedback: outcome.retry.feedback } });
    return { id: task.id, outcome: "retry", detail: outcome.retry.feedback };
  }

  task.status = "failed";
  task.error = outcome.retry.feedback;
  step.fail(ctx, task, outcome.retry.feedback, outcome.retry.claimIds);
  audit.log({ event: "task_failed", module: "skill", details: { task: task.id, error: outcome.retry.feedback } });
  return { id: task.id, outcome: "failed", detail: outcome.retry.feedback };
}

/** Completes finished stages and issues the next stage's tasks; stages without tasks complete at once. */
function advance(ctx: StepContext, audit: AuditLogger): void {
  const { state } = ctx;
  while (isActive(state.stage)) {
    const stage = state.stage;
    if (state.tasks.some((t) => STAGE_OF[t.kind] === stage && t.status === "pending")) return;
    const next = STEPS[stage].complete(ctx);
    audit.log({ event: "stage_complete", module: "skill", details: { stage, next } });
    state.stage = next;
    if (next === "done") {
      finalizeRun(ctx);
      return;
    }
    if (next === "failed") return;
    const issued = STEPS[next].issue(ctx);
    state.tasks.push(...issued);
    audit.log({ event: "tasks_issued", module: "skill", details: { stage: next, tasks: issued.map((t) => t.id) } });
  }
}

function view(ctx: StepContext, processed: ProcessedView[], waiting: string[]): NextOutput {
  const { state, paths } = ctx;
  const stageTasks = isActive(state.stage) ? state.tasks.filter((t) => STAGE_OF[t.kind] === state.stage) : [];
  const out: NextOutput = {
    run: paths.root,
    hd_command: state.hd_command,
    stage: state.stage,
    done: state.stage === "done",
    failure: state.stage === "failed" ? (state.failure ?? "The run failed.") : undefined,
    processed,
    waiting,
    tasks: state.tasks
      .filter((t) => t.status === "pending")
      .map((t) => ({
        id: t.id,
        kind: t.kind,
        independence: t.independence,
        model_tier: t.model_tier,
        attempt: t.attempt,
        task_file: taskFile(paths, t.id),
        result_file: resultFile(paths, t.id),
      })),
    progress: { done: stageTasks.filter((t) => t.status !== "pending").length, total: stageTasks.length },
    warnings: state.warnings,
  };
  if (out.done && existsSync(paths.report)) {
    const report = readJSON<HallucinationReport>(paths.report);
    out.counts = {
      claims: report.total_claims,
      hallucination: report.hallucination_count,
      unverifiable: report.unverifiable_count,
      verified: report.verified_count,
    };
    out.summary_file = paths.summary;
  }
  return out;
}

export function runNext(root: string, now: () => number = Date.now): NextOutput {
  const ctx = loadContext(root);
  const processed: ProcessedView[] = [];
  const waiting: string[] = [];
  if (isActive(ctx.state.stage)) {
    const audit = new AuditLogger(ctx.paths.audit);
    if (ctx.state.tasks.length === 0) ctx.state.tasks.push(...STEPS[ctx.state.stage].issue(ctx));
    for (const task of ctx.state.tasks.filter((t) => t.status === "pending")) {
      const read = readResult(resultFile(ctx.paths, task.id), now());
      if (read.state === "missing") continue;
      if (read.state === "settling") {
        waiting.push(task.id);
        continue;
      }
      processed.push(handle(ctx, task, read, audit));
    }
    advance(ctx, audit);
    saveState(ctx.paths, ctx.state);
  }
  return view(ctx, processed, waiting);
}

export function runStatus(root: string): NextOutput {
  return view(loadContext(root), [], []);
}
