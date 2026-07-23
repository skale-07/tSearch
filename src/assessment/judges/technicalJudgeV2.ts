import type { LlmJudgeClient } from "./llmClient.js";
import {
  TECHNICAL_PROMPT_VERSION_V2,
  TECHNICAL_RUBRIC_ID,
  TECHNICAL_RUBRIC_VERSION,
  buildTechnicalPrompt,
} from "./prompts/buildTechnicalPrompt.js";
import { technicalJudgeV2JsonSchema } from "./judgeJsonSchemas.js";
import { technicalJudgeLlmOutputV2Schema } from "./schemas/technicalJudgeSchema.js";
import {
  TECHNICAL_DIMENSIONS_V2,
  type DimensionAssessmentV2,
  type DimensionScoreV2,
  type EvidenceItem,
  type GithubRepositoryArtifactDetail,
  type OverallStrengthBand,
  type TechnicalJudgeResultV2,
} from "../types.js";
import type { RubricDefinition } from "../rubrics/types.js";
import {
  EvidenceValidationError,
  validateJudgeDimensionsV2,
} from "../evidence/evidenceValidation.js";
import { averageScores, toDimensionScoreV2 } from "./scoreUtils.js";

function assertEvidenceIds(
  ids: string[],
  evidenceById: Map<string, EvidenceItem>,
  label: string
): void {
  for (const id of ids) {
    if (!evidenceById.has(id)) {
      throw new EvidenceValidationError(`${label} references unknown ${id}`);
    }
  }
}

function validateTechnicalResultV2(
  result: TechnicalJudgeResultV2,
  evidence: EvidenceItem[],
  opts?: { ownershipConfidence?: number }
): void {
  const evidenceById = new Map(evidence.map((e) => [e.evidence_id, e]));
  validateJudgeDimensionsV2(
    result.dimensions,
    evidence,
    TECHNICAL_DIMENSIONS_V2,
    opts
  );
  assertEvidenceIds(result.strongest_evidence_ids, evidenceById, "strongest_evidence_ids");
  assertEvidenceIds(result.counterevidence_ids, evidenceById, "counterevidence_ids");
  assertEvidenceIds(
    result.artifact_reconstruction.evidence_ids,
    evidenceById,
    "artifact_reconstruction.evidence_ids"
  );

  const scored = result.dimensions.filter((d) => d.score !== null) as Array<
    DimensionAssessmentV2 & { score: number }
  >;
  const avg =
    scored.reduce((s, d) => s + d.score, 0) / Math.max(1, scored.length);
  if (
    result.overall_technical_strength === "exceptional" &&
    avg < 3.5
  ) {
    throw new EvidenceValidationError(
      "overall_technical_strength contradicts dimension scores"
    );
  }
}

