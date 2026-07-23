import type { LlmJudgeClient } from "./llmClient.js";
import { coryRelevanceJsonSchema } from "./judgeJsonSchemas.js";
import { coryRelevanceLlmOutputSchema } from "./schemas/coryRelevanceSchema.js";
import type {
  CoryRelevanceResult,
  CrossArtifactJudgeResult,
  OwnershipAssessmentV2,
  TechnicalJudgeResultV2,
  WritingJudgeResult,
} from "../types.js";

export const CORY_CALIBRATION_VERSION = "cory-relevance-v1";

export interface CoryRelevanceInputs {
  technical?: TechnicalJudgeResultV2;
  ownership?: OwnershipAssessmentV2;
  writing?: WritingJudgeResult;
  crossArtifact?: CrossArtifactJudgeResult;
  evidenceCompleteness: number;
  evidenceIds?: string[];
  sparseEvidenceUpside?: boolean;
}

function dimScore(
  dims: { dimension_id: string; score: number | null }[] | undefined,
  id: string
): number | null {
  const d = dims?.find((x) => x.dimension_id === id);
  return d?.score ?? null;
}

function strengthToPoints(
  band:
    | "exceptional"
    | "strong"
    | "moderate"
    | "limited"
    | "insufficient_public_evidence"
    | undefined
): number {
  switch (band) {
    case "exceptional":
      return 4;
    case "strong":
      return 3;
    case "moderate":
      return 2;
    case "limited":
      return 1;
    default:
      return 0;
  }
}

function ownershipPoints(ownership?: OwnershipAssessmentV2): number {
  if (!ownership) return 0;
  switch (ownership.support_class) {
    case "high_ownership_support":
      return 3;
    case "medium_ownership_support":
      return 2;
    case "low_ownership_support":
      return 1;
    default:
      return 0;
  }
}

/** Pure rule hybrid used by fixtures and as the LLM baseline. */
export function deterministicCoryRelevance(
  input: CoryRelevanceInputs
): CoryRelevanceResult {
  const unusual = dimScore(
    input.technical?.dimensions,
    "unusual_problem_selection"
  );
  const persistence = dimScore(
    input.technical?.dimensions,
    "persistence_and_iteration"
  );
  const techPts = strengthToPoints(input.technical?.overall_technical_strength);
  const writePts = strengthToPoints(input.writing?.overall_writing_depth);
  const crossPts = strengthToPoints(
    input.crossArtifact?.overall_inquiry_support
  );
  const ownPts = ownershipPoints(input.ownership);
  const completeness = Math.max(0, Math.min(1, input.evidenceCompleteness));

  const reasons: string[] = [];
  let score = 0;

  if (techPts >= 3) {
    score += 3;
    reasons.push("Strong or exceptional technical strength.");
  } else if (techPts === 2) {
    score += 2;
    reasons.push("Moderate technical strength.");
  } else if (techPts === 1) {
    score += 1;
    reasons.push("Limited technical signal.");
  }

  if (ownPts >= 2) {
    score += 2;
    reasons.push("Medium or high ownership support.");
  } else if (ownPts === 1) {
    score += 1;
    reasons.push("Low ownership support.");
  }

  if (unusual !== null && unusual >= 3) {
    score += 2;
    reasons.push("Unusual problem selection is visible.");
  }
  if (persistence !== null && persistence >= 3) {
    score += 1;
    reasons.push("Persistence / iteration evidence present.");
  }
  if (writePts >= 3) {
    score += 2;
    reasons.push("Strong writing intellectual depth.");
  } else if (writePts === 2) {
    score += 1;
    reasons.push("Moderate writing depth.");
  } else if (writePts === 1) {
    score += 1;
    reasons.push("Limited writing depth.");
  }
  if (crossPts >= 2) {
    score += 1;
    reasons.push("Cross-artifact inquiry support present.");
  }
  if (completeness >= 0.6) {
    score += 1;
    reasons.push("Evidence completeness is adequate.");
  }
  if (input.sparseEvidenceUpside && techPts >= 2 && completeness < 0.45) {
    score += 1;
    reasons.push("Sparse-evidence upside with nontrivial technical signal.");
  }

  const insufficient =
    !input.technical &&
    !input.writing &&
    !input.crossArtifact &&
    ownPts === 0;

  let relevance: CoryRelevanceResult["relevance"];
  if (insufficient || (techPts === 0 && writePts === 0 && crossPts === 0)) {
    relevance = "insufficient_evidence";
    if (!reasons.length) {
      reasons.push("Insufficient public evidence for Cory routing.");
    }
  } else if (score >= 8) {
    relevance = "high";
  } else if (score >= 4) {
    relevance = "medium";
  } else {
    relevance = "low";
    if (!reasons.length) {
      reasons.push("Weak aggregated signal for Cory routing.");
    }
  }
  const evidence_ids = [
    ...(input.evidenceIds ?? []),
    ...(input.technical?.strongest_evidence_ids ?? []),
    ...(input.writing?.strongest_evidence_ids ?? []),
    ...(input.crossArtifact?.strongest_evidence_ids ?? []),
    ...(input.ownership?.supporting_evidence_ids ?? []),
  ].slice(0, 8);

  return {
    relevance,
    reasons,
    evidence_ids: [...new Set(evidence_ids)],
    calibration_version: CORY_CALIBRATION_VERSION,
    human_review_recommended:
      relevance === "high" ||
      relevance === "insufficient_evidence" ||
      (relevance === "medium" && completeness < 0.5),
  };
}

