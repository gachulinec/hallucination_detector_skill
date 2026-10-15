/** Version and limits of the skill (spec §4.6); the method's values come from METHOD. */

import { METHOD } from "../method/config.js";
import type { Profile } from "./types.js";

export const SKILL_VERSION = "1.0.0";

export const SKILL_LIMITS = {
  extractionChunkChars: METHOD.extraction_chunk_chars,
  claimsPerTask: {
    verify: { thorough: 3, quick: 6 },
    judge: { thorough: 5, quick: 5 },
    ground: { thorough: 8, quick: 12 },
  } satisfies Record<string, Record<Profile, number>>,
  queriesPerClaim: { thorough: 2, quick: 1 } satisfies Record<Profile, number>,
  maxEvidencePerClaim: METHOD.max_evidence_per_claim,
  maxFetchesPerClaim: 4,
  passagesPerFetch: METHOD.passages_per_page,
  passageChars: METHOD.passage_chars,
  fetchTimeoutMs: 10_000,
  fullSourceChars: 120_000,
  sourcePassagesChars: METHOD.source_passages_chars,
  sampleCount: METHOD.consistency_samples,
  maxAttempts: 2,
  /** A broken result file that changed more recently than this may still be being written */
  settleMs: 2_000,
} as const;
