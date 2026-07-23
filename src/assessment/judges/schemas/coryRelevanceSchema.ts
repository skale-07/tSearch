import { z } from "zod";

export const coryRelevanceLlmOutputSchema = z.object({
  relevance: z.enum(["high", "medium", "low", "insufficient_evidence"]),
  reasons: z.array(z.string()).min(1),
  evidence_ids: z.array(z.string()),
  human_review_recommended: z.boolean(),
});

export type CoryRelevanceLlmOutput = z.infer<typeof coryRelevanceLlmOutputSchema>;

export const coryRelevanceResultSchema = coryRelevanceLlmOutputSchema.extend({
  calibration_version: z.string().min(1),
});
