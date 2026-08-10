import fs from "fs";
import path from "path";
import type { Candidate, Repo } from "../types.js";
import {
  ASSESSMENT_CANDIDATE_LIMIT,
  ASSESSMENT_CANDIDATE_CONCURRENCY,
  ASSESSMENT_REPOSITORY_LIMIT,
  ASSESSMENT_PUBLICATION_LIMIT,
  ASSESSMENT_ARTICLE_LIMIT,
  LLM_MODEL,
  LLM_PROVIDER,
  LLM_USE_MOCK,
  PRIORITY_WEIGHT_VERSION,
  PROMPT_VERSIONS,
  getDigestsDir,
} from "./config.js";
import {
  loadCandidatesFromPath,
  selectCandidatesForAssessment,
  type SelectedCandidate,
} from "./selectCandidates.js";
import {
  createAssessmentRun,
  hashFile,
  updateAssessmentRunStatus,
  writeSourceCandidates,
  writeCandidateAssessment,
  writeRunDigestFiles,
  appendRunError,
  listCandidateAssessments,
  loadAssessmentRun,
  loadCandidateAssessment,
  clearCandidateRunErrors,
  invalidateRunDigests,
  assertResumeCompatible,
  saveAssessmentRun,
  assessmentRunDir,
  isRunImmutable,
} from "./storage/assessmentRunStore.js";
import {
  assessCandidate,
  type AssessCandidateContext,
  type AssessCandidateMode,
} from "./assessCandidate.js";
import {
  ensureAssessmentCacheDirs,
  JUDGE_SCHEMA_VERSION,
  TECHNICAL_JUDGE_IMPLEMENTATION_VERSION,
} from "./storage/artifactCache.js";
import { selectRepositories } from "./github/selectRepositories.js";
import { collectRepositorySelectionMetadata } from "./github/collectRepositorySelectionMetadata.js";
import {
  collectRepositoryArtifact,
  collectRepositoryFromFixture,
  type FixtureRepoPackage,
} from "./github/collectRepositoryArtifact.js";
import {
  aggregateCandidateOwnership,
  ownershipV2ToLegacy,
} from "./github/collectOwnershipEvidence.js";
import {
  deterministicTechnicalJudgeV2,
  runTechnicalJudgeV2,
} from "./judges/technicalJudgeV2.js";
import {
  deterministicWritingJudge,
  runWritingJudge,
  type WritingArtifactInput,
} from "./judges/writingJudge.js";
import {
  deterministicCrossArtifactJudge,
  runCrossArtifactJudge,
} from "./judges/crossArtifactJudge.js";
import {
  CORY_CALIBRATION_VERSION,
  deterministicCoryRelevance,
  runCoryRelevanceJudge,
} from "./judges/coryRelevanceJudge.js";
import type { LlmJudgeClient } from "./judges/llmClient.js";
import { synthesizeCandidate } from "./scoring/synthesizeCandidate.js";
import type {
  AssessmentRunError,
  CandidateAssessmentRecord,
  CandidateArtifactCollection,
  CoryRelevanceResult,
  CrossArtifactJudgeResult,
  TechnicalJudgeResultV2,
  WritingJudgeResult,
} from "./types.js";
import { ASSESSMENT_SCHEMA_VERSION } from "./types.js";
import type { RepoSelectionMeta } from "./github/collectRepositorySelectionMetadata.js";
import { buildDigest } from "../digest/buildDigest.js";
import { loadFeedbackMap } from "../digest/feedbackStore.js";
import { renderMarkdown } from "../digest/renderMarkdown.js";
import { renderHtml } from "../digest/renderHtml.js";
import { writeJsonAtomic } from "../storage/jsonStore.js";
import { loadRubricBundle } from "./rubrics/loadRubricBundle.js";
import { rubricBundleVersionLabel } from "./rubrics/rubricCacheIdentity.js";
import type { LoadedRubricBundle } from "./rubrics/types.js";
import type { BlogFixture } from "./blog/types.js";
import {
  collectBlogArtifacts,
  collectBlogArtifactsFromFixture,
} from "./blog/collectBlogArtifacts.js";
import { extractDeterministicLinks } from "./relationships/extractDeterministicLinks.js";
import { filterValidRelationships } from "./relationships/validateRelationships.js";
import type { ArtifactRelationship } from "./relationships/types.js";
import type { ArtifactUrlRef } from "./relationships/types.js";

