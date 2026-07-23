import type { LlmJudgeClient } from "./llmClient.js";
import {
  CROSS_ARTIFACT_PROMPT_VERSION,
  CROSS_ARTIFACT_RUBRIC_ID,
  CROSS_ARTIFACT_RUBRIC_VERSION,
  buildCrossArtifactPrompt,
} from "./prompts/buildCrossArtifactPrompt.js";
import { crossArtifactJudgeJsonSchema } from "./judgeJsonSchemas.js";
import { crossArtifactJudgeLlmOutputSchema } from "./schemas/crossArtifactJudgeSchema.js";
import {
  CROSS_ARTIFACT_DIMENSIONS,
  type DimensionAssessmentV2,
  type DimensionScoreV2,
  type EvidenceItem,
  type OverallStrengthBand,
  type CrossArtifactJudgeResult,
} from "../types.js";
import type { RubricDefinition } from "../rubrics/types.js";
import {
  EvidenceValidationError,
  validateJudgeDimensionsV2,
} from "../evidence/evidenceValidation.js";
import { averageScores, toDimensionScoreV2 } from "./scoreUtils.js";

/** Minimal relationship shape until relationships module lands. */
export interface ArtifactRelationshipInput {
  relationship_id: string;
  source_artifact_id: string;
  target_artifact_id: string;
  relationship_type: string;
  deterministic: boolean;
  confidence_support: "high" | "moderate" | "low";
  evidence_ids: string[];
  explanation?: string;
}

function validateCrossArtifactResult(
  result: CrossArtifactJudgeResult,
  evidence: EvidenceItem[]
): void {
  const evidenceById = new Map(evidence.map((e) => [e.evidence_id, e]));
  validateJudgeDimensionsV2(
    result.dimensions,
    evidence,
    CROSS_ARTIFACT_DIMENSIONS
  );
  for (const id of result.strongest_evidence_ids) {
    if (!evidenceById.has(id)) {
      throw new EvidenceValidationError(
        `strongest_evidence_ids references unknown ${id}`
      );
    }
  }
}

function scoreBand(avg: number | null): OverallStrengthBand {
  if (avg === null) return "insufficient_public_evidence";
  if (avg >= 4.5) return "exceptional";
  if (avg >= 3.5) return "strong";
  if (avg >= 2.5) return "moderate";
  if (avg >= 1.5) return "limited";
  return "insufficient_public_evidence";
}

export async function runCrossArtifactJudge(input: {
  client: LlmJudgeClient;
  candidateName: string;
  artifactIds: string[];
  relationships: ArtifactRelationshipInput[];
  evidence: EvidenceItem[];
  model?: string;
  rubric?: RubricDefinition;
  rubricBundleVersion?: string;
}): Promise<CrossArtifactJudgeResult> {
  const distinctKinds = new Set(
    input.evidence.map((e) => e.source_type.split("_")[0] ?? e.source_type)
  );
  if (input.artifactIds.length < 2 || input.relationships.length === 0) {
    return deterministicCrossArtifactJudge({
      artifactIds: input.artifactIds,
      relationships: input.relationships,
      evidence: input.evidence,
      model: input.model ?? "deterministic-unavailable",
    });
  }

  const evidenceIds = input.evidence.map((e) => e.evidence_id);
  const userPayload = {
    candidate: { name: input.candidateName },
    allowed_evidence_ids: evidenceIds,
    artifact_ids: input.artifactIds,
    relationships: input.relationships,
    evidence: input.evidence.map((e) => ({
      evidence_id: e.evidence_id,
      artifact_id: e.artifact_id,
      source_type: e.source_type,
      observation: e.observation,
      supports_claim: e.supports_claim,
      strength: e.strength,
    })),
    required_dimensions: [...CROSS_ARTIFACT_DIMENSIONS],
    note:
      distinctKinds.size < 2
        ? "Limited artifact-type diversity; abstain where cross-type inquiry cannot be shown."
        : undefined,
  };

  const { value, model } = await input.client.generateStructured({
    systemPrompt: buildCrossArtifactPrompt(input.rubric),
    userPayload,
    outputSchema: crossArtifactJudgeLlmOutputSchema,
    jsonSchema: crossArtifactJudgeJsonSchema,
    jsonSchemaName: "cross_artifact_judge_v1",
    model: input.model,
    cacheNamespace: `cross-artifact-v1:${CROSS_ARTIFACT_PROMPT_VERSION}`,
    judgeSchemaVersion: "cross-artifact-judge-v1",
    rubricBundleVersion:
      input.rubricBundleVersion ?? CROSS_ARTIFACT_RUBRIC_VERSION,
  });

  const result: CrossArtifactJudgeResult = {
    schema_version: "cross-artifact-judge-v1",
    judge_type: "cross_artifact",
    relationship_ids: input.relationships.map((r) => r.relationship_id),
    artifact_ids: input.artifactIds,
    model,
    rubric_id: CROSS_ARTIFACT_RUBRIC_ID,
    rubric_version: CROSS_ARTIFACT_RUBRIC_VERSION,
    prompt_version: CROSS_ARTIFACT_PROMPT_VERSION,
    ...value,
  };
  validateCrossArtifactResult(result, input.evidence);
  return result;
}

