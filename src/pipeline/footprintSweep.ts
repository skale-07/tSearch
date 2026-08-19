import type { OlympiadProfile } from "../types.js";
import { SEED_QUEUE_PATH } from "../config.js";
import { ghFetch } from "../github/githubSearch.js";
import { readJson, writeJsonAtomic } from "../storage/jsonStore.js";
import {
  loadPerson,
  upsertPerson,
  type PersonRecord,
} from "../storage/personStore.js";
import { loadAllPeople } from "./convergence.js";
import { nameMatchConfidence } from "./nameMatch.js";

/**
 * Legacy GitHub-first footprint qualification. Live intake is pending-seeds
 * (olympiad CSV / rosters / manual) → LinkedIn first. GitHub attaches from a
 * LinkedIn/website URL, or from a name-search hit corroborated by
 * school/college/major. github_login_guess from this sweep still never
 * becomes links.github_url by itself.
 */

const FOOTPRINT_TTL_MS = Number(
  process.env.FOOTPRINT_TTL_MS ?? 30 * 24 * 60 * 60 * 1000
);
const QUEUE_MIN_SCORE = Number(process.env.QUEUE_MIN_SCORE ?? 0.35);

export interface GithubUserDetail {
  login: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  blog: string | null;
  created_at: string | null;
  public_repos: number;
  followers: number;
}

export interface FootprintResult {
  score: number;
  github_login_guess?: string;
  github_confidence: number;
  signals: string[];
}

export { nameMatchConfidence };

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const OLYMPIAD_HINT_RE =
  /\b(olympiad|imo|ioi|ipho|icho|competitive programming|codeforces|putnam)\b/i;

/** Pure scoring so the heuristic is testable without network. */
export function scoreFootprint(
  person: Pick<OlympiadProfile, "name" | "countries" | "years">,
  gh: GithubUserDetail | null
): FootprintResult {
  if (!gh) return { score: 0, github_confidence: 0, signals: [] };

  const signals: string[] = [];
  const confidence = nameMatchConfidence(person.name, gh.login, gh.name);

  // A weak name match is noise, not evidence.
  if (confidence < 0.45) {
    return { score: 0, github_confidence: confidence, signals: [] };
  }
  signals.push(`name-match:${confidence.toFixed(2)}`);

  let boost = 0;
  const blob = `${gh.bio ?? ""} ${gh.location ?? ""}`;
  if (OLYMPIAD_HINT_RE.test(blob)) {
    boost += 0.15;
    signals.push("olympiad-hint-in-bio");
  }
  if (
    person.countries.some((c) =>
      blob.toLowerCase().includes(c.toLowerCase().split(" ")[0])
    )
  ) {
    boost += 0.1;
    signals.push("country-match");
  }
  const earliestYear = Math.min(...person.years);
  if (gh.created_at && Number.isFinite(earliestYear)) {
    const created = new Date(gh.created_at).getFullYear();
    // Accounts created near/after the competition fit a young competitor.
    if (created >= earliestYear - 4) {
      boost += 0.05;
      signals.push("account-age-plausible");
    }
  }
  if (gh.blog?.trim()) {
    boost += 0.15;
    signals.push("has-website");
  }
  if (gh.public_repos > 3) {
    boost += 0.1;
    signals.push("repos>3");
  }
  if (gh.followers > 10) {
    boost += 0.05;
    signals.push("followers>10");
  }

  const score = Math.min(1, confidence * 0.6 + boost);
  return {
    score: Math.round(score * 100) / 100,
    github_login_guess: gh.login,
    github_confidence: Math.round(confidence * 100) / 100,
    signals,
  };
}

async function bestGithubCandidate(
  name: string
): Promise<GithubUserDetail | null> {
  const q = encodeURIComponent(`${name} in:name`);
  const search = await ghFetch<{ items?: Array<{ login: string }> }>(
    `/search/users?q=${q}&per_page=3`
  );
  if (!search?.items?.length) return null;

  let best: GithubUserDetail | null = null;
  let bestConf = 0;
  for (const item of search.items) {
    const detail = await ghFetch<GithubUserDetail>(`/users/${item.login}`);
    if (!detail) continue;
    const conf = nameMatchConfidence(name, detail.login, detail.name);
    if (conf > bestConf) {
      bestConf = conf;
      best = detail;
    }
  }
  return best;
}