const COLLECTION_CONFIG_VERSION = "collection-v2-agents-wired";

export interface AssessOneContext {
  rubricBundle: LoadedRubricBundle;
  rubricBundleVersion: string;
}

export interface RunAssessmentOptions {
  inputPath: string;
  limit?: number;
  repositoryLimit?: number;
  candidateId?: string;
  candidateIds?: string[];
  seedName?: string;
  mockLlm?: boolean;
  llmClient?: LlmJudgeClient;
  fixtureReposByUser?: Record<string, FixtureRepoPackage[]>;
  /** Offline blog fixtures keyed by github username or candidate_id */
  blogFixtureByKey?: Record<string, BlogFixture>;
  /** Injected selection metadata (tests); skips network list */
  selectionDetailsByUser?: Record<string, Record<string, RepoSelectionMeta>>;
  skipDigest?: boolean;
  resumeRunId?: string;
  retryErrors?: boolean;
  forceCandidateId?: string;
  /** Optional override for tests */
  rubricBundle?: LoadedRubricBundle;
}

function logStage(
  runId: string,
  stage: string,
  extra?: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      assessment_run_id: runId,
      stage,
      status: "ok",
      ...extra,
      ts: new Date().toISOString(),
    })
  );
}

function normalizeHttpUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function websiteOrBlogUrl(selected: SelectedCandidate): string | undefined {
  const raw =
    selected.source_snapshot.website_url ||
    selected.source_snapshot.blog_url ||
    selected.identity.website_url ||
    selected.candidate.linkedin?.personal_website ||
    selected.candidate.website?.url ||
    selected.candidate.github?.blog ||
    undefined;
  if (!raw?.trim()) return undefined;
  return normalizeHttpUrl(raw);
}

function rubricById(bundle: LoadedRubricBundle, id: string) {
  return bundle.rubrics.find((r) => r.rubric_id === id);
}

function hasSubstantiveTechnical(
  technical?: TechnicalJudgeResultV2
): boolean {
  if (!technical) return false;
  if (technical.overall_technical_strength === "insufficient_public_evidence") {
    return technical.dimensions.some((d) => d.score !== null);
  }
  return true;
}

function hasSubstantiveWriting(writing?: WritingJudgeResult): boolean {
  if (!writing) return false;
  if (writing.artifact_ids.length === 0) return false;
  return writing.overall_writing_depth !== "insufficient_public_evidence";
}

function coryAbstention(): CoryRelevanceResult {
  return {
    relevance: "insufficient_evidence",
    reasons: [
      "No substantive technical or writing signal for Cory routing; abstained without LLM.",
    ],
    evidence_ids: [],
    calibration_version: CORY_CALIBRATION_VERSION,
    human_review_recommended: false,
  };
}

function articleText(article: {
  title: string;
  sections: Array<{ text: string }>;
  external_links?: string[];
}): string {
  return [
    article.title,
    ...article.sections.map((s) => s.text),
    ...(article.external_links ?? []),
  ].join("\n");
}

