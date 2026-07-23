import { z } from "zod";
import { WRITING_DIMENSIONS } from "../../types.js";
import {
  dimensionAssessmentV2Schema,
  evidenceSupportLevelSchema,
  overallStrengthBandSchema,
} from "./dimensionAssessmentV2Schema.js";

export const writingJudgeLlmOutputSchema = z.object({
  corpus_reconstruction: z.object({
    recurring_questions: z.array(
      z.object({
        question: z.string().min(1),
        artifact_ids: z.array(z.string()),
        evidence_ids: z.array(z.string()),
      })
    ),
    observable_trajectory: z.string().min(1),
    explicit_revisions: z.array(z.string()),
    original_analysis_artifacts: z.array(z.string()),
    evidence_ids: z.array(z.string()),
  }),
  dimensions: z.array(dimensionAssessmentV2Schema).length(WRITING_DIMENSIONS.length),
  strongest_evidence_ids: z.array(z.string()),
  counterevidence_ids: z.array(z.string()),
  missing_information: z.array(z.string()),
  overall_writing_depth: overallStrengthBandSchema,
  evidence_support: evidenceSupportLevelSchema,
  summary: z.string().min(1),
});

export type WritingJudgeLlmOutput = z.infer<typeof writingJudgeLlmOutputSchema>;

export const writingJudgeResultSchema = writingJudgeLlmOutputSchema.extend({
  schema_version: z.literal("writing-judge-v1"),
  judge_type: z.literal("writing"),
  artifact_ids: z.array(z.string()),
  rubric_id: z.string().min(1),
  rubric_version: z.string().min(1),
  prompt_version: z.string().min(1),
  model: z.string().min(1),
});
