import fs from "fs";
import path from "path";
import { PROFILES_DIR } from "../config.js";
import type {
  Candidate,
  GitHubProfile,
  LinkedInProfile,
  OlympiadProfile,
  WebsiteProfile,
} from "../types.js";
import type { SeedTreeEdge } from "../pipeline/expandGraph.js";
import { slugify, writeJsonAtomic } from "./jsonStore.js";

export type ProfileRelation = "seed" | "collaborator" | "follower";

export interface ProfileRecord {
  slug: string;
  name: string;
  kind: "seed" | "neighbor";
  relation: ProfileRelation;
  hop: 0 | 1 | 2;
  /** GitHub login of the root seed this node hangs under (self for seeds). */
  seed: string;
  discovered_via: string[];
  parents: string[];
  linkedin?: LinkedInProfile;
  github?: GitHubProfile;
  website?: WebsiteProfile;
  olympiad?: OlympiadProfile;
  links: {
    github_url?: string;
    linkedin_url?: string;
    personal_website?: string;
    blog?: string;
    twitter_url?: string;
    email?: string;
    social_accounts?: { provider: string; url: string }[];
  };
  context_score: number;
  context_signals: string[];
  last_updated: string;
}

export interface SeedTreeDocument {
  seeds: { name: string; github: string | null; website?: string | null }[];
  edges: SeedTreeEdge[];
}

export interface ProfilePathArgs {
  seed: string;
  relation: ProfileRelation;
  slug?: string;
  hop?: 0 | 1 | 2;
  /** Hop-1 relation folder when writing/reading hop-2 nodes. */
  parentRelation?: "collaborator" | "follower";
  parentSlug?: string;
}

function githubLoginFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/?#]+)/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** Relation folder under a seed root (not used for the seed itself). */
export function relationDir(relation: ProfileRelation): string | null {
  if (relation === "collaborator") return "collaborators";
  if (relation === "follower") return "followers";
  return null;
}

/**
 * Hop 0: profiles/<seed>/profile.json
 * Hop 1: profiles/<seed>/<rel>/<login>/profile.json
 * Hop 2: profiles/<seed>/<parentRel>/<parent>/<rel>/<login>/profile.json
 */
export function profileFilePath(args: ProfilePathArgs): string {
  const seed = slugify(args.seed);
  const hop = args.hop ?? (args.relation === "seed" ? 0 : 1);
  if (hop === 0 || args.relation === "seed") {
    return path.join(PROFILES_DIR, seed, "profile.json");
  }
  const node = slugify(args.slug ?? args.seed);
  const rel = relationDir(args.relation);
  if (!rel) return path.join(PROFILES_DIR, seed, "profile.json");

  if (hop === 2 && args.parentSlug && args.parentRelation) {
    const parentRel = relationDir(args.parentRelation);
    if (!parentRel) {
      return path.join(PROFILES_DIR, seed, rel, node, "profile.json");
    }
    return path.join(
      PROFILES_DIR,
      seed,
      parentRel,
      slugify(args.parentSlug),
      rel,
      node,
      "profile.json"
    );
  }

  return path.join(PROFILES_DIR, seed, rel, node, "profile.json");
}

function linksFromSources(input: {
  linkedin?: LinkedInProfile;
  github?: GitHubProfile;
  website?: WebsiteProfile;
}): ProfileRecord["links"] {
  const twitter =
    input.linkedin?.twitter_url ??
    input.website?.twitter_url ??
    (input.github?.twitter_username
      ? `https://x.com/${input.github.twitter_username}`
      : undefined);

  const socialFromGh = input.github?.social_accounts;
  const linkedinFromSocial = socialFromGh?.find(
    (s) => s.provider.toLowerCase() === "linkedin"
  )?.url;

  return {
    github_url:
      input.github?.profile_url ??
      input.linkedin?.github_url ??
      input.website?.github_url ??
      undefined,
    linkedin_url:
      input.linkedin?.url ??
      input.website?.linkedin_url ??
      linkedinFromSocial ??
      undefined,
    personal_website:
      input.linkedin?.personal_website ??
      input.website?.url ??
      undefined,
    blog: input.github?.blog ?? undefined,
    twitter_url: twitter,
    email: input.website?.email ?? input.github?.email ?? undefined,
    social_accounts: socialFromGh?.length ? socialFromGh : undefined,
  };
}

