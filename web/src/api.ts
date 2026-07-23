export type ProfileRelation = "seed" | "collaborator" | "follower";

export interface SeedOption {
  name: string;
  country: string;
  hasTree: boolean;
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
}

export interface TreeResponse {
  seedSlug: string;
  seed: ProfileRecord;
  nodes: TreeNodeSummary[];
  edges: TreeEdge[];
}

/** Same rule as server: hop ≥ 1 needs score ≥ 4 (hide ≤ 3). Applies to hop-2 too. */
export const MIN_TREE_DISPLAY_SCORE = 4;

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

export async function fetchSeeds(): Promise<{
  seeds: SeedOption[];
  profileSeeds: string[];
}> {
  const res = await fetch("/api/seeds");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
    }
  | {
      type: "error";
      message: string;
      exitCode?: number;
      assessmentRunId?: string | null;
      digestHint?: string | null;
    };

export interface AssessmentCandidateRow {
  candidate_id: string;
  name: string;
  final_score: number;
  github_username?: string;
  website_url?: string;
  blog_url?: string;
  has_github: boolean;
  has_writing_surface: boolean;
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
  mode: "selected" | "top_n";
  candidateIds?: string[];
  limit?: number;
  mock?: boolean;
}): Promise<{ runId: string }> {
  const res = await fetch("/api/assessment/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<{ runId?: string; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.runId) throw new Error("API response missing runId");
  return { runId: data.runId };
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
