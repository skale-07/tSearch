import type {
  Archetype,
  CandidateSynthesis,
  OwnershipAssessment,
  OwnershipAssessmentV2,
  SpecialistJudgeResult,
} from "../types.js";
import {
  aggregateCandidateOwnership,
  ownershipSupportToScore,
  ownershipV2ToLegacy,
  synthesizeCandidate,
  technicalLegacyToV2Shape,
} from "./synthesizeCandidate.js";

export {
  aggregateCandidateOwnership,
  ownershipSupportToScore,
  ownershipV2ToLegacy,
  synthesizeCandidate,
};

function dimScore(
  technical: SpecialistJudgeResult | undefined,
  name: string
): number | undefined {
  return technical?.dimensions.find((d) => d.dimension === name)?.score;
}

function avg(
  technical: SpecialistJudgeResult | undefined,
  names: string[]
): number | undefined {
  if (!technical) return undefined;
  const vals = names
    .map((n) => dimScore(technical, n))
    .filter((x): x is number => x !== undefined);
  if (!vals.length) return undefined;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function pickArchetype(input: {
  technical?: SpecialistJudgeResult;
  ownership?: OwnershipAssessment;
  hasArtifacts: boolean;
}): Archetype {
  if (!input.hasArtifacts || !input.technical) {
    return "insufficient_evidence";
  }
  const tech = avg(input.technical, [
    "technical_depth",
    "architecture_depth",
    "implementation_quality",
  ]);
  const unusual = dimScore(input.technical, "unusual_problem_selection") ?? 0;
  const ownershipScore =
    input.ownership?.score ??
    dimScore(input.technical, "candidate_ownership") ??
    0;

  if ((tech ?? 0) < 4) {
    return ownershipScore >= 5
      ? "polished_profile_limited_artifact_depth"
      : "insufficient_evidence";
  }
  if (unusual >= 7 && (tech ?? 0) >= 6) {
    return "unusual_experimentalist";
  }
  if (ownershipScore >= 6 && (tech ?? 0) >= 6) {
    return "independent_systems_builder";
  }
  if ((tech ?? 0) >= 5 && ownershipScore < 5) {
    return "high_potential_weakly_verified";
  }
  return "independent_systems_builder";
}

/**
 * Compatibility wrapper: adapts legacy technical (0-10) + ownership into
 * synthesizeCandidate (priority-v2). Prefer calling synthesizeCandidate directly
 * with TechnicalJudgeResultV2 once the pipeline migrates.
 */
export function synthesizeFromTechnical(input: {
  technical?: SpecialistJudgeResult;
  ownership?: OwnershipAssessment | OwnershipAssessmentV2;
  evidenceCount: number;
  discoveryScore: number;
  name: string;
}): CandidateSynthesis {
  const technicalV2 = input.technical
    ? technicalLegacyToV2Shape(input.technical)
    : undefined;

  return synthesizeCandidate({
    name: input.name,
    technical: technicalV2,
    ownership: input.ownership,
    evidenceCount: input.evidenceCount,
    discoveryScore: input.discoveryScore,
  });
}
