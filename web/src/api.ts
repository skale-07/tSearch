export type ProfileRelation = "seed" | "collaborator" | "follower";

export interface SeedOption {
  name: string;
  country: string;
  hasTree: boolean;
  has_github?: boolean;
  has_linkedin?: boolean;
  age_label?: string | null;
}

export interface TreeNodeSummary {
  id: string;
  name: string;
  relation: ProfileRelation;
  hop: 0 | 1 | 2;
  parentId?: string;
  context_score: number;
  context_signals: string[];
  photo_url?: string;
  linkedin_url?: string;
  website_url?: string;
  blog_url?: string;
  has_linkedin?: boolean;
  has_writing_surface?: boolean;
  surface_score?: number;
  surface_signals?: string[];
  surface_score_max?: number;
  can_expand: boolean;
  bridge_seed_count?: number;
  bridge_seeds?: string[];
  age_label?: string | null;
}

export interface TreeEdge {
  from: string;
  to: string;
  via: "github-collaborator" | "github-follower";
  context_score: number;
  hop: 1 | 2;
}

export interface ProfileRecord {
  slug: string;
  name: string;
  kind: "seed" | "neighbor";
  relation: ProfileRelation;
  hop?: 0 | 1 | 2;
  seed: string;
  discovered_via: string[];
  parents: string[];
  context_score: number;
  context_signals: string[];
  links?: {
    github_url?: string;
    linkedin_url?: string;
    personal_website?: string;
    blog?: string;
    twitter_url?: string;
    email?: string;
    social_accounts?: { provider: string; url: string }[];
  };
  linkedin?: {
    url?: string;
    name?: string;
    photo_url?: string;
    headline?: string;
    college?: string;
    school?: string;
  };
  github?: {
    username?: string;
    display_name?: string | null;
    profile_url?: string;
    bio?: string | null;
    blog?: string | null;
    company?: string | null;
    location?: string | null;
    social_accounts?: { provider: string; url: string }[];
    repos?: { name: string; stars: number; language: string | null }[];
  };
  website?: {
    url?: string;
    github_url?: string | null;
    twitter_url?: string | null;
    email?: string | null;
  };
  olympiad?: {
    prizes?: string[];
    countries?: string[];
  };
  last_updated?: string;
  age_label?: string | null;
}

export interface TreeResponse {
  seedSlug: string;
  seed: ProfileRecord;
  nodes: TreeNodeSummary[];
  edges: TreeEdge[];
}

/** Same rule as server: hop ≥ 1 needs score ≥ 4 (hide ≤ 3). Applies to hop-2 too. */
export const MIN_TREE_DISPLAY_SCORE = 4;
export const DISCOVERED_FOREST_SLUG = "tsearch-discovered";

function isBotishNode(id: string, name: string): boolean {
  const slug = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  const s = `${slug} ${name}`.toLowerCase();
  return (
    /\[bot\]/.test(s) ||
    /(^|[\s_-])bot($|[\s_-])/.test(s) ||
    /dependabot|renovate|github-actions|actions-user|opencode-agent/.test(s)
  );
}

/** Strip low-score / bot nodes (incl. Arihant hop-2) before the UI renders them. */
export function sanitizeTree(tree: TreeResponse): TreeResponse {
  const nodes = tree.nodes.filter((n) => {
    if (n.relation === "seed" || n.hop === 0) return true;
    if (isBotishNode(n.id, n.name)) return false;
    return Number(n.context_score ?? 0) >= MIN_TREE_DISPLAY_SCORE;
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = tree.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return { ...tree, nodes, edges };
}

export interface TreeOption {
  slug: string;
  name: string;
  age_label?: string | null;
  hasTree?: boolean;
}

/** Vite is up before tsx watch; retry GETs through a dead proxy instead of failing the shell. */
async function getWithRetry(path: string, attempts = 10): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(path);
      if (res.ok || res.status < 500 || i === attempts - 1) return res;
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) throw err;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw lastErr instanceof Error ? lastErr : new Error(`GET ${path} failed`);
}

