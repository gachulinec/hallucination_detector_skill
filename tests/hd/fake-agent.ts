/**
 * A scripted agent for the skill tests: it does every kind of task with
 * fixed, simple answers, so whole runs can be tested without a model.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Claim, ClaimsOutput } from "../../src/schemas/index.js";
import type { TaskView } from "../../src/hd/next.js";
import type { RunState } from "../../src/hd/types.js";
import { parseNumbers } from "../../src/utils/rounding.js";

export interface FakeWorld {
  /** Claims whose text contains one of these strings are wrong */
  wrong: string[];
  /** The page the fake agent fetches for a claim */
  pageUrl(claim: Claim): string;
  /** Fetches the page through hd and returns the evidence IDs hd printed */
  fetchEvidence(root: string, claimId: number, url: string): Promise<string[]>;
  /** Who the results say did the task (default: subagent) */
  executedBy?: "subagent" | "main";
}

function readJsonFile<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf-8")) as T;
}

function sentences(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .filter(Boolean);
}

export async function fakeAgentDo(root: string, tasks: TaskView[], world: FakeWorld): Promise<void> {
  const state = readJsonFile<RunState>(join(root, "state.json"));
  const by = world.executedBy ?? "subagent";
  for (const view of tasks) {
    const task = state.tasks.find((t) => t.id === view.id);
    if (!task) throw new Error(`Unknown task ${view.id}`);
    const claims = (): Claim[] =>
      readJsonFile<ClaimsOutput>(join(root, "claims.json")).claims.filter((c) => task.claim_ids.includes(c.id));
    const wrong = (c: Claim): boolean => world.wrong.some((w) => c.text.includes(w));
    let result: Record<string, unknown>;
    switch (task.kind) {
      case "extract": {
        const { chunks } = readJsonFile<{ chunks: Array<{ id: number; text: string }> }>(join(root, "chunks.json"));
        const chunk = chunks.find((c) => c.id === task.chunk_id);
        result = {
          executed_by: by,
          claims: sentences(chunk?.text ?? "").map((s, i) => ({
            id: i + 1,
            text: s.replace(/[.!?]$/, ""),
            type: /\d/.test(s) ? "numeric" : "factual",
            original_sentence: s,
          })),
        };
        break;
      }
      case "questions":
        result = { executed_by: "main", questions: claims().map((c) => ({ claim_id: c.id, question: `What is known about: ${c.text}?` })) };
        break;
      case "sample":
        result = { executed_by: by, answers: task.claim_ids.map((id) => ({ question_id: id, answer: "I do not know." })) };
        break;
      case "sample-judgments":
        // String IDs on purpose: agents write them
        result = {
          executed_by: "main",
          judgments: task.claim_ids.map((id) => ({ claim_id: String(id), judgments: ["not_addressed", "not_addressed", "not_addressed"] })),
        };
        break;
      case "verify": {
        const results: Array<Record<string, unknown>> = [];
        for (const c of claims()) {
          const [evidenceId] = await world.fetchEvidence(root, c.id, world.pageUrl(c));
          results.push({
            claim_id: c.id,
            search_queries: [c.text],
            evidence: [{ id: evidenceId, relation: wrong(c) ? "contradicts" : "supports", confidence: 0.9 }],
            verification_status: wrong(c) ? "CONTRADICTED" : "SUPPORTED",
            explanation: "fake",
          });
        }
        result = { executed_by: by, results };
        break;
      }
      case "judge":
        result = {
          executed_by: by,
          verdicts: claims().map((c) => ({
            claim_id: c.id,
            verdict: wrong(c) ? "HALLUCINATION" : "VERIFIED",
            confidence: 0.9,
            hallucination_type: wrong(c) ? "numeric_fabrication" : "none",
            reasoning: "fake judge",
            severity: wrong(c) ? "major" : null,
          })),
        };
        break;
      case "ground": {
        const source = sentences(readFileSync(join(root, "input", "source.md"), "utf-8"));
        result = {
          executed_by: by,
          results: claims().map((c) => {
            const sentence = source.find((s) => s.startsWith(c.text.split(" ").slice(0, 2).join(" ")));
            if (!sentence) return { claim_id: c.id, status: "NOT_IN_SOURCE", quote: null, source_says: null, explanation: "fake" };
            const same = parseNumbers(sentence).some((n) => parseNumbers(c.text).some((m) => m.value === n.value));
            return { claim_id: c.id, status: same ? "SUPPORTED" : "CONTRADICTED", quote: sentence, source_says: same ? null : sentence, explanation: "fake" };
          }),
        };
        break;
      }
      default:
        throw new Error(`The fake agent cannot do ${task.kind}`);
    }
    writeFileSync(view.result_file, JSON.stringify(result), "utf-8");
  }
}
