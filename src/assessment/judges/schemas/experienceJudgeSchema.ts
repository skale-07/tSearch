import { z } from "zod";
import { EXPERIENCE_DIMENSIONS } from "../../types.js";
import {
  dimensionAssessmentV2Schema,
  evidenceSupportLevelSchema,
  overallStrengthBandSchema,
} from "./dimensionAssessmentV2Schema.js";

export const experienceJudgeLlmOutputSchema = z.object({
  dimensions: z
    .array(dimensionAssessmentV2Schema)
    .length(EXPERIENCE_DIMENSIONS.length),
  overall_distinctiveness: overallStrengthBandSchema,
  evidence_support: evidenceSupportLevelSchema,
  hook: z.string().min(1).max(200).nullable(),
  strongest_evidence_ids: z.array(z.string()),
  counterevidence_ids: z.array(z.string()),
  missing_information: z.array(z.string()),
  summary: z.string().min(1),
});

export type ExperienceJudgeLlmOutput = z.infer<
  typeof experienceJudgeLlmOutputSchema
>;
