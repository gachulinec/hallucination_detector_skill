/**
 * Step 1: claim extraction, one task per chunk of the text (the pipeline's
 * chunking and prompt). Code checks that each claim's sentence is in the text
 * and that no number of a sentence is left without a claim.
 */

import { finalizeExtractedClaims, normalizeExtractedClaims } from "../../method/claims.js";
import type { Claim } from "../../schemas/index.js";
import { atomicWriteJSON, readJSON } from "../../utils/atomic-write.js";
import { chunkForExtraction, mergeChunkClaims, type ExtractionChunk } from "../../utils/extraction-chunks.js";
import { loadPrompt } from "../../utils/prompts.js";
import { splitIntoSections } from "../../utils/section-splitter.js";
import { sanitizeText } from "../../utils/text-sanitizer.js";
import { normalizeText, sentenceInText, uncoveredNumbers } from "../checks.js";
import { SKILL_LIMITS } from "../config.js";
import type { ResultObject } from "../results.js";
import { readAccepted, updateAccepted } from "../run-state.js";
import { newTask, numberedId, writeTaskFile } from "../tasks.js";
import type { Stage, TaskRecord } from "../types.js";
import { addWarning, type AcceptOutcome, type Step, type StepContext } from "./step.js";

const ACCEPTED = "extract";

function readChunks(ctx: StepContext): ExtractionChunk[] {
  return readJSON<{ chunks: ExtractionChunk[] }>(ctx.paths.chunks).chunks;
}

function chunkOf(ctx: StepContext, task: TaskRecord): ExtractionChunk {
  const chunk = readChunks(ctx).find((c) => c.id === task.chunk_id);
  if (!chunk) throw new Error(`Task ${task.id} refers to an unknown part of the text (${task.chunk_id}).`);
  return chunk;
}

/** Positions in the chunk taken from where the claim's sentence is (more reliable than counted characters) */
function positioned(claims: Claim[], chunkText: string): Claim[] {
  return claims.map((claim) => {
    const at = chunkText.indexOf(claim.original_sentence);
    return at >= 0 ? { ...claim, source_position: { start: at, end: at + claim.original_sentence.length } } : claim;
  });
}

function issue(ctx: StepContext): TaskRecord[] {
  const chunks = chunkForExtraction(ctx.text, SKILL_LIMITS.extractionChunkChars);
  atomicWriteJSON(ctx.paths.chunks, { chunks });
  return chunks.map((chunk) => {
    const task = newTask({
      id: numberedId("extract", chunk.id, chunks.length),
      kind: "extract",
      claim_ids: [],
      chunk_id: chunk.id,
      independence: "recommended",
      model_tier: "standard",
    });
    render(ctx, task);
    return task;
  });
}

function render(ctx: StepContext, task: TaskRecord, feedback?: string): void {
  const chunk = chunkOf(ctx, task);
  const parts = readChunks(ctx).length;
  writeTaskFile(
    ctx,
    task,
    {
      title: parts > 1 ? `extract the claims of part ${chunk.id} of ${parts} of the text` : "extract the claims of the text",
      body: `${loadPrompt("claim-extractor")}\n\n## Text to analyze:\n\n${chunk.text}`,
      output:
        '{"executed_by": "subagent", "claims": [{"id": 1, "text": "Albert Einstein was born in 1879", "type": "numeric", "original_sentence": "Albert Einstein, born in Ulm in 1879, developed the theory of relativity."}]}',
      outputRules: [
        "Copy each original_sentence exactly from the text: it is used to find the claim there.",
        "source_position may be left out.",
      ],
    },
    feedback
  );
}

