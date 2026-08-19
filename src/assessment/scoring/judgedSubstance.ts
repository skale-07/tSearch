import type {
  ExperienceJudgeResult,
  OverallStrengthBand,
  OwnershipAssessmentV2,
  TechnicalJudgeResultV2,
} from "../types.js";
import { EXPERIENCE_AS_TECHNICAL_CAP } from "./synthesizeCandidate.js";

/**
 * Substance input to the upside vector (obscurity × work).
 *
 * Prefers the GitHub technical judge over repo counts. When GitHub was never
 * judged, LinkedIn experience distinctiveness fills in at
 * EXPERIENCE_AS_TECHNICAL_CAP so GitHub-less youth can still surface as
 * undiscovered *and* substantive. Damped by ownership support.
 *
 * Returns null — not zero — when nothing was judged, so unjudged candidates
 * fall out of the vector instead of ranking at the bottom of it.
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
      // No ownership read at all: heavily damped but not zeroed, since a
      // strong artifact with unclear attribution is still worth a look.
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
  const fromExperience = bandTo01(input.experience?.overall_distinctiveness);
  if (fromExperience === null) return null;
  return (
    Math.round(
      fromExperience *
        EXPERIENCE_AS_TECHNICAL_CAP *
        ownershipFactor(input.ownership) *
        100
    ) / 100
  );
}
