import fs from "fs";
import path from "path";
import {
  ASSESSMENT_ARTICLE_LIMIT,
  ASSESSMENT_PUBLICATION_LIMIT,
  ASSESSMENT_REPOSITORY_LIMIT,
  LLM_MODEL,
  PRIORITY_WEIGHT_VERSION,
  PROMPT_VERSIONS,
} from "../src/assessment/config.js";
import {
  githubUsernameFromCandidate,
  identityFromCandidate,
} from "../src/assessment/candidateIdentity.js";
import {
  isTerminalRunStatus,
  normalizeRunStatus,
} from "../src/assessment/assessmentState.js";
import { loadCandidatesFromPath } from "../src/assessment/selectCandidates.js";
import {
  assessmentRunDir,
  createAssessmentRun,
  hashFile,
  listCandidateAssessments,
  listNonterminalRuns,
  loadAssessmentRun,
  loadCandidateAssessment,
  writeSourceCandidates,
  saveAssessmentRun,
  updateAssessmentRunStatus,
} from "../src/assessment/storage/assessmentRunStore.js";
import {
  ensureAssessmentCacheDirs,
  JUDGE_SCHEMA_VERSION,
  TECHNICAL_JUDGE_IMPLEMENTATION_VERSION,
} from "../src/assessment/storage/artifactCache.js";
import { loadRubricBundle } from "../src/assessment/rubrics/loadRubricBundle.js";
import { rubricBundleVersionLabel } from "../src/assessment/rubrics/rubricCacheIdentity.js";
import type {
  AssessmentError,
  AssessmentRun,
  AssessmentRunStatus,
  CandidateAssessmentRecord,
  CandidateAssessmentStatus,
  CandidateAssessmentStage,
  JudgeExecutionState,
  SynthesisExecutionState,
} from "../src/assessment/types.js";
import type { Candidate } from "../src/types.js";
import { OUTPUT_PATH } from "../src/config.js";

const COLLECTION_CONFIG_VERSION = "collection-v2-agents-wired";

export function candidateEligibility(c: Candidate): {
  eligible: boolean;
  reason?: string;
  github_username?: string;
  website_url?: string;
  blog_url?: string;
  github_path_available: boolean;
  writing_path_available: boolean;
} {
  const github_username = githubUsernameFromCandidate(c);
  const website_url =
    c.linkedin?.personal_website ?? c.website?.url ?? undefined;
  const blog_url = c.github?.blog ?? c.substack?.url ?? undefined;
  const github_path_available = Boolean(github_username);
  const writing_path_available = Boolean(blog_url || website_url);
  if (github_path_available || writing_path_available) {
    return {
      eligible: true,
      github_username,
      website_url,
      blog_url,
      github_path_available,
      writing_path_available,
    };
  }
  return {
    eligible: false,
    reason: "No GitHub or website",
    github_username,
    website_url,
    blog_url,
    github_path_available: false,
    writing_path_available: false,
  };
}

export interface PrepareAssessmentRunInput {
  candidate_ids: string[];
  mock_llm?: boolean;
  skip_digest?: boolean;
  inputPath?: string;
}

export interface PrepareAssessmentRunResult {
  run_id: string;
  status: "queued";
  requested_count: number;
  eligible_count: number;
  skipped_count: number;
  skipped_candidates: Array<{ candidate_id: string; reason: string }>;
  mock_llm: boolean;
  skip_digest: boolean;
}

