import type { LlmJudgeClient } from "./llmClient.js";
import {
  WRITING_PROMPT_VERSION,
  WRITING_RUBRIC_ID,
  WRITING_RUBRIC_VERSION,
  buildWritingPrompt,
} from "./prompts/buildWritingPrompt.js";
import { writingJudgeJsonSchema } from "./judgeJsonSchemas.js";
import { writingJudgeLlmOutputSchema } from "./schemas/writingJudgeSchema.js";
import {
  WRITING_DIMENSIONS,
  type ArtifactReference,
  type DimensionAssessmentV2,
  type DimensionScoreV2,
  type EvidenceItem,
  type OverallStrengthBand,
  type WritingJudgeResult,
} from "../types.js";
import type { RubricDefinition } from "../rubrics/types.js";
import {
  EvidenceValidationError,
  validateJudgeDimensionsV2,
} from "../evidence/evidenceValidation.js";
import { coerceScoredDimensionsForEvidence } from "./normalizeLlmPayload.js";
import { averageScores, toDimensionScoreV2 } from "./scoreUtils.js";

export interface WritingArtifactInput {
  artifact_id: string;
  title: string;
  canonical_url: string;
  excerpt: string;
  published_at?: string;
}

function validateWritingResult(
  result: WritingJudgeResult,
  evidence: EvidenceItem[]
): void {
  const evidenceById = new Map(evidence.map((e) => [e.evidence_id, e]));
  validateJudgeDimensionsV2(result.dimensions, evidence, WRITING_DIMENSIONS);
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

export async function runWritingJudge(input: {
  client: LlmJudgeClient;
  candidateName: string;
  articles: WritingArtifactInput[];
  evidence: EvidenceItem[];
  references?: ArtifactReference[];
  model?: string;
  rubric?: RubricDefinition;
  rubricBundleVersion?: string;
}): Promise<WritingJudgeResult> {
  if (input.articles.length === 0) {
    return deterministicWritingJudge({
      articles: [],
      evidence: input.evidence,
      model: input.model ?? "deterministic-unavailable",
    });
  }

  const evidenceIds = input.evidence.map((e) => e.evidence_id);
  const artifactIds = input.articles.map((a) => a.artifact_id);
  const userPayload = {
    candidate: { name: input.candidateName },
    allowed_evidence_ids: evidenceIds,
    articles: input.articles.map((a) => ({
      artifact_id: a.artifact_id,
      title: a.title,
      canonical_url: a.canonical_url,
      excerpt: a.excerpt.slice(0, 6000),
      published_at: a.published_at,
    })),
    evidence: input.evidence.map((e) => ({
      evidence_id: e.evidence_id,
      artifact_id: e.artifact_id,
      source_type: e.source_type,
      source_url: e.source_url,
      observation: e.observation,
      supports_claim: e.supports_claim,
      strength: e.strength,
      location: e.location,
    })),
    required_dimensions: [...WRITING_DIMENSIONS],
  };

  const { value, model } = await input.client.generateStructured({
    systemPrompt: buildWritingPrompt(input.rubric),
    userPayload,
    outputSchema: writingJudgeLlmOutputSchema,
    jsonSchema: writingJudgeJsonSchema,
    jsonSchemaName: "writing_judge_v1",
    model: input.model,
    cacheNamespace: `writing-v1:${WRITING_PROMPT_VERSION}`,
    judgeSchemaVersion: "writing-judge-v1",
    rubricBundleVersion: input.rubricBundleVersion ?? WRITING_RUBRIC_VERSION,
  });

  const allowedEvidence = new Set(evidenceIds);
  const evidenceStrength = new Map(
    input.evidence.map((e) => [e.evidence_id, e.strength] as const)
  );
  const coerced = coerceScoredDimensionsForEvidence(
    {
      ...value,
      strongest_evidence_ids: (value.strongest_evidence_ids ?? []).filter((id) =>
        allowedEvidence.has(id)
      ),
      counterevidence_ids: (value.counterevidence_ids ?? []).filter((id) =>
        allowedEvidence.has(id)
      ),
      corpus_reconstruction: {
        ...value.corpus_reconstruction,
        evidence_ids: (value.corpus_reconstruction.evidence_ids ?? []).filter(
          (id) => allowedEvidence.has(id)
        ),
        recurring_questions: (
          value.corpus_reconstruction.recurring_questions ?? []
        ).map((q) => ({
          ...q,
          evidence_ids: (q.evidence_ids ?? []).filter((id) =>
            allowedEvidence.has(id)
          ),
        })),
      },
    },
    allowedEvidence,
    evidenceStrength
  );

  const result: WritingJudgeResult = {
    schema_version: "writing-judge-v1",
    judge_type: "writing",
    artifact_ids: artifactIds,
    rubric_id: WRITING_RUBRIC_ID,
    rubric_version: WRITING_RUBRIC_VERSION,
    prompt_version: WRITING_PROMPT_VERSION,
    model,
    ...coerced,
  };
  validateWritingResult(result, input.evidence);
  return result;
}

/** Deterministic offline writing judge for fixtures / mock defaults. */
export function deterministicWritingJudge(input: {
  articles: WritingArtifactInput[];
  evidence: EvidenceItem[];
  model?: string;
}): WritingJudgeResult {
  const evIds = input.evidence.map((e) => e.evidence_id);
  const strongIds = input.evidence
    .filter((e) => e.strength === "strong")
    .map((e) => e.evidence_id);
  const artifactIds = input.articles.map((a) => a.artifact_id);
  const hasCorpus = input.articles.length > 0;
  const multi = input.articles.length >= 2;
  const mechanistic = /mechanism|tradeoff|limitation|experiment|hypothesis/i.test(
    input.articles.map((a) => `${a.title} ${a.excerpt}`).join(" ")
  );

  const dimensions: DimensionAssessmentV2[] = WRITING_DIMENSIONS.map(
    (dimension_id) => {
      if (!hasCorpus) {
        return {
          dimension_id,
          score: null,
          applicability: "insufficient_evidence" as const,
          rationale: "No writing artifacts available for this candidate.",
          supporting_evidence_ids: [],
          counterevidence_ids: [],
          missing_information: ["Public technical articles or essays"],
        };
      }

      let score: DimensionScoreV2 = 2;
      if (dimension_id === "topic_persistence") {
        score = toDimensionScoreV2(multi ? 3 : 1);
      }
      if (dimension_id === "observable_self_directed_inquiry") {
        score = toDimensionScoreV2(multi || mechanistic ? 3 : 2);
      }
      if (dimension_id === "mechanistic_explanation") {
        score = toDimensionScoreV2(mechanistic ? 3 : 1);
      }
      if (dimension_id === "original_analysis") {
        score = toDimensionScoreV2(mechanistic ? 3 : 2);
      }
      if (dimension_id === "clarity") score = 3;
      if (score !== null && score >= 5 && strongIds.length === 0) score = 4;
      const supporting = evIds.slice(0, 2);
      if (score !== null && score > 0 && supporting.length === 0) {
        return {
          dimension_id,
          score: null,
          applicability: "insufficient_evidence" as const,
          rationale: "Writing artifacts present but evidence IDs missing.",
          supporting_evidence_ids: [],
          counterevidence_ids: [],
          missing_information: ["Evidence package empty"],
        };
      }

      return {
        dimension_id,
        score,
        applicability: "applicable" as const,
        rationale: `Derived from ${input.articles.length} writing artifact(s).`,
        supporting_evidence_ids: supporting,
        counterevidence_ids: [],
        missing_information: ["Full corpus history may be incomplete"],
      };
    }
  );

  const avg = averageScores(dimensions.map((d) => d.score));

  const result: WritingJudgeResult = {
    schema_version: "writing-judge-v1",
    judge_type: "writing",
    artifact_ids: artifactIds,
    rubric_id: WRITING_RUBRIC_ID,
    rubric_version: WRITING_RUBRIC_VERSION,
    prompt_version: WRITING_PROMPT_VERSION,
    model: input.model ?? "deterministic-fixture",
    corpus_reconstruction: {
      recurring_questions: hasCorpus
        ? [
            {
              question: "Visible technical questions across writing artifacts.",
              artifact_ids: artifactIds.slice(0, 3),
              evidence_ids: evIds.slice(0, 2),
            },
          ]
        : [],
      observable_trajectory: hasCorpus
        ? multi
          ? "Multiple artifacts suggest an ongoing inquiry thread."
          : "Single-article corpus; trajectory cannot be established."
        : "No writing corpus.",
      explicit_revisions: [],
      original_analysis_artifacts: mechanistic ? artifactIds.slice(0, 1) : [],
      evidence_ids: evIds.slice(0, 3),
    },
    dimensions,
    strongest_evidence_ids: (strongIds.length ? strongIds : evIds).slice(0, 3),
    counterevidence_ids: [],
    missing_information: hasCorpus
      ? ["Earlier unpublished drafts not available"]
      : ["Public writing artifacts"],
    overall_writing_depth: scoreBand(avg),
    evidence_support: hasCorpus ? (multi ? "moderate" : "low") : "low",
    summary: hasCorpus
      ? `Writing depth assessed across ${input.articles.length} artifact(s).`
      : "Writing intellectual depth unavailable: no public writing artifacts.",
  };

  validateWritingResult(result, input.evidence);
  return result;
}