async function assessOne(
  runId: string,
  selected: SelectedCandidate,
  opts: RunAssessmentOptions,
  ctx: AssessOneContext
): Promise<CandidateAssessmentRecord> {
  return assessCandidate({
    runId,
    selected,
    opts,
    ctx,
    mode: "fresh",
  });
  /*
  const now = new Date().toISOString();
  const username = selected.identity.github_username;
  const siteUrl = websiteOrBlogUrl(selected);
  const artifacts: CandidateArtifactCollection = {
    references: [],
    github_repositories: {},
    blog_articles: {},
    evidence: [],
  };
  let relationships: ArtifactRelationship[] = [];

  const mockLlm = opts.mockLlm ?? LLM_USE_MOCK;
  const useLiveLlm = !mockLlm;
  const llmClient =
    opts.llmClient ?? (useLiveLlm ? new OpenAiJudgeClient() : undefined);

  try {
    // Sparse: neither GitHub nor website/blog — persist insufficient, continue (no throw)
    if (!username && !siteUrl) {
      const synthesis = synthesizeCandidate({
        name: selected.candidate.name,
        discoveryScore: selected.source_snapshot.discovery_score,
        evidenceCount: 0,
      });
      logStage(runId, "insufficient_public_evidence", {
        candidate_id: selected.candidate_id,
        reason: "no_github_or_blog",
      });
      return {
        schema_version: ASSESSMENT_SCHEMA_VERSION,
        candidate_id: selected.candidate_id,
        assessment_run_id: runId,
        source_candidate: selected.source_snapshot,
        identity: selected.identity,
        artifacts,
        judge_results: { cory: coryAbstention() },
        synthesis,
        digest_summary: {
          why_highlighted: [
            {
              claim: "Insufficient public evidence",
              rationale:
                "No GitHub identity and no website/blog URL on the input candidate record.",
              evidence_ids: [],
            },
          ],
          next_review_step:
            "Locate a public GitHub profile or writing surface before re-assessing.",
        },
        created_at: now,
        updated_at: now,
      };
    }

    logStage(runId, "identity_resolved", {
      candidate_id: selected.candidate_id,
      github: username ?? null,
      website: siteUrl ?? null,
    });

    // —— GitHub path ——
    let technical: TechnicalJudgeResultV2 | undefined;
    let ownershipAggregate = aggregateCandidateOwnership([]);
    if (username) {
      const repos: Repo[] = selected.candidate.github?.repos ?? [];
      let details = opts.selectionDetailsByUser?.[username];
      if (!details && !opts.fixtureReposByUser) {
        details = await collectRepositorySelectionMetadata(
          username,
          repos.map((r) => r.name)
        );
      }
      const picked = selectRepositories(
        { username, repos, details },
        opts.repositoryLimit ?? ASSESSMENT_REPOSITORY_LIMIT
      );
      logStage(runId, "repositories_selected", {
        candidate_id: selected.candidate_id,
        count: picked.length,
        names: picked.map((p) => p.name),
        details_passed: !!details,
      });

      const metaCache: Record<string, unknown> = {};
      if (details) {
        for (const [name, m] of Object.entries(details)) {
          if (m.raw) metaCache[`${username}/${name}`] = m.raw;
        }
      }

      for (const sel of picked) {
        let collected;
        const fixtures = opts.fixtureReposByUser?.[username];
        if (fixtures) {
          const fix = fixtures.find((f) => f.name === sel.name) ?? fixtures[0];
          if (!fix) continue;
          collected = collectRepositoryFromFixture(
            fix,
            username,
            sel.reasons.join(", ")
          );
        } else {
          collected = await collectRepositoryArtifact(
            username,
            sel.name,
            username,
            sel.reasons.join(", "),
            { metaCache }
          );
        }
        artifacts.references.push(collected.reference);
        artifacts.github_repositories[collected.reference.artifact_id] =
          collected.detail;
        artifacts.evidence.push(...collected.evidence);
        logStage(runId, "repository_collected", {
          candidate_id: selected.candidate_id,
          artifact_id: collected.reference.artifact_id,
        });
      }

      const repoDetails = Object.values(artifacts.github_repositories);
      ownershipAggregate = aggregateCandidateOwnership(
        repoDetails.map((r) => r.ownership)
      );

      if (repoDetails.length > 0) {
        const techRubric = rubricById(
          ctx.rubricBundle,
          "technical-repository-v2"
        );
        if (useLiveLlm && llmClient) {
          technical = await runTechnicalJudgeV2({
            client: llmClient,
            candidateName: selected.candidate.name,
            githubUsername: username,
            repositories: repoDetails,
            evidence: artifacts.evidence,
            rubric: techRubric,
            rubricBundleVersion: ctx.rubricBundleVersion,
          });
          logStage(runId, "technical_judged", {
            candidate_id: selected.candidate_id,
            mode: "openai_v2",
            schema: technical.schema_version,
          });
        } else {
          technical = deterministicTechnicalJudgeV2({
            evidence: artifacts.evidence,
            repositories: repoDetails,
          });
          logStage(runId, "technical_judged", {
            candidate_id: selected.candidate_id,
            mode: "deterministic_v2",
            schema: technical.schema_version,
          });
        }
      }
    }

    // —— Blog path ——
    let writing: WritingJudgeResult | undefined;
    if (siteUrl) {
      const blogKey =
        username ??
        selected.candidate_id ??
        selected.source_snapshot.key;
      const fixture = opts.blogFixtureByKey?.[blogKey];
      const blogResult = fixture
        ? collectBlogArtifactsFromFixture(fixture, {
            candidate_id: selected.candidate_id,
          })
        : await collectBlogArtifacts(siteUrl, {
            candidate_id: selected.candidate_id,
          });

      artifacts.evidence.push(...blogResult.evidence);
      for (const article of blogResult.selected) {
        artifacts.blog_articles![article.artifact_id] = article;
        artifacts.references.push({
          artifact_id: article.artifact_id,
          kind: "technical_article",
          title: article.title,
          canonical_url: article.canonical_url,
          author_identity_confidence: 0.6,
          candidate_ownership_confidence: 0.55,
          discovered_from: siteUrl,
          selected_reason: "blog_collector_selected",
          collected_at: now,
          content_hash: article.content_hash,
        });
      }
      logStage(runId, "blog_collected", {
        candidate_id: selected.candidate_id,
        selected: blogResult.selected.length,
      });

      const writingArticles: WritingArtifactInput[] = blogResult.selected.map(
        (a) => ({
          artifact_id: a.artifact_id,
          title: a.title,
          canonical_url: a.canonical_url,
          excerpt: articleText(a).slice(0, 6000),
          published_at: a.published_at,
        })
      );
      const writeRubric = rubricById(
        ctx.rubricBundle,
        "blog-intellectual-depth-v1"
      );
      if (writingArticles.length === 0) {
        writing = deterministicWritingJudge({
          articles: [],
          evidence: artifacts.evidence,
        });
      } else if (useLiveLlm && llmClient) {
        writing = await runWritingJudge({
          client: llmClient,
          candidateName: selected.candidate.name,
          articles: writingArticles,
          evidence: artifacts.evidence,
          references: artifacts.references,
          rubric: writeRubric,
          rubricBundleVersion: ctx.rubricBundleVersion,
        });
      } else {
        writing = deterministicWritingJudge({
          articles: writingArticles,
          evidence: artifacts.evidence,
        });
      }
      logStage(runId, "writing_judged", {
        candidate_id: selected.candidate_id,
        articles: writingArticles.length,
        depth: writing.overall_writing_depth,
      });
    }

    // —— Relationships (deterministic only) ——
    const repoRefs = Object.entries(artifacts.github_repositories).map(
      ([artifact_id, detail]): ArtifactUrlRef => ({
        artifact_id,
        kind: "github_repository",
        canonical_url: `https://github.com/${detail.full_name}`,
        text: detail.readme_excerpt ?? "",
      })
    );
    const articleRefs = Object.values(artifacts.blog_articles ?? {}).map(
      (a): ArtifactUrlRef => ({
        artifact_id: a.artifact_id,
        kind: "technical_article",
        canonical_url: a.canonical_url,
        text: articleText(a),
      })
    );
    if (repoRefs.length > 0 && articleRefs.length > 0) {
      const raw = extractDeterministicLinks([...repoRefs, ...articleRefs]);
      relationships = filterValidRelationships(raw, [
        ...repoRefs.map((r) => r.artifact_id),
        ...articleRefs.map((r) => r.artifact_id),
      ]);
      logStage(runId, "relationships_extracted", {
        candidate_id: selected.candidate_id,
        count: relationships.length,
      });
    }

    // —— Cross-artifact ——
    let crossArtifact: CrossArtifactJudgeResult | undefined;
    const deterministicRels = relationships.filter((r) => r.deterministic);
    if (deterministicRels.length > 0) {
      const artifactIds = [
        ...new Set([
          ...deterministicRels.map((r) => r.source_artifact_id),
          ...deterministicRels.map((r) => r.target_artifact_id),
        ]),
      ];
      const crossRubric = rubricById(
        ctx.rubricBundle,
        "cross-artifact-inquiry-v1"
      );
      if (useLiveLlm && llmClient) {
        crossArtifact = await runCrossArtifactJudge({
          client: llmClient,
          candidateName: selected.candidate.name,
          artifactIds,
          relationships: deterministicRels,
          evidence: artifacts.evidence,
          rubric: crossRubric,
          rubricBundleVersion: ctx.rubricBundleVersion,
        });
      } else {
        crossArtifact = deterministicCrossArtifactJudge({
          artifactIds,
          relationships: deterministicRels,
          evidence: artifacts.evidence,
        });
      }
      logStage(runId, "cross_artifact_judged", {
        candidate_id: selected.candidate_id,
        relationships: deterministicRels.length,
      });
    }

    // —— Cory (only with substantive technical or writing) ——
    let cory: CoryRelevanceResult;
    const substantive =
      hasSubstantiveTechnical(technical) || hasSubstantiveWriting(writing);
    if (substantive) {
      const signals = {
        technical,
        ownership: ownershipAggregate,
        writing,
        crossArtifact,
        evidenceCompleteness: Math.min(1, artifacts.evidence.length / 8),
      };
      if (useLiveLlm && llmClient) {
        cory = await runCoryRelevanceJudge({
          client: llmClient,
          signals,
          rubricBundleVersion: ctx.rubricBundleVersion,
        });
      } else {
        cory = deterministicCoryRelevance(signals);
      }
      logStage(runId, "cory_judged", {
        candidate_id: selected.candidate_id,
        relevance: cory.relevance,
      });
    } else {
      cory = coryAbstention();
      logStage(runId, "cory_abstained", {
        candidate_id: selected.candidate_id,
      });
    }

    const ownershipLegacy = ownershipAggregate
      ? ownershipV2ToLegacy(ownershipAggregate)
      : undefined;

    const synthesis = synthesizeCandidate({
      name: selected.candidate.name,
      discoveryScore: selected.source_snapshot.discovery_score,
      evidenceCount: artifacts.evidence.length,
      technical,
      ownership: ownershipAggregate,
      writing,
      crossArtifact,
      cory,
    });
    logStage(runId, "synthesis_completed", {
      candidate_id: selected.candidate_id,
      priority_score: synthesis.priority_score,
    });

    return {
      schema_version: ASSESSMENT_SCHEMA_VERSION,
      candidate_id: selected.candidate_id,
      assessment_run_id: runId,
      source_candidate: selected.source_snapshot,
      identity: selected.identity,
      artifacts,
      ownership: ownershipAggregate,
      relationships: relationships.length ? relationships : undefined,
      judge_results: {
        technical,
        writing,
        cross_artifact: crossArtifact,
        cory,
      },
      synthesis,
      digest_summary: {
        why_highlighted: [
          {
            claim: synthesis.primary_strength,
            rationale: synthesis.overall_rationale.slice(0, 500),
            evidence_ids: synthesis.strongest_evidence_ids.slice(0, 3),
          },
          {
            claim: `Archetype: ${synthesis.archetype}`,
            rationale: synthesis.reason_to_review,
            evidence_ids: synthesis.strongest_evidence_ids.slice(0, 2),
          },
          {
            claim: "Ownership assessed separately from repository quality",
            rationale:
              ownershipLegacy?.rationale ??
              ownershipAggregate?.summary ??
              "Ownership unclear.",
            evidence_ids:
              ownershipAggregate?.supporting_evidence_ids ??
              ownershipLegacy?.evidence_ids ??
              [],
          },
        ],
        next_review_step: synthesis.reason_to_review,
      },
      created_at: now,
      updated_at: now,
    };
  } catch (err) {
    const code =
      (err as { code?: string }).code ??
      (err instanceof Error && err.message.includes("rate limit")
        ? "GITHUB_RATE_LIMIT"
        : "ASSESSMENT_FAILED");
    const error: AssessmentRunError = {
      code,
      message: err instanceof Error ? err.message : String(err),
      retryable: code === "GITHUB_RATE_LIMIT",
      candidate_id: selected.candidate_id,
      stage: "assess_candidate",
      at: new Date().toISOString(),
    };
    appendRunError(runId, error);

    const synthesis = synthesizeCandidate({
      name: selected.candidate.name,
      discoveryScore: selected.source_snapshot.discovery_score,
      evidenceCount: artifacts.evidence.length,
    });

    return {
      schema_version: ASSESSMENT_SCHEMA_VERSION,
      candidate_id: selected.candidate_id,
      assessment_run_id: runId,
      source_candidate: selected.source_snapshot,
      identity: selected.identity,
      artifacts,
      relationships: relationships.length ? relationships : undefined,
      judge_results: {},
      synthesis,
      digest_summary: {
        why_highlighted: [
          {
            claim: "Assessment incomplete",
            rationale: error.message,
            evidence_ids: [],
          },
        ],
        next_review_step: "Retry assessment after resolving the error.",
      },
      created_at: now,
      updated_at: now,
      error,
    };
  }
  */
}

