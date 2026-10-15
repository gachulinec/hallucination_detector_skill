/**
 * The method's prompts (src/prompts/*.md). Every module reads them through
 * loadPrompt; the bundle (scripts/build.mjs) replaces this module with the
 * prompts embedded, so the built hd.mjs needs no prompt files.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PromptName = "claim-extractor" | "grounded-verifier" | "retrieval-verifier" | "verdict-judge";

export const PROMPT_NAMES: readonly PromptName[] = [
  "claim-extractor",
  "grounded-verifier",
  "retrieval-verifier",
  "verdict-judge",
];

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");

export function loadPrompt(name: PromptName): string {
  return readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf-8");
}
