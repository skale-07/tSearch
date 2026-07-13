import fs from "fs";
import path from "path";
import {
  COOKIES_PATH,
  OUTPUT_PATH,
  PROFILES_DIR,
  SEEDS_PATH,
} from "../src/config.js";
import type { ProfileRecord, ProfileRelation } from "../src/storage/profileStore.js";
import { profileFilePath } from "../src/storage/profileStore.js";
import { slugify } from "../src/storage/jsonStore.js";

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

export interface TreeResponse {
  seedSlug: string;
  seed: ProfileRecord;
  nodes: TreeNodeSummary[];
  edges: TreeEdge[];
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function listNeighborDirs(
  seedSlug: string,
  relation: "collaborator" | "follower"
): string[] {
  const folder = relation === "collaborator" ? "collaborators" : "followers";
  const dir = path.join(PROFILES_DIR, slugify(seedSlug), folder);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function toSummary(p: ProfileRecord): TreeNodeSummary {
  return {
    id: p.slug,
    name: p.name,
    relation: p.relation,
    context_score: p.context_score ?? 0,
    context_signals: p.context_signals ?? [],
    photo_url: p.linkedin?.photo_url,
  };
}

function githubLoginFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/?#]+)/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** Resolve seed GitHub slug from latest seed_tree.json by display name. */
export function resolveSeedSlugFromTree(seedName: string): string | null {
  const treePath = path.resolve(path.dirname(OUTPUT_PATH), "seed_tree.json");
  const tree = readJson<{
    seeds: { name: string; github: string | null }[];
  }>(treePath);
  if (!tree?.seeds?.length) return null;
  const want = seedName.trim().toLowerCase();
  const hit = tree.seeds.find((s) => s.name.trim().toLowerCase() === want);
  if (hit) {
    const login = githubLoginFromUrl(hit.github);
    if (login) return login;
  }
  // Fallback: single-seed run wrote exactly one seed
  if (tree.seeds.length === 1) {
    return githubLoginFromUrl(tree.seeds[0].github);
  }
  return null;
}

export function loadProfile(
  seedSlug: string,
  relation: ProfileRelation,
  nodeSlug?: string
): ProfileRecord | null {
  const seed = slugify(seedSlug);
  const node = slugify(nodeSlug ?? seedSlug);
  const file = profileFilePath(seed, node, relation);
  return readJson<ProfileRecord>(file);
}

export function buildTree(seedSlug: string): TreeResponse | null {
  const seed = slugify(seedSlug);
  const seedProfile = loadProfile(seed, "seed");
  if (!seedProfile) return null;

  const nodes: TreeNodeSummary[] = [toSummary(seedProfile)];
  const edges: TreeEdge[] = [];

  for (const login of listNeighborDirs(seed, "collaborator")) {
    const p = loadProfile(seed, "collaborator", login);
    if (!p) continue;
    nodes.push(toSummary(p));
    edges.push({
      from: seed,
      to: p.slug,
      via: "github-collaborator",
      context_score: p.context_score ?? 0,
    });
  }

  for (const login of listNeighborDirs(seed, "follower")) {
    const p = loadProfile(seed, "follower", login);
    if (!p) continue;
    nodes.push(toSummary(p));
    edges.push({
      from: seed,
      to: p.slug,
      via: "github-follower",
      context_score: p.context_score ?? 0,
    });
  }

  // Prefer edge metadata from seed_tree.json when present
  const treePath = path.resolve(path.dirname(OUTPUT_PATH), "seed_tree.json");
  const doc = readJson<{
    edges: {
      from_github: string;
      to_github: string;
      via: TreeEdge["via"];
      context_score?: number;
    }[];
  }>(treePath);
  if (doc?.edges?.length) {
    const filtered = doc.edges.filter(
      (e) => e.from_github.toLowerCase() === seed
    );
    if (filtered.length) {
      edges.length = 0;
      for (const e of filtered) {
        edges.push({
          from: seed,
          to: slugify(e.to_github),
          via: e.via,
          context_score: e.context_score ?? 0,
        });
      }
    }
  }

  return { seedSlug: seed, seed: seedProfile, nodes, edges };
}

export function listProfileSeeds(): string[] {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs
    .readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) =>
      fs.existsSync(path.join(PROFILES_DIR, d.name, "profile.json"))
    )
    .map((d) => d.name);
}

export function loadSeedsFile(): { name: string; country: string }[] {
  const raw = JSON.parse(fs.readFileSync(SEEDS_PATH, "utf-8"));
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is { name: string; country: string } =>
        s && typeof s.name === "string" && typeof s.country === "string"
    )
    .map((s) => ({ name: s.name, country: s.country }));
}

export function cookiesExist(): boolean {
  return fs.existsSync(COOKIES_PATH);
}