function shouldAssessCandidate(
  runId: string,
  candidateId: string,
  opts: RunAssessmentOptions
): boolean {
  if (opts.forceCandidateId === candidateId) return true;
  const existing = loadCandidateAssessment(runId, candidateId);
  if (!existing) return true;
  if (
    opts.retryErrors &&
    (existing.error ||
      existing.errors?.length ||
      existing.status === "partial" ||
      existing.status === "failed" ||
      Object.values(existing.judge_statuses ?? {}).some(
        (judge) => judge.status === "failed"
      ))
  ) {
    return true;
  }
  return false;
}

function loadSnapshotCandidates(runId: string): Candidate[] {
  const sourcePath = path.join(
    assessmentRunDir(runId),
    "source-candidates.json"
  );
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source-candidates.json for run ${runId}`);
  }
  return loadCandidatesFromPath(sourcePath);
}

export async function runAssessment(
  opts: RunAssessmentOptions
): Promise<{ runId: string }> {
  ensureAssessmentCacheDirs();
  const inputPath = path.resolve(opts.inputPath);
  if (!fs.existsSync(inputPath) && !opts.resumeRunId) {
    throw new Error(`Candidates file not found: ${inputPath}`);
  }

  const mockLlm = opts.mockLlm ?? LLM_USE_MOCK;
  const limit = opts.limit ?? ASSESSMENT_CANDIDATE_LIMIT;
  const repositoryLimit = opts.repositoryLimit ?? ASSESSMENT_REPOSITORY_LIMIT;

  const rubricBundle = opts.rubricBundle ?? loadRubricBundle();
  const rubricBundleVersion = rubricBundleVersionLabel(rubricBundle);
  const assessCtx: AssessCandidateContext = { rubricBundle, rubricBundleVersion };

  let runId: string;
  let selected: SelectedCandidate[];

  if (opts.resumeRunId) {
    const existing = loadAssessmentRun(opts.resumeRunId);
    if (!existing) throw new Error(`Run not found: ${opts.resumeRunId}`);
    if (isRunImmutable(existing.status)) {
      throw new Error(`Completed run ${opts.resumeRunId} is immutable`);
    }

    // Resume exclusively from snapshot — never reread mutable input/backup
    const snapshotCandidates = loadSnapshotCandidates(opts.resumeRunId);
    selected = selectCandidatesForAssessment(snapshotCandidates, {
      limit: existing.config.candidate_limit,
      candidateId: opts.candidateId,
      candidateIds: opts.candidateIds,
      seedName: opts.seedName,
    }).filter((s) => existing.candidate_ids.includes(s.candidate_id));

    // Preserve stored order; fill any missing from snapshot by id
    if (selected.length < existing.candidate_ids.length) {
      const byId = new Map(selected.map((s) => [s.candidate_id, s]));
      const allSelected = selectCandidatesForAssessment(snapshotCandidates, {
        limit: snapshotCandidates.length,
      });
      for (const s of allSelected) {
        if (
          existing.candidate_ids.includes(s.candidate_id) &&
          !byId.has(s.candidate_id)
        ) {
          byId.set(s.candidate_id, s);
        }
      }
      selected = existing.candidate_ids
        .map((id) => byId.get(id))
        .filter((x): x is SelectedCandidate => !!x);
    }

    assertResumeCompatible(existing, {
      schema_version: existing.schema_version,
      source_candidates_hash: existing.source.source_candidates_hash,
      candidates_file_hash: existing.source.candidates_file_hash,
      candidate_ids: existing.candidate_ids,
      prompt_versions: existing.config.prompt_versions,
      weight_version: existing.config.weight_version,
      judge_schema_version: existing.config.judge_schema_version,
      rubric_bundle_version: existing.config.rubric_bundle_version,
      judge_implementation_version: existing.config.judge_implementation_version,
      model: existing.config.model,
      mock_llm: existing.config.mock_llm,
      candidate_limit: existing.config.candidate_limit,
      repository_limit: existing.config.repository_limit,
      collection_config_version: existing.config.collection_config_version,
    });

    if (opts.forceCandidateId || opts.retryErrors) {
      invalidateRunDigests(opts.resumeRunId);
      if (opts.forceCandidateId) {
        clearCandidateRunErrors(opts.resumeRunId, opts.forceCandidateId);
      }
    }

    updateAssessmentRunStatus(opts.resumeRunId, "judging");
    runId = opts.resumeRunId;
  } else {
    // Load once from input, snapshot exact records, then select from memory
    const allCandidates = loadCandidatesFromPath(inputPath);
    selected = selectCandidatesForAssessment(allCandidates, {
      limit,
      candidateId: opts.candidateId,
      candidateIds: opts.candidateIds,
      seedName: opts.seedName,
    });

    const run = createAssessmentRun({
      source: {
        candidates_path: inputPath,
        candidates_file_hash: hashFile(inputPath),
      },
      config: {
        candidate_limit: limit,
        repository_limit: repositoryLimit,
        publication_limit: ASSESSMENT_PUBLICATION_LIMIT,
        article_limit: ASSESSMENT_ARTICLE_LIMIT,
        model: mockLlm ? "mock/deterministic" : LLM_MODEL,
        llm_provider: mockLlm ? "mock" : LLM_PROVIDER,
        prompt_versions: { ...PROMPT_VERSIONS },
        weight_version: PRIORITY_WEIGHT_VERSION,
        mock_llm: mockLlm,
        judge_schema_version: JUDGE_SCHEMA_VERSION,
        rubric_bundle_version: rubricBundleVersion,
        judge_implementation_version: TECHNICAL_JUDGE_IMPLEMENTATION_VERSION,
        collection_config_version: COLLECTION_CONFIG_VERSION,
      },
      candidate_ids: selected.map((s) => s.candidate_id),
    });

    // Persist exact input candidate records (full Candidate objects)
    const sourceHash = writeSourceCandidates(run.id, allCandidates);
    const loaded = loadAssessmentRun(run.id)!;
    loaded.source.source_candidates_hash = sourceHash;
    saveAssessmentRun(loaded);

    updateAssessmentRunStatus(run.id, "collecting");
    runId = run.id;
  }

  const runMeta = loadAssessmentRun(runId)!;
  const orderedIds = runMeta.candidate_ids;
  const byId = new Map(selected.map((s) => [s.candidate_id, s]));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((x): x is SelectedCandidate => !!x);

  const selectedIdsAtStart = new Set(ordered.map((s) => s.candidate_id));

  const work = ordered.filter((s) => {
    if (!shouldAssessCandidate(runId, s.candidate_id, opts)) {
      logStage(runId, "candidate_skipped", { candidate_id: s.candidate_id });
      return false;
    }
    return true;
  });

  if (work.length) {
    updateAssessmentRunStatus(runId, "judging");
    logStage(runId, "candidate_pool_start", {
      count: work.length,
      concurrency: ASSESSMENT_CANDIDATE_CONCURRENCY,
    });

    let nextWork = 0;
    const workers = Array.from(
      {
        length: Math.min(ASSESSMENT_CANDIDATE_CONCURRENCY, work.length),
      },
      async () => {
        while (true) {
          const i = nextWork++;
          if (i >= work.length) return;
          const s = work[i]!;
          if (opts.forceCandidateId === s.candidate_id) {
            clearCandidateRunErrors(runId, s.candidate_id);
          }
          logStage(runId, "candidate_selected", {
            candidate_id: s.candidate_id,
            name: s.candidate.name,
          });
          const prior = loadCandidateAssessment(runId, s.candidate_id);
          const mode: AssessCandidateMode =
            opts.forceCandidateId === s.candidate_id
              ? "force_full"
              : opts.retryErrors
                ? "retry_errors"
                : "fresh";
          await assessCandidate({
            runId,
            selected: s,
            opts: { ...opts, mockLlm },
            ctx: assessCtx,
            prior,
            mode,
          });
        }
      }
    );
    await Promise.all(workers);
  }

  // Discovery boundary: never grow candidate set during assessment
  const afterIds = new Set(loadAssessmentRun(runId)!.candidate_ids);
  if (
    afterIds.size !== selectedIdsAtStart.size ||
    [...afterIds].some((id) => !selectedIdsAtStart.has(id))
  ) {
    throw new Error(
      "Discovery boundary violated: candidate_ids changed during assessment"
    );
  }

  if (!opts.skipDigest) {
    updateAssessmentRunStatus(runId, "rendering");
    const digestId = await renderDigestForRun(runId);
    const run = loadAssessmentRun(runId)!;
    run.digest_id = digestId;
    saveAssessmentRun(run);
    logStage(runId, "digest_rendered", { digest_id: digestId });
  }

  const assessments = listCandidateAssessments(runId);
  const hasErrors =
    loadAssessmentRun(runId)!.errors.length > 0 ||
    assessments.some(
      (assessment) =>
        assessment.status === "partial" || assessment.status === "failed"
    );
  updateAssessmentRunStatus(
    runId,
    hasErrors ? "completed_with_errors" : "completed"
  );
  return { runId };
}

export async function renderDigestForRun(
  runId: string,
  discoveredCount?: number
): Promise<string> {
  const run = loadAssessmentRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const assessments = listCandidateAssessments(runId);
  let discovered = discoveredCount;
  if (discovered === undefined) {
    discovered = assessments.length;
  }

  const digest = buildDigest({
    run,
    assessments,
    discoveredCandidateCount: discovered ?? assessments.length,
    feedback: loadFeedbackMap(),
  });
  const md = renderMarkdown(digest);
  const html = renderHtml(digest);
  writeRunDigestFiles(runId, digest, md, html);

  const digestsDir = getDigestsDir();
  fs.mkdirSync(digestsDir, { recursive: true });
  writeJsonAtomic(path.join(digestsDir, `${digest.digest_id}.json`), digest);
  fs.writeFileSync(
    path.join(digestsDir, `${digest.digest_id}.md`),
    md,
    "utf-8"
  );
  fs.writeFileSync(
    path.join(digestsDir, `${digest.digest_id}.html`),
    html,
    "utf-8"
  );
  return digest.digest_id;
}

export type { Candidate };
