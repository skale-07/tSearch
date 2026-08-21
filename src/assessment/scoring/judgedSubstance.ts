import type {
  ExperienceJudgeResult,
  OverallStrengthBand,
  OwnershipAssessmentV2,
  TechnicalJudgeResultV2,
} from "../types.js";
import { experienceAsTechnical01 } from "./synthesizeCandidate.js";

/**
 * Substance input to the upside vector (obscurity × work).
 *
 * GitHub technical verdict when artifacts were judged; otherwise LinkedIn-stated
 * work (internships, research, other roles) via the experience judge. Damped by
 * ownership support when that read exists.
 *
 * Returns null — not zero — when nothing was judged.
 */

function bandTo01(band: OverallStrengthBand | undefined): number | null {
  switch (band) {
    case "exceptional":
      return 0.95;
    case "strong":
      return 0.8;
    case "moderate":
      return 0.55;
    case "limited":
      return 0.3;
    default:
      return null;
  }
}

function ownershipFactor(ownership?: OwnershipAssessmentV2): number {
  switch (ownership?.support_class) {
    case "high_ownership_support":
      return 1;
    case "medium_ownership_support":
      return 0.85;
    case "low_ownership_support":
      return 0.6;
    default:
      return 0.5;
  }
}

export function judgedSubstance(input: {
  technical?: TechnicalJudgeResultV2;
  ownership?: OwnershipAssessmentV2;
  experience?: ExperienceJudgeResult;
}): number | null {
  const { technical } = input;
  if (technical && technical.artifact_ids.length > 0) {
    const base = bandTo01(technical.overall_technical_strength);
    if (base === null) return null;
    return Math.round(base * ownershipFactor(input.ownership) * 100) / 100;
  }
  const fromExperience = experienceAsTechnical01(input.experience);
  if (fromExperience === null) return null;
  return Math.round(fromExperience * ownershipFactor(input.ownership) * 100) / 100;
}
