import { readArtifactCache, writeArtifactCache } from "../storage/artifactCache.js";
import { ghJson } from "./collectRepositoryArtifact.js";

export interface RepoSelectionMeta {
  fork?: boolean;
  archived?: boolean;
  is_template?: boolean;
  size?: number;
  description?: string | null;
  default_branch?: string;
  created_at?: string | null;
  pushed_at?: string | null;
  topics?: string[];
  language?: string | null;
  stars?: number;
  raw?: Record<string, unknown>;
}

/**
 * Lightweight metadata for selectRepositories. Prefers one list-user-repos
 * request; falls back to cached GET /repos/{owner}/{repo}.
 */
export async function collectRepositorySelectionMetadata(
  username: string,
  repoNames: string[]
): Promise<Record<string, RepoSelectionMeta>> {
  const want = new Set(repoNames.map((n) => n.toLowerCase()));
  const out: Record<string, RepoSelectionMeta> = {};
  const listCacheKey = `repo-list-meta:v1:${username}`;
  let listed =
    readArtifactCache<
      Array<{
        name: string;
        fork: boolean;
        archived: boolean;
        is_template?: boolean;
        size: number;
        description: string | null;
        default_branch: string;
        created_at: string | null;
        pushed_at: string | null;
        topics?: string[];
        language: string | null;
        stargazers_count: number;
      }>
    >(listCacheKey);

  if (!listed) {
    listed =
      (await ghJson<
        Array<{
          name: string;
          fork: boolean;
          archived: boolean;
          is_template?: boolean;
          size: number;
          description: string | null;
          default_branch: string;
          created_at: string | null;
          pushed_at: string | null;
          topics?: string[];
          language: string | null;
          stargazers_count: number;
        }>
      >(`/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`)) ??
      [];
    writeArtifactCache(listCacheKey, listed);
  }

  for (const r of listed) {
    if (!want.has(r.name.toLowerCase())) continue;
    out[r.name] = {
      fork: r.fork,
      archived: r.archived,
      is_template: r.is_template,
      size: r.size,
      description: r.description,
      default_branch: r.default_branch,
      created_at: r.created_at,
      pushed_at: r.pushed_at,
      topics: r.topics ?? [],
      language: r.language,
      stars: r.stargazers_count,
      raw: r as unknown as Record<string, unknown>,
    };
  }

  // Fill missing via individual cached GETs
  for (const name of repoNames) {
    if (out[name]) continue;
    const key = `repo-meta:v1:${username}/${name}`;
    let meta = readArtifactCache<{
      fork: boolean;
      archived: boolean;
      is_template?: boolean;
      size: number;
      description: string | null;
      default_branch: string;
      created_at: string | null;
      pushed_at: string | null;
      topics?: string[];
      language: string | null;
      stargazers_count: number;
    }>(key);
    if (!meta) {
      meta = await ghJson(`/repos/${username}/${name}`);
      if (meta) writeArtifactCache(key, meta);
    }
    if (!meta) continue;
    out[name] = {
      fork: meta.fork,
      archived: meta.archived,
      is_template: meta.is_template,
      size: meta.size,
      description: meta.description,
      default_branch: meta.default_branch,
      created_at: meta.created_at,
      pushed_at: meta.pushed_at,
      topics: meta.topics ?? [],
      language: meta.language,
      stars: meta.stargazers_count,
      raw: meta as unknown as Record<string, unknown>,
    };
  }

  return out;
}
