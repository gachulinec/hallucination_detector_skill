/**
 * The run directory: where every file of a skill run lives, and the run's
 * state (state.json). Steps keep the results they accepted in accepted/*.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { atomicWriteJSON, readJSON } from "../utils/atomic-write.js";
import { SKILL_VERSION } from "./config.js";
import type { RunOptions, RunState } from "./types.js";

export const DEFAULT_DIR = ".hallucination-check";

export interface RunPaths {
  root: string;
  state: string;
  text: string;
  source: string;
  tasks: string;
  results: string;
  accepted: string;
  passages: string;
  pages: string;
  chunks: string;
  sections: string;
  claims: string;
  questions: string;
  consistency: string;
  evidence: string;
  verifications: string;
  verdicts: string;
  report: string;
  annotated: string;
  summary: string;
  network: string;
  audit: string;
}

export function runPaths(root: string): RunPaths {
  const r = resolve(root);
  return {
    root: r,
    state: join(r, "state.json"),
    text: join(r, "input", "text.md"),
    source: join(r, "input", "source.md"),
    tasks: join(r, "tasks"),
    results: join(r, "results"),
    accepted: join(r, "accepted"),
    passages: join(r, "passages"),
    pages: join(r, "pages"),
    chunks: join(r, "chunks.json"),
    sections: join(r, "sections.json"),
    claims: join(r, "claims.json"),
    questions: join(r, "questions.json"),
    consistency: join(r, "consistency.json"),
    evidence: join(r, "evidence.json"),
    verifications: join(r, "verifications.json"),
    verdicts: join(r, "verdicts.json"),
    report: join(r, "report.json"),
    annotated: join(r, "annotated_text.md"),
    summary: join(r, "summary.md"),
    network: join(r, "network.json"),
    audit: join(r, "audit.jsonl"),
  };
}

export function taskFile(paths: RunPaths, id: string): string {
  return join(paths.tasks, `${id}.md`);
}

export function resultFile(paths: RunPaths, id: string): string {
  return join(paths.results, `${id}.json`);
}

export interface CreateRunInput extends RunOptions {
  textFile: string;
  sourceFile?: string;
  /** Directory that holds runs/ */
  dir: string;
  /** Write <dir>/.gitignore with "*" so runs are never committed (the default directory) */
  writeGitignore: boolean;
  /** How task files tell agents to call hd */
  hdCommand: string;
  now?: Date;
}

export function createRun(input: CreateRunInput): RunPaths {
  const text = readFileSync(input.textFile, "utf-8");
  if (!text.trim()) throw new Error(`The text file ${input.textFile} is empty.`);
  const source = input.sourceFile === undefined ? undefined : readFileSync(input.sourceFile, "utf-8");
  if (source !== undefined && !source.trim()) throw new Error(`The source file ${input.sourceFile} is empty.`);

  const base = resolve(input.dir);
  mkdirSync(base, { recursive: true });
  const gitignore = join(base, ".gitignore");
  if (input.writeGitignore && !existsSync(gitignore)) writeFileSync(gitignore, "*\n", "utf-8");

  const now = input.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  let root = join(base, "runs", stamp);
  for (let n = 2; existsSync(root); n++) root = join(base, "runs", `${stamp}-${n}`);

  const paths = runPaths(root);
  for (const dir of [dirname(paths.text), paths.tasks, paths.results, paths.accepted, paths.passages, paths.pages]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(paths.text, text, "utf-8");
  if (source !== undefined) writeFileSync(paths.source, source, "utf-8");

  saveState(paths, {
    version: SKILL_VERSION,
    created: now.toISOString(),
    mode: source === undefined ? "standard" : "faithfulness",
    profile: input.profile,
    origin: input.origin,
    language: input.language,
    subagents: input.subagents,
    agent: input.agent,
    models: input.models,
    hd_command: input.hdCommand,
    stage: "extract",
    tasks: [],
    warnings: [],
  });
  return paths;
}

export function loadState(paths: RunPaths): RunState {
  if (!existsSync(paths.state)) {
    throw new Error(`No run at ${paths.root} (state.json is missing). Start one with: hd init --text <file>`);
  }
  return readJSON<RunState>(paths.state);
}

export function saveState(paths: RunPaths, state: RunState): void {
  atomicWriteJSON(paths.state, state);
}

/** Results a step accepted so far, by claim ID (or chunk / sample key). */
export function readAccepted<T>(paths: RunPaths, name: string): Record<string, T> {
  const file = join(paths.accepted, `${name}.json`);
  return existsSync(file) ? readJSON<Record<string, T>>(file) : {};
}

export function updateAccepted<T>(paths: RunPaths, name: string, key: string | number, value: T): void {
  const accepted = readAccepted<T>(paths, name);
  accepted[String(key)] = value;
  atomicWriteJSON(join(paths.accepted, `${name}.json`), accepted);
}

export interface NetworkFlag {
  network: boolean;
  reason?: string;
}

/** Whether hd fetch could reach the web; null until the first fetch. Kept outside state.json because subagents write it. */
export function readNetwork(paths: RunPaths): boolean | null {
  return existsSync(paths.network) ? readJSON<NetworkFlag>(paths.network).network : null;
}

export function writeNetwork(paths: RunPaths, flag: NetworkFlag): void {
  atomicWriteJSON(paths.network, flag);
}
