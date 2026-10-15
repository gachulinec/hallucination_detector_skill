/** Values of the method, as in the Hallucination Detector pipeline (src/config.ts there, commit 82f9de2). */

export const METHOD = {
  consistency_threshold: 0.8,
  // No HALLUCINATION above this confidence without contradicting evidence
  hallucination_confidence: 0.8,
  extraction_chunk_chars: 6000,
  max_evidence_per_claim: 5,
  // Passages taken from a fetched page
  passages_per_page: 3,
  passage_chars: 800,
  // Passage selection per claim for a long source document
  source_passages_chars: 30_000,
  consistency_samples: 3,
  // Minimum gap between searches, so the public engines behind SearXNG are not flooded
  searxng_min_interval_ms: 1500,
  get searxng_url(): string {
    return process.env.SEARXNG_URL || "http://localhost:8888";
  },
};