export function prepareAssessmentRun(
  input: PrepareAssessmentRunInput
): PrepareAssessmentRunResult | { error: string; status: number } {
  const inputPath = path.resolve(input.inputPath ?? OUTPUT_PATH);
  if (!fs.existsSync(inputPath)) {
    return {
      error: `Candidates file not found at ${inputPath}. Run discovery first.`,
      status: 404,
    };
  }

  const requested = [...new Set(input.candidate_ids.map((s) => s.trim()).filter(Boolean))];
  if (!requested.length) {
    return { error: "candidate_ids required", status: 400 };
  }

  ensureAssessmentCacheDirs();
  const all = loadCandidatesFromPath(inputPath);
  const byId = new Map(
    all.map((c) => [identityFromCandidate(c).candidate_id, c] as const)
  );

  const unknown = requested.filter((id) => !byId.has(id));
  if (unknown.length) {
    return {
      error: `Unknown candidate_ids: ${unknown.slice(0, 5).join(", ")}`,
      status: 400,
    };
  }

  const skipped_candidates: Array<{ candidate_id: string; reason: string }> =
    [];
  const eligibleCandidates: Candidate[] = [];
  const eligibleIds: string[] = [];

  for (const id of requested) {
    const c = byId.get(id)!;
    const el = candidateEligibility(c);
    if (!el.eligible) {
      skipped_candidates.push({
        candidate_id: id,
        reason: el.reason ?? "Insufficient context",
      });
      continue;
    }
    eligibleCandidates.push(c);
    eligibleIds.push(id);
  }

  if (!eligibleIds.length) {
    return {
      error: "No eligible candidates in request (need GitHub path or writing path)",
      status: 400,
    };
  }

  const mock_llm = Boolean(input.mock_llm);
  const rubricBundle = loadRubricBundle();
  const rubricBundleVersion = rubricBundleVersionLabel(rubricBundle);

  const run = createAssessmentRun({
    source: {
      candidates_path: inputPath,
      candidates_file_hash: hashFile(inputPath),
    },
    config: {
      candidate_limit: eligibleIds.length,
      repository_limit: ASSESSMENT_REPOSITORY_LIMIT,
      publication_limit: ASSESSMENT_PUBLICATION_LIMIT,
      article_limit: ASSESSMENT_ARTICLE_LIMIT,
      model: mock_llm ? "mock/deterministic" : LLM_MODEL,
      prompt_versions: { ...PROMPT_VERSIONS },
      weight_version: PRIORITY_WEIGHT_VERSION,
      mock_llm,
      judge_schema_version: JUDGE_SCHEMA_VERSION,
      rubric_bundle_version: rubricBundleVersion,
      judge_implementation_version: TECHNICAL_JUDGE_IMPLEMENTATION_VERSION,
      collection_config_version: COLLECTION_CONFIG_VERSION,
    },
    candidate_ids: eligibleIds,
    status: "queued",
  });

  // Freeze only the eligible requested candidates (immutable set)
  const sourceHash = writeSourceCandidates(run.id, eligibleCandidates);
  const loaded = loadAssessmentRun(run.id)!;
  loaded.source.source_candidates_hash = sourceHash;
  saveAssessmentRun(loaded);

  return {
    run_id: run.id,
    status: "queued",
    requested_count: requested.length,
    eligible_count: eligibleIds.length,
    skipped_count: skipped_candidates.length,
    skipped_candidates,
    mock_llm,
    skip_digest: input.skip_digest !== false,
  };
}

export function getAssessmentRunResponse(runId: string):
  | {
      run_id: string;
      status: AssessmentRunStatus;
      started_at?: string;
      completed_at?: string;
      updated_at?: string;
      revision: number;
      mock_llm: boolean;
      model?: string;
      rubric_bundle_version?: string;
      judge_implementation_version?: string;
      candidate_count: number;
      counts: {
        pending: number;
        active: number;
        completed: number;
        partial: number;
        failed: number;
        insufficient_context: number;
      };
      errors: AssessmentError[];
    }
  | null {
  const run = loadAssessmentRun(runId);
  if (!run) return null;

  const assessments = listCandidateAssessments(runId);
  const byId = new Map(assessments.map((a) => [a.candidate_id, a]));
  const counts = {
    pending: 0,
    active: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    insufficient_context: 0,
  };

  for (const id of run.candidate_ids) {
    const a = byId.get(id);
    const status = (a?.status ?? "pending") as CandidateAssessmentStatus;
    if (status === "pending") counts.pending += 1;
    else if (status === "running") counts.active += 1;
    else if (status === "completed") counts.completed += 1;
    else if (status === "partial") counts.partial += 1;
    else if (status === "failed") counts.failed += 1;
    else if (status === "insufficient_context")
      counts.insufficient_context += 1;
  }

  const status = normalizeRunStatus(run.status) as AssessmentRunStatus;
  const errors: AssessmentError[] = [
    ...run.errors.map((e) => ({
      stage: (e.stage as AssessmentError["stage"]) || "persistence",
      code: e.code,
      message: e.message,
      technical_details: e.technical_details,
      retryable: e.retryable,
      judge: e.judge as AssessmentError["judge"],
      occurred_at: e.at,
      candidate_id: e.candidate_id,
    })),
    ...assessments.flatMap((a) => a.errors ?? []),
  ];

  return {
    run_id: run.id,
    status,
    started_at: run.created_at,
    completed_at: run.completed_at,
    updated_at: run.updated_at,
    revision: run.revision ?? 1,
    mock_llm: run.config.mock_llm,
    model: run.config.model,
    rubric_bundle_version: run.config.rubric_bundle_version,
    judge_implementation_version: run.config.judge_implementation_version,
    candidate_count: run.candidate_ids.length,
    counts,
    errors,
  };
}

function defaultJudgeState(): JudgeExecutionState {
  return { status: "pending", attempt_count: 0, error_ids: [] };
}

export interface AssessmentRunCandidateRow {
  candidate_id: string;
  name: string;
  github_username?: string;
  website_url?: string;
  status: CandidateAssessmentStatus;
  pipeline_stage: CandidateAssessmentStage;
  judge_statuses: {
    technical: JudgeExecutionState;
    writing: JudgeExecutionState;
    cross_artifact: JudgeExecutionState;
    cory: JudgeExecutionState;
  };
  synthesis_state?: SynthesisExecutionState;
  priority_score?: number;
  synthesis_valid: boolean;
  error_count: number;
  errors: AssessmentError[];
  revision: number;
}

