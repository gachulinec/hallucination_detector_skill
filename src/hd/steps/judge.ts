/**
 * Step 4 (standard mode): verdicts. Code decides what the rules decide
 * (decideWithoutJudge, ignoring unconfirmed evidence); the rest goes to an
 * independent judge, whose verdicts pass through the pipeline's guardrails.
 */

import { buildJudgeClaimContext, buildJudgeVerdict, decideWithoutJudge } from "../../method/verdicts.js";
import type { Verdict } from "../../schemas/index.js";
import { atomicWriteJSON } from "../../utils/atomic-write.js";
import { AuditLogger } from "../../utils/audit-logger.js";
import { loadPrompt } from "../../utils/prompts.js";
import { normalizeVerdict } from "../../utils/validate.js";
import { SKILL_LIMITS } from "../config.js";
import { entriesById, type ResultObject } from "../results.js";
import { readAccepted, updateAccepted } from "../run-state.js";
import { batches, newTask, numberedId, writeTaskFile } from "../tasks.js";
import { WEB_TEXT_WARNING } from "./verify.js";
import type { Stage, TaskRecord } from "../types.js";
import {
  claimMap,
  consistencyMap,
  readClaims,
  verificationMap,
  type AcceptOutcome,
  type Step,
  type StepContext,
} from "./step.js";

const ACCEPTED = "verdicts";

/** Stores the verdicts the rules decide; returns the claims the judge has to decide. */
export function routeClaims(ctx: StepContext): number[] {
  const claimsOutput = readClaims(ctx);
  const consistency = consistencyMap(ctx);
  const verification = verificationMap(ctx);
  const queue: number[] = [];
  for (const claim of claimsOutput.claims) {
    const direct = decideWithoutJudge(claim, consistency.get(claim.id), verification.get(claim.id), {
      // Every claim is verified (always_verify), so none is decided by consistency alone
      flaggedIds: claimsOutput.claims.map((c) => c.id),
      sourceIsAnonymized: claimsOutput.source_is_anonymized ?? false,
    });
    if (direct) updateAccepted(ctx.paths, ACCEPTED, claim.id, direct);
    else queue.push(claim.id);
  }
  return queue;
}

function issue(ctx: StepContext): TaskRecord[] {
  const groups = batches(routeClaims(ctx), SKILL_LIMITS.claimsPerTask.judge[ctx.state.profile]);
  return groups.map((claimIds, i) => {
    const task = newTask({
      id: numberedId("judge", i + 1, groups.length),
      kind: "judge",
      claim_ids: claimIds,
      independence: "required",
      model_tier: "strongest",
    });
    render(ctx, task);
    return task;
  });
}

function render(ctx: StepContext, task: TaskRecord, feedback?: string): void {
  const claims = claimMap(ctx);
  const consistency = consistencyMap(ctx);
  const verification = verificationMap(ctx);
  const blocks = task.claim_ids.flatMap((id) => {
    const claim = claims.get(id);
    return claim ? [`### Claim ${id}\n${buildJudgeClaimContext(claim, consistency.get(id), verification.get(id))}`] : [];
  });
  writeTaskFile(
    ctx,
    task,
    {
      title: "decide the verdicts the rules could not decide",
      body: [
        loadPrompt("verdict-judge"),
        "",
        "## How to work",
        "",
        "Judge each claim below on its own, from the evidence given and your own knowledge. Do not search the web.",
        WEB_TEXT_WARNING,
        "Evidence marked [unconfirmed] is the verifier's own wording of a source that could not be checked against the page; it weighs less than confirmed evidence.",
        `Write the reasoning in ${ctx.state.language}.`,
        "",
        "## Claims",
        "",
        blocks.join("\n\n"),
      ].join("\n"),
      output:
        '{"executed_by": "subagent", "verdicts": [{"claim_id": 4, "verdict": "HALLUCINATION", "confidence": 0.85, "hallucination_type": "numeric_fabrication", "reasoning": "step-by-step explanation", "severity": "major"}]}',
      outputRules: [
        "One verdict per claim, for every claim listed.",
        "This output format replaces the one described in the rules above.",
      ],
    },
    feedback
  );
}

function accept(ctx: StepContext, task: TaskRecord, value: ResultObject): AcceptOutcome {
  const entries = entriesById(value.verdicts, "claim_id");
  const claims = claimMap(ctx);
  const consistency = consistencyMap(ctx);
  const verification = verificationMap(ctx);
  // Guardrail events (confidence caps) go to the run's audit log, as in the pipeline
  const audit = new AuditLogger(ctx.paths.audit);
  const problems: string[] = [];
  const retry: number[] = [];
  for (const id of task.claim_ids) {
    const claim = claims.get(id);
    if (!claim) continue;
    const entry = entries.get(id);
    if (!entry || !normalizeVerdict(entry.verdict)) {
      problems.push(
        `Claim ${id}: ${entry ? `the verdict ${JSON.stringify(entry.verdict)} is not VERIFIED, HALLUCINATION or UNVERIFIABLE` : "no verdict for this claim"}.`
      );
      retry.push(id);
      continue;
    }
    updateAccepted(
      ctx.paths,
      ACCEPTED,
      id,
      buildJudgeVerdict(claim, entry, consistency.get(id)?.consistency_score ?? 0.5, verification.get(id)?.evidence ?? [], audit)
    );
  }
  return retry.length > 0 ? { retry: { feedback: problems.join("\n"), claimIds: retry } } : {};
}

function unverifiable(ctx: StepContext, claimId: number, reasoning: string): Verdict {
  return {
    claim_id: claimId,
    claim_text: claimMap(ctx).get(claimId)?.text ?? "",
    verdict: "UNVERIFIABLE",
    confidence: 0.3,
    hallucination_type: null,
    consistency_score: consistencyMap(ctx).get(claimId)?.consistency_score ?? 0.5,
    evidence: verificationMap(ctx).get(claimId)?.evidence ?? [],
    reasoning,
    severity: null,
  };
}

function fail(ctx: StepContext, task: TaskRecord, reason: string, claimIds: number[] = task.claim_ids): void {
  for (const id of claimIds) {
    updateAccepted(ctx.paths, ACCEPTED, id, unverifiable(ctx, id, `No valid verdict from the judge: ${reason}`));
  }
}

function complete(ctx: StepContext): Stage {
  const accepted = readAccepted<Verdict>(ctx.paths, ACCEPTED);
  const verdicts = readClaims(ctx).claims.map((c) => accepted[c.id] ?? unverifiable(ctx, c.id, "No verdict for this claim."));
  atomicWriteJSON(ctx.paths.verdicts, { verdicts });
  return "done";
}

export const judgeStep: Step = { stage: "judge", issue, render, accept, fail, complete };
