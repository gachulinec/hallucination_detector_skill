/**
 * A lock file around read-modify-write of files that several hd processes may
 * update at once: subagents run hd fetch in parallel.
 */

import { closeSync, openSync, statSync, unlinkSync } from "node:fs";

const WAIT_MS = 10_000;
// A lock older than this was left by a process that died
const STALE_MS = 30_000;
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

function sleep(ms: number): void {
  Atomics.wait(sleepCell, 0, 0, ms);
}

export function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_MS) unlinkSync(lock);
      } catch {
        // the lock went away in the meantime
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lock}`);
      sleep(10);
    }
  }
  try {
    return fn();
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      // already removed
    }
  }
}