/**
 * Hybrid Cory relevance: deterministic rules first; optional LLM may refine
 * wording / flag review without inventing a separate preference model.
 */
export async function runCoryRelevanceJudge(input: {
  client?: LlmJudgeClient;
  signals: CoryRelevanceInputs;
  model?: string;
  rubricBundleVersion?: string;
}): Promise<CoryRelevanceResult> {
  const baseline = deterministicCoryRelevance(input.signals);
  if (!input.client) return baseline;

  try {
    const { value } = await input.client.generateStructured({
      systemPrompt: `You refine Cory relevance routing labels for tSearch.
Cory relevance is reviewer-specific routing, not general talent.
Start from the provided rule baseline. You may adjust relevance by at most one band
when the baseline reasons clearly conflict with the axis summary.
Do not invent evidence IDs. Return JSON only.`,
      userPayload: {
        baseline,
        axes_summary: {
          technical: input.signals.technical?.overall_technical_strength,
          ownership: input.signals.ownership?.support_class,
          writing: input.signals.writing?.overall_writing_depth,
          cross_artifact: input.signals.crossArtifact?.overall_inquiry_support,
          unusual: dimScore(
            input.signals.technical?.dimensions,
            "unusual_problem_selection"
          ),
          evidence_completeness: input.signals.evidenceCompleteness,
        },
        allowed_evidence_ids: baseline.evidence_ids,
      },
      outputSchema: coryRelevanceLlmOutputSchema,
      jsonSchema: coryRelevanceJsonSchema,
      jsonSchemaName: "cory_relevance_v1",
      model: input.model,
      cacheNamespace: `cory-relevance:${CORY_CALIBRATION_VERSION}`,
      judgeSchemaVersion: "cory-relevance-v1",
      rubricBundleVersion: input.rubricBundleVersion ?? CORY_CALIBRATION_VERSION,
    });

    const allowed = new Set(baseline.evidence_ids);
    const evidence_ids = value.evidence_ids.filter((id) => allowed.has(id));
    return {
      relevance: value.relevance,
      reasons: value.reasons.length ? value.reasons : baseline.reasons,
      evidence_ids: evidence_ids.length ? evidence_ids : baseline.evidence_ids,
      calibration_version: CORY_CALIBRATION_VERSION,
      human_review_recommended: value.human_review_recommended,
    };
  } catch {
    return baseline;
  }
}