export async function runTechnicalJudgeV2(input: {
  client: LlmJudgeClient;
  candidateName: string;
  githubUsername: string;
  repositories: GithubRepositoryArtifactDetail[];
  evidence: EvidenceItem[];
  model?: string;
  rubric?: RubricDefinition;
  rubricBundleVersion?: string;
}): Promise<TechnicalJudgeResultV2> {
  const evidenceIds = input.evidence.map((e) => e.evidence_id);
  const artifactIds = [
    ...new Set(input.evidence.map((e) => e.artifact_id).filter(Boolean)),
  ];
  const userPayload = {
    candidate: {
      name: input.candidateName,
      github_username: input.githubUsername,
    },
    allowed_evidence_ids: evidenceIds,
    repositories: input.repositories.map((r) => ({
      full_name: r.full_name,
      description: r.description,
      language: r.language,
      topics: r.topics,
      is_fork: r.is_fork,
      ownership: r.ownership,
      provenance_risks: r.ownership.provenance_risks,
      readme_excerpt: r.readme_excerpt.slice(0, 4000),
      core_source_files: r.core_source_files.map((f) => ({
        path: f.path,
        excerpt: f.excerpt.slice(0, 3000),
      })),
      test_files: r.test_files.map((f) => f.path),
      manifests: r.manifests.map((f) => f.path),
      candidate_commit_count: r.candidate_commits.length,
      candidate_pr_count: r.candidate_prs.length,
    })),
    evidence: input.evidence.map((e) => ({
      evidence_id: e.evidence_id,
      artifact_id: e.artifact_id,
      source_type: e.source_type,
      source_url: e.source_url,
      observation: e.observation,
      supports_claim: e.supports_claim,
      strength: e.strength,
      candidate_ownership_confidence: e.candidate_ownership_confidence,
      location: e.location,
    })),
    required_dimensions: [...TECHNICAL_DIMENSIONS_V2],
  };

  const systemPrompt = buildTechnicalPrompt(input.rubric);
  const { value, model } = await input.client.generateStructured({
    systemPrompt,
    userPayload,
    outputSchema: technicalJudgeLlmOutputV2Schema,
    jsonSchema: technicalJudgeV2JsonSchema,
    jsonSchemaName: "technical_judge_v2",
    model: input.model,
    cacheNamespace: `technical-v2:${TECHNICAL_PROMPT_VERSION_V2}`,
    judgeSchemaVersion: "technical-judge-v2",
    rubricBundleVersion:
      input.rubricBundleVersion ?? TECHNICAL_RUBRIC_VERSION,
  });

  const dimNames = new Set(value.dimensions.map((d) => d.dimension_id));
  for (const req of TECHNICAL_DIMENSIONS_V2) {
    if (!dimNames.has(req)) {
      throw new Error(`Technical judge v2 missing dimension ${req}`);
    }
  }

  const ownershipConf = Math.min(
    ...input.repositories.map((r) => {
      const cls = r.ownership.support_class;
      if (cls === "high_ownership_support") return 0.8;
      if (cls === "medium_ownership_support") return 0.65;
      if (cls === "low_ownership_support") return 0.5;
      return 0.35;
    }),
    1
  );

  const result: TechnicalJudgeResultV2 = {
    schema_version: "technical-judge-v2",
    judge_type: "technical",
    artifact_ids: artifactIds,
    rubric_id: TECHNICAL_RUBRIC_ID,
    rubric_version: TECHNICAL_RUBRIC_VERSION,
    prompt_version: TECHNICAL_PROMPT_VERSION_V2,
    model,
    ...value,
  };

  validateTechnicalResultV2(result, input.evidence, {
    ownershipConfidence: ownershipConf,
  });
  return result;
}

function scoreBand(avg: number | null): OverallStrengthBand {
  if (avg === null) return "insufficient_public_evidence";
  if (avg >= 4.5) return "exceptional";
  if (avg >= 3.5) return "strong";
  if (avg >= 2.5) return "moderate";
  if (avg >= 1.5) return "limited";
  return "insufficient_public_evidence";
}