export function getAssessmentRunCandidateRows(
  runId: string
): AssessmentRunCandidateRow[] | null {
  const run = loadAssessmentRun(runId);
  if (!run) return null;
  const assessments = listCandidateAssessments(runId);
  const byId = new Map(assessments.map((a) => [a.candidate_id, a]));

  let snapshotNames = new Map<string, Candidate>();
  const snap = path.join(assessmentRunDir(runId), "source-candidates.json");
  if (fs.existsSync(snap)) {
    try {
      const list = loadCandidatesFromPath(snap);
      snapshotNames = new Map(
        list.map((c) => [identityFromCandidate(c).candidate_id, c])
      );
    } catch {
      /* ignore corrupt snapshot mid-write */
    }
  }

  return run.candidate_ids.map((id) => {
    const a = byId.get(id);
    const snap = snapshotNames.get(id);
    const name =
      a?.identity.display_name ??
      a?.source_candidate.name ??
      snap?.name ??
      id;
    const synthesis_valid = Boolean(
      a?.synthesis_state?.valid_for_ranking
    );
    const errors = a?.errors ?? [];
    return {
      candidate_id: id,
      name,
      github_username:
        a?.identity.github_username ??
        a?.source_candidate.github_username ??
        (snap ? githubUsernameFromCandidate(snap) : undefined),
      website_url:
        a?.source_candidate.website_url ??
        a?.source_candidate.blog_url,
      status: (a?.status ?? "pending") as CandidateAssessmentStatus,
      pipeline_stage: (a?.pipeline_stage ??
        "pending") as CandidateAssessmentStage,
      judge_statuses: a?.judge_statuses ?? {
        technical: defaultJudgeState(),
        writing: defaultJudgeState(),
        cross_artifact: defaultJudgeState(),
        cory: defaultJudgeState(),
      },
      synthesis_state: a?.synthesis_state,
      priority_score: synthesis_valid
        ? a?.synthesis.priority_score
        : undefined,
      synthesis_valid,
      error_count: errors.length + (a?.error ? 1 : 0),
      errors,
      revision: a?.revision ?? 0,
    };
  });
}

export function findLatestCandidateAssessment(
  candidateId: string
): { run_id: string; record: CandidateAssessmentRecord } | null {
  const root = path.resolve(process.cwd(), "output", "assessment-runs");
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root)
    .filter((n) => n.startsWith("arun_"))
    .sort()
    .reverse();
  for (const runId of dirs) {
    const record = loadCandidateAssessment(runId, candidateId);
    if (record) return { run_id: runId, record };
  }
  return null;
}

export function reconcileAbandonedAssessmentRuns(): {
  interrupted: string[];
} {
  const interrupted: string[] = [];
  for (const run of listNonterminalRuns()) {
    // No verified child process in this process — mark abandoned
    updateAssessmentRunStatus(run.id, "interrupted");
    interrupted.push(run.id);
  }
  return { interrupted };
}

export function readPersistedAssessmentStatus(
  runId: string | null | undefined
): AssessmentRunStatus | null {
  if (!runId) return null;
  const run = loadAssessmentRun(runId);
  if (!run) return null;
  return normalizeRunStatus(run.status) as AssessmentRunStatus;
}

export function assertCandidateInRun(
  runId: string,
  candidateId: string
): AssessmentRun | { error: string; status: number } {
  const run = loadAssessmentRun(runId);
  if (!run) return { error: "Assessment run not found", status: 404 };
  if (!run.candidate_ids.includes(candidateId)) {
    return {
      error: "candidate_id is not in the frozen run snapshot",
      status: 400,
    };
  }
  return run;
}

export { isTerminalRunStatus, loadAssessmentRun };

export interface AssessedCandidateRow {
  candidate_id: string;
  name: string;
  priority_score: number;
  archetype: string;
  status: string;
  run_id: string;
  updated_at: string;
}

/** Latest assessment per candidate across all runs, newest report first. */
export function listAssessedCandidates(): AssessedCandidateRow[] {
  const root = path.resolve(process.cwd(), "output", "assessment-runs");
  if (!fs.existsSync(root)) return [];
  const seen = new Set<string>();
  const rows: AssessedCandidateRow[] = [];
  const runs = fs
    .readdirSync(root)
    .filter((n) => n.startsWith("arun_"))
    .sort()
    .reverse();
  for (const runId of runs) {
    for (const record of listCandidateAssessments(runId)) {
      if (seen.has(record.candidate_id)) continue;
      seen.add(record.candidate_id);
      rows.push({
        candidate_id: record.candidate_id,
        name: record.source_candidate.name,
        priority_score: record.synthesis.priority_score,
        archetype: record.synthesis.archetype,
        status: record.status,
        run_id: runId,
        updated_at: record.updated_at,
      });
    }
  }
  return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** Newest run that finished (with or without errors) — digest target. */
export function latestCompletedAssessmentRunId(): string | null {
  const root = path.resolve(process.cwd(), "output", "assessment-runs");
  if (!fs.existsSync(root)) return null;
  const runs = fs
    .readdirSync(root)
    .filter((n) => n.startsWith("arun_"))
    .sort()
    .reverse();
  for (const runId of runs) {
    const run = loadAssessmentRun(runId);
    if (run && (run.status === "completed" || run.status === "completed_with_errors")) {
      return runId;
    }
  }
  return null;
}
