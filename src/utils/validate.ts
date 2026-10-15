/**
 * Normalizers for values returned by LLMs. Model output is never trusted to
 * match our enums, so every enum and number goes through one of these.
 */

import type { Evidence, Verdict } from "../schemas/index.js";

export type VerificationStatus = "SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT";
type VerdictValue = Verdict["verdict"];
type HallucinationType = NonNullable<Verdict["hallucination_type"]>;
type Severity = NonNullable<Verdict["severity"]>;
type Relation = Evidence["support_relation"];

const VERIFICATION_STATUSES: readonly VerificationStatus[] = ["SUPPORTED", "CONTRADICTED", "INSUFFICIENT"];
const VERDICTS: readonly VerdictValue[] = ["VERIFIED", "HALLUCINATION", "UNVERIFIABLE"];
const HALLUCINATION_TYPES: readonly HallucinationType[] = [
  "factual",
  "faithfulness",
  "entity_fabrication",
  "numeric_fabrication",
  "none",
];
const SEVERITIES: readonly Severity[] = ["critical", "major", "minor"];
const RELATIONS: readonly Relation[] = ["supports", "contradicts", "neutral"];

function pick<T extends string>(value: unknown, allowed: readonly T[], upper: boolean): T | null {
  if (typeof value !== "string") return null;
  const normalized = upper ? value.trim().toUpperCase() : value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : null;
}

export function normalizeVerificationStatus(value: unknown): VerificationStatus {
  return pick(value, VERIFICATION_STATUSES, true) ?? "INSUFFICIENT";
}

export function normalizeVerdict(value: unknown): VerdictValue | null {
  return pick(value, VERDICTS, true);
}

export function normalizeHallucinationType(value: unknown): HallucinationType | null {
  return pick(value, HALLUCINATION_TYPES, false);
}

export function normalizeSeverity(value: unknown): Severity | null {
  return pick(value, SEVERITIES, false);
}

export function normalizeRelation(value: unknown): Relation {
  return pick(value, RELATIONS, false) ?? "neutral";
}

export function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}
