/** Fixtures for the skill tests: runs in temporary directories and two short texts. */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun } from "../../src/hd/run-state.js";
import { extractStep } from "../../src/hd/steps/extract.js";
import { loadContext, type StepContext } from "../../src/hd/steps/step.js";
import type { RunOptions } from "../../src/hd/types.js";

export const STANDARD_TEXT =
  "# Eiffel Tower\n\nThe Eiffel Tower is 330 metres tall. It was completed in 1899. Gustave Eiffel's company built the tower.\n";

export const STANDARD_CLAIMS = [
  { text: "The Eiffel Tower is 330 metres tall", type: "numeric", original_sentence: "The Eiffel Tower is 330 metres tall." },
  { text: "The Eiffel Tower was completed in 1899", type: "numeric", original_sentence: "It was completed in 1899." },
  { text: "Gustave Eiffel's company built the Eiffel Tower", type: "entity", original_sentence: "Gustave Eiffel's company built the tower." },
];

export const FAITH_TEXT = "# Hoover Dam\n\nConstruction of the dam began in 1933. The dam is 221 metres tall.\n";

export const FAITH_SOURCE =
  "# Hoover Dam\n\nConstruction of the dam began in 1931. The dam is 221 metres tall. Lake Mead holds about 35 cubic kilometres of water.\n";

export const FAITH_CLAIMS = [
  { text: "Construction of the dam began in 1933", type: "numeric", original_sentence: "Construction of the dam began in 1933." },
  { text: "The dam is 221 metres tall", type: "numeric", original_sentence: "The dam is 221 metres tall." },
];

export const PAGE_TEXT =
  "The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris. It is 330 metres tall. The tower was completed in 1889 for the World's Fair. It was built by the company of Gustave Eiffel, whose engineers designed it.";

export interface RunFixtureOptions extends Partial<RunOptions> {
  source?: string;
  /** Parent directory of the run (a new temporary directory by default) */
  dir?: string;
}

export function makeRun(text: string, options: RunFixtureOptions = {}): StepContext {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "hd-test-"));
  const textFile = join(dir, "input-text.md");
  writeFileSync(textFile, text);
  let sourceFile: string | undefined;
  if (options.source !== undefined) {
    sourceFile = join(dir, "input-source.md");
    writeFileSync(sourceFile, options.source);
  }
  const paths = createRun({
    textFile,
    sourceFile,
    dir: join(dir, "work"),
    writeGitignore: false,
    hdCommand: 'node "/skill/scripts/hd.mjs"',
    profile: options.profile ?? "thorough",
    origin: options.origin ?? "external",
    language: options.language ?? "English",
    subagents: options.subagents ?? true,
    agent: options.agent,
    models: options.models ?? [],
  });
  return loadContext(paths.root);
}

/** Runs the extraction step with the given claims and moves the run to the next stage. */
export function extractClaims(
  ctx: StepContext,
  claims: Array<Record<string, unknown>> = ctx.state.mode === "faithfulness" ? FAITH_CLAIMS : STANDARD_CLAIMS
): void {
  const [task] = extractStep.issue(ctx);
  extractStep.accept(ctx, task, { claims });
  ctx.state.stage = extractStep.complete(ctx);
}