/** Deterministic offline cross-artifact judge for fixtures / mock defaults. */
export function deterministicCrossArtifactJudge(input: {
  artifactIds: string[];
  relationships: ArtifactRelationshipInput[];
  evidence: EvidenceItem[];
  model?: string;
}): CrossArtifactJudgeResult {
  const evIds = input.evidence.map((e) => e.evidence_id);
  const relIds = input.relationships.map((r) => r.relationship_id);
  const hasLinks = input.relationships.length > 0 && input.artifactIds.length >= 2;
  const deterministicLinks = input.relationships.filter((r) => r.deterministic);
  const revisions = input.relationships.filter((r) =>
    /revises|follow_up|derived_from/i.test(r.relationship_type)
  );

  const dimensions: DimensionAssessmentV2[] = CROSS_ARTIFACT_DIMENSIONS.map(
    (dimension_id) => {
      if (!hasLinks) {
        return {
          dimension_id,
          score: null,
          applicability: "insufficient_evidence" as const,
          rationale:
            "Fewer than two linked artifacts; cross-artifact inquiry cannot be scored.",
          supporting_evidence_ids: [],
          counterevidence_ids: [],
          missing_information: [
            "Linked artifacts of more than one type",
            "Deterministic relationship evidence",
          ],
        };
      }

      let score: DimensionScoreV2 = toDimensionScoreV2(
        deterministicLinks.length ? 3 : 2
      );
      if (dimension_id === "evidence_of_belief_updating") {
        score = toDimensionScoreV2(revisions.length ? 3 : 1);
      }
      if (dimension_id === "iteration_across_artifacts") {
        score = toDimensionScoreV2(input.relationships.length >= 2 ? 3 : 2);
      }
      if (dimension_id === "coherence_without_redundancy") {
        score = toDimensionScoreV2(deterministicLinks.length ? 3 : 2);
      }
      if (score !== null && score >= 5) score = 4;
      const supporting = evIds.slice(0, 2);
      if (score !== null && score > 0 && supporting.length === 0) {
        return {
          dimension_id,
          score: null,
          applicability: "insufficient_evidence" as const,
          rationale:
            "Relationships exist but no evidence IDs were collected for citation.",
          supporting_evidence_ids: [],
          counterevidence_ids: [],
          missing_information: ["Evidence package empty"],
        };
      }

      return {
        dimension_id,
        score,
        applicability: "applicable" as const,
        rationale: `Derived from ${input.relationships.length} artifact relationship(s).`,
        supporting_evidence_ids: supporting,
        counterevidence_ids: [],
        missing_information: ["Full inquiry history may be incomplete"],
      };
    }
  );

  const avg = averageScores(dimensions.map((d) => d.score));

  const result: CrossArtifactJudgeResult = {
    schema_version: "cross-artifact-judge-v1",
    judge_type: "cross_artifact",
    relationship_ids: relIds,
    artifact_ids: input.artifactIds,
    rubric_id: CROSS_ARTIFACT_RUBRIC_ID,
    rubric_version: CROSS_ARTIFACT_RUBRIC_VERSION,
    prompt_version: CROSS_ARTIFACT_PROMPT_VERSION,
    model: input.model ?? "deterministic-fixture",
    reconstructed_inquiry_threads: hasLinks
      ? [
          {
            thread_id: "thread_deterministic_1",
            question_or_theme: "Linked artifacts suggest a shared inquiry theme.",
            ordered_artifact_ids: input.artifactIds.slice(0, 4),
            relationship_ids: relIds.slice(0, 3),
            evidence_ids: evIds.slice(0, 2),
            interpretation:
              "Deterministic links connect artifacts; depth of translation remains limited without follow-up text.",
            counterevidence: [],
          },
        ]
      : [],
    dimensions,
    overall_inquiry_support: scoreBand(avg),
    evidence_support: hasLinks
      ? deterministicLinks.length
        ? "moderate"
        : "low"
      : "low",
    strongest_evidence_ids: evIds.slice(0, 3),
    counterevidence_ids: [],
    missing_information: hasLinks
      ? ["Explicit belief-revision statements"]
      : ["Cross-artifact relationships"],
    summary: hasLinks
      ? `Cross-artifact inquiry assessed from ${input.relationships.length} relationship(s).`
      : "Cross-artifact inquiry unavailable: insufficient linked artifacts.",
  };

  validateCrossArtifactResult(result, input.evidence);
  return result;
}
