import type {
  Archetype,
  ArchetypeAssignment,
  AssessmentAxes,
  AxisResult,
  CandidateSynthesis,
  CoryRelevanceResult,
  CrossArtifactJudgeResult,
  EvidenceSupportLevel,
  OwnershipAssessment,
  OwnershipAssessmentV2,
  OwnershipSupportClass,
  SpecialistJudgeResult,
  TechnicalJudgeResultV2,
  WritingJudgeResult,
} from "../types.js";
import {
  aggregateCandidateOwnership,
  ownershipV2ToLegacy,
} from "../github/collectOwnershipEvidence.js";
import { averageScores } from "../judges/scoreUtils.js";

export const PRIORITY_V2_VERSION = "priority-v2";
export const PRIORITY_V2_REQUIRES_CALIBRATION = true;

/** priority-v2 base weights (normalized inputs 0..1). Marked requires_calibration. */
export const PRIORITY_V2_WEIGHTS = {
  technical: 0.3,
  ownership: 0.15,
  writing: 0.1,
  cross_artifact: 0.15,
  unusual: 0.08,
  persistence: 0.07,
  cory: 0.1,
  evidence_completeness: 0.05,
} as const;

export {
  aggregateCandidateOwnership,
  ownershipV2ToLegacy,
};

/** high→8, medium→6, low→3, insufficient→2 */
export function ownershipSupportToScore(
  support: OwnershipSupportClass
): number {
  switch (support) {
    case "high_ownership_support":
      return 8;
    case "medium_ownership_support":
      return 6;
    case "low_ownership_support":
      return 3;
    case "insufficient_public_evidence":
      return 2;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

function unavailableAxis(summary: string): AxisResult {
  return {
    score: null,
    available: false,
    evidence_support: "low",
    summary,
  };
}

function availableAxis(
  score01: number,
  evidence_support: EvidenceSupportLevel,
  summary?: string
): AxisResult {
  return {
    score: clamp01(score01),
    available: true,
    evidence_support,
    summary,
  };
}

function strengthTo01(
  band:
    | "exceptional"
    | "strong"
    | "moderate"
    | "limited"
    | "insufficient_public_evidence"
    | undefined
): number | null {
  switch (band) {
    case "exceptional":
      return 1;
    case "strong":
      return 0.8;
    case "moderate":
      return 0.55;
    case "limited":
      return 0.3;
    case "insufficient_public_evidence":
      return null;
    default:
      return null;
  }
}

function dimScoreV2(
  technical: TechnicalJudgeResultV2 | undefined,
  id: string
): number | null {
  const d = technical?.dimensions.find((x) => x.dimension_id === id);
  return d?.score ?? null;
}

function avgScoredDims(
  technical: TechnicalJudgeResultV2 | undefined,
  ids: string[]
): number | null {
  if (!technical) return null;
  const vals = ids
    .map((id) => dimScoreV2(technical, id))
    .filter((x): x is number => x !== null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length / 5;
}

function coryTo01(
  cory: CoryRelevanceResult | undefined
): number | null {
  if (!cory) return null;
  switch (cory.relevance) {
    case "high":
      return 1;
    case "medium":
      return 0.65;
    case "low":
      return 0.35;
    case "insufficient_evidence":
      return null;
  }
}

function isOwnershipV2(
  o: OwnershipAssessment | OwnershipAssessmentV2
): o is OwnershipAssessmentV2 {
  return (
    typeof o === "object" &&
    o !== null &&
    "schema_version" in o &&
    (o as OwnershipAssessmentV2).schema_version === "ownership-v2"
  );
}

export function normalizeOwnershipInput(
  ownership?: OwnershipAssessment | OwnershipAssessmentV2
): OwnershipAssessment | undefined {
  if (!ownership) return undefined;
  if (isOwnershipV2(ownership)) return ownershipV2ToLegacy(ownership);
  return ownership;
}

export function normalizeOwnershipV2(
  ownership?: OwnershipAssessment | OwnershipAssessmentV2
): OwnershipAssessmentV2 | undefined {
  if (!ownership) return undefined;
  if (isOwnershipV2(ownership)) return ownership;
  // Legacy → minimal V2 projection for axis scoring
  const score = ownership.score;
  let support_class: OwnershipSupportClass = "insufficient_public_evidence";
  if (score >= 7) support_class = "high_ownership_support";
  else if (score >= 5) support_class = "medium_ownership_support";
  else if (score >= 3) support_class = "low_ownership_support";
  return {
    schema_version: "ownership-v2",
    support_class,
    evidence_coverage: score >= 6 ? "medium" : "low",
    identity_support: score >= 7 ? "high" : score >= 5 ? "medium" : "low",
    direct_core_contribution_present: score >= 6,
    contribution_metrics: {},
    responsibility_signals: [],
    continuity_signals: [],
    provenance_risks: [],
    identity_risks: ownership.limitations,
    supporting_evidence_ids: ownership.evidence_ids,
    counterevidence_ids: [],
    missing_information: ownership.limitations,
    summary: ownership.rationale,
  };
}

/** Convert legacy 0-10 specialist technical result into a V2-shaped input for synthesis. */
export function technicalLegacyToV2Shape(
  technical: SpecialistJudgeResult
): TechnicalJudgeResultV2 {
  const mapDim = (legacy: string, v2: string) => {
    const d = technical.dimensions.find((x) => x.dimension === legacy);
    if (!d) {
      return {
        dimension_id: v2,
        score: null as null,
        applicability: "insufficient_evidence" as const,
        rationale: "Not present in legacy technical judge output.",
        supporting_evidence_ids: [] as string[],
        counterevidence_ids: [] as string[],
        missing_information: [] as string[],
      };
    }
    const mapped = Math.round(Math.max(0, Math.min(10, d.score)) / 2);
    const score = Math.max(0, Math.min(5, mapped)) as 0 | 1 | 2 | 3 | 4 | 5;
    return {
      dimension_id: v2,
      score,
      applicability: "applicable" as const,
      rationale: d.rationale,
      supporting_evidence_ids: d.supporting_evidence_ids,
      counterevidence_ids: [],
      missing_information: d.missing_information,
    };
  };

  const dimensions = [
    mapDim("problem_difficulty", "problem_difficulty"),
    mapDim("technical_depth", "mechanism_depth"),
    mapDim("architecture_depth", "architecture_depth"),
    mapDim("algorithmic_depth", "algorithmic_or_methodological_depth"),
    mapDim("implementation_quality", "implementation_quality"),
    mapDim("evaluation_rigor", "evaluation_and_validation"),
    {
      dimension_id: "failure_handling",
      score: null as null,
      applicability: "insufficient_evidence" as const,
      rationale: "Not present in legacy technical judge output.",
      supporting_evidence_ids: [] as string[],
      counterevidence_ids: [] as string[],
      missing_information: [] as string[],
    },
    {
      dimension_id: "reproducibility",
      score: null as null,
      applicability: "insufficient_evidence" as const,
      rationale: "Not present in legacy technical judge output.",
      supporting_evidence_ids: [] as string[],
      counterevidence_ids: [] as string[],
      missing_information: [] as string[],
    },
    {
      dimension_id: "tradeoff_reasoning",
      score: null as null,
      applicability: "insufficient_evidence" as const,
      rationale: "Not present in legacy technical judge output.",
      supporting_evidence_ids: [] as string[],
      counterevidence_ids: [] as string[],
      missing_information: [] as string[],
    },
    mapDim("completion", "completion_and_operational_reality"),
    mapDim("persistence_and_iteration", "persistence_and_iteration"),
    mapDim("unusual_problem_selection", "unusual_problem_selection"),
  ];

  const avg = averageScores(dimensions.map((d) => d.score)) ?? 0;
  let overall: TechnicalJudgeResultV2["overall_technical_strength"] =
    "insufficient_public_evidence";
  if (avg >= 4.5) overall = "exceptional";
  else if (avg >= 3.5) overall = "strong";
  else if (avg >= 2.5) overall = "moderate";
  else if (avg >= 1.5) overall = "limited";

  return {
    schema_version: "technical-judge-v2",
    judge_type: "technical",
    artifact_ids: [],
    rubric_id: "legacy-technical-v1-adapter",
    rubric_version: "1.0.0",
    prompt_version: technical.prompt_version,
    model: technical.model,
    artifact_reconstruction: {
      problem: "Adapted from legacy technical judge.",
      claimed_mechanism: "See legacy summary.",
      visible_architecture: "See legacy dimensions.",
      validation_approach: "See legacy evaluation_rigor.",
      unresolved_questions: technical.important_uncertainties,
      evidence_ids: technical.strongest_evidence_ids,
    },
    dimensions,
    strongest_evidence_ids: technical.strongest_evidence_ids,
    counterevidence_ids: [],
    unsupported_or_unverifiable_claims: [],
    missing_information: technical.important_uncertainties,
    overall_technical_strength: overall,
    evidence_support: avg >= 3 ? "moderate" : "low",
    summary: technical.summary,
  };
}

function buildAxes(input: {
  technical?: TechnicalJudgeResultV2;
  ownership?: OwnershipAssessmentV2;
  writing?: WritingJudgeResult;
  crossArtifact?: CrossArtifactJudgeResult;
  cory?: CoryRelevanceResult;
  evidenceCompleteness: number;
}): AssessmentAxes {
  const tech01 = strengthTo01(input.technical?.overall_technical_strength);
  const techFromDims = avgScoredDims(input.technical, [
    "mechanism_depth",
    "architecture_depth",
    "algorithmic_or_methodological_depth",
    "implementation_quality",
  ]);
  const technicalScore =
    tech01 !== null ? tech01 : techFromDims !== null ? techFromDims : null;

  const ownershipScore = input.ownership
    ? ownershipSupportToScore(input.ownership.support_class) / 10
    : null;

  const writing01 = strengthTo01(input.writing?.overall_writing_depth);
  const cross01 = strengthTo01(input.crossArtifact?.overall_inquiry_support);
  const unusualRaw = dimScoreV2(
    input.technical,
    "unusual_problem_selection"
  );
  const persistenceRaw = dimScoreV2(
    input.technical,
    "persistence_and_iteration"
  );
  const cory01 = coryTo01(input.cory);

  const inquiryParts = [writing01, cross01].filter(
    (x): x is number => x !== null
  );
  const inquiry =
    inquiryParts.length > 0
      ? inquiryParts.reduce((a, b) => a + b, 0) / inquiryParts.length
      : null;

  return {
    technical_strength:
      technicalScore !== null
        ? availableAxis(
            technicalScore,
            input.technical?.evidence_support ?? "low",
            input.technical?.summary
          )
        : unavailableAxis("Technical strength unavailable."),
    ownership_support:
      ownershipScore !== null
        ? availableAxis(
            ownershipScore,
            input.ownership?.evidence_coverage === "high"
              ? "high"
              : input.ownership?.evidence_coverage === "medium"
                ? "moderate"
                : "low",
            input.ownership?.summary
          )
        : unavailableAxis("Ownership support unavailable."),
    writing_intellectual_depth:
      writing01 !== null
        ? availableAxis(
            writing01,
            input.writing?.evidence_support ?? "low",
            input.writing?.summary
          )
        : unavailableAxis("writing_intellectual_depth = unavailable"),
    cross_artifact_coherence:
      cross01 !== null
        ? availableAxis(
            cross01,
            input.crossArtifact?.evidence_support ?? "low",
            input.crossArtifact?.summary
          )
        : unavailableAxis("cross_artifact_coherence = unavailable"),
    observable_inquiry:
      inquiry !== null
        ? availableAxis(inquiry, "moderate")
        : unavailableAxis("Observable inquiry unavailable."),
    unusual_problem_selection:
      unusualRaw !== null
        ? availableAxis(unusualRaw / 5, "moderate")
        : unavailableAxis("Unusual problem selection unavailable."),
    persistence_and_iteration:
      persistenceRaw !== null
        ? availableAxis(persistenceRaw / 5, "moderate")
        : unavailableAxis("Persistence unavailable."),
    cory_relevance:
      cory01 !== null
        ? availableAxis(cory01, "moderate", input.cory?.reasons.join(" "))
        : unavailableAxis("Cory relevance insufficient_evidence."),
    evidence_completeness: availableAxis(
      clamp01(input.evidenceCompleteness),
      input.evidenceCompleteness >= 0.7
        ? "high"
        : input.evidenceCompleteness >= 0.4
          ? "moderate"
          : "low"
    ),
  };
}

export function computePriorityV2(input: {
  axes: AssessmentAxes;
  identitySupport?: OwnershipAssessmentV2["identity_support"];
  identityRisks?: string[];
}): {
  priority_score: number;
  components: Record<string, number>;
  caps_applied: string[];
  weight_version: string;
} {
  const W = { ...PRIORITY_V2_WEIGHTS } as Record<
    keyof typeof PRIORITY_V2_WEIGHTS,
    number
  >;
  let wTech = W.technical;
  let wOwn = W.ownership;
  let wWrite = W.writing;
  let wCross = W.cross_artifact;
  let wUnu = W.unusual;
  let wPer = W.persistence;
  let wCory = W.cory;
  let wComp = W.evidence_completeness;

  const writingAvail = input.axes.writing_intellectual_depth?.available === true;
  const crossAvail = input.axes.cross_artifact_coherence?.available === true;

  // Missing writing: move at most half of its weight into technical + persistence.
  // Remaining half is unused (not fully redistributed).
  if (!writingAvail) {
    const movable = wWrite * 0.5;
    wWrite = 0;
    wTech += movable / 2;
    wPer += movable / 2;
  }

  // Missing cross-artifact: move at most half into technical + ownership.
  if (!crossAvail) {
    const movable = wCross * 0.5;
    wCross = 0;
    wTech += movable / 2;
    wOwn += movable / 2;
  }

  const tech = input.axes.technical_strength?.score ?? 0;
  const own = input.axes.ownership_support?.score ?? 0;
  const write = writingAvail
    ? (input.axes.writing_intellectual_depth?.score ?? 0)
    : 0;
  const cross = crossAvail
    ? (input.axes.cross_artifact_coherence?.score ?? 0)
    : 0;
  const unusual = input.axes.unusual_problem_selection?.score ?? 0;
  const persistence = input.axes.persistence_and_iteration?.score ?? 0;
  const cory = input.axes.cory_relevance?.available
    ? (input.axes.cory_relevance.score ?? 0)
    : 0;
  const completeness = input.axes.evidence_completeness.score ?? 0;

  let base =
    wTech * tech +
    wOwn * own +
    wWrite * write +
    wCross * cross +
    wUnu * unusual +
    wPer * persistence +
    wCory * cory +
    wComp * completeness;

  const caps_applied: string[] = [];

  if (input.identitySupport === "low") {
    base = Math.min(base, 0.7);
    caps_applied.push("identity_support_low_cap_0.7");
  }
  if ((input.identityRisks?.length ?? 0) > 0) {
    base = Math.min(base, 0.75);
    caps_applied.push("identity_risk_cap_0.75");
  }
  const supportLevels = [
    input.axes.technical_strength?.evidence_support,
    input.axes.ownership_support?.evidence_support,
  ].filter(Boolean);
  if (supportLevels.includes("low") && tech >= 0.7) {
    base = Math.min(base, 0.8);
    caps_applied.push("high_signal_low_evidence_cap_0.8");
  }

  return {
    priority_score: clamp100(base * 100),
    components: {
      technical: tech,
      ownership: own,
      writing: write,
      cross_artifact: cross,
      unusual,
      persistence,
      cory,
      evidence_completeness: completeness,
      w_technical: wTech,
      w_ownership: wOwn,
      w_writing: wWrite,
      w_cross_artifact: wCross,
      w_unusual: wUnu,
      w_persistence: wPer,
      w_cory: wCory,
      w_evidence_completeness: wComp,
      base,
      requires_calibration: PRIORITY_V2_REQUIRES_CALIBRATION ? 1 : 0,
    },
    caps_applied,
    weight_version: PRIORITY_V2_VERSION,
  };
}

export function assignArchetypes(input: {
  axes: AssessmentAxes;
  ownership?: OwnershipAssessmentV2;
  evidenceIds: string[];
}): ArchetypeAssignment {
  const tech = input.axes.technical_strength?.score ?? 0;
  const techAvail = input.axes.technical_strength?.available === true;
  const own = input.axes.ownership_support?.score ?? 0;
  const ownClass = input.ownership?.support_class;
  const writing = input.axes.writing_intellectual_depth?.score ?? 0;
  const writingAvail = input.axes.writing_intellectual_depth?.available === true;
  const cross = input.axes.cross_artifact_coherence?.score ?? 0;
  const crossAvail = input.axes.cross_artifact_coherence?.available === true;
  const unusual = input.axes.unusual_problem_selection?.score ?? 0;
  const persistence = input.axes.persistence_and_iteration?.score ?? 0;
  const completeness = input.axes.evidence_completeness.score ?? 0;
  const coverage = input.ownership?.evidence_coverage ?? "low";

  const secondary: Archetype[] = [];
  let primary: Archetype = "insufficient_evidence";

  const hasArtifacts = techAvail || writingAvail || crossAvail;
  if (!hasArtifacts || (tech < 0.35 && writing < 0.35 && cross < 0.35)) {
    return {
      primary: "insufficient_evidence",
      secondary: [],
      evidence_ids: input.evidenceIds.slice(0, 5),
      confidence_support: "low",
    };
  }

  const independent =
    tech >= 0.55 &&
    (own >= 0.55 ||
      ownClass === "medium_ownership_support" ||
      ownClass === "high_ownership_support");
  const unusualExp = unusual >= 0.6 && tech >= 0.5 && (persistence >= 0.4 || tech >= 0.55);
  const deepWriter = writingAvail && writing >= 0.65;
  const crossSeeker =
    (writingAvail && writing >= 0.55) || (crossAvail && cross >= 0.55);
  const highPotential =
    tech >= 0.55 &&
    (coverage === "low" ||
      ownClass === "low_ownership_support" ||
      ownClass === "insufficient_public_evidence" ||
      own < 0.5);
  const polished =
    tech < 0.4 &&
    completeness >= 0.3 &&
    (ownClass === "medium_ownership_support" || own >= 0.5);

  if (independent) primary = "independent_systems_builder";
  else if (unusualExp) primary = "unusual_experimentalist";
  else if (deepWriter) primary = "deep_technical_writer";
  else if (crossSeeker) primary = "cross_domain_knowledge_seeker";
  else if (highPotential) primary = "high_potential_weakly_verified";
  else if (polished) primary = "polished_profile_limited_artifact_depth";
  else if (techAvail && tech >= 0.45) primary = "independent_systems_builder";
  else primary = "insufficient_evidence";

  const candidates: Array<{ a: Archetype; ok: boolean }> = [
    { a: "independent_systems_builder", ok: independent },
    { a: "unusual_experimentalist", ok: unusualExp },
    { a: "deep_technical_writer", ok: deepWriter },
    { a: "cross_domain_knowledge_seeker", ok: crossSeeker },
    { a: "high_potential_weakly_verified", ok: highPotential },
    {
      a: "research_first_technical_investigator",
      ok: writingAvail && writing >= 0.5 && tech >= 0.5,
    },
    { a: "polished_profile_limited_artifact_depth", ok: polished },
  ];
  for (const c of candidates) {
    if (c.ok && c.a !== primary && secondary.length < 2) {
      secondary.push(c.a);
    }
  }

  // Prefer high-potential as primary when strong signal + weak verification
  if (highPotential && primary === "independent_systems_builder" && own < 0.55) {
    if (!secondary.includes("independent_systems_builder")) {
      secondary.unshift("independent_systems_builder");
    }
    primary = "high_potential_weakly_verified";
    while (secondary.length > 2) secondary.pop();
  }

  let confidence_support: ArchetypeAssignment["confidence_support"] = "moderate";
  if (coverage === "high" && (input.axes.technical_strength?.evidence_support === "high")) {
    confidence_support = "high";
  } else if (coverage === "low" || completeness < 0.35) {
    confidence_support = "low";
  }

  return {
    primary,
    secondary,
    evidence_ids: input.evidenceIds.slice(0, 8),
    confidence_support,
  };
}

export function synthesizeCandidate(input: {
  name: string;
  technical?: TechnicalJudgeResultV2;
  writing?: WritingJudgeResult;
  crossArtifact?: CrossArtifactJudgeResult;
  ownership?: OwnershipAssessment | OwnershipAssessmentV2;
  cory?: CoryRelevanceResult;
  evidenceCount: number;
  discoveryScore?: number;
}): CandidateSynthesis {
  const ownershipV2 = normalizeOwnershipV2(input.ownership);
  const ownershipLegacy = normalizeOwnershipInput(input.ownership);
  const evidenceCompleteness = Math.min(1, input.evidenceCount / 8);

  const axes = buildAxes({
    technical: input.technical,
    ownership: ownershipV2,
    writing: input.writing,
    crossArtifact: input.crossArtifact,
    cory: input.cory,
    evidenceCompleteness,
  });

  const evidenceIds = [
    ...(input.technical?.strongest_evidence_ids ?? []),
    ...(input.writing?.strongest_evidence_ids ?? []),
    ...(input.crossArtifact?.strongest_evidence_ids ?? []),
    ...(ownershipV2?.supporting_evidence_ids ?? []),
  ];

  const assignment = assignArchetypes({
    axes,
    ownership: ownershipV2,
    evidenceIds,
  });

  const priority = computePriorityV2({
    axes,
    identitySupport: ownershipV2?.identity_support,
    identityRisks: ownershipV2?.identity_risks,
  });

  const tech01 = axes.technical_strength?.score;
  const unusual = axes.unusual_problem_selection?.score;
  const persistence = axes.persistence_and_iteration?.score;
  const curiosity =
    unusual !== null &&
    unusual !== undefined &&
    persistence !== null &&
    persistence !== undefined
      ? ((unusual + persistence) / 2) * 10
      : unusual !== null && unusual !== undefined
        ? unusual * 10
        : persistence !== null && persistence !== undefined
          ? persistence * 10
          : undefined;

  const confSources = [
    axes.technical_strength?.evidence_support,
    axes.ownership_support?.evidence_support,
    axes.evidence_completeness.evidence_support,
  ];
  const confMap = { high: 0.85, moderate: 0.6, low: 0.35 };
  const confVals = confSources
    .filter(Boolean)
    .map((s) => confMap[s as EvidenceSupportLevel]);
  const priority_confidence =
    confVals.reduce((a, b) => a + b, 0) / Math.max(1, confVals.length);

  const headline =
    assignment.primary === "insufficient_evidence"
      ? `${input.name}: insufficient inspectable artifacts for deep assessment`
      : `${input.name}: ${assignment.primary.replace(/_/g, " ")}`;

  return {
    archetype: assignment.primary,
    archetype_assignment: assignment,
    axes,
    headline,
    overall_rationale:
      input.technical?.summary ??
      input.writing?.summary ??
      "No specialist summary available.",
    primary_strength: primaryStrengthProse(input, tech01, axes),
    reason_to_review:
      input.cory?.human_review_recommended
        ? "The relevance judge flagged this person for a human look."
        : "Open their strongest work first, then check how much of it is really theirs.",
    reason_for_caution:
      input.technical?.missing_information[0] ??
      ownershipV2?.missing_information[0] ??
      "Artifact coverage may be incomplete.",
    strongest_evidence_ids: [...new Set(evidenceIds)].slice(0, 8),
    important_uncertainties: (() => {
      const items = [
        ...(input.technical?.unsupported_or_unverifiable_claims.slice(0, 2) ??
          []),
        ...(ownershipV2?.identity_risks.slice(0, 2) ?? []),
      ].slice(0, 4);
      return items.length ? items : ["Limited artifact coverage"];
    })(),
    domain_scores: {
      technical: tech01 !== null && tech01 !== undefined ? tech01 * 10 : undefined,
      writing:
        axes.writing_intellectual_depth?.available &&
        axes.writing_intellectual_depth.score !== null
          ? axes.writing_intellectual_depth.score * 10
          : undefined,
      curiosity,
      ownership: ownershipLegacy?.score,
      evidence_completeness: evidenceCompleteness,
    },
    priority_score: priority.priority_score,
    priority_confidence,
    weight_version: PRIORITY_V2_VERSION,
  };
}

function writingAvailStrength(axes: AssessmentAxes): string {
  if (
    axes.writing_intellectual_depth?.available &&
    axes.writing_intellectual_depth.score !== null
  ) {
    return "Their public writing carries the strongest signal here.";
  }
  return "Not enough inspectable public work for a firm read yet.";
}

function firstProseSentence(
  text: string | undefined,
  max = 220
): string | undefined {
  if (!text?.trim()) return undefined;
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^(.{30,320}?[.!?])(\s|$)/);
  const s = (m?.[1] ?? cleaned).slice(0, max).trim();
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/**
 * The claim a human sees first. Prefer the judge's own opening sentence —
 * what the person actually built/wrote — over any score restatement.
 */
function primaryStrengthProse(
  input: { technical?: { summary?: string }; writing?: { summary?: string } },
  tech01: number | null | undefined,
  axes: AssessmentAxes
): string {
  const prose =
    firstProseSentence(input.technical?.summary) ??
    firstProseSentence(input.writing?.summary);
  if (prose) return prose;
  if (tech01 !== null && tech01 !== undefined) {
    return "Assessed on inspectable technical artifacts.";
  }
  return writingAvailStrength(axes);
}
