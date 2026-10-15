/** Entry point of the bundled hd CLI (hallucination-check/scripts/hd.mjs). */

import { resolve } from "node:path";
import { buildProgram } from "./program.js";

/**
 * Exits once stdout and stderr have flushed: an exit right after writing cuts
 * piped output (macOS pipes take 64 KB at a time).
 */
function exitAfterFlush(code: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}

buildProgram(resolve(process.argv[1] ?? "hd.mjs"))
  .parseAsync(process.argv)
  .then(() => exitAfterFlush(typeof process.exitCode === "number" ? process.exitCode : 0))
  .catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    exitAfterFlush(1);
  });