export async function fetchSeeds(): Promise<{
  seeds: SeedOption[];
  profileSeeds: string[];
  trees?: TreeOption[];
}> {
  const res = await getWithRetry("/api/seeds");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type SeedSourceKind = "olympiad_csv" | "award_roster" | "manual_cohort";

export interface ChannelSnapshot {
  source_id: string;
  kind: SeedSourceKind;
  label: string;
  present: boolean;
  row_count: number;
  error?: string;
}

export interface PendingSeedRow {
  name: string;
  country?: string;
  cohort_year?: number;
  award_id?: string;
  age_at_award?: number;
  estimated_age?: number | null;
  age_label?: string | null;
  source_id: string;
  source_kind?: SeedSourceKind;
  first_seen: string;
}

export interface DiscoverySnapshot {
  channels: ChannelSnapshot[];
  pending: PendingSeedRow[];
  pending_count: number;
  channel_meta: Record<SeedSourceKind, { title: string; hint: string }>;
  refresh?: {
    sources_read: number;
    rows_read: number;
    already_known: number;
    duplicates_within_run: number;
  };
  roster_awards?: Array<{
    award_id: string;
    display_name: string;
    scrapeable?: boolean;
  }>;
  saved?: { file: string; count: number };
  scrape?: {
    names_written: number;
    jobs: Array<{
      award_id: string;
      year: number;
      url?: string;
      count: number;
      error?: string;
    }>;
  };
  olympiad_pull?: {
    rows_written: number | null;
    sources: string[];
    year_from: number;
    year_to: number;
    log_tail: string;
  };
  github_ready?: Array<{
    name: string;
    country: string;
    github_url: string;
    linkedin_url?: string;
    has_tree: boolean;
    age_label: string | null;
  }>;
}

export async function fetchDiscovery(): Promise<DiscoverySnapshot> {
  const res = await getWithRetry("/api/discovery");
  const data = await readApiJson<DiscoverySnapshot & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function refreshDiscovery(): Promise<DiscoverySnapshot> {
  const res = await fetch("/api/discovery/refresh", { method: "POST" });
  const data = await readApiJson<DiscoverySnapshot & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function saveDiscoveryRoster(body: {
  award_id: string;
  year: number;
  names: string;
}): Promise<DiscoverySnapshot> {
  const res = await fetch("/api/discovery/roster", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<DiscoverySnapshot & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function scrapeDiscoveryRosters(body: {
  award_id?: string;
  year_from: number;
  year_to: number;
}): Promise<DiscoverySnapshot> {
  const res = await fetch("/api/discovery/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<DiscoverySnapshot & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Re-run olympiad_winners.py and refresh pending from the CSV. */
export async function pullDiscoveryOlympiads(body: {
  year_from: number;
  year_to: number;
  sources?: string[];
  skip_ibo?: boolean;
}): Promise<DiscoverySnapshot> {
  const res = await fetch("/api/discovery/olympiad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<DiscoverySnapshot & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function startDiscoveryResolve(body: {
  limit?: number;
  kind?: SeedSourceKind | "";
  name?: string;
  year?: number | "";
  program?: string;
}): Promise<{ runId: string; batch: Array<{ name: string; country?: string }> }> {
  const res = await fetch("/api/discovery/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: body.limit,
      kind: body.kind || undefined,
      name: body.name?.trim() || undefined,
      year: typeof body.year === "number" ? body.year : undefined,
      program: body.program?.trim() || undefined,
    }),
  });
  const data = await readApiJson<{
    runId?: string;
    batch?: Array<{ name: string; country?: string }>;
    error?: string;
  }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.runId) throw new Error("API response missing runId");
  return { runId: data.runId, batch: data.batch ?? [] };
}

export async function cancelRun(runId: string): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await readApiJson<{ error?: string }>(res);
    throw new Error(data.error || res.statusText);
  }
}

async function readApiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) {
    throw new Error(
      `API returned HTML instead of JSON (${res.status}). Is the API running on :8787? Start with "npm run dev" (or "npm run dev:api").`
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Invalid JSON from API (${res.status}): ${trimmed.slice(0, 160)}`
    );
  }
}

export async function startRun(body: {
  name: string;
  country: string;
}): Promise<{ runId: string }> {
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<{ runId?: string; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.runId) throw new Error("API response missing runId");
  return { runId: data.runId };
}

/** Run pipeline on N seeds in one batch (max 15). */
export async function startRunBatch(body: {
  seeds: Array<{ name: string; country: string }>;
}): Promise<{ runId: string; batch: Array<{ name: string; country?: string }> }> {
  const res = await fetch("/api/runs/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<{
    runId?: string;
    batch?: Array<{ name: string; country?: string }>;
    error?: string;
  }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.runId) throw new Error("API response missing runId");
  return { runId: data.runId, batch: data.batch ?? [] };
}

export async function startBranchRun(body: {
  rootSeedSlug: string;
  parentSlug: string;
  relation: "collaborator" | "follower";
}): Promise<{ runId: string }> {
  const res = await fetch("/api/runs/branch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<{ runId?: string; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.runId) throw new Error("API response missing runId");
  return { runId: data.runId };
}

export async function fetchTree(seedSlug: string): Promise<TreeResponse> {
  const res = await fetch(`/api/tree/${encodeURIComponent(seedSlug)}`);
  const data = await readApiJson<TreeResponse & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return sanitizeTree(data);
}

export async function fetchProfile(
  seedSlug: string,
  relation: ProfileRelation,
  slug?: string,
  opts?: {
    parentSlug?: string;
    parentRelation?: "collaborator" | "follower";
  }
): Promise<ProfileRecord> {
  let path: string;
  if (relation === "seed") {
    path = `/api/profile/${encodeURIComponent(seedSlug)}/seed`;
  } else if (opts?.parentSlug && opts.parentRelation) {
    path = `/api/profile/${encodeURIComponent(seedSlug)}/${opts.parentRelation}/${encodeURIComponent(opts.parentSlug)}/${relation}/${encodeURIComponent(slug!)}`;
  } else {
    path = `/api/profile/${encodeURIComponent(seedSlug)}/${relation}/${encodeURIComponent(slug!)}`;
  }
  const res = await fetch(path);
  const data = await readApiJson<ProfileRecord & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export type SseEvent =
  | {
      type: "log";
      line: string;
    }
  | {
      type: "done";
      seedSlug?: string | null;
      assessmentRunId?: string | null;
      digestHint?: string | null;
      exitCode?: number;
      run_id?: string | null;
      job_id?: string | null;
      process_exit_code?: number;
      assessment_status?: AssessmentRunStatus | null;
      ui_tone?: "success" | "warning" | "danger";
    }
  | {
      type: "error";
      message: string;
      exitCode?: number;
      assessmentRunId?: string | null;
      digestHint?: string | null;
      run_id?: string | null;
      job_id?: string | null;
      process_exit_code?: number;
      assessment_status?: AssessmentRunStatus | null;
      ui_tone?: "danger";
    };

export interface AssessmentCandidateRow {
  candidate_id: string;
  name: string;
  age_label?: string | null;
  estimated_age?: number | null;
  final_score: number;
  github_username?: string;
  website_url?: string;
  blog_url?: string;
  has_github: boolean;
  has_writing_surface: boolean;
  /** Frozen 17–19 draw from LinkedIn experience + featured links. */
  youth_wildcard?: boolean;
}

export type AssessmentRunStatus =
  | "queued"
  | "collecting"
  | "judging"
  | "rendering"
  | "completed"
  | "completed_with_errors"
  | "interrupted"
  | "failed";

export interface AssessmentError {
  id?: string;
  stage: string;
  code: string;
  message: string;
  technical_details?: string;
  retryable: boolean;
  judge?: string;
  attempt_count?: number;
  occurred_at?: string;
  candidate_id?: string;
}

export interface JudgeExecutionState {
  status?: string;
  attempt_count?: number;
  error_ids?: string[];
}

export interface AssessmentRun {
  run_id: string;
  status: AssessmentRunStatus;
  revision: number;
  mock_llm: boolean;
  candidate_count: number;
  counts: Record<"pending" | "active" | "completed" | "partial" | "failed" | "insufficient_context", number>;
  errors: AssessmentError[];
}

export interface AssessmentRunCandidate {
  candidate_id: string;
  name: string;
  github_username?: string;
  website_url?: string;
  status: string;
  pipeline_stage: string;
  judge_statuses: Record<string, JudgeExecutionState>;
  synthesis_state?: { valid_for_ranking?: boolean; status?: string };
  priority_score?: number;
  synthesis_valid: boolean;
  error_count: number;
  errors: AssessmentError[];
  revision: number;
}

export async function fetchCandidates(): Promise<{
  candidates: AssessmentCandidateRow[];
  path: string;
}> {
  const res = await fetch("/api/candidates");
  const data = await readApiJson<{
    candidates?: AssessmentCandidateRow[];
    path?: string;
    error?: string;
  }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return {
    candidates: data.candidates ?? [],
    path: data.path ?? "",
  };
}

export async function startAssessmentRun(body: {
  candidate_ids: string[];
  mock_llm?: boolean;
  skip_digest?: boolean;
}): Promise<{
  run_id: string;
  job_id: string;
  status: "queued";
  requested_count: number;
  eligible_count: number;
  skipped_count: number;
  skipped_candidates: Array<{ candidate_id: string; reason: string }>;
}> {
  const res = await fetch("/api/assessment/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<{
    run_id?: string;
    job_id?: string;
    status?: "queued";
    requested_count?: number;
    eligible_count?: number;
    skipped_count?: number;
    skipped_candidates?: Array<{ candidate_id: string; reason: string }>;
    error?: string;
  }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.run_id || !data.job_id) throw new Error("API response missing run_id or job_id");
  return {
    run_id: data.run_id,
    job_id: data.job_id,
    status: data.status ?? "queued",
    requested_count: data.requested_count ?? body.candidate_ids.length,
    eligible_count: data.eligible_count ?? body.candidate_ids.length,
    skipped_count: data.skipped_count ?? 0,
    skipped_candidates: data.skipped_candidates ?? [],
  };
}

async function assessmentRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = await readApiJson<T & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function fetchAssessmentRun(runId: string): Promise<AssessmentRun> {
  return assessmentRequest(`/api/assessment/runs/${encodeURIComponent(runId)}`);
}

export async function fetchAssessmentRunCandidates(
  runId: string
): Promise<AssessmentRunCandidate[]> {
  const data = await assessmentRequest<{ candidates: AssessmentRunCandidate[] }>(
    `/api/assessment/runs/${encodeURIComponent(runId)}/candidates`
  );
  return data.candidates;
}

export function retryFailedAssessment(runId: string): Promise<{ run_id: string; job_id: string }> {
  return assessmentRequest(`/api/assessment/runs/${encodeURIComponent(runId)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "failed" }),
  });
}

