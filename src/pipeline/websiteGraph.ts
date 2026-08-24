import fs from "fs";
import path from "path";
import {
  COOKIES_PATH,
  OLYMPIAD_CSV_PATH,
  OUTPUT_PATH,
  PROFILES_DIR,
} from "../config.js";
import {
  githubUsernameFromCandidate,
  identityFromCandidate,
} from "../assessment/candidateIdentity.js";
import { expandGithubFromUrl } from "../github/githubExpand.js";
import { fetchGithubProfile } from "../github/githubUser.js";
import {
  extractLinkedInProfile,
  githubUsernameFromUrl,
} from "../linkedin/linkedinExtract.js";
import { openLinkedInSession } from "../linkedin/linkedinBrowser.js";
import { loadOlympiadCsv } from "../olympiad/parseOlympiad.js";
import { pageHitMarkId, rewriteMarkId } from "../marks/markStore.js";
import type { SeedTreeEdge } from "./expandGraph.js";
import { mergeCandidates, type RawCandidate } from "./mergeCandidates.js";
import {
  enrichIdentityFromWebsite,
  resolveIdentities,
} from "./resolveIdentities.js";
import { enqueueVerifiedGithub } from "./githubIdentity.js";
import type { SeedQuery } from "../seeds/parseSeeds.js";
import { appendPendingSeeds } from "../seeds/refreshSeeds.js";
import {
  upsertProfile,
  type NeighborRelation,
  type ProfileRecord,
} from "../storage/profileStore.js";
import { profileFilePath } from "../storage/profileStore.js";
import { readJson, slugify, writeJsonAtomic } from "../storage/jsonStore.js";
import { upsertPerson } from "../storage/personStore.js";
import type {
  Candidate,
  GitHubProfile,
  LinkedInProfile,
  ResolvedIdentity,
  WebsiteProfile,
} from "../types.js";
import { llmUseMock } from "../assessment/config.js";
import {
  extractOrgHintFromPage,
  extractPagePeople,
  isSoftNotFoundPage,
  type PagePerson,
} from "../website/extractPagePeople.js";
import { screenPagePeople } from "../website/screenPagePeople.js";
import { fetchWebsiteHtml, websiteFetchFailureMessage } from "../website/fetchWebsiteHtml.js";

export const WEBSITE_GRAPH_INGEST_LIMIT = 15;
export const WEBSITE_GRAPH_PREVIEW_LIMIT = 40;

const MAX_COLLABORATOR_PROFILES = Number(
  process.env.MAX_COLLABORATOR_PROFILES ?? 15
);

const NEIGHBOR_RELS: NeighborRelation[] = [
  "collaborator",
  "follower",
  "website",
];

export interface WebsiteGraphHint {
  linkedin_url?: string;
  github_url?: string;
  org_hint?: string;
}

export interface WebsiteGraphJob {
  seed_slug: string;
  host_slug?: string;
  url: string;
  names: string[];
  org_hint?: string;
  hints?: Record<string, WebsiteGraphHint>;
}

export interface WebsiteGraphHost {
  seed_slug: string;
  host_slug: string;
  host_name: string;
  host_hop: 0 | 1;
  host_relation: ProfileRecord["relation"];
  websiteUrl: string | null;
  github: string | null;
  org_hint: string | null;
}

export interface WebsiteGraphPreview {
  page_url: string;
  seed: { slug: string; name: string };
  host: { slug: string; name: string; hop: 0 | 1 };
  org_hint: string | null;
  people: Array<PagePerson & { mark_id: string }>;
  low_confidence_count: number;
}

export interface WebsiteNeighborInput {
  name: string;
  linkedin?: LinkedInProfile;
  github?: GitHubProfile;
  website?: WebsiteProfile;
  identity_confidence?: number;
  github_url?: string;
  linkedin_url?: string;
}

function log(msg: string): void {
  console.log(`[website-graph] ${msg}`);
}

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function loadSeedProfile(seedSlug: string): ProfileRecord | null {
  return readJson<ProfileRecord>(
    profileFilePath({ seed: seedSlug, relation: "seed" })
  );
}

