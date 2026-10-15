import { z } from "zod";

export const ClaimSchema = z.object({
  id: z.number().describe("Sequential claim identifier"),
  text: z.string().describe("The atomic claim text"),
  source_position: z
    .object({
      start: z.number(),
      end: z.number(),
    })
    .describe("Character positions in original text"),
  type: z.enum([
    "factual",
    "faithfulness",
    "numeric",
    "entity",
    "subjective",
  ]),
  original_sentence: z
    .string()
    .describe("Full sentence containing the claim"),
  attribution_check: z
    .boolean()
    .optional()
    .describe("True if claim contains a specific attribution that needs anonymization verification"),
  context: z
    .string()
    .optional()
    .describe("The claim's sentence with the text before it, to identify what the claim refers to"),
});

export const ClaimsOutputSchema = z.object({
  claims: z.array(ClaimSchema),
  source_is_anonymized: z
    .boolean()
    .optional()
    .describe("True if source document contains anonymization/confidentiality clause"),
  chunks_total: z
    .number()
    .optional()
    .describe("Number of chunks the text was split into for extraction"),
  chunks_failed: z
    .number()
    .optional()
    .describe("Chunks whose extraction failed; their claims are missing"),
  document_title: z
    .string()
    .optional()
    .describe("Title of the analyzed text (first-line heading), given to later modules as context"),
});

export type Claim = z.infer<typeof ClaimSchema>;
export type ClaimsOutput = z.infer<typeof ClaimsOutputSchema>;