export function retryAssessmentCandidate(
  runId: string,
  candidateId: string
): Promise<{ run_id: string; job_id: string }> {
  return assessmentRequest(
    `/api/assessment/runs/${encodeURIComponent(runId)}/retry-candidate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_id: candidateId }),
    }
  );
}

export function fetchLatestCandidateAssessment(candidateId: string): Promise<{
  run_id: string;
  assessment: CandidateAssessmentDetail;
}> {
  return assessmentRequest(`/api/candidates/${encodeURIComponent(candidateId)}/assessment`);
}

export interface AssessmentArtifactReference {
  artifact_id: string;
  kind?: string;
  title: string;
  canonical_url: string;
}

export interface AssessmentEvidenceItem {
  evidence_id: string;
  artifact_id: string;
  source_type?: string;
  source_url: string;
  location?: {
    file_path?: string;
    heading?: string;
    section?: string;
    commit_sha?: string;
  };
  observation?: string;
}

export interface CandidateAssessmentDetail {
  candidate_id?: string;
  assessment_run_id?: string;
  status: string;
  pipeline_stage: string;
  artifacts?: {
    references?: AssessmentArtifactReference[];
    evidence?: AssessmentEvidenceItem[];
    github_repositories?: Record<string, { full_name?: string; name?: string }>;
    blog_articles?: Record<string, { title?: string; canonical_url?: string }>;
  };
  digest_summary?: {
    why_highlighted?: Array<{
      claim: string;
      rationale: string;
      evidence_ids?: string[];
    }>;
    next_review_step?: string;
  };
  judge_results?: Record<string, unknown>;
  judge_statuses?: Record<string, JudgeExecutionState>;
  synthesis?: {
    overall_score?: number;
    priority_score?: number;
    archetype?: string;
    headline?: string;
    primary_strength?: string;
    overall_rationale?: string;
    strongest_evidence_ids?: string[];
    [key: string]: unknown;
  };
  synthesis_state?: {
    valid_for_ranking?: boolean;
    fallback_used?: boolean;
    status?: string;
    [key: string]: unknown;
  };
  errors?: AssessmentError[];
  identity?: { display_name?: string; github_username?: string };
  updated_at?: string;
}

export async function fetchRunCandidateAssessment(
  runId: string,
  candidateId: string
): Promise<{ run_id: string; assessment: CandidateAssessmentDetail }> {
  return assessmentRequest(
    `/api/assessment/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}`
  );
}

const terminalRunStatuses = new Set<AssessmentRunStatus>([
  "completed",
  "completed_with_errors",
  "failed",
  "interrupted",
]);

export async function pollAssessmentRun(
  runId: string,
  opts: { onUpdate: (run: AssessmentRun) => void; signal?: AbortSignal }
): Promise<AssessmentRun> {
  let revision = -1;
  while (!opts.signal?.aborted) {
    const run = await fetchAssessmentRun(runId);
    if (run.revision > revision) {
      revision = run.revision;
      opts.onUpdate(run);
    }
    if (terminalRunStatuses.has(run.status)) return run;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1_000);
      opts.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Polling cancelled", "AbortError"));
        },
        { once: true }
      );
    });
  }
  throw new DOMException("Polling cancelled", "AbortError");
}

export function subscribeRunEvents(
  runId: string,
  onEvent: (ev: SseEvent) => void
): () => void {
  const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as SseEvent);
    } catch {
      onEvent({ type: "log", line: msg.data });
    }
  };
  es.onerror = () => {
    /* browser retries */
  };
  return () => es.close();
}

/** Resolve github slug from composite hop-2 id `parent:child`. */
export function parseNodeId(id: string): { slug: string; parentSlug?: string } {
  const idx = id.indexOf(":");
  if (idx === -1) return { slug: id };
  return { parentSlug: id.slice(0, idx), slug: id.slice(idx + 1) };
}

export type FeedbackVerdict = "relevant" | "not_relevant" | "explore_network";

export interface FeedbackRecord {
  candidate_id: string;
  candidate_name?: string;
  latest_verdict: FeedbackVerdict;
  updated_at: string;
}

export async function fetchCandidateFeedback(
  candidateId: string
): Promise<FeedbackRecord | null> {
  const res = await fetch(
    `/api/feedback/candidate/${encodeURIComponent(candidateId)}`
  );
  const data = await readApiJson<{ feedback: FeedbackRecord | null }>(res);
  if (!res.ok) throw new Error(res.statusText);
  return data.feedback;
}

export async function sendCandidateFeedback(body: {
  candidate_id: string;
  candidate_name?: string;
  verdict: FeedbackVerdict;
  note?: string;
}): Promise<FeedbackRecord> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<{ feedback?: FeedbackRecord; error?: string }>(
    res
  );
  if (!res.ok || !data.feedback) {
    throw new Error(data.error || res.statusText);
  }
  return data.feedback;
}

export interface AssessedRow {
  candidate_id: string;
  name: string;
  priority_score: number;
  archetype: string;
  status: string;
  run_id: string;
  updated_at: string;
  label?: { display: string; tier: number };
  age_relative?: number | null;
  stage_bucket?: string;
  estimated_age?: number | null;
  obscurity?: number | null;
  connections?: number | null;
  substance?: number | null;
  upside_score?: number | null;
  age_weighted_upside?: number | null;
}

export type AssessedSort =
  | "recent"
  | "quality"
  | "upside"
  | "obscurity"
  | "age_adjusted"
  | "age_weighted_upside";

export const ASSESSED_SORT_LABELS: Array<{
  value: AssessedSort;
  label: string;
  hint: string;
}> = [
  { value: "recent", label: "Most recent", hint: "Newest reports first" },
  { value: "quality", label: "Quality", hint: "Assessment priority score" },
  {
    value: "upside",
    label: "Upside",
    hint: "How undiscovered they are × how sound the judge found their work",
  },
  {
    value: "age_weighted_upside",
    label: "Upside for age",
    hint: "Upside, further weighted by how impressive the work is for their stage",
  },
  {
    value: "age_adjusted",
    label: "Impressive for age",
    hint: "How far above the norm for their stage",
  },
  {
    value: "obscurity",
    label: "Least discovered",
    hint: "Thin public footprint, real work",
  },
];

export async function fetchAssessed(
  sort: AssessedSort = "recent"
): Promise<AssessedRow[]> {
  const res = await fetch(`/api/assessed?sort=${encodeURIComponent(sort)}`);
  const data = await readApiJson<{ assessed: AssessedRow[] }>(res);
  if (!res.ok) throw new Error(res.statusText);
  return data.assessed;
}

export function assessedProfileUrl(candidateId: string): string {
  return `/api/assessed/${encodeURIComponent(candidateId)}/profile.html`;
}

export interface DigestListItem {
  digest_id: string;
  url: string;
  generated_at: string;
  assessment_run_id: string | null;
  candidate_count: number | null;
  assessed_candidate_count: number | null;
}

export async function fetchDigests(): Promise<DigestListItem[]> {
  const res = await fetch("/api/digest/list");
  const data = await readApiJson<{ digests: DigestListItem[]; error?: string }>(
    res
  );
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.digests ?? [];
}

export async function generateDigest(
  runId?: string
): Promise<{ digest_id: string; run_id: string; url: string }> {
  const res = await fetch("/api/digest/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runId ? { run_id: runId } : {}),
  });
  const data = await readApiJson<{
    digest_id?: string;
    run_id?: string;
    url?: string;
    error?: string;
  }>(res);
  if (!res.ok || !data.digest_id || !data.url) {
    throw new Error(data.error || res.statusText);
  }
  return { digest_id: data.digest_id, run_id: data.run_id ?? "", url: data.url };
}

export interface DigestSettings {
  from: string;
  to: string;
  provider_key_present: boolean;
}

export async function fetchDigestSettings(): Promise<DigestSettings> {
  const res = await fetch("/api/digest/settings");
  const data = await readApiJson<DigestSettings>(res);
  if (!res.ok) throw new Error(res.statusText);
  return data;
}

export async function sendDigestEmail(body: {
  digestId: string;
  from: string;
  to: string;
  dryRun: boolean;
}): Promise<{ messageId: string; dryRun: boolean; to: string[] }> {
  const res = await fetch(
    `/api/digest/${encodeURIComponent(body.digestId)}/send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: body.from,
        to: body.to,
        dry_run: body.dryRun,
      }),
    }
  );
  const data = await readApiJson<{
    messageId?: string;
    dryRun?: boolean;
    to?: string[];
    error?: string;
  }>(res);
  if (!res.ok || !data.messageId) throw new Error(data.error || res.statusText);
  return { messageId: data.messageId, dryRun: Boolean(data.dryRun), to: data.to ?? [] };
}
