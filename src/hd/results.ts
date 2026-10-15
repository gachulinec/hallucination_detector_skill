/**
 * Reading the result files agents write. Agents wrap JSON in code fences, add
 * a sentence around it or write IDs as strings; none of that should cost them
 * their one retry.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { SKILL_LIMITS } from "./config.js";
import type { ExecutedBy } from "./types.js";

export type ResultObject = Record<string, unknown>;

export type ReadResult =
  | { state: "missing" }
  | { state: "settling" }
  | { state: "invalid"; feedback: string }
  | { state: "ok"; value: ResultObject; executedBy?: ExecutedBy; error?: string };

function sliceObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

/** The JSON object in a result file's text, or null. */
export function parseResultText(text: string): ResultObject | null {
  const unfenced = text
    .replace(/^\s*```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  for (const candidate of [unfenced, sliceObject(unfenced)]) {
    if (!candidate) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as ResultObject;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function toExecutedBy(value: unknown): ExecutedBy | undefined {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return v === "subagent" || v === "main" ? v : undefined;
}

export function readResult(file: string, now: number = Date.now()): ReadResult {
  if (!existsSync(file)) return { state: "missing" };
  const value = parseResultText(readFileSync(file, "utf-8"));
  if (!value) {
    // A subagent may still be writing the file
    if (now - statSync(file).mtimeMs < SKILL_LIMITS.settleMs) return { state: "settling" };
    return { state: "invalid", feedback: "The result file is not a valid JSON object. Write only the JSON object the task describes." };
  }
  const error = typeof value.error === "string" && value.error.trim() ? value.error.trim() : undefined;
  return { state: "ok", value, executedBy: toExecutedBy(value.executed_by), error };
}

/** A claim or question ID written as a number or a numeric string. */
export function toClaimId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\s*\d+\s*$/.test(value)) return Number(value.trim());
  return null;
}

/** The object entries of an array field by their ID; later duplicates are ignored. */
export function entriesById(value: unknown, idField: string): Map<number, ResultObject> {
  const map = new Map<number, ResultObject>();
  if (!Array.isArray(value)) return map;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const id = toClaimId((entry as ResultObject)[idField]);
    if (id !== null && !map.has(id)) map.set(id, entry as ResultObject);
  }
  return map;
}
