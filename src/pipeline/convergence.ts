import fs from "fs";
import path from "path";
import { CONVERGENCE_PATH, PEOPLE_DIR } from "../config.js";
import { readJson, writeJsonAtomic } from "../storage/jsonStore.js";
import type { PersonRecord } from "../storage/personStore.js";

/**
 * Convergence: people reachable from 2+ distinct seed-set members are
 * disproportionately interesting (the "connected to X people in our base set"
 * heuristic from the original product brief). Edges come from the per-person
 * records that runs accumulate — no new scraping happens here.
 */

export interface ConvergenceEntry {
  login: string;
  seed_count: number;
  /** Seed-set member names whose neighborhoods contain this login. */
  seeds: string[];
  collaborator_of: string[];
  follower_of: string[];
  /** Collaborator edges weigh double follower edges. */
  weight: number;
}

function isSeedMember(p: PersonRecord): boolean {
  return p.identity?.status === "resolved" || Boolean(p.olympiad);
}

export function computeConvergence(people: PersonRecord[]): ConvergenceEntry[] {
  const acc = new Map<
    string,
    { seeds: Set<string>; collab: Set<string>; follow: Set<string> }
  >();

  for (const p of people) {
    if (!isSeedMember(p) || !p.graph) continue;
    const add = (rawLogin: string, kind: "collab" | "follow") => {
      const login = rawLogin.trim().toLowerCase();
      if (!login || login === p.slug) return;
      const entry =
        acc.get(login) ??
        { seeds: new Set<string>(), collab: new Set<string>(), follow: new Set<string>() };
      entry.seeds.add(p.name);
      (kind === "collab" ? entry.collab : entry.follow).add(p.name);
      acc.set(login, entry);
    };

    const collabs = p.graph.github_collaborators ?? [];
    const follows = p.graph.github_followers ?? [];
    for (const l of collabs) add(l, "collab");
    for (const l of follows) add(l, "follow");
    // Older records only carried the merged neighbor list.
    if (!collabs.length && !follows.length) {
      for (const l of p.graph.github_neighbors ?? []) add(l, "follow");
    }
  }

  return [...acc.entries()]
    .filter(([, e]) => e.seeds.size >= 2)
    .map(([login, e]) => ({
      login,
      seed_count: e.seeds.size,
      seeds: [...e.seeds].sort(),
      collaborator_of: [...e.collab].sort(),
      follower_of: [...e.follow].sort(),
      weight: 2 * e.collab.size + e.follow.size,
    }))
    .sort((a, b) => b.weight - a.weight || a.login.localeCompare(b.login));
}

export function loadAllPeople(): PersonRecord[] {
  if (!fs.existsSync(PEOPLE_DIR)) return [];
  const people: PersonRecord[] = [];
  for (const file of fs.readdirSync(PEOPLE_DIR)) {
    if (!file.endsWith(".json")) continue;
    const rec = readJson<PersonRecord>(path.join(PEOPLE_DIR, file));
    if (rec?.name) people.push(rec);
  }
  return people;
}

/** Recompute from all person records and persist. Returns the entries. */
export function refreshConvergenceStore(): ConvergenceEntry[] {
  const entries = computeConvergence(loadAllPeople());
  writeJsonAtomic(CONVERGENCE_PATH, {
    computed_at: new Date().toISOString(),
    entries,
  });
  return entries;
}

/** Map keyed by lowercase github login. Empty when no store exists yet. */
export function loadConvergenceMap(): Map<string, ConvergenceEntry> {
  const doc = readJson<{ entries: ConvergenceEntry[] }>(CONVERGENCE_PATH);
  return new Map((doc?.entries ?? []).map((e) => [e.login.toLowerCase(), e]));
}
