import path from "path";
import { PEOPLE_DIR } from "../config.js";
import type {
  GitHubProfile,
  LinkedInProfile,
  OlympiadProfile,
  ScoreBreakdown,
  SubstackProfile,
  WebsiteProfile,
} from "../types.js";
import { readJson, slugify, writeJsonAtomic } from "./jsonStore.js";

export type IdentityStatus =
  | "resolved"
  | "no_results"
  | "no_name_match"
  | "not_attempted";

export interface PersonRecord {
  name: string;
  slug: string;
  country?: string;
  /** Other names this person appeared under (query name vs LinkedIn display name). */
  aliases: string[];

  olympiad?: OlympiadProfile;
  linkedin?: LinkedInProfile;
  github?: GitHubProfile;
  substack?: SubstackProfile;
  website?: WebsiteProfile;

  links: {
    linkedin_url?: string;
    github_url?: string;
    substack_url?: string;
    twitter_url?: string;
    email?: string;
    personal_website?: string;
    website_url?: string;
    contact_links?: string[];
    instagram_url?: string;
    youtube_url?: string;
  };

  identity: {
    status: IdentityStatus;
    confidence: number;
    resolved_at?: string;
  };

  /** Raw material for future 2-hop expansion without re-fetching. */
  graph: {
    github_neighbors: string[];
    github_collaborators: string[];
    github_followers: string[];
    substack_neighbors: string[];
    discovered_via: string[];
  };

  scores?: ScoreBreakdown & { final_score: number };
  score_history: { run_at: string; final_score: number }[];

  /** Per-source staleness, for deciding when to re-fetch. */
  freshness: {
    linkedin_checked_at?: string;
    github_checked_at?: string;
    substack_checked_at?: string;
    website_checked_at?: string;
  };

  first_seen: string;
  last_updated: string;
}

export interface PersonUpdate {
  name: string;
  country?: string;
  aliases?: string[];
  olympiad?: OlympiadProfile;
  linkedin?: LinkedInProfile;
  github?: GitHubProfile;
  substack?: SubstackProfile;
  website?: WebsiteProfile;
  links?: Partial<PersonRecord["links"]>;
  identity?: Partial<PersonRecord["identity"]>;
  graph?: Partial<PersonRecord["graph"]>;
  scores?: ScoreBreakdown & { final_score: number };
  freshness?: Partial<PersonRecord["freshness"]>;
}

export function personPath(name: string): string {
  return path.join(PEOPLE_DIR, `${slugify(name)}.json`);
}

export function loadPerson(name: string): PersonRecord | null {
  return readJson<PersonRecord>(personPath(name));
}

function union(...lists: (string[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap((l) => l ?? []))];
}

function emptyRecord(name: string, now: string): PersonRecord {
  return {
    name,
    slug: slugify(name),
    aliases: [],
    links: {},
    identity: { status: "not_attempted", confidence: 0 },
    graph: {
      github_neighbors: [],
      github_collaborators: [],
      github_followers: [],
      substack_neighbors: [],
      discovered_via: [],
    },
    score_history: [],
    freshness: {},
    first_seen: now,
    last_updated: now,
  };
}

/**
 * Deep-merges an update into `data/people/<slug>.json`, creating it if
 * missing. Arrays are unioned, defined fields in the update win over stored
 * values, `first_seen` is preserved, and a scores update appends to
 * `score_history`.
 */
export function upsertPerson(update: PersonUpdate): PersonRecord {
  const now = new Date().toISOString();
  const existing = loadPerson(update.name);
  const record = existing ?? emptyRecord(update.name, now);

  if (update.country) record.country = update.country;
  record.aliases = union(record.aliases, update.aliases).filter(
    (a) => a && a !== record.name
  );

  if (update.olympiad) record.olympiad = update.olympiad;
  if (update.linkedin) record.linkedin = update.linkedin;
  if (update.github) record.github = update.github;
  if (update.substack) record.substack = update.substack;
  if (update.website) record.website = update.website;

  if (update.links) {
    record.links = { ...record.links, ...update.links };
  }

  if (update.identity) {
    record.identity = { ...record.identity, ...update.identity };
  }

  if (update.graph) {
    record.graph = {
      github_neighbors: union(
        record.graph.github_neighbors,
        update.graph.github_neighbors
      ),
      github_collaborators: union(
        record.graph.github_collaborators,
        update.graph.github_collaborators
      ),
      github_followers: union(
        record.graph.github_followers ?? [],
        update.graph.github_followers
      ),
      substack_neighbors: union(
        record.graph.substack_neighbors,
        update.graph.substack_neighbors
      ),
      discovered_via: union(
        record.graph.discovered_via,
        update.graph.discovered_via
      ),
    };
  }

  if (update.scores) {
    record.scores = update.scores;
    record.score_history.push({
      run_at: now,
      final_score: update.scores.final_score,
    });
  }

  record.freshness = { ...record.freshness, ...update.freshness };
  record.last_updated = now;

  writeJsonAtomic(personPath(update.name), record);
  return record;
}