function seedWebsiteUrl(rec: ProfileRecord): string | null {
  const li = rec.linkedin as { personal_website?: string | null } | undefined;
  const raw =
    rec.links?.personal_website?.trim() ||
    rec.website?.url?.trim() ||
    li?.personal_website?.trim() ||
    "";
  return raw || null;
}

function profileGithub(rec: ProfileRecord): string | null {
  return (
    githubUsernameFromUrl(
      rec.links?.github_url ?? rec.github?.profile_url ?? null
    ) ?? (rec.github?.username ? rec.github.username.toLowerCase() : null)
  );
}

/** Second-level host label: lab.berkeley.edu → berkeley. */
export function orgHintFromUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    const parts = host.split(".").filter(Boolean);
    const tlds = new Set([
      "com",
      "org",
      "net",
      "edu",
      "io",
      "ai",
      "co",
      "us",
      "uk",
      "ac",
      "gov",
    ]);
    while (parts.length > 1 && tlds.has(parts[parts.length - 1]!)) {
      parts.pop();
    }
    const label = parts[parts.length - 1]?.trim();
    return label && label.length >= 2 ? label : null;
  } catch {
    return null;
  }
}

function looksLikeSchool(value: string): boolean {
  return /\b(high school|university|college|academy|school)\b/i.test(value);
}

function defaultOrgHint(
  rec: ProfileRecord,
  pageUrl?: string | null
): string | null {
  const fromHost = orgHintFromUrl(pageUrl || seedWebsiteUrl(rec));
  if (fromHost) return fromHost;
  const company = rec.linkedin?.experience?.[0]?.company?.trim();
  if (company && !looksLikeSchool(company)) return company;
  return null;
}

function listSeedDirs(): string[] {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs
    .readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        fs.existsSync(path.join(PROFILES_DIR, d.name, "profile.json"))
    )
    .map((d) => d.name);
}

function loadHop1Profile(
  seedSlug: string,
  slug: string
): ProfileRecord | null {
  for (const rel of NEIGHBOR_RELS) {
    const rec = readJson<ProfileRecord>(
      profileFilePath({
        seed: seedSlug,
        relation: rel,
        slug,
        hop: 1,
      })
    );
    if (rec?.slug) return rec;
  }
  return null;
}

function hostFromRecords(
  seed: ProfileRecord,
  host: ProfileRecord
): WebsiteGraphHost {
  const hostHop: 0 | 1 = host.relation === "seed" ? 0 : 1;
  return {
    seed_slug: seed.slug,
    host_slug: host.slug,
    host_name: host.name,
    host_hop: hostHop,
    host_relation: host.relation,
    websiteUrl: seedWebsiteUrl(host) ?? seedWebsiteUrl(seed),
    github: profileGithub(host) ?? profileGithub(seed),
    org_hint: defaultOrgHint(host, seedWebsiteUrl(host)),
  };
}

function findHostBySlug(slug: string): WebsiteGraphHost | null {
  const want = slugify(slug);
  const asSeed = loadSeedProfile(want);
  if (asSeed) return hostFromRecords(asSeed, asSeed);
  for (const seedSlug of listSeedDirs()) {
    const seed = loadSeedProfile(seedSlug);
    if (!seed) continue;
    const hop1 = loadHop1Profile(seedSlug, want);
    if (hop1) return hostFromRecords(seed, hop1);
  }
  return null;
}

export function findWebsiteGraphSeed(seedSlug: string): {
  slug: string;
  name: string;
  websiteUrl: string | null;
  github: string | null;
} | null {
  const host = findHostBySlug(seedSlug);
  if (!host || host.host_hop !== 0) return null;
  return {
    slug: host.seed_slug,
    name: host.host_name,
    websiteUrl: host.websiteUrl,
    github: host.github,
  };
}