function footprintFresh(rec: PersonRecord | null): boolean {
  const at = rec?.footprint?.checked_at;
  if (!at) return false;
  const age = Date.now() - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age < FOOTPRINT_TTL_MS;
}

function alreadyDiscovered(rec: PersonRecord | null): boolean {
  return Boolean(rec?.identity?.status === "resolved" || rec?.links?.github_url);
}

export interface SweepStats {
  considered: number;
  swept: number;
  skipped_fresh: number;
  skipped_resolved: number;
  qualified: number;
}

export async function sweepOlympiadSeeds(
  olympiadIndex: Map<string, OlympiadProfile>,
  opts?: { limit?: number; log?: (msg: string) => void }
): Promise<SweepStats> {
  const limit = opts?.limit ?? Number(process.env.SWEEP_LIMIT ?? 40);
  const log = opts?.log ?? (() => {});
  const stats: SweepStats = {
    considered: 0,
    swept: 0,
    skipped_fresh: 0,
    skipped_resolved: 0,
    qualified: 0,
  };

  const seen = new Set<string>();
  for (const person of olympiadIndex.values()) {
    if (stats.swept >= limit) break;
    const key = norm(person.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    stats.considered++;

    const existing = loadPerson(person.name);
    if (alreadyDiscovered(existing)) {
      stats.skipped_resolved++;
      continue;
    }
    if (footprintFresh(existing)) {
      stats.skipped_fresh++;
      continue;
    }

    const gh = await bestGithubCandidate(person.name);
    const result = scoreFootprint(person, gh);
    stats.swept++;
    if (result.score >= QUEUE_MIN_SCORE) stats.qualified++;

    upsertPerson({
      name: person.name,
      country: person.countries[0],
      olympiad: person,
      footprint: {
        score: result.score,
        github_login_guess: result.github_login_guess,
        github_confidence: result.github_confidence,
        signals: result.signals,
        checked_at: new Date().toISOString(),
      },
    });
    log(
      `${person.name}: score=${result.score.toFixed(2)} gh=${result.github_login_guess ?? "—"} [${result.signals.join(", ")}]`
    );
  }

  refreshSeedQueue();
  return stats;
}

export interface QueueEntry {
  name: string;
  country?: string;
  footprint_score: number;
  github_login_guess?: string;
  signals: string[];
  checked_at: string;
}

/** Ranked, LinkedIn-unresolved, footprint-qualified seeds. */
export function refreshSeedQueue(): QueueEntry[] {
  const entries: QueueEntry[] = loadAllPeople()
    .filter(
      (p) =>
        p.footprint &&
        p.footprint.score >= QUEUE_MIN_SCORE &&
        !alreadyDiscovered(p)
    )
    .map((p) => ({
      name: p.name,
      country: p.country,
      footprint_score: p.footprint!.score,
      github_login_guess: p.footprint!.github_login_guess,
      signals: p.footprint!.signals,
      checked_at: p.footprint!.checked_at,
    }))
    .sort((a, b) => b.footprint_score - a.footprint_score);

  writeJsonAtomic(SEED_QUEUE_PATH, {
    generated_at: new Date().toISOString(),
    entries,
  });
  return entries;
}

export function loadSeedQueue(): QueueEntry[] {
  return readJson<{ entries: QueueEntry[] }>(SEED_QUEUE_PATH)?.entries ?? [];
}

/**
 * Cross-source identity check: the sweep guessed a GitHub login from name
 * matching; LinkedIn later verified one via profile/website. When two
 * independent sources agree, identity confidence deserves a bump.
 */
export function footprintCrossCheck(
  confidence: number,
  guess: string | undefined,
  verifiedLogin: string | null | undefined
): { confidence: number; confirmed: boolean } {
  if (!guess || !verifiedLogin) return { confidence, confirmed: false };
  if (guess.trim().toLowerCase() !== verifiedLogin.trim().toLowerCase()) {
    return { confidence, confirmed: false };
  }
  return {
    confidence: Math.min(1, Math.round((confidence + 0.1) * 100) / 100),
    confirmed: true,
  };
}