/** Deterministic offline technical judge v2 for fixtures / mock defaults. */
export function deterministicTechnicalJudgeV2(input: {
  evidence: EvidenceItem[];
  repositories: GithubRepositoryArtifactDetail[];
  model?: string;
}): TechnicalJudgeResultV2 {
  const evIds = input.evidence.map((e) => e.evidence_id);
  const strongIds = input.evidence
    .filter((e) => e.strength === "strong")
    .map((e) => e.evidence_id);
  const artifactIds = [
    ...new Set(input.evidence.map((e) => e.artifact_id).filter(Boolean)),
  ];
  const hasCore = input.repositories.some((r) => r.core_source_files.length > 0);
  const hasTests = input.repositories.some((r) => r.test_files.length > 0);
  const commitCount = input.repositories.reduce(
    (n, r) => n + r.candidate_commits.length,
    0
  );
  const unusual = /engine|scheduler|compiler|runtime|optimizer|protocol/i.test(
    input.repositories.map((r) => r.name).join(" ")
  );

  const base = hasCore ? (hasTests ? 3 : 2) : null;
  const pickIds = (score: DimensionScoreV2): string[] => {
    if (score === null || score <= 0) return [];
    if (score >= 5) return (strongIds.length ? strongIds : evIds).slice(0, 2);
    return evIds.slice(0, 2);
  };

  const dimensions: DimensionAssessmentV2[] = TECHNICAL_DIMENSIONS_V2.map(
    (dimension_id) => {
      let score: DimensionScoreV2 = base === null ? null : toDimensionScoreV2(base);
      if (!hasCore) {
        return {
          dimension_id,
          score: null,
          applicability: "insufficient_evidence" as const,
          rationale:
            "Insufficient inspectable source artifacts for this dimension.",
          supporting_evidence_ids: [],
          counterevidence_ids: [],
          missing_information: ["Core source excerpts", "Validation artifacts"],
        };
      }
      if (dimension_id === "evaluation_and_validation") {
        score = toDimensionScoreV2(hasTests ? 3 : 1);
      } else if (dimension_id === "failure_handling") {
        score = toDimensionScoreV2(
          /fail|recover|retry|error/i.test(
            input.repositories.map((r) => r.readme_excerpt).join(" ")
          )
            ? 3
            : 1
        );
      } else if (dimension_id === "reproducibility") {
        score = toDimensionScoreV2(
          input.repositories.some((r) => r.manifests.length > 0) ? 3 : 1
        );
      } else if (dimension_id === "persistence_and_iteration") {
        score = toDimensionScoreV2(Math.min(4, Math.floor(commitCount / 4) + 1));
      } else if (dimension_id === "unusual_problem_selection") {
        score = toDimensionScoreV2(unusual ? 4 : 2);
      } else if (dimension_id === "completion_and_operational_reality") {
        score = toDimensionScoreV2(hasCore ? 3 : 1);
      } else if (dimension_id === "mechanism_depth") {
        score = toDimensionScoreV2(hasCore ? 3 : 1);
      } else if (dimension_id === "architecture_depth") {
        score = toDimensionScoreV2(hasCore ? 3 : 1);
      } else if (dimension_id === "algorithmic_or_methodological_depth") {
        score = toDimensionScoreV2(hasCore ? (unusual ? 3 : 2) : 1);
      }

      // Cap at 4 without strong evidence (5 requires strong)
      if (score !== null && score >= 5 && strongIds.length === 0) {
        score = 4;
      }
      const supporting = pickIds(score);
      if (score !== null && score > 0 && supporting.length === 0) {
        return {
          dimension_id,
          score: null,
          applicability: "insufficient_evidence" as const,
          rationale:
            "Observable artifact structure exists but no evidence IDs were collected.",
          supporting_evidence_ids: [],
          counterevidence_ids: [],
          missing_information: ["Evidence package empty"],
        };
      }

      return {
        dimension_id,
        score,
        applicability: "applicable" as const,
        rationale: `Derived from collected repository artifacts (${input.repositories.map((r) => r.full_name).join(", ")}).`,
        supporting_evidence_ids: supporting,
        counterevidence_ids: [],
        missing_information: [
          "Production deployment evidence",
          "Independent review of algorithmic novelty",
        ],
      };
    }
  );

  const avg = averageScores(dimensions.map((d) => d.score));

  const ownershipConf = input.repositories[0]
    ? input.repositories[0].ownership.support_class === "high_ownership_support"
      ? 0.8
      : input.repositories[0].ownership.support_class ===
          "medium_ownership_support"
        ? 0.65
        : 0.45
    : 0.5;

  const result: TechnicalJudgeResultV2 = {
    schema_version: "technical-judge-v2",
    judge_type: "technical",
    artifact_ids: artifactIds,
    rubric_id: TECHNICAL_RUBRIC_ID,
    rubric_version: TECHNICAL_RUBRIC_VERSION,
    prompt_version: TECHNICAL_PROMPT_VERSION_V2,
    model: input.model ?? "deterministic-fixture",
    artifact_reconstruction: {
      problem: hasCore
        ? `Visible work across ${input.repositories.length} selected repository(ies).`
        : "Problem statement not reconstructible from available artifacts.",
      claimed_mechanism: hasCore
        ? "Implementation excerpts indicate a concrete mechanism."
        : "No mechanism visible.",
      visible_architecture: hasCore
        ? "Core source and manifests outline a partial architecture."
        : "Architecture not visible.",
      validation_approach: hasTests
        ? "Test files present in selected repositories."
        : "Little or no validation evidence in package.",
      unresolved_questions: [
        "Production-scale usage not verified",
        "Contribution history may be incomplete",
      ],
      evidence_ids: (strongIds.length ? strongIds : evIds).slice(0, 3),
    },
    dimensions,
    strongest_evidence_ids: (strongIds.length ? strongIds : evIds).slice(0, 3),
    counterevidence_ids: [],
    unsupported_or_unverifiable_claims: [
      "Global novelty claims are unsupported without comparison evidence.",
    ],
    missing_information: [
      "Production deployment evidence",
      "Long-term maintenance signals",
    ],
    overall_technical_strength: scoreBand(avg),
    evidence_support: hasCore
      ? strongIds.length
        ? "high"
        : "moderate"
      : "low",
    summary: hasCore
      ? `Candidate shows substantive repository work across ${input.repositories.length} selected repo(s).`
      : "Insufficient source artifacts to support deep technical assessment.",
  };

  validateTechnicalResultV2(result, input.evidence, {
    ownershipConfidence: ownershipConf,
  });
  return result;
}