export function locateWebsiteGraphHost(input: {
  seed_slug?: string;
  host_slug?: string;
  candidate_id?: string;
}): WebsiteGraphHost | { error: string; status: number } {
  const candidateId = input.candidate_id?.trim();
  if (candidateId) {
    const match = loadExistingCandidates().find(
      (c) => identityFromCandidate(c).candidate_id === candidateId
    );
    if (!match) {
      return {
        error: `Unknown candidate "${candidateId}".`,
        status: 404,
      };
    }
    const login = githubUsernameFromCandidate(match);
    const slugs = [login, slugify(match.name)].filter(
      (s, i, arr): s is string => Boolean(s) && arr.indexOf(s) === i
    );
    for (const slug of slugs) {
      const host = findHostBySlug(slug);
      if (host) {
        return {
          ...host,
          websiteUrl:
            host.websiteUrl ||
            match.linkedin?.personal_website ||
            match.website?.url ||
            null,
          org_hint:
            host.org_hint ||
            orgHintFromUrl(match.website?.url),
        };
      }
    }
    return {
      error:
        "No graph root for this person — they are not on a seed tree. Refuse ingest rather than invent a root.",
      status: 404,
    };
  }

  const seedSlug = input.seed_slug?.trim();
  if (!seedSlug) {
    return { error: "seed_slug or candidate_id required", status: 400 };
  }
  const root = loadSeedProfile(slugify(seedSlug));
  if (!root) {
    return {
      error: `Unknown seed "${seedSlug}". Pick a seed with a profile.`,
      status: 404,
    };
  }
  const hostSlug = input.host_slug?.trim();
  if (!hostSlug || slugify(hostSlug) === root.slug) {
    return hostFromRecords(root, root);
  }
  const hop1 = loadHop1Profile(root.slug, slugify(hostSlug));
  if (!hop1) {
    return {
      error: `No hop-1 profile "${hostSlug}" under seed "${root.slug}".`,
      status: 404,
    };
  }
  return hostFromRecords(root, hop1);
}

function hostSourceId(pageUrl: string): string {
  try {
    return `website:${new URL(pageUrl).hostname.replace(/^www\./i, "").toLowerCase()}`;
  } catch {
    return "website:unknown";
  }
}

export async function previewWebsiteGraph(input: {
  seed_slug: string;
  url?: string;
  host_slug?: string;
}): Promise<WebsiteGraphPreview | { error: string; status: number }> {
  const host = locateWebsiteGraphHost({
    seed_slug: input.seed_slug,
    host_slug: input.host_slug,
  });
  if ("error" in host) return host;
  const url = (input.url?.trim() || host.websiteUrl || "").trim();
  if (!url) {
    return {
      error: "Pass a page URL, or use a seed that already has a website.",
      status: 400,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "url must be an http(s) address.", status: 400 };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "url must be an http(s) address.", status: 400 };
  }

  const fetched = await fetchWebsiteHtml(url);
  if (!fetched.ok) {
    const status =
      fetched.httpStatus === 404 || fetched.httpStatus === 410 ? 404 : 502;
    return { error: websiteFetchFailureMessage(url, fetched), status };
  }
  if (isSoftNotFoundPage(fetched.html)) {
    return {
      error: `That URL looks like a not-found page (${fetched.finalUrl}). Nothing to extract.`,
      status: 404,
    };
  }
  const extracted = extractPagePeople({
    html: fetched.html,
    pageUrl: fetched.finalUrl,
    seedName: host.host_name,
    limit: WEBSITE_GRAPH_PREVIEW_LIMIT,
  });
  const people = await screenPagePeople(extracted, {
    pageUrl: fetched.finalUrl,
    mock: llmUseMock(),
  });
  return {
    page_url: fetched.finalUrl,
    seed: { slug: host.seed_slug, name: host.host_name },
    host: {
      slug: host.host_slug,
      name: host.host_name,
      hop: host.host_hop,
    },
    org_hint:
      extractOrgHintFromPage(fetched.html, fetched.finalUrl) ||
      host.org_hint ||
      orgHintFromUrl(fetched.finalUrl),
    people: people.map((p) => ({
      ...p,
      mark_id: pageHitMarkId(fetched.finalUrl, p.name),
    })),
    low_confidence_count: people.filter((p) => p.confidence === "low").length,
  };
}

function uniqueNames(names: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name) continue;
    const key = nameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= cap) break;
  }
  return out;
}

function hintForName(
  name: string,
  hints?: Record<string, WebsiteGraphHint>
): WebsiteGraphHint | undefined {
  return hints?.[name] ?? hints?.[nameKey(name)];
}

function searchOrgHint(
  name: string,
  jobOrg: string | undefined,
  hints?: Record<string, WebsiteGraphHint>
): string | undefined {
  const h = hintForName(name, hints);
  return h?.org_hint?.trim() || jobOrg?.trim() || undefined;
}

