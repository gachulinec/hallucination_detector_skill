/**
 * Step 2 (faithfulness mode): each claim against the source document only.
 * Code checks every quote against the source and the number in every
 * SUPPORTED quote, as the pipeline's grounded verifier does.
 */

import {
  GROUNDED_QUESTION,
  GROUNDED_RETRY_SUFFIX,
  buildGroundedRules,
  buildSourceContext,
  groundedResultsToVerdicts,
  resolveGroundedAnswer,
  toAtomicClaims,
  validateGroundedFields,
  type AtomicClaim,
  type GroundedResult,
} from "../../method/grounded.js";
import { atomicWriteJSON, readJSON } from "../../utils/atomic-write.js";
import { describeClaim } from "../../utils/claim-context.js";
import type { TextSection } from "../../utils/section-splitter.js";
import { SKILL_LIMITS } from "../config.js";
import { entriesById, type ResultObject } from "../results.js";
import { readAccepted, updateAccepted } from "../run-state.js";
import { batches, newTask, numberedId, writeTaskFile } from "../tasks.js";
import type { Stage, TaskRecord } from "../types.js";
import { addWarning, claimMap, readClaims, type AcceptOutcome, type Step, type StepContext } from "./step.js";

const ACCEPTED = "ground";
const REJECTED_QUOTES = "ground-rejected-quotes";

function sections(ctx: StepContext): TextSection[] {
  return readJSON<{ sections: TextSection[] }>(ctx.paths.sections).sections;
}

function atomicClaims(ctx: StepContext): AtomicClaim[] {
  return toAtomicClaims(readClaims(ctx).claims, sections(ctx), ctx.text);
}

function source(ctx: StepContext): string {
  return ctx.source ?? "";
}

function fullSource(ctx: StepContext): boolean {
  return source(ctx).length <= SKILL_LIMITS.fullSourceChars;
}

function issue(ctx: StepContext): TaskRecord[] {
  const ids = readClaims(ctx).claims.map((c) => c.id);
  const groups = batches(ids, SKILL_LIMITS.claimsPerTask.ground[ctx.state.profile]);
  return groups.map((claimIds, i) => {
    const task = newTask({
      id: numberedId("ground", i + 1, groups.length),
      kind: "ground",
      claim_ids: claimIds,
      independence: "required",
      model_tier: "standard",
    });
    render(ctx, task);
    return task;
  });
}

function render(ctx: StepContext, task: TaskRecord, feedback?: string): void {
  const { claims, document_title: title } = readClaims(ctx);
  const full = fullSource(ctx);
  const blocks = claims
    .filter((c) => task.claim_ids.includes(c.id))
    .map((claim) => {
      const lines = [`### Claim ${claim.id}`, describeClaim(claim, title)];
      if (!full) {
        lines.push(
          "",
          "<source_passages>",
          buildSourceContext(source(ctx), claim.text, SKILL_LIMITS.sourcePassagesChars),
          "</source_passages>"
        );
      }
      return lines.join("\n");
    });
  writeTaskFile(
    ctx,
    task,
    {
      title: "check the claims against the source document only",
      body: [
        buildGroundedRules(ctx.state.language),
        "",
        "## Source document",
        "",
        full
          ? `Read the whole source document from ${ctx.paths.source} before you answer. If your file reader returns it in parts, read every part. Use nothing else: no web search, no other files, no outside knowledge.`
          : "The source document is long. Each claim below comes with the passages of the source most relevant to it; they are your only source. Use nothing else: no web search, no other files, no outside knowledge.",
        "",
        "## Claims",
        "",
        blocks.join("\n\n"),
        "",
        `For each claim: ${GROUNDED_QUESTION}`,
      ].join("\n"),
      output:
        '{"executed_by": "subagent", "results": [{"claim_id": 3, "status": "CONTRADICTED", "quote": "verbatim quote from the source document, or null for NOT_IN_SOURCE", "source_says": "what the source states when it differs, otherwise null", "explanation": "short explanation"}]}',
      outputRules: [
        "One result per claim, for every claim listed.",
        "A SUPPORTED or CONTRADICTED answer needs a quote copied character-for-character from the source document.",
      ],
    },
    feedback
  );
}

function accept(ctx: StepContext, task: TaskRecord, value: ResultObject): AcceptOutcome {
  const entries = entriesById(value.results, "claim_id");
  const claims = claimMap(ctx);
  const rejected = readAccepted<boolean>(ctx.paths, REJECTED_QUOTES);
  const problems: string[] = [];
  const retry: number[] = [];
  for (const id of task.claim_ids) {
    const claim = claims.get(id);
    if (!claim) continue;
    const entry = entries.get(id);
    if (!entry) {
      problems.push(`Claim ${id}: no result for this claim.`);
      retry.push(id);
      continue;
    }
    const validation = validateGroundedFields(entry, source(ctx), claim.text);
    if (validation.ok) {
      const base = { claim_id: id, claim_text: claim.text, quote: null, source_says: null, explanation: "" };
      updateAccepted(ctx.paths, ACCEPTED, id, resolveGroundedAnswer(base, validation, rejected[id] === true, claim.text));
    } else {
      if (validation.quoteRejected) updateAccepted(ctx.paths, REJECTED_QUOTES, id, true);
      problems.push(`Claim ${id}: ${validation.feedback} ${GROUNDED_RETRY_SUFFIX}`);
      retry.push(id);
    }
  }
  return retry.length > 0 ? { retry: { feedback: problems.join("\n"), claimIds: retry } } : {};
}

function failed(claimId: number, claimText: string, error: string): GroundedResult {
  return { claim_id: claimId, claim_text: claimText, status: null, quote: null, source_says: null, explanation: "", error };
}

function fail(ctx: StepContext, task: TaskRecord, reason: string, claimIds: number[] = task.claim_ids): void {
  const claims = claimMap(ctx);
  const error = task.attempt >= SKILL_LIMITS.maxAttempts ? `No valid answer after ${task.attempt} attempts: ${reason}` : reason;
  for (const id of claimIds) updateAccepted(ctx.paths, ACCEPTED, id, failed(id, claims.get(id)?.text ?? "", error));
}

function complete(ctx: StepContext): Stage {
  const accepted = readAccepted<GroundedResult>(ctx.paths, ACCEPTED);
  const claims = atomicClaims(ctx);
  const results = claims.map((c) => accepted[c.id] ?? failed(c.id, c.text, "No verification result."));
  atomicWriteJSON(ctx.paths.verifications, { results });

  const full = fullSource(ctx);
  const verdicts = groundedResultsToVerdicts(results, claims, sections(ctx), { partialSource: !full });
  atomicWriteJSON(ctx.paths.verdicts, { verdicts });

  const unverified = results.filter((r) => r.status === null).length;
  if (unverified > 0) {
    addWarning(ctx.state, `${unverified} of ${results.length} claims could not be verified against the source and are marked UNVERIFIABLE.`);
  }
  if (!full) {
    addWarning(
      ctx.state,
      `The source document is longer than ${SKILL_LIMITS.fullSourceChars} characters; each claim was checked against the most relevant passages only, and claims not found there are marked UNVERIFIABLE.`
    );
  }
  return "done";
}

export const groundStep: Step = { stage: "ground", issue, render, accept, fail, complete };
