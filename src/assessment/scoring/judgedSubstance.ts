import type {
  OverallStrengthBand,
  OwnershipAssessmentV2,
  TechnicalJudgeResultV2,
} from "../types.js";

/**
 * "Technically sound GitHub projects that the LLM judges" — the substance
 * input to the upside vector.
 *
 * This reads the technical judge's verdict rather than counting repos: a
 * hundred tutorial forks are not substance, and one deep inspectable system
 * is. It is damped by ownership support, because crediting someone for work
 * that is probably not theirs is the failure mode this system exists to
 * avoid.
 *
 * Returns null — not zero — when the work was never judged, so unjudged
 * candidates fall out of the vector instead of ranking at the bottom of it.
 */

function bandTo01(band: OverallStrengthBand): number | null {
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
}): number | null {
  const { technical } = input;
  // The judge must have actually seen artifacts — a deterministic abstention
  // over an empty repo set is not evidence of anything.
  if (!technical || technical.artifact_ids.length === 0) return null;
  const base = bandTo01(technical.overall_technical_strength);
  if (base === null) return null;
  return Math.round(base * ownershipFactor(input.ownership) * 100) / 100;
}
