/** The text hd prints for the agent. */

import type { StoredEvidence } from "./evidence-store.js";
import type { NextOutput } from "./next.js";

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

export function formatNext(out: NextOutput): string {
  const lines: string[] = [];
  for (const p of out.processed) {
    if (p.outcome === "accepted") lines.push(`Accepted: ${p.id}`);
    else if (p.outcome === "retry") lines.push(`Needs a retry: ${p.id} (task ${p.id}-retry)`, indent(p.detail ?? ""));
    else lines.push(`Failed: ${p.id}: ${p.detail ?? ""}`);
  }

  if (out.failure) {
    lines.push(`FAILED: ${out.failure}`, "Tell the user what failed.");
    return lines.join("\n");
  }

  if (out.done) {
    const c = out.counts;
    lines.push(c ? `DONE. ${c.claims} claims: ${c.hallucination} HALLUCINATION, ${c.unverifiable} UNVERIFIABLE, ${c.verified} VERIFIED.` : "DONE.");
    if (out.summary_file) lines.push(`Summary: ${out.summary_file}`);
    if (out.warnings.length > 0) lines.push("Warnings:", ...out.warnings.map((w) => `- ${w}`));
    lines.push("Present the result as references/reading-results.md says.");
    return lines.join("\n");
  }

  lines.push(`Step: ${out.stage} (${out.progress.done} of ${out.progress.total} tasks done)`);
  // A task whose result is being written is not work to do: dispatching it again duplicates it
  const todo = out.tasks.filter((t) => !out.waiting.includes(t.id));
  if (todo.length > 0) {
    lines.push("Do these tasks now. Each task file says what to do and where to write the result:");
    for (const t of todo) {
      lines.push(`- ${t.id} [independence: ${t.independence}, model: ${t.model_tier}]`, `    task: ${t.task_file}`, `    result: ${t.result_file}`);
    }
    lines.push("If you already dispatched one of these tasks and its subagent is still working, wait for its result instead of dispatching it again.");
    if (todo.some((t) => t.independence !== "none")) {
      lines.push(
        'Give tasks marked required to subagents with a fresh context: "Read <task file> and follow it exactly. Write the result to the path it names. Do not run hd next." Use subagents for recommended tasks too if you can. Independent tasks can run at the same time.'
      );
    }
  }
  if (out.waiting.length > 0) lines.push(`Still being written: ${out.waiting.join(", ")}`);
  lines.push(`When the result files are written, run: ${out.hd_command} next "${out.run}"`);
  return lines.join("\n");
}

export function formatEvidence(items: StoredEvidence[]): string {
  return `${items.map((item) => `${item.id}  ${item.url}\n  "${item.text.replace(/\s+/g, " ")}"`).join("\n\n")}\n\nRefer to this evidence by its ID in your result.`;
}