export function prepareWebsiteGraphIngest(input: {
  seed_slug: string;
  host_slug?: string;
  url: string;
  names: string[];
  org_hint?: string;
  hints?: Record<string, WebsiteGraphHint>;
}): WebsiteGraphJob | { error: string; status: number } {
  const host = locateWebsiteGraphHost({
    seed_slug: input.seed_slug,
    host_slug: input.host_slug,
  });
  if ("error" in host) return host;
  const url = input.url.trim();
  if (!url) return { error: "url required", status: 400 };
  const names = uniqueNames(input.names ?? [], WEBSITE_GRAPH_INGEST_LIMIT);
  if (!names.length) {
    return { error: "Select at least one name to resolve.", status: 400 };
  }
  if ((input.names?.length ?? 0) > WEBSITE_GRAPH_INGEST_LIMIT) {
    log(`ingest capped at ${WEBSITE_GRAPH_INGEST_LIMIT} names`);
  }

  const jobOrg = input.org_hint?.trim() || undefined;
  for (const name of names) {
    const h = hintForName(name, input.hints);
    if (h?.linkedin_url?.trim()) continue;
    if (searchOrgHint(name, jobOrg, input.hints)) continue;
    return {
      error: `Name-only LinkedIn search refused for "${name}". Provide an org/award token or a LinkedIn URL.`,
      status: 400,
    };
  }

  appendPendingSeeds(
    names.map((name) => ({
      name,
      source_id: hostSourceId(url),
      source_kind: "website_page",
    }))
  );

  const hints: Record<string, WebsiteGraphHint> = {};
  for (const name of names) {
    const h = hintForName(name, input.hints);
    if (!h) continue;
    const next: WebsiteGraphHint = {};
    if (h.linkedin_url) next.linkedin_url = h.linkedin_url;
    if (h.github_url) next.github_url = h.github_url;
    if (h.org_hint) next.org_hint = h.org_hint;
    if (next.linkedin_url || next.github_url || next.org_hint) {
      hints[name] = next;
    }
  }

  return {
    seed_slug: host.seed_slug,
    host_slug: host.host_slug,
    url,
    names,
    ...(jobOrg ? { org_hint: jobOrg } : {}),
    ...(Object.keys(hints).length ? { hints } : {}),
  };
}

