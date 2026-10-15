import { z } from "zod";
import { EvidenceSchema } from "./evidence.js";

export const VerdictSchema = z.object({
  claim_id: z.number(),
  claim_text: z.string(),
  verdict: z.enum(["VERIFIED", "HALLUCINATION", "UNVERIFIABLE"]),
  confidence: z.number().min(0).max(1),
  hallucination_type: z
    .enum([
      "factual",
      "faithfulness",
      "entity_fabrication",
      "numeric_fabrication",
      "none",
    ])
    .nullable(),
  consistency_score: z
    .number()
    .min(0)
    .max(1)
    .describe("Self-consistency across samples"),
  evidence: z.array(EvidenceSchema),
  reasoning: z
    .string()
    .describe("Chain-of-thought explanation for the verdict"),
  severity: z
    .enum(["critical", "major", "minor"])
    .nullable()
    .describe(
      "Severity if hallucination: critical=factual error, major=misleading, minor=imprecise"
    ),
});

export const VerdictsOutputSchema = z.object({
  verdicts: z.array(VerdictSchema),
});

export type Verdict = z.infer<typeof VerdictSchema>;
export type VerdictsOutput = z.infer<typeof VerdictsOutputSchema>;
