import { z } from "zod";
import { CROSS_ARTIFACT_DIMENSIONS } from "../../types.js";
import {
  dimensionAssessmentV2Schema,
  evidenceSupportLevelSchema,
  overallStrengthBandSchema,
} from "./dimensionAssessmentV2Schema.js";

export const crossArtifactJudgeLlmOutputSchema = z.object({
  reconstructed_inquiry_threads: z.array(
    z.object({
      thread_id: z.string().min(1),
      question_or_theme: z.string().min(1),
      ordered_artifact_ids: z.array(z.string()),
      relationship_ids: z.array(z.string()),
      evidence_ids: z.array(z.string()),
      interpretation: z.string().min(1),
      counterevidence: z.array(z.string()),
    })
  ),
  dimensions: z
    .array(dimensionAssessmentV2Schema)
    .length(CROSS_ARTIFACT_DIMENSIONS.length),
  overall_inquiry_support: overallStrengthBandSchema,
  evidence_support: evidenceSupportLevelSchema,
  strongest_evidence_ids: z.array(z.string()),
  counterevidence_ids: z.array(z.string()),
  missing_information: z.array(z.string()),
  summary: z.string().min(1),
});

export type CrossArtifactJudgeLlmOutput = z.infer<
  typeof crossArtifactJudgeLlmOutputSchema
>;

export const crossArtifactJudgeResultSchema =
  crossArtifactJudgeLlmOutputSchema.extend({
    schema_version: z.literal("cross-artifact-judge-v1"),
    judge_type: z.literal("cross_artifact"),
    relationship_ids: z.array(z.string()),
    artifact_ids: z.array(z.string()),
  });
