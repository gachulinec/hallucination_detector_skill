import { z } from "zod";

export const EvidenceSchema = z.object({
  source_url: z.string().describe("URL of the evidence source"),
  source_title: z.string().describe("Title of the source"),
  relevant_text: z
    .string()
    .describe("Relevant excerpt from the source (max 200 chars)"),
  retrieval_method: z.enum(["web_search", "source_document", "knowledge_base"]),
  support_relation: z.enum(["supports", "contradicts", "neutral"]),
  confidence: z.number().min(0).max(1),
  checked: z
    .boolean()
    .optional()
    .describe("False when the verifying agent wrote the evidence text itself and it could not be checked against the page; absent when the text came from code"),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
