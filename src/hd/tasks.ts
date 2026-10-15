/**
 * Task records and task files. A task file holds everything an agent (or a
 * fresh subagent) needs for one task: instructions, input, and the exact
 * shape and path of the result.
 */

import { writeFileSync } from "node:fs";
import type { Claim } from "../schemas/index.js";
import { describeClaim } from "../utils/claim-context.js";
import { resultFile, taskFile } from "./run-state.js";
import type { StepContext } from "./steps/step.js";
import type { Independence, TaskKind, TaskRecord } from "./types.js";

// Addressed to the main agent: a subagent that reads "run this in a subagent" delegates again
const INDEPENDENCE_TEXT: Record<Independence, string> = {
  required:
    "required — the main agent gives this task to a subagent with a fresh context that has not seen the checked text, the claims or earlier results, and gives it only this file.",
  recommended: "recommended — the main agent gives this task to a subagent if it can; it keeps the main context small.",
  none: "not needed — the main agent can do this task itself.",
};

export function newTask(fields: Omit<TaskRecord, "attempt" | "status">): TaskRecord {
  return { attempt: 1, status: "pending", ...fields };
}

/** "verify-03": numbered so that tasks list in order */
export function numberedId(kind: TaskKind, n: number, total: number): string {
  return `${kind}-${String(n).padStart(Math.max(2, String(total).length), "0")}`;
}

export function batches<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/** The claims of a task with their document context (title and passage). */
export function claimsSection(
  claims: Claim[],
  title: string | undefined,
  extra?: (claim: Claim) => string | undefined
): string {
  return claims
    .map((claim) => {
      const more = extra?.(claim);
      return [`### Claim ${claim.id}`, describeClaim(claim, title), ...(more ? [more] : [])].join("\n");
    })
    .join("\n\n");
}

export interface TaskContent {
  title: string;
  body: string;
  /** An example of the result JSON */
  output: string;
  outputRules?: string[];
}

export function writeTaskFile(ctx: StepContext, task: TaskRecord, content: TaskContent, feedback?: string): void {
  const result = resultFile(ctx.paths, task.id);
  const lines = [
    `# Task ${task.id}: ${content.title}`,
    "",
    `- Independence: ${INDEPENDENCE_TEXT[task.independence]}`,
    `- Model: ${task.model_tier === "strongest" ? "use the strongest model you can choose" : "a standard model is enough"}`,
    `- Result file: ${result}`,
    "",
    "If you received this file as a subagent, do the task yourself now: do not hand it to another subagent.",
    "",
  ];
  if (feedback) {
    lines.push(
      "## This is a retry",
      "",
      "The earlier result for this task had these problems:",
      "",
      feedback.trim(),
      "",
      "Fix them and write the result again.",
      ""
    );
  }
  lines.push(
    content.body.trim(),
    "",
    "## Output",
    "",
    `Write only this JSON object to ${result} (UTF-8, no code fences, no text around it):`,
    "",
    "```json",
    content.output,
    "```",
    "",
    ...(content.outputRules ?? []).map((rule) => `- ${rule}`),
    '- Set "executed_by" to "subagent" if another agent gave you this file — also when you do the task yourself as asked above. Set it to "main" only if you are the agent that runs hd next.',
    '- If you cannot do this task at all, write {"executed_by": "...", "error": "<why>"} instead.',
    "",
    "When the file is written, this task is done. Do not run `hd next`: the main agent does that.",
    ""
  );
  writeFileSync(taskFile(ctx.paths, task.id), lines.join("\n"), "utf-8");
}
