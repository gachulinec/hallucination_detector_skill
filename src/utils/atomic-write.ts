import {
  writeFileSync,
  renameSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * Atomically writes data to a file by writing to a temp file first,
 * then renaming (atomic on POSIX). Prevents readers from seeing partial writes.
 */
export function atomicWriteJSON(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
}

/**
 * Reads and parses a JSON file. Throws if file doesn't exist.
 */
export function readJSON<T>(filePath: string): T {
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as T;
}

/**
 * Returns the work directory path, creating it if needed.
 */
export function ensureWorkDir(workDir: string): string {
  if (!existsSync(workDir)) {
    mkdirSync(workDir, { recursive: true });
  }
  return workDir;
}

/**
 * Returns path within the work directory.
 */
export function workPath(workDir: string, filename: string): string {
  return join(workDir, filename);
}