function loadExistingCandidates(): Candidate[] {
  if (!fs.existsSync(OUTPUT_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function loadExistingSeedTree(): {
  generated_at?: string;
  seeds: { name: string; github: string | null; website?: string | null }[];
  edges: SeedTreeEdge[];
} {
  const treePath = path.resolve(path.dirname(OUTPUT_PATH), "seed_tree.json");
  if (!fs.existsSync(treePath)) return { seeds: [], edges: [] };
  try {
    return JSON.parse(fs.readFileSync(treePath, "utf-8"));
  } catch {
    return { seeds: [], edges: [] };
  }
}

function mergeEdges(
  existing: SeedTreeEdge[],
  incoming: SeedTreeEdge[]
): SeedTreeEdge[] {
  const key = (e: SeedTreeEdge) =>
    `${e.from_github}|${e.to_github}|${e.via}|${e.hop ?? 1}|${e.via_node ?? ""}`;
  const map = new Map(existing.map((e) => [key(e), e]));
  for (const e of incoming) map.set(key(e), e);
  return [...map.values()];
}

function neighborSlug(n: WebsiteNeighborInput): string {
  const login =
    n.github?.username?.toLowerCase() ??
    githubUsernameFromUrl(n.github_url ?? n.github?.profile_url ?? null);
  return login || slugify(n.name);
}

export function isLinkedInConfirmed(person: WebsiteNeighborInput): boolean {
  return Boolean(person.linkedin?.url);
}

function mergeTreeAndCandidates(
  seed: WebsiteGraphHost,
  edges: SeedTreeEdge[],
  raw: RawCandidate[]
): void {
  const existingTree = loadExistingSeedTree();
  const treePath = path.resolve(path.dirname(OUTPUT_PATH), "seed_tree.json");
  fs.mkdirSync(path.dirname(treePath), { recursive: true });
  const seeds = existingTree.seeds.length
    ? existingTree.seeds
    : [
        {
          name: seed.host_name,
          github: seed.github ? `https://github.com/${seed.github}` : null,
          website: seed.websiteUrl,
        },
      ];
  writeJsonAtomic(treePath, {
    generated_at: new Date().toISOString(),
    seeds,
    edges: mergeEdges(existingTree.edges, edges),
  });

  if (!raw.length) return;
  const merged = mergeCandidates([
    ...loadExistingCandidates().map((c) => ({
      key: c.key,
      name: c.name,
      discovered_via: c.discovered_via,
      linkedin: c.linkedin,
      identity_confidence: c.identity_confidence,
      github: c.github,
      substack: c.substack,
      website: c.website,
      olympiad: c.olympiad,
    })),
    ...raw,
  ]);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeJsonAtomic(OUTPUT_PATH, merged);
}

/**
 * Hang LinkedIn-confirmed people on the host as website-colocated neighbors.
 * Zero confirmed → no tree write.
 */
export function attachWebsiteColocatedNeighbors(input: {
  seed_slug: string;
  host_slug?: string;
  page_url: string;
  people: WebsiteNeighborInput[];
}): {
  edges: SeedTreeEdge[];
  attached: number;
} {
  const host = locateWebsiteGraphHost({
    seed_slug: input.seed_slug,
    host_slug: input.host_slug,
  });
  if ("error" in host) {
    throw new Error(host.error);
  }
  const confirmed = input.people.filter(isLinkedInConfirmed);
  if (!confirmed.length) {
    log("no LinkedIn-confirmed neighbors — skip tree write");
    return { edges: [], attached: 0 };
  }

  const fromGithub =
    host.host_hop === 0
      ? host.github || host.seed_slug
      : host.host_slug;
  const via = `website-colocated:${input.page_url}`;
  const hop: 1 | 2 = host.host_hop === 0 ? 1 : 2;
  const parentRelation: NeighborRelation | undefined =
    hop === 2 && host.host_relation !== "seed"
      ? host.host_relation
      : undefined;
  const edges: SeedTreeEdge[] = [];
  const raw: RawCandidate[] = [];

  for (const person of confirmed) {
    const to = neighborSlug(person);
    const confidence = person.identity_confidence ?? 0.7;
    const edge: SeedTreeEdge = {
      from: host.host_name,
      from_github: fromGithub,
      to_github: to,
      via: "website-colocated",
      hop,
      context_signals: ["website-colocated"],
    };
    if (hop === 2) {
      edge.via_node = host.host_slug;
      edge.root_github = host.github || host.seed_slug;
      edge.parent_relation = parentRelation ?? "collaborator";
    }
    edges.push(edge);
    upsertProfile({
      name: person.name,
      slug: to,
      seed: host.seed_slug,
      relation: "website",
      hop,
      parentSlug: hop === 2 ? host.host_slug : undefined,
      parentRelation: hop === 2 ? parentRelation : undefined,
      discovered_via: [via],
      parents:
        hop === 2 ? [host.seed_slug, host.host_slug] : [host.seed_slug],
      linkedin: person.linkedin,
      github: person.github,
      website: person.website,
    });
    upsertPerson({
      name: person.name,
      linkedin: person.linkedin,
      github: person.github,
      website: person.website,
      links: {
        linkedin_url: person.linkedin?.url ?? person.linkedin_url ?? undefined,
        github_url:
          person.github?.profile_url ??
          person.github_url ??
          person.linkedin?.github_url ??
          undefined,
        personal_website: person.website?.url ?? undefined,
      },
      identity: {
        status: "resolved",
        confidence,
        resolved_at: new Date().toISOString(),
      },
      graph: { discovered_via: [via] },
    });
    raw.push({
      key: nameKey(person.name),
      name: person.name,
      discovered_via: [via],
      linkedin: person.linkedin,
      identity_confidence: confidence,
      github: person.github,
      website: person.website,
    });

    const cand = mergeCandidates([raw[raw.length - 1]!])[0];
    if (cand) {
      const cid = identityFromCandidate(cand).candidate_id;
      rewriteMarkId(pageHitMarkId(input.page_url, person.name), cid, {
        candidate_id: cid,
        name: person.name,
      });
    }
  }

  mergeTreeAndCandidates(host, edges, raw);
  return { edges, attached: confirmed.length };
}

/** Hop-2 GitHub collabs under a hop-1 website neighbor. Hop-3 is refused. */
export function attachGithubCollaboratorsUnderHost(input: {
  seed_slug: string;
  parent_slug: string;
  parent_relation: NeighborRelation;
  parent_hop: 1 | 2;
  collaborators: Array<{ login: string; profile: GitHubProfile }>;
}): { edges: SeedTreeEdge[]; attached: number } {
  if (input.parent_hop !== 1) {
    log("skip GitHub expand — parent is hop-2 (no hop-3)");
    return { edges: [], attached: 0 };
  }
  const host = locateWebsiteGraphHost({
    seed_slug: input.seed_slug,
    host_slug: input.seed_slug,
  });
  if ("error" in host) throw new Error(host.error);
  const rootGithub = host.github || host.seed_slug;
  const via = `github-collaborator:${input.parent_slug}`;
  const edges: SeedTreeEdge[] = [];
  const raw: RawCandidate[] = [];

  for (const { login, profile } of input.collaborators) {
    const to = login.toLowerCase();
    edges.push({
      from: input.parent_slug,
      from_github: input.parent_slug,
      to_github: to,
      via: "github-collaborator",
      hop: 2,
      via_node: input.parent_slug,
      root_github: rootGithub,
      parent_relation: input.parent_relation,
      context_score: profile.context_score,
      context_signals: profile.context_signals,
    });
    upsertProfile({
      name: profile.display_name || login,
      slug: to,
      seed: host.seed_slug,
      relation: "collaborator",
      hop: 2,
      parentSlug: input.parent_slug,
      parentRelation: input.parent_relation,
      discovered_via: [via],
      parents: [host.seed_slug, input.parent_slug],
      github: profile,
    });
    raw.push({
      key: to,
      name: profile.display_name || login,
      discovered_via: [via],
      github: profile,
      identity_confidence: 0,
    });
  }

  mergeTreeAndCandidates(host, edges, raw);
  return { edges, attached: input.collaborators.length };
}

async function scrapeLinkedInByUrl(
  url: string,
  name: string
): Promise<LinkedInProfile | null> {
  if (!fs.existsSync(COOKIES_PATH)) {
    log(`missing cookies — skip ${url}`);
    return null;
  }
  try {
    const session = await openLinkedInSession();
    const profile = await extractLinkedInProfile(
      session,
      { url, title: name, headline: "", location: "", snippet: "" },
      name
    );
    await session.close();
    return profile;
  } catch (err) {
    log(
      `linkedin scrape failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

async function followOnGithub(person: WebsiteNeighborInput): Promise<void> {
  if (!person.linkedin) return;
  const identity: ResolvedIdentity = {
    query_name: person.name,
    linkedin: person.linkedin,
    identity_confidence: person.identity_confidence ?? 0.8,
    github_url:
      person.github_url ??
      person.linkedin.github_url ??
      person.website?.github_url ??
      null,
    substack_url: person.linkedin.substack_url,
    website: person.website ?? null,
  };
  await enrichIdentityFromWebsite(identity);
  await enqueueVerifiedGithub(identity);
  person.github_url = identity.github_url ?? person.github_url;
  person.website = identity.website ?? person.website;
}

export function readWebsiteGraphJob(): WebsiteGraphJob | null {
  const file = process.env.WEBSITE_GRAPH_JOB?.trim();
  if (!file || process.env.WEBSITE_GRAPH !== "1") return null;
  return readJson<WebsiteGraphJob>(file);
}

export async function runWebsiteGraphIngest(job: WebsiteGraphJob): Promise<void> {
  const host = locateWebsiteGraphHost({
    seed_slug: job.seed_slug,
    host_slug: job.host_slug,
  });
  if ("error" in host) throw new Error(host.error);
  const names = uniqueNames(job.names, WEBSITE_GRAPH_INGEST_LIMIT);
  log(
    `seed=${host.seed_slug} host=${host.host_slug} hop=${host.host_hop} page=${job.url} names=${names.length}`
  );

  const olympiadIndex = fs.existsSync(OLYMPIAD_CSV_PATH)
    ? loadOlympiadCsv(OLYMPIAD_CSV_PATH)
    : new Map();
  const existing = loadExistingCandidates();

  const withUrl: string[] = [];
  const needSearch: SeedQuery[] = [];
  for (const name of names) {
    const hint = hintForName(name, job.hints);
    if (hint?.linkedin_url) withUrl.push(name);
    else {
      needSearch.push({
        name,
        org_hint: searchOrgHint(name, job.org_hint, job.hints),
      });
    }
  }

  const people: WebsiteNeighborInput[] = [];

  for (const name of withUrl) {
    const hint = hintForName(name, job.hints)!;
    log(`linkedin url for ${name}`);
    const linkedin = await scrapeLinkedInByUrl(hint.linkedin_url!, name);
    const person: WebsiteNeighborInput = {
      name,
      linkedin: linkedin ?? undefined,
      linkedin_url: hint.linkedin_url,
      github_url: hint.github_url,
      identity_confidence: linkedin ? 0.8 : 0.2,
    };
    if (linkedin) await followOnGithub(person);
    people.push(person);
  }

  if (needSearch.length) {
    const { resolved, failed } = await resolveIdentities(
      needSearch,
      olympiadIndex,
      existing,
      { requireTargetedSearch: true }
    );
    const byKey = new Map(resolved.map((i) => [nameKey(i.query_name), i]));
    for (const seedQ of needSearch) {
      const ident = byKey.get(nameKey(seedQ.name));
      const hint = hintForName(seedQ.name, job.hints);
      if (ident) {
        people.push({
          name: ident.query_name,
          linkedin: ident.linkedin,
          website: ident.website ?? undefined,
          linkedin_url: ident.linkedin.url,
          github_url:
            hint?.github_url ??
            ident.github_url ??
            ident.website?.github_url ??
            undefined,
          identity_confidence: ident.identity_confidence,
        });
      } else {
        const miss = failed.find(
          (f) => nameKey(f.seed.name) === nameKey(seedQ.name)
        );
        log(`${seedQ.name} → ${miss?.reason ?? "unresolved"}`);
      }
    }
  }

  for (const person of people) {
    const login =
      githubUsernameFromUrl(person.github_url ?? null) ??
      githubUsernameFromUrl(person.linkedin?.github_url ?? null) ??
      githubUsernameFromUrl(person.website?.github_url ?? null);
    if (!login || person.github) continue;
    log(`github profile ${login}`);
    const gh = await fetchGithubProfile(login);
    if (gh) person.github = gh;
  }

  const { attached } = attachWebsiteColocatedNeighbors({
    seed_slug: host.seed_slug,
    host_slug: host.host_slug,
    page_url: job.url,
    people,
  });
  log(
    `attached ${attached} LinkedIn-confirmed website-colocated neighbors under ${host.host_slug}`
  );

  if (!attached) return;

  const neighborHop: 1 | 2 = host.host_hop === 0 ? 1 : 2;
  if (neighborHop !== 1) {
    log("skip GitHub collab expand — teammates are hop-2");
    return;
  }

  for (const person of people.filter(isLinkedInConfirmed)) {
    const login =
      person.github?.username ??
      githubUsernameFromUrl(person.github_url ?? null) ??
      githubUsernameFromUrl(person.linkedin?.github_url ?? null);
    if (!login) continue;
    log(`expand collaborators for ${login}`);
    const expanded = await expandGithubFromUrl(`https://github.com/${login}`);
    const collabs: Array<{ login: string; profile: GitHubProfile }> = [];
    for (const collabLogin of expanded.collaborators.slice(
      0,
      MAX_COLLABORATOR_PROFILES
    )) {
      const profile =
        collabLogin.toLowerCase() === login.toLowerCase()
          ? expanded.profile
          : await fetchGithubProfile(collabLogin, { includeRecentCommits: false });
      if (!profile) continue;
      collabs.push({ login: collabLogin, profile });
    }
    if (!collabs.length) continue;
    const { attached: n } = attachGithubCollaboratorsUnderHost({
      seed_slug: host.seed_slug,
      parent_slug: neighborSlug(person),
      parent_relation: "website",
      parent_hop: 1,
      collaborators: collabs,
    });
    log(`attached ${n} GitHub collaborators under ${login}`);
  }
}