function accept(ctx: StepContext, task: TaskRecord, value: ResultObject): AcceptOutcome {
  if (!Array.isArray(value.claims)) return { retry: { feedback: 'The result has no "claims" array.' } };
  const chunk = chunkOf(ctx, task);
  const normalizedChunk = normalizeText(chunk.text);
  let claims = positioned(normalizeExtractedClaims(value.claims), chunk.text);
  if (task.attempt > 1) {
    // A retry that returns only the corrected claims must not drop the valid claims of the first attempt
    const previous = readAccepted<Claim[]>(ctx.paths, ACCEPTED)[chunk.id] ?? [];
    const retried = new Set(claims.map((c) => normalizeText(c.text)));
    const kept = previous.filter((c) => !retried.has(normalizeText(c.text)) && sentenceInText(c.original_sentence, normalizedChunk));
    claims = [...claims, ...kept].sort((a, b) => a.source_position.start - b.source_position.start);
  }
  // The newest valid list replaces an earlier one
  updateAccepted(ctx.paths, ACCEPTED, chunk.id, claims);

  const notInText = claims.filter((c) => !sentenceInText(c.original_sentence, normalizedChunk));
  const uncovered = uncoveredNumbers(chunk.text, claims);

  if (task.attempt === 1 && (notInText.length > 0 || uncovered.length > 0)) {
    const lines: string[] = [];
    if (notInText.length > 0) {
      lines.push(
        "These claims have an original_sentence that is not in the text; copy the sentence exactly:",
        ...notInText.map((c) => `- Claim "${c.text}": "${c.original_sentence}"`)
      );
    }
    if (uncovered.length > 0) {
      lines.push(
        "These sentences contain numbers that no claim states. Add a claim for each such number (one number = one claim), unless the number is not a fact (for example, a list number):",
        ...uncovered.map((u) => `- "${u.sentence}": ${u.numbers.join(", ")}`)
      );
    }
    lines.push("Return the complete list of claims for this text again, with these corrections.");
    return { retry: { feedback: lines.join("\n") } };
  }

  if (notInText.length > 0) {
    addWarning(
      ctx.state,
      `Part ${chunk.id}: ${notInText.length} claims quote a sentence that is not in the text; they were kept, but their place in the text is unknown.`
    );
  }
  if (uncovered.length > 0) {
    addWarning(ctx.state, `Part ${chunk.id}: numbers without a claim after the retry: ${uncovered.flatMap((u) => u.numbers).join(", ")}.`);
  }
  return {};
}

function fail(ctx: StepContext, task: TaskRecord, reason: string): void {
  const chunk = chunkOf(ctx, task);
  if (readAccepted<Claim[]>(ctx.paths, ACCEPTED)[chunk.id] !== undefined) {
    addWarning(ctx.state, `Part ${chunk.id}: the retry failed (${reason}); the claims of the first attempt were kept.`);
  }
}

function complete(ctx: StepContext): Stage {
  const chunks = readChunks(ctx);
  const accepted = readAccepted<Claim[]>(ctx.paths, ACCEPTED);
  const failed = chunks.filter((c) => accepted[c.id] === undefined).length;
  if (failed === chunks.length) {
    ctx.state.failure = `Claim extraction failed for all ${chunks.length} parts of the text.`;
    return "failed";
  }
  if (failed > 0) {
    addWarning(
      ctx.state,
      `${failed} of ${chunks.length} text chunks could not be processed by the claim extractor; claims from them are missing.`
    );
  }

  const merged = mergeChunkClaims(chunks.map((c) => ({ offset: c.start, claims: accepted[c.id] ?? [] })));
  const { output } = finalizeExtractedClaims(merged, ctx.text, ctx.source, { total: chunks.length, failed });
  atomicWriteJSON(ctx.paths.claims, output);

  if (ctx.state.mode === "faithfulness") {
    const sections = splitIntoSections(ctx.text).map((s) => ({ ...s, text: sanitizeText(s.text) }));
    atomicWriteJSON(ctx.paths.sections, { sections });
  }

  if (output.claims.length === 0) return "done";
  if (ctx.state.mode === "faithfulness") return "ground";
  if (ctx.state.profile === "quick") return "verify";
  if (!ctx.state.subagents) {
    addWarning(
      ctx.state,
      "The consistency check was skipped: it needs independent subagents, which this agent cannot run. The rules that use it did not apply."
    );
    return "verify";
  }
  return "questions";
}

export const extractStep: Step = { stage: "extract", issue, render, accept, fail, complete };