export function upsertProfile(input: {
  name: string;
  slug?: string;
  seed: string;
  relation: ProfileRelation;
  hop?: 0 | 1 | 2;
  parentRelation?: "collaborator" | "follower";
  parentSlug?: string;
  discovered_via?: string[];
  parents?: string[];
  linkedin?: LinkedInProfile;
  github?: GitHubProfile;
  website?: WebsiteProfile;
  olympiad?: OlympiadProfile;
}): ProfileRecord {
  const slug = slugify(input.slug ?? input.name);
  const seed = slugify(input.seed);
  const hop: 0 | 1 | 2 =
    input.hop ?? (input.relation === "seed" ? 0 : input.parentSlug ? 2 : 1);
  const now = new Date().toISOString();
  const file = profileFilePath({
    seed,
    relation: input.relation,
    slug,
    hop,
    parentSlug: input.parentSlug,
    parentRelation: input.parentRelation,
  });

  let existing: ProfileRecord | null = null;
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf-8")) as ProfileRecord;
    } catch {
      existing = null;
    }
  }

  const context_score =
    input.github?.context_score ?? existing?.context_score ?? 0;
  const context_signals =
    input.github?.context_signals ?? existing?.context_signals ?? [];

  const record: ProfileRecord = {
    slug,
    name: input.name,
    kind: input.relation === "seed" ? "seed" : "neighbor",
    relation: input.relation,
    hop,
    seed,
    discovered_via: [
      ...new Set([
        ...(existing?.discovered_via ?? []),
        ...(input.discovered_via ?? []),
      ]),
    ],
    parents: [
      ...new Set([...(existing?.parents ?? []), ...(input.parents ?? [])]),
    ],
    linkedin: input.linkedin ?? existing?.linkedin,
    github: input.github ?? existing?.github,
    website: input.website ?? existing?.website,
    olympiad: input.olympiad ?? existing?.olympiad,
    links: {
      ...existing?.links,
      ...linksFromSources({
        linkedin: input.linkedin ?? existing?.linkedin,
        github: input.github ?? existing?.github,
        website: input.website ?? existing?.website,
      }),
    },
    context_score,
    context_signals,
    last_updated: now,
  };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, record);
  return record;
}

function candidateByGithub(ranked: Candidate[]): Map<string, Candidate> {
  const map = new Map<string, Candidate>();
  for (const c of ranked) {
    const login = c.github?.username?.toLowerCase();
    if (login) map.set(login, c);
    map.set(c.key, c);
  }
  return map;
}

/**
 * Writes only the seed tree into disk — not every candidate in the pool.
 * Layout mirrors the graph a visualizer will walk.
 */
export function writeSeedTreeProfiles(
  ranked: Candidate[],
  tree: SeedTreeDocument
): number {
  const byGh = candidateByGithub(ranked);
  let n = 0;

  for (const seed of tree.seeds) {
    const seedLogin =
      githubLoginFromUrl(seed.github) ?? slugify(seed.name);
    const seedCand =
      byGh.get(seedLogin) ??
      byGh.get(seed.name.trim().toLowerCase().replace(/\s+/g, " "));

    upsertProfile({
      name: seedCand?.name ?? seed.name,
      slug: seedLogin,
      seed: seedLogin,
      relation: "seed",
      hop: 0,
      discovered_via: seedCand?.discovered_via ?? [`seed:${seed.name}`],
      parents: [],
      linkedin: seedCand?.linkedin,
      github: seedCand?.github,
      website: seedCand?.website,
      olympiad: seedCand?.olympiad,
    });
    n++;
  }

  for (const edge of tree.edges) {
    const hop = edge.hop ?? 1;
    const relation: ProfileRelation =
      edge.via === "github-collaborator" ? "collaborator" : "follower";
    const neighborLogin = slugify(edge.to_github);
    const cand =
      byGh.get(edge.to_github.toLowerCase()) ?? byGh.get(neighborLogin);

    if (hop === 2 && edge.via_node) {
      const parentLogin = slugify(edge.via_node);
      const parentRel: "collaborator" | "follower" =
        edge.parent_relation ?? "follower";
      const rootLogin = slugify(edge.root_github ?? edge.from_github);

      upsertProfile({
        name: cand?.name ?? edge.to_github,
        slug: neighborLogin,
        seed: rootLogin,
        relation,
        hop: 2,
        parentSlug: parentLogin,
        parentRelation: parentRel,
        discovered_via: cand?.discovered_via ?? [
          `${edge.via}:${edge.via_node}`,
        ],
        parents: [rootLogin, parentLogin],
        linkedin: cand?.linkedin,
        github: cand?.github,
        website: cand?.website,
        olympiad: cand?.olympiad,
      });
    } else {
      const seedLogin = slugify(edge.from_github);
      upsertProfile({
        name: cand?.name ?? edge.to_github,
        slug: neighborLogin,
        seed: seedLogin,
        relation,
        hop: 1,
        discovered_via: cand?.discovered_via ?? [
          `${edge.via}:${edge.from_github}`,
        ],
        parents: [seedLogin],
        linkedin: cand?.linkedin,
        github: cand?.github,
        website: cand?.website,
        olympiad: cand?.olympiad,
      });
    }
    n++;
  }

  return n;
}

/** @deprecated use writeSeedTreeProfiles */
export function writeProfilesFromCandidates(
  ranked: Candidate[],
  _seedKeys: Set<string>,
  tree?: SeedTreeDocument
): number {
  if (!tree) {
    throw new Error(
      "writeProfilesFromCandidates requires the seed tree; use writeSeedTreeProfiles"
    );
  }
  return writeSeedTreeProfiles(ranked, tree);
}

export function linkedInUrlFromProfile(p: ProfileRecord): string | null {
  const fromLinks = p.links?.linkedin_url;
  if (fromLinks) return fromLinks;
  const fromLi = p.linkedin?.url;
  if (fromLi) return fromLi;
  const fromSocial = p.github?.social_accounts?.find(
    (s) => s.provider.toLowerCase() === "linkedin"
  )?.url;
  return fromSocial ?? p.links?.social_accounts?.find(
    (s) => s.provider.toLowerCase() === "linkedin"
  )?.url ?? null;
}
