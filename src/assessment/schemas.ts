import { z } from "zod";
import { TECHNICAL_DIMENSIONS } from "./types.js";

export const evidenceStrengthSchema = z.enum(["weak", "moderate", "strong"]);

export const counterEvidenceSchema = z.object({
  observation: z.string().min(1),
  effect_on_score: z.string().min(1),
  evidence_ids: z.array(z.string()).optional(),
});

export const dimensionAssessmentSchema = z.object({
  dimension: z.string().min(1),
  score: z.number().min(0).max(10),
  confidence: z.number().min(0).max(1),
  definition: z.string().min(1),
  rationale: z.string().min(1),
  supporting_evidence_ids: z.array(z.string()),
  counterevidence: z.array(counterEvidenceSchema),
  missing_information: z.array(z.string()),
});

export const specialistJudgeResultSchema = z.object({
  judge_type: z.enum(["technical", "research", "writing", "curiosity"]),
  prompt_version: z.string(),
  model: z.string(),
  input_hash: z.string(),
  summary: z.string().min(1),
  dimensions: z.array(dimensionAssessmentSchema).min(1),
  strongest_evidence_ids: z.array(z.string()),
  important_uncertainties: z.array(z.string()),
  recommended_human_review: z.array(z.string()),
  created_at: z.string(),
});

/** LLM payload before we stamp meta fields */
export const technicalJudgeLlmOutputSchema = z.object({
  summary: z.string().min(1),
  dimensions: z.array(dimensionAssessmentSchema).length(TECHNICAL_DIMENSIONS.length),
  strongest_evidence_ids: z.array(z.string()),
  important_uncertainties: z.array(z.string()),
  recommended_human_review: z.array(z.string()),
  ownership: z.object({
    score: z.number().min(0).max(10),
    confidence: z.number().min(0).max(1),
    ownership_type: z.enum([
      "primary_creator",
      "major_contributor",
      "meaningful_contributor",
      "minor_contributor",
      "unclear",
    ]),
    rationale: z.string().min(1),
    evidence_ids: z.array(z.string()),
    limitations: z.array(z.string()),
  }),
});

export type TechnicalJudgeLlmOutput = z.infer<
  typeof technicalJudgeLlmOutputSchema
>;

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Schema validation failed (${label}): ${msg}`);
  }
  return result.data;
}
