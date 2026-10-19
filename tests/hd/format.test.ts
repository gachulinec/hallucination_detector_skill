import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { formatNext, shellQuote } from "../../src/hd/format.js";
import type { NextOutput } from "../../src/hd/next.js";

// Review finding: paths containing " $ or a backtick broke the printed commands
describe("shellQuote", () => {
  test("keeps the plain double-quoted form for ordinary paths", () => {
    expect(shellQuote("/Users/me/My Skills/hd.mjs")).toBe('"/Users/me/My Skills/hd.mjs"');
  });

  test.each(['/tmp/a "quoted" dir', "/tmp/$HOME", "/tmp/`whoami`", "/tmp/back\\slash", "/tmp/it's"])(
    "gives the shell back the exact path %s",
    (path) => {
      expect(execFileSync("sh", ["-c", `printf %s ${shellQuote(path)}`], { encoding: "utf-8" })).toBe(path);
    }
  );
});

describe("formatNext", () => {
  test("quotes the run path of the next command for the shell", () => {
    const out: NextOutput = {
      run: "/tmp/runs/$x",
      hd_command: 'node "/skill/scripts/hd.mjs"',
      stage: "verify",
      done: false,
      processed: [],
      waiting: [],
      tasks: [],
      progress: { done: 0, total: 1 },
      warnings: [],
    };
    expect(formatNext(out)).toContain('run: node "/skill/scripts/hd.mjs" next "/tmp/runs/\\$x"');
  });
});
