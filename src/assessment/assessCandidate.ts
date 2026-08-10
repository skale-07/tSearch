import type { Repo } from "../types.js";
import { buildCoryBrief } from "../digest/buildCoryBrief.js";
import {
  ASSESSMENT_REPOSITORY_LIMIT,
  ASSESSMENT_REPO_FETCH_CONCURRENCY,
  LLM_USE_MOCK,
} from "./config.js";
import type { SelectedCandidate } from "./selectCandidates.js";
import type { RunAssessmentOptions } from "./runAssessment.js";
import {
  aggregateCandidateOwnership,
} from "./github/collectOwnershipEvidence.js";
import { selectRepositories } from "./github/selectRepositories.js";
import { collectRepositorySelectionMetadata } from "./github/collectRepositorySelectionMetadata.js";
import {
  collectRepositoryArtifact,
  collectRepositoryFromFixture,
} from "./github/collectRepositoryArtifact.js";
import {
  collectBlogArtifacts,
  collectBlogArtifactsFromFixture,
} from "./blog/collectBlogArtifacts.js";
import { deterministicTechnicalJudgeV2, runTechnicalJudgeV2 } from "./judges/technicalJudgeV2.js";
import { deterministicWritingJudge, runWritingJudge, type WritingArtifactInput } from "./judges/writingJudge.js";
import { deterministicCrossArtifactJudge, runCrossArtifactJudge } from "./judges/crossArtifactJudge.js";
import { CORY_CALIBRATION_VERSION, deterministicCoryRelevance, runCoryRelevanceJudge } from "./judges/coryRelevanceJudge.js";
import { createLlmJudgeClient } from "./judges/llmClient.js";
import { extractDeterministicLinks } from "./relationships/extractDeterministicLinks.js";
import { filterValidRelationships } from "./relationships/validateRelationships.js";
import type { ArtifactRelationship, ArtifactUrlRef } from "./relationships/types.js";
import { synthesizeCandidate } from "./scoring/synthesizeCandidate.js";
import { writeCandidateAssessment } from "./storage/assessmentRunStore.js";
import {
  deriveTerminalCandidateStatus,
  humanHighlightForJudgeFailure,
  initialJudgeStatuses,
  initialSynthesisState,
  makeAssessmentError,
  markJudgeRunning,
  markJudgeTerminal,
  splitJudgeError,
  synthesisCompleted,
} from "./assessmentState.js";
import {
  ASSESSMENT_SCHEMA_VERSION,
  type AssessmentError,
  type CandidateArtifactCollection,
  type CandidateAssessmentRecord,
  type CandidateJudgeResults,
  type CoryRelevanceResult,
  type CrossArtifactJudgeResult,
  type TechnicalJudgeResultV2,
  type WritingJudgeResult,
} from "./types.js";
import type { LoadedRubricBundle } from "./rubrics/types.js";

