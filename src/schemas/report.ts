import { z } from "zod";
import { VerdictSchema } from "./verdict.js";

export const HallucinationReportSchema = z.object({
  timestamp: z.string(),
  input_text: z.string(),
  source_document: z
    .string()
    .nullable()
    .describe("Source document if faithfulness check"),
  model_analyzed: z
    .string()
    .nullable()
    .describe("Which LLM generated the text, if known"),

  total_claims: z.number(),
  verified_count: z.number(),
  hallucination_count: z.number(),
  unverifiable_count: z.number(),
  hallucination_rate: z
    .number()
    .describe("hallucination_count / total_claims"),
  average_confidence: z.number(),

  factual_hallucinations: z.number(),
  faithfulness_hallucinations: z.number(),
  entity_fabrications: z.number(),
  numeric_fabrications: z.number(),

  critical_count: z.number(),
  major_count: z.number(),
  minor_count: z.number(),

  verdicts: z.array(VerdictSchema),

  annotated_text: z
    .string()
    .describe(
      "Original text with [VERIFIED], [HALLUCINATION], [UNVERIFIABLE] markers"
    ),

  warnings: z
    .array(z.string())
    .optional()
    .describe("Problems during the run that affect the results (failed searches, failed verifications)"),

  search_provider: z
    .string()
    .optional()
    .describe("Web search provider used in standard mode (searxng; earlier runs: tavily)"),

  models_used: z
    .array(z.string())
    .optional()
    .describe("Model IDs the CLI aliases resolved to during the run"),
  usage: z
    .object({
      calls: z.number(),
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_read_input_tokens: z.number(),
      cache_creation_input_tokens: z.number(),
      estimated_cost_usd: z.number().describe("CLI estimate at list prices; subscription calls are not billed individually"),
    })
    .optional(),
  run_info: z
    .object({
      tool: z.string(),
      version: z.string(),
      profile: z.enum(["thorough", "quick"]),
      origin: z.enum(["external", "self"]),
      agent: z.string().optional(),
      independence: z.enum(["subagents", "partial", "none"]),
      network: z.boolean().nullable(),
    })
    .optional()
    .describe("How a skill run ran: profile, who ran it, whether independent tasks got a fresh context, whether hd had network"),

  modules_used: z.array(z.string()),
  total_api_calls: z.number(),
  processing_time_ms: z.number(),
});

export type HallucinationReport = z.infer<typeof HallucinationReportSchema>;
