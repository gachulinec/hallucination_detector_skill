/** Entry point of the bundled hd CLI (hallucination-check/scripts/hd.mjs). */

import { resolve } from "node:path";
import { buildProgram } from "./program.js";

buildProgram(resolve(process.argv[1] ?? "hd.mjs"))
  .parseAsync(process.argv)
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
