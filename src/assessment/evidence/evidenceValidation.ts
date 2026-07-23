import type {
  DimensionAssessment,
  DimensionAssessmentV2,
  EvidenceItem,
  SpecialistJudgeResult,
} from "../types.js";

const MOTIVATION_AS_FACT =
  /\b(is|are|was|were)\s+motivated by\b|\btheir passion\b|\bgenuinely curious because\b|\bwants to\b|\bdreams of\b|\bloves coding because\b/i;

const CONFIRMED_CREATOR =
  /\b(is the (sole |primary )?author|definitely created|confirmed creator|sole creator)\b/i;

export class EvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceValidationError";
  }
}

export function validateDimensionAssessment(
  dim: DimensionAssessment,
  evidenceById: Map<string, EvidenceItem>,
  opts?: { ownershipConfidence?: number }
): void {
  if (dim.score < 0 || dim.score > 10) {
    throw new EvidenceValidationError(
      `Dimension ${dim.dimension}: score out of range (${dim.score})`
    );
  }
  if (dim.confidence < 0 || dim.confidence > 1) {
    throw new EvidenceValidationError(
      `Dimension ${dim.dimension}: confidence out of range (${dim.confidence})`
    );
  }
  if (dim.score > 2 && dim.supporting_evidence_ids.length === 0) {
    throw new EvidenceValidationError(
      `Dimension ${dim.dimension}: score ${dim.score} requires evidence IDs`
    );
  }
  for (const id of dim.supporting_evidence_ids) {
    if (!evidenceById.has(id)) {
      throw new EvidenceValidationError(
        `Dimension ${dim.dimension}: unknown evidence_id ${id}`
      );
    }
  }
  for (const ce of dim.counterevidence) {
    for (const id of ce.evidence_ids ?? []) {
      if (!evidenceById.has(id)) {
        throw new EvidenceValidationError(
          `Dimension ${dim.dimension}: counterevidence unknown evidence_id ${id}`
        );
      }
    }
  }
  if (dim.score > 8) {
    const hasStrong = dim.supporting_evidence_ids.some(
      (id) => evidenceById.get(id)?.strength === "strong"
    );
    if (!hasStrong) {
      throw new EvidenceValidationError(
        `Dimension ${dim.dimension}: score ${dim.score} requires at least one strong evidence item`
      );
    }
  }
  if (MOTIVATION_AS_FACT.test(dim.rationale)) {
    throw new EvidenceValidationError(
      `Dimension ${dim.dimension}: rationale claims internal motivation as fact`
    );
  }
  const ownershipConf = opts?.ownershipConfidence ?? 1;
  if (ownershipConf < 0.5 && CONFIRMED_CREATOR.test(dim.rationale)) {
    throw new EvidenceValidationError(
      `Dimension ${dim.dimension}: unsupported confirmed-creator claim with low ownership confidence`
    );
  }
}

/** V2 dimensions: score may be null when applicability is not_applicable or insufficient_evidence. */
export function validateDimensionAssessmentV2(
  dim: DimensionAssessmentV2,
  evidenceById: Map<string, EvidenceItem>,
  opts?: { ownershipConfidence?: number }
): void {
  const label = dim.dimension_id;
  if (dim.applicability === "applicable") {
    if (dim.score === null) {
      throw new EvidenceValidationError(
        `Dimension ${label}: applicable dimensions require a 0-5 score`
      );
    }
    if (dim.score < 0 || dim.score > 5 || !Number.isInteger(dim.score)) {
      throw new EvidenceValidationError(
        `Dimension ${label}: score out of range (${dim.score})`
      );
    }
  } else if (dim.score !== null) {
    throw new EvidenceValidationError(
      `Dimension ${label}: score must be null when applicability is ${dim.applicability}`
    );
  }

  if (dim.score !== null && dim.score > 0 && dim.supporting_evidence_ids.length === 0) {
    throw new EvidenceValidationError(
      `Dimension ${label}: score ${dim.score} requires evidence IDs`
    );
  }
  for (const id of dim.supporting_evidence_ids) {
    if (!evidenceById.has(id)) {
      throw new EvidenceValidationError(
        `Dimension ${label}: unknown evidence_id ${id}`
      );
    }
  }
  for (const id of dim.counterevidence_ids) {
    if (!evidenceById.has(id)) {
      throw new EvidenceValidationError(
        `Dimension ${label}: counterevidence unknown evidence_id ${id}`
      );
    }
  }
  if (dim.score !== null && dim.score >= 5) {
    const hasStrong = dim.supporting_evidence_ids.some(
      (id) => evidenceById.get(id)?.strength === "strong"
    );
    if (!hasStrong) {
      throw new EvidenceValidationError(
        `Dimension ${label}: score ${dim.score} requires at least one strong evidence item`
      );
    }
  }
  if (MOTIVATION_AS_FACT.test(dim.rationale)) {
    throw new EvidenceValidationError(
      `Dimension ${label}: rationale claims internal motivation as fact`
    );
  }
  const ownershipConf = opts?.ownershipConfidence ?? 1;
  if (ownershipConf < 0.5 && CONFIRMED_CREATOR.test(dim.rationale)) {
    throw new EvidenceValidationError(
      `Dimension ${label}: unsupported confirmed-creator claim with low ownership confidence`
    );
  }
}

export function validateJudgeDimensionsV2(
  dimensions: DimensionAssessmentV2[],
  evidence: EvidenceItem[],
  requiredDimensionIds: readonly string[],
  opts?: { ownershipConfidence?: number }
): void {
  const evidenceById = evidenceIndex(evidence);
  const present = new Set(dimensions.map((d) => d.dimension_id));
  for (const id of requiredDimensionIds) {
    if (!present.has(id)) {
      throw new EvidenceValidationError(`Missing required dimension: ${id}`);
    }
  }
  for (const dim of dimensions) {
    validateDimensionAssessmentV2(dim, evidenceById, opts);
  }
}

export function validateSpecialistJudgeResult(
  result: SpecialistJudgeResult,
  evidence: EvidenceItem[],
  requiredDimensions?: readonly string[],
  opts?: { ownershipConfidence?: number }
): void {
  const evidenceById = new Map(evidence.map((e) => [e.evidence_id, e]));

  if (requiredDimensions) {
    const present = new Set(result.dimensions.map((d) => d.dimension));
    for (const dim of requiredDimensions) {
      if (!present.has(dim)) {
        throw new EvidenceValidationError(`Missing required dimension: ${dim}`);
      }
    }
  }

  for (const dim of result.dimensions) {
    validateDimensionAssessment(dim, evidenceById, opts);
  }

  for (const id of result.strongest_evidence_ids) {
    if (!evidenceById.has(id)) {
      throw new EvidenceValidationError(
        `strongest_evidence_ids references unknown ${id}`
      );
    }
  }

  if (MOTIVATION_AS_FACT.test(result.summary)) {
    throw new EvidenceValidationError(
      "Judge summary claims internal motivation as fact"
    );
  }

  const avgScore =
    result.dimensions.reduce((s, d) => s + d.score, 0) /
    Math.max(1, result.dimensions.length);
  if (
    /exceptional|outstanding|world-class/i.test(result.summary) &&
    avgScore < 6
  ) {
    throw new EvidenceValidationError(
      "Judge summary contradicts low dimension scores"
    );
  }
}

export function evidenceIndex(
  evidence: EvidenceItem[]
): Map<string, EvidenceItem> {
  return new Map(evidence.map((e) => [e.evidence_id, e]));
}
