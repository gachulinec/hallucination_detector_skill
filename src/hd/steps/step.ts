/**
 * The interface every stage of a run implements, and readers for the files
 * steps share. Stages: extract → (questions → samples → sample-judgments) →
 * verify → judge in standard mode; extract → ground in faithfulness mode.
 */

import { existsSync, readFileSync } from "node:fs";
import type { ConsistencyResult } from "../../method/consistency.js";
import type { VerificationResult } from "../../method/retrieval.js";
import type { Claim, ClaimsOutput } from "../../schemas/index.js";
import { readJSON } from "../../utils/atomic-write.js";
import type { ResultObject } from "../results.js";
import { loadState, runPaths, type RunPaths } from "../run-state.js";
import type { ActiveStage, RunState, Stage, TaskRecord } from "../types.js";

export interface StepContext {
  paths: RunPaths;
  state: RunState;
  text: string;
  source?: string;
}

export interface AcceptOutcome {
  /** Something to fix: a retry for these claims, or for the whole task when claimIds is left out */
  retry?: { feedback: string; claimIds?: number[] };
}

export interface Step {
  stage: ActiveStage;
  /** Writes the stage's tasks and returns their records (none when there is nothing to do) */
  issue(ctx: StepContext): TaskRecord[];
  /** Writes the task file of a record: a first attempt, or a retry with feedback */
  render(ctx: StepContext, task: TaskRecord, feedback?: string): void;
  /** Checks a result and stores what is valid */
  accept(ctx: StepContext, task: TaskRecord, value: ResultObject): AcceptOutcome;
  /** The task failed for good: stores failure results for what it did not deliver */
  fail(ctx: StepContext, task: TaskRecord, reason: string, claimIds?: number[]): void;
  /** All tasks of the stage are finished: writes the stage's output and returns the next stage */
  complete(ctx: StepContext): Stage;
}

export function loadContext(root: string): StepContext {
  const paths = runPaths(root);
  const state = loadState(paths);
  return {
    paths,
    state,
    text: readFileSync(paths.text, "utf-8"),
    source: existsSync(paths.source) ? readFileSync(paths.source, "utf-8") : undefined,
  };
}

export function addWarning(state: RunState, warning: string): void {
  if (!state.warnings.includes(warning)) state.warnings.push(warning);
}

export function readClaims(ctx: StepContext): ClaimsOutput {
  return readJSON<ClaimsOutput>(ctx.paths.claims);
}

export function claimMap(ctx: StepContext): Map<number, Claim> {
  return new Map(readClaims(ctx).claims.map((claim) => [claim.id, claim]));
}

export function consistencyMap(ctx: StepContext): Map<number, ConsistencyResult> {
  if (!existsSync(ctx.paths.consistency)) return new Map();
  const { results } = readJSON<{ results: ConsistencyResult[] }>(ctx.paths.consistency);
  return new Map(results.map((r) => [r.claim_id, r]));
}

export function verificationMap(ctx: StepContext): Map<number, VerificationResult> {
  if (!existsSync(ctx.paths.evidence)) return new Map();
  const { results } = readJSON<{ results: VerificationResult[] }>(ctx.paths.evidence);
  return new Map(results.map((r) => [r.claim_id, r]));
}
