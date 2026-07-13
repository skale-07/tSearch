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
  context_score: number;
  context_signals: string[];
  photo_url?: string;
}

export interface TreeEdge {
  from: string;
  to: string;
  via: "github-collaborator" | "github-follower";
  context_score: number;
}

export interface ProfileRecord {
  slug: string;
  name: string;
  kind: "seed" | "neighbor";
  relation: ProfileRelation;
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

export async function fetchSeeds(): Promise<{
  seeds: SeedOption[];
  profileSeeds: string[];
}> {
  const res = await fetch("/api/seeds");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function fetchTree(seedSlug: string): Promise<TreeResponse> {
  const res = await fetch(`/api/tree/${encodeURIComponent(seedSlug)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function fetchProfile(
  seedSlug: string,
  relation: ProfileRelation,
  slug?: string
): Promise<ProfileRecord> {
  const path =
    relation === "seed"
      ? `/api/profile/${encodeURIComponent(seedSlug)}/seed`
      : `/api/profile/${encodeURIComponent(seedSlug)}/${relation}/${encodeURIComponent(slug!)}`;
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export type SseEvent =
  | { type: "log"; line: string }
  | { type: "done"; seedSlug: string | null }
  | { type: "error"; message: string; exitCode?: number };

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
    // Browser will retry; ignore transient errors while running
  };
  return () => es.close();
}
