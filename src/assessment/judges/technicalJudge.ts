import type { LlmJudgeClient } from "./llmClient.js";
import {
  TECHNICAL_SYSTEM_PROMPT,
  TECHNICAL_PROMPT_VERSION,
} from "./prompts/technicalSystemPrompt.js";
import { technicalJudgeLlmOutputSchema } from "../schemas.js";
import { TECHNICAL_DIMENSIONS } from "../types.js";
import type {
  EvidenceItem,
  GithubRepositoryArtifactDetail,
  SpecialistJudgeResult,
} from "../types.js";
import { validateSpecialistJudgeResult } from "../evidence/evidenceValidation.js";

export async function runTechnicalJudge(input: {
  client: LlmJudgeClient;
  candidateName: string;
  githubUsername: string;
  repositories: GithubRepositoryArtifactDetail[];
  evidence: EvidenceItem[];
  model?: string;
}): Promise<SpecialistJudgeResult> {
  const evidenceIds = input.evidence.map((e) => e.evidence_id);
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
    required_dimensions: [...TECHNICAL_DIMENSIONS],
  };

  const { value, model, input_hash } = await input.client.generateStructured({
    systemPrompt: TECHNICAL_SYSTEM_PROMPT,
    userPayload,
    outputSchema: technicalJudgeLlmOutputSchema,
    model: input.model,
    cacheNamespace: `technical:${TECHNICAL_PROMPT_VERSION}`,
  });

  // Ensure dimension names match exactly
  const dimNames = new Set(value.dimensions.map((d) => d.dimension));
  for (const req of TECHNICAL_DIMENSIONS) {
    if (!dimNames.has(req)) {
      throw new Error(`Technical judge missing dimension ${req}`);
    }
  }

  const ownershipConf = Math.min(
    ...input.repositories.map((r) => r.ownership_legacy.confidence),
    value.ownership.confidence
  );

  const result: SpecialistJudgeResult = {
    judge_type: "technical",
    prompt_version: TECHNICAL_PROMPT_VERSION,
    model,
    input_hash,
    summary: value.summary,
    dimensions: value.dimensions,
    strongest_evidence_ids: value.strongest_evidence_ids,
    important_uncertainties: value.important_uncertainties,
    recommended_human_review: value.recommended_human_review,
    created_at: new Date().toISOString(),
  };

  validateSpecialistJudgeResult(result, input.evidence, TECHNICAL_DIMENSIONS, {
    ownershipConfidence: ownershipConf,
  });

  return result;
}

/** Deterministic offline technical judge for fixtures / mock defaults */
export function deterministicTechnicalJudge(input: {
  evidence: EvidenceItem[];
  repositories: GithubRepositoryArtifactDetail[];
  model?: string;
}): SpecialistJudgeResult {
  const evIds = input.evidence.map((e) => e.evidence_id);
  const strongIds = input.evidence
    .filter((e) => e.strength === "strong")
    .map((e) => e.evidence_id);
  const ownership = input.repositories[0]?.ownership_legacy;
  const hasCore = input.repositories.some((r) => r.core_source_files.length > 0);
  const hasTests = input.repositories.some((r) => r.test_files.length > 0);
  const depth = hasCore ? (hasTests ? 7.5 : 6.5) : 2;

  const dimensions = TECHNICAL_DIMENSIONS.map((dimension) => {
    let score = depth;
    if (dimension === "candidate_ownership") score = ownership?.score ?? 3;
    if (dimension === "evaluation_rigor") score = hasTests ? 7 : 3;
    if (dimension === "persistence_and_iteration") {
      score = Math.min(
        8,
        (input.repositories[0]?.candidate_commits.length ?? 0) / 5 + 3
      );
    }
    if (dimension === "unusual_problem_selection") {
      score = /engine|scheduler|compiler|runtime|optimizer/i.test(
        input.repositories.map((r) => r.name).join(" ")
      )
        ? 7
        : 4;
    }
    if (dimension === "completion") score = hasCore ? 6.5 : 2;
    const useIds =
      score > 8
        ? strongIds.length
          ? strongIds.slice(0, 2)
          : evIds.slice(0, 1)
        : score > 2
          ? evIds.slice(0, 2)
          : [];
    // Cap score at 8 if no strong evidence
    if (score > 8 && strongIds.length === 0) score = 8;

    return {
      dimension,
      score: Math.round(score * 10) / 10,
      confidence: ownership?.confidence ?? 0.55,
      definition: `Assessment of ${dimension.replace(/_/g, " ")}.`,
      rationale: `Derived from collected repository artifacts (${input.repositories.map((r) => r.full_name).join(", ") || "none"}).`,
      supporting_evidence_ids: useIds,
      counterevidence: [
        {
          observation: "Live production usage and long-term maintenance were not verified.",
          effect_on_score: "Prevents maximum scores.",
        },
      ],
      missing_information: [
        "Production deployment evidence",
        "Independent review of algorithmic novelty",
      ],
    };
  });

  const result: SpecialistJudgeResult = {
    judge_type: "technical",
    prompt_version: TECHNICAL_PROMPT_VERSION,
    model: input.model ?? "deterministic-fixture",
    input_hash: "deterministic",
    summary: hasCore
      ? `Candidate shows substantive repository work across ${input.repositories.length} selected repo(s), with ownership type ${ownership?.ownership_type ?? "unclear"}.`
      : "Insufficient source artifacts to support deep technical assessment.",
    dimensions,
    strongest_evidence_ids: (strongIds.length ? strongIds : evIds).slice(0, 3),
    important_uncertainties: [
      "Production-scale usage not verified",
      "Contribution history may be incomplete",
    ],
    recommended_human_review: [
      "Inspect central source files and commit history on GitHub",
    ],
    created_at: new Date().toISOString(),
  };

  validateSpecialistJudgeResult(result, input.evidence, TECHNICAL_DIMENSIONS, {
    ownershipConfidence: ownership?.confidence ?? 0.5,
  });
  return result;
}