export type AssessCandidateMode = "fresh" | "retry_errors" | "force_full";
export interface AssessCandidateContext {
  rubricBundle: LoadedRubricBundle;
  rubricBundleVersion: string;
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function websiteOrBlogUrl(selected: SelectedCandidate): string | undefined {
  const raw =
    selected.source_snapshot.website_url ||
    selected.source_snapshot.blog_url ||
    selected.identity.website_url ||
    selected.candidate.linkedin?.personal_website ||
    selected.candidate.website?.url ||
    selected.candidate.github?.blog;
  return raw?.trim() ? normalizeHttpUrl(raw) : undefined;
}

function rubricById(bundle: LoadedRubricBundle, id: string) {
  return bundle.rubrics.find((rubric) => rubric.rubric_id === id);
}

function articleText(article: { title: string; sections: Array<{ text: string }>; external_links?: string[] }): string {
  return [article.title, ...article.sections.map((section) => section.text), ...(article.external_links ?? [])].join("\n");
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!, i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function hasSubstantiveTechnical(technical?: TechnicalJudgeResultV2): boolean {
  return !!technical &&
    (technical.overall_technical_strength !== "insufficient_public_evidence" ||
      technical.dimensions.some((dimension) => dimension.score !== null));
}

function hasSubstantiveWriting(writing?: WritingJudgeResult): boolean {
  return !!writing && writing.artifact_ids.length > 0 &&
    writing.overall_writing_depth !== "insufficient_public_evidence";
}

function coryAbstention(): CoryRelevanceResult {
  return {
    relevance: "insufficient_evidence",
    reasons: ["No substantive technical or writing signal for Cory routing; abstained without LLM."],
    evidence_ids: [],
    calibration_version: CORY_CALIBRATION_VERSION,
    human_review_recommended: false,
  };
}

function initialRecord(runId: string, selected: SelectedCandidate, hasGithub: boolean, hasWritingSurface: boolean): CandidateAssessmentRecord {
  const now = new Date().toISOString();
  const artifacts: CandidateArtifactCollection = { references: [], github_repositories: {}, blog_articles: {}, evidence: [] };
  const synthesis = synthesizeCandidate({
    name: selected.candidate.name,
    discoveryScore: selected.source_snapshot.discovery_score,
    evidenceCount: 0,
  });
  return {
    schema_version: ASSESSMENT_SCHEMA_VERSION,
    candidate_id: selected.candidate_id,
    assessment_run_id: runId,
    source_candidate: selected.source_snapshot,
    identity: selected.identity,
    artifacts,
    judge_results: {},
    judge_statuses: initialJudgeStatuses({ hasGithub, hasWritingSurface }),
    synthesis,
    synthesis_state: initialSynthesisState(),
    status: "running",
    pipeline_stage: "collecting",
    digest_summary: { why_highlighted: [], next_review_step: "Assessment in progress." },
    created_at: now,
    updated_at: now,
    revision: 0,
  };
}

export async function assessCandidate(input: {
  runId: string;
  selected: SelectedCandidate;
  opts: RunAssessmentOptions;
  ctx: AssessCandidateContext;
  prior?: CandidateAssessmentRecord | null;
  mode: AssessCandidateMode;
}): Promise<CandidateAssessmentRecord> {
  const { runId, selected, opts, ctx, prior, mode } = input;
  const username = selected.identity.github_username;
  const siteUrl = websiteOrBlogUrl(selected);
  const reusing = mode === "retry_errors" && prior;
  const record = reusing
    ? {
        ...prior,
        status: "running" as const,
        pipeline_stage: "collecting" as const,
        artifacts: prior.artifacts,
        judge_results: { ...prior.judge_results },
        judge_statuses: { ...prior.judge_statuses },
        errors: [...(prior.errors ?? [])],
      }
    : initialRecord(runId, selected, !!username, !!siteUrl);
  const checkpoint = () => writeCandidateAssessment(runId, record);
  const addError = (stage: AssessmentError["stage"], err: unknown, judge?: AssessmentError["judge"]) => {
    const parsed = splitJudgeError(err);
    const error = makeAssessmentError({
      ...parsed,
      stage,
      judge,
      retryable: parsed.code === "GITHUB_RATE_LIMIT",
      candidate_id: selected.candidate_id,
      attempt_count: judge ? record.judge_statuses[judge].attempt_count : undefined,
    });
    record.errors = [...(record.errors ?? []), error];
    return error;
  };
  const clearJudgeErrors = (judge: NonNullable<AssessmentError["judge"]>) => {
    record.errors = (record.errors ?? []).filter((error) => error.judge !== judge);
  };

  if (!username && !siteUrl) {
    const cory = coryAbstention();
    record.judge_results = { ...record.judge_results, cory };
    record.judge_statuses.cory = markJudgeTerminal(record.judge_statuses.cory, "abstained");
    record.synthesis = synthesizeCandidate({ name: selected.candidate.name, discoveryScore: selected.source_snapshot.discovery_score, evidenceCount: 0, cory });
    record.synthesis_state = synthesisCompleted({ valid_for_ranking: false, fallback_used: true });
    record.status = "insufficient_context";
    record.pipeline_stage = "done";
    record.digest_summary = {
      why_highlighted: [{ claim: "Insufficient public evidence", rationale: "No GitHub identity and no website/blog URL on the input candidate record.", evidence_ids: [] }],
      next_review_step: "Locate a public GitHub profile or writing surface before re-assessing.",
    };
    checkpoint();
    return record;
  }

  const mockLlm = opts.mockLlm ?? LLM_USE_MOCK;
  const llmClient =
    opts.llmClient ?? (!mockLlm ? createLlmJudgeClient() : undefined);
  let relationships: ArtifactRelationship[] = record.relationships ?? [];

  if (!reusing) {
    record.artifacts = { references: [], github_repositories: {}, blog_articles: {}, evidence: [] };
    record.judge_results = {};
    record.judge_statuses = initialJudgeStatuses({ hasGithub: !!username, hasWritingSurface: !!siteUrl });
    record.errors = [];
  }

  const collectGithub = async () => {
    if (!username || reusing) return;
    try {
      const repos: Repo[] = selected.candidate.github?.repos ?? [];
      let details = opts.selectionDetailsByUser?.[username];
      if (!details && !opts.fixtureReposByUser) {
        details = await collectRepositorySelectionMetadata(
          username,
          repos.map((repo) => repo.name)
        );
      }
      const picked = selectRepositories(
        { username, repos, details },
        opts.repositoryLimit ?? ASSESSMENT_REPOSITORY_LIMIT
      );
      const metaCache: Record<string, unknown> = {};
      for (const [name, metadata] of Object.entries(details ?? {})) {
        if (metadata.raw) metaCache[`${username}/${name}`] = metadata.raw;
      }
      const collectedList = await mapPool(
        picked,
        ASSESSMENT_REPO_FETCH_CONCURRENCY,
        async (selection) => {
          const fixtures = opts.fixtureReposByUser?.[username];
          const fixture =
            fixtures?.find((item) => item.name === selection.name) ?? fixtures?.[0];
          return fixture
            ? collectRepositoryFromFixture(
                fixture,
                username,
                selection.reasons.join(", ")
              )
            : collectRepositoryArtifact(
                username,
                selection.name,
                username,
                selection.reasons.join(", "),
                { metaCache }
              );
        }
      );
      for (const collected of collectedList) {
        record.artifacts.references.push(collected.reference);
        record.artifacts.github_repositories[collected.reference.artifact_id] =
          collected.detail;
        record.artifacts.evidence.push(...collected.evidence);
      }
    } catch (err) {
      addError("collecting", err);
    }
  };

  const collectBlog = async () => {
    if (!siteUrl || reusing) return;
    try {
      const key =
        username ?? selected.candidate_id ?? selected.source_snapshot.key;
      const result = opts.blogFixtureByKey?.[key]
        ? collectBlogArtifactsFromFixture(opts.blogFixtureByKey[key]!, {
            candidate_id: selected.candidate_id,
          })
        : await collectBlogArtifacts(siteUrl, {
            candidate_id: selected.candidate_id,
          });
      record.artifacts.evidence.push(...result.evidence);
      for (const article of result.selected) {
        record.artifacts.blog_articles![article.artifact_id] = article;
        record.artifacts.references.push({
          artifact_id: article.artifact_id,
          kind: "technical_article",
          title: article.title,
          canonical_url: article.canonical_url,
          author_identity_confidence: 0.6,
          candidate_ownership_confidence: 0.55,
          discovered_from: siteUrl,
          selected_reason: "blog_collector_selected",
          collected_at: new Date().toISOString(),
          content_hash: article.content_hash,
        });
      }
    } catch (err) {
      addError("collecting", err);
    }
  };

  // GitHub + blog collection are independent — run together
  await Promise.all([collectGithub(), collectBlog()]);
  checkpoint();

  const shouldRun = (judge: keyof typeof record.judge_statuses) =>
    mode !== "retry_errors" ||
    ["failed", "pending"].includes(record.judge_statuses[judge].status);
  const repoDetails = Object.values(record.artifacts.github_repositories);
  let ownership = repoDetails.length
    ? aggregateCandidateOwnership(repoDetails.map((repo) => repo.ownership))
    : undefined;

  const willRunTechnical = !!(repoDetails.length && shouldRun("technical"));
  const willRunWriting = !!(siteUrl && shouldRun("writing"));
  if (willRunTechnical || willRunWriting) {
    // Mark both running, then one checkpoint — avoid concurrent writes while
    // technical/writing mutate the same in-memory record.
    if (willRunTechnical) {
      record.pipeline_stage = "judging_technical";
      record.judge_statuses.technical = markJudgeRunning(
        record.judge_statuses.technical
      );
    }
    if (willRunWriting) {
      if (!willRunTechnical) record.pipeline_stage = "judging_writing";
      record.judge_statuses.writing = markJudgeRunning(
        record.judge_statuses.writing
      );
    }
    checkpoint();
  }

  const runTechnical = async () => {
    if (!willRunTechnical) return;
    try {
      const rubric = rubricById(ctx.rubricBundle, "technical-repository-v2");
      const technical =
        !mockLlm && llmClient
          ? await runTechnicalJudgeV2({
              client: llmClient,
              candidateName: selected.candidate.name,
              githubUsername: username!,
              repositories: repoDetails,
              evidence: record.artifacts.evidence,
              rubric,
              rubricBundleVersion: ctx.rubricBundleVersion,
            })
          : deterministicTechnicalJudgeV2({
              evidence: record.artifacts.evidence,
              repositories: repoDetails,
            });
      record.judge_results.technical = technical;
      record.judge_statuses.technical = markJudgeTerminal(
        record.judge_statuses.technical,
        "completed"
      );
      clearJudgeErrors("technical");
    } catch (err) {
      const error = addError("technical", err, "technical");
      record.judge_statuses.technical = markJudgeTerminal(
        record.judge_statuses.technical,
        "failed",
        error.id
      );
    }
  };

  const runWriting = async () => {
    if (!willRunWriting) return;
    try {
      const articles: WritingArtifactInput[] = Object.values(
        record.artifacts.blog_articles ?? {}
      ).map((article) => ({
        artifact_id: article.artifact_id,
        title: article.title,
        canonical_url: article.canonical_url,
        excerpt: articleText(article).slice(0, 6000),
        published_at: article.published_at,
      }));
      const writing = !articles.length
        ? deterministicWritingJudge({
            articles,
            evidence: record.artifacts.evidence,
          })
        : !mockLlm && llmClient
          ? await runWritingJudge({
              client: llmClient,
              candidateName: selected.candidate.name,
              articles,
              evidence: record.artifacts.evidence,
              references: record.artifacts.references,
              rubric: rubricById(ctx.rubricBundle, "blog-intellectual-depth-v1"),
              rubricBundleVersion: ctx.rubricBundleVersion,
            })
          : deterministicWritingJudge({
              articles,
              evidence: record.artifacts.evidence,
            });
      record.judge_results.writing = writing;
      record.judge_statuses.writing = markJudgeTerminal(
        record.judge_statuses.writing,
        "completed"
      );
      clearJudgeErrors("writing");
    } catch (err) {
      const error = addError("writing", err, "writing");
      record.judge_statuses.writing = markJudgeTerminal(
        record.judge_statuses.writing,
        "failed",
        error.id
      );
    }
  };

  // Technical and writing judges do not depend on each other
  await Promise.all([runTechnical(), runWriting()]);
  if (willRunTechnical || willRunWriting) checkpoint();

  if (shouldRun("cross_artifact")) {
    record.pipeline_stage = "linking_artifacts";
    try {
      const repos: ArtifactUrlRef[] = Object.entries(record.artifacts.github_repositories).map(([artifact_id, detail]) => ({ artifact_id, kind: "github_repository", canonical_url: `https://github.com/${detail.full_name}`, text: detail.readme_excerpt ?? "" }));
      const articles: ArtifactUrlRef[] = Object.values(record.artifacts.blog_articles ?? {}).map((article) => ({ artifact_id: article.artifact_id, kind: "technical_article", canonical_url: article.canonical_url, text: articleText(article) }));
      relationships = repos.length && articles.length ? filterValidRelationships(extractDeterministicLinks([...repos, ...articles]), [...repos, ...articles].map((ref) => ref.artifact_id)) : [];
      record.relationships = relationships.length ? relationships : undefined;
    } catch (err) {
      addError("relationships", err, "cross_artifact");
    }
    checkpoint();
    const deterministic = relationships.filter((relationship) => relationship.deterministic);
    if (deterministic.length) {
      record.pipeline_stage = "judging_cross_artifact";
      record.judge_statuses.cross_artifact = markJudgeRunning(record.judge_statuses.cross_artifact);
      checkpoint();
      try {
        const artifactIds = [...new Set(deterministic.flatMap((relationship) => [relationship.source_artifact_id, relationship.target_artifact_id]))];
        const crossArtifact = !mockLlm && llmClient
          ? await runCrossArtifactJudge({ client: llmClient, candidateName: selected.candidate.name, artifactIds, relationships: deterministic, evidence: record.artifacts.evidence, rubric: rubricById(ctx.rubricBundle, "cross-artifact-inquiry-v1"), rubricBundleVersion: ctx.rubricBundleVersion })
          : deterministicCrossArtifactJudge({ artifactIds, relationships: deterministic, evidence: record.artifacts.evidence });
        record.judge_results.cross_artifact = crossArtifact;
        record.judge_statuses.cross_artifact = markJudgeTerminal(record.judge_statuses.cross_artifact, "completed");
        clearJudgeErrors("cross_artifact");
      } catch (err) {
        const error = addError("cross_artifact", err, "cross_artifact");
        record.judge_statuses.cross_artifact = markJudgeTerminal(record.judge_statuses.cross_artifact, "failed", error.id);
      }
    } else {
      record.judge_statuses.cross_artifact = markJudgeTerminal(record.judge_statuses.cross_artifact, "not_applicable");
    }
    checkpoint();
  }

  if (shouldRun("cory")) {
    record.pipeline_stage = "judging_cory";
    const technical = record.judge_results.technical;
    const writing = record.judge_results.writing;
    if (hasSubstantiveTechnical(technical) || hasSubstantiveWriting(writing)) {
      record.judge_statuses.cory = markJudgeRunning(record.judge_statuses.cory);
      checkpoint();
      try {
        const signals = { technical, ownership, writing, crossArtifact: record.judge_results.cross_artifact, evidenceCompleteness: Math.min(1, record.artifacts.evidence.length / 8) };
        const cory = !mockLlm && llmClient
          ? await runCoryRelevanceJudge({ client: llmClient, signals, rubricBundleVersion: ctx.rubricBundleVersion })
          : deterministicCoryRelevance(signals);
        record.judge_results.cory = cory;
        record.judge_statuses.cory = markJudgeTerminal(record.judge_statuses.cory, "completed");
        clearJudgeErrors("cory");
      } catch (err) {
        const error = addError("cory", err, "cory");
        record.judge_statuses.cory = markJudgeTerminal(record.judge_statuses.cory, "failed", error.id);
      }
    } else {
      record.judge_results.cory = coryAbstention();
      record.judge_statuses.cory = markJudgeTerminal(record.judge_statuses.cory, "abstained");
    }
    checkpoint();
  }

  record.pipeline_stage = "synthesizing";
  checkpoint();
  const specialists = ["technical", "writing", "cross_artifact"] as const;
  const completedSpecialists = specialists.filter((judge) => record.judge_statuses[judge].status === "completed");
  const anyFailed = Object.values(record.judge_statuses).some((judge) => judge.status === "failed");
  const fallbackOnly = completedSpecialists.length === 0;
  record.ownership = ownership;
  record.synthesis = synthesizeCandidate({
    name: selected.candidate.name,
    discoveryScore: selected.source_snapshot.discovery_score,
    evidenceCount: record.artifacts.evidence.length,
    technical: record.judge_results.technical,
    ownership,
    writing: record.judge_results.writing,
    crossArtifact: record.judge_results.cross_artifact,
    cory: record.judge_results.cory,
  });
  record.synthesis_state = synthesisCompleted({
    valid_for_ranking: !fallbackOnly,
    fallback_used: anyFailed || fallbackOnly,
    partial: anyFailed,
  });
  record.status = deriveTerminalCandidateStatus({ errors: record.errors ?? [], judge_statuses: record.judge_statuses });
  record.pipeline_stage = "done";
  const failedJudge = (["technical", "writing", "cross_artifact", "cory"] as const).find((judge) => record.judge_statuses[judge].status === "failed");
  if (failedJudge) {
    record.digest_summary = {
      why_highlighted: [
        {
          claim: humanHighlightForJudgeFailure(failedJudge),
          rationale:
            "Other completed signals were retained; retry this judge to refresh the assessment.",
          evidence_ids: [],
        },
      ],
      next_review_step: "Retry the failed judge after resolving its error.",
    };
  } else {
    const brief = buildCoryBrief(record);
    record.digest_summary = {
      why_highlighted: [
        {
          claim: brief.claim,
          rationale: brief.rationale,
          evidence_ids: brief.evidence_ids,
        },
      ],
      next_review_step: record.synthesis.reason_to_review,
    };
  }
  checkpoint();
  return record;
}
