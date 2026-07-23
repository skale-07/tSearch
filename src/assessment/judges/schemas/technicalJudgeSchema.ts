import { z } from "zod";
import { TECHNICAL_DIMENSIONS_V2 } from "../../types.js";
import {
  dimensionAssessmentV2Schema,
  evidenceSupportLevelSchema,
  overallStrengthBandSchema,
} from "./dimensionAssessmentV2Schema.js";

export const technicalJudgeLlmOutputV2Schema = z.object({
  artifact_reconstruction: z.object({
    problem: z.string().min(1),
    claimed_mechanism: z.string().min(1),
    visible_architecture: z.string().min(1),
    validation_approach: z.string().min(1),
    unresolved_questions: z.array(z.string()),
    evidence_ids: z.array(z.string()),
  }),
  dimensions: z
    .array(dimensionAssessmentV2Schema)
    .length(TECHNICAL_DIMENSIONS_V2.length),
  strongest_evidence_ids: z.array(z.string()),
  counterevidence_ids: z.array(z.string()),
  unsupported_or_unverifiable_claims: z.array(z.string()),
  missing_information: z.array(z.string()),
  overall_technical_strength: overallStrengthBandSchema,
  evidence_support: evidenceSupportLevelSchema,
  summary: z.string().min(1),
});

export type TechnicalJudgeLlmOutputV2 = z.infer<
  typeof technicalJudgeLlmOutputV2Schema
>;

export const technicalJudgeResultV2Schema = technicalJudgeLlmOutputV2Schema.extend({
  schema_version: z.literal("technical-judge-v2"),
  judge_type: z.literal("technical"),
  artifact_ids: z.array(z.string()),
  rubric_id: z.string().min(1),
  rubric_version: z.string().min(1),
  prompt_version: z.string().min(1),
  model: z.string().min(1),
});
