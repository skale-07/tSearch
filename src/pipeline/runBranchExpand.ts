import fs from "fs";
import path from "path";
import {
  COOKIES_PATH,
  MAX_FOLLOWER_PROFILES,
  MIN_CONTEXT_SCORE_TO_EXPAND,
  OLYMPIAD_CSV_PATH,
  OUTPUT_PATH,
} from "../config.js";
import { expandGithubFromUrl } from "../github/githubExpand.js";
import { fetchGithubProfile } from "../github/githubUser.js";
import { openLinkedInSession } from "../linkedin/linkedinBrowser.js";
import { extractLinkedInProfile } from "../linkedin/linkedinExtract.js";
import { loadOlympiadCsv, lookupOlympiad } from "../olympiad/parseOlympiad.js";
import {
  type ProfileRelation,
  upsertProfile,
} from "../storage/profileStore.js";
import { slugify } from "../storage/jsonStore.js";
import type { LinkedInProfile, WebsiteProfile } from "../types.js";
import {
  applyWebsiteToLinkedInUrls,
  scrapeWebsite,
} from "../website/scrapeWebsite.js";
import type { SeedTreeEdge } from "./expandGraph.js";
import { mergeCandidates } from "./mergeCandidates.js";

const MAX_COLLABORATOR_PROFILES = Number(
  process.env.MAX_COLLABORATOR_PROFILES ?? 15
);

function log(step: string, detail?: string): void {
  const ts = new Date().toLocaleTimeString();
  console.log(detail ? `[${ts}] ${step} — ${detail}` : `[${ts}] ${step}`);
}

export interface BranchExpandEnv {
  root: string;
  parent: string;
  relation: "collaborator" | "follower";
  linkedinUrl: string;
  githubUrl: string;
  name: string;
}

export function readBranchExpandEnv(): BranchExpandEnv | null {
  if (process.env.BRANCH_EXPAND !== "1") return null;
  const root = process.env.BRANCH_ROOT?.trim();
  const parent = process.env.BRANCH_PARENT?.trim();
  const relation = process.env.BRANCH_RELATION?.trim() as
    | "collaborator"
    | "follower"
    | undefined;
  const linkedinUrl = process.env.BRANCH_LINKEDIN?.trim();
  const githubUrl = process.env.BRANCH_GITHUB?.trim();
  const name = process.env.BRANCH_NAME?.trim();
  if (
    !root ||
    !parent ||
    !linkedinUrl ||
    !githubUrl ||
    !name ||
    (relation !== "collaborator" && relation !== "follower")
  ) {
    return null;
  }
  return { root, parent, relation, linkedinUrl, githubUrl, name };
}

function stubLinkedIn(url: string, name: string): LinkedInProfile {
  return {
    url,
    name,
    photo_url: null,
    headline: null,
    college: null,
    school: null,
    degree: null,
    country: null,
    graduation_year: null,
    education: [],
    keywords: [],
    github_url: null,
    substack_url: null,
    twitter_url: null,
    personal_website: null,
    website_url: null,
    contact_links: [],
    experience: [],
    awards: [],
    skills: [],
  };
}

function loadExistingSeedTree(): {
  generated_at?: string;
  seeds: { name: string; github: string | null; website?: string | null }[];
  edges: SeedTreeEdge[];
} {
  const treePath = path.resolve(path.dirname(OUTPUT_PATH), "seed_tree.json");
  if (!fs.existsSync(treePath)) {
    return { seeds: [], edges: [] };
  }
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

async function scrapeLinkedInByUrl(
  url: string,
  name: string
): Promise<LinkedInProfile | null> {
  if (!fs.existsSync(COOKIES_PATH)) {
    log("linkedin", `missing cookies — skipping scrape`);
    return null;
  }
  try {
    const session = await openLinkedInSession();
    log("linkedin", `scraping known URL ${url}`);
    const profile = await extractLinkedInProfile(
      session,
      {
        url,
        title: name,
        headline: "",
        location: "",
        snippet: "",
      },
      name
    );
    await session.close();
    return profile;
  } catch (err) {
    log(
      "linkedin",
      `scrape failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

async function websiteFromBlog(
  blog: string | null | undefined
): Promise<WebsiteProfile | undefined> {
  const raw = blog?.trim();
  if (!raw) return undefined;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return (await scrapeWebsite(url)) ?? undefined;
}

/**
 * Branch expand: known LinkedIn URL + known GitHub → enrich parent, grow hop-2.
 */
export async function runBranchExpand(env: BranchExpandEnv): Promise<void> {
  const root = slugify(env.root);
  const parent = slugify(env.parent);
  const parentRelation = env.relation;

  log("branch", `root=${root} parent=${parent} (${parentRelation})`);
  log("branch", `linkedin=${env.linkedinUrl}`);
  log("branch", `github=${env.githubUrl} (forced)`);

  const olympiadIndex = fs.existsSync(OLYMPIAD_CSV_PATH)
    ? loadOlympiadCsv(OLYMPIAD_CSV_PATH)
    : new Map();

  let linkedin = await scrapeLinkedInByUrl(env.linkedinUrl, env.name);
  if (!linkedin) {
    log("branch", "LinkedIn unavailable — continuing with GitHub-only expand");
    linkedin = stubLinkedIn(env.linkedinUrl, env.name);
  }

  let website: WebsiteProfile | null = null;
  const siteUrl = linkedin.personal_website ?? linkedin.website_url;
  if (siteUrl) {
    log("website", `scraping ${siteUrl}`);
    website = await scrapeWebsite(siteUrl);
    if (website) {
      const merged = applyWebsiteToLinkedInUrls(
        linkedin.github_url,
        linkedin.substack_url,
        linkedin.twitter_url,
        website
      );
      // Never let LinkedIn/website replace the known branch GitHub.
      linkedin = {
        ...linkedin,
        github_url: env.githubUrl,
        substack_url: merged.substack_url,
        twitter_url: merged.twitter_url,
        personal_website: website.url || linkedin.personal_website,
        website_url: website.url || linkedin.website_url,
      };
      if (merged.overrides.length) {
        log("website", `overrides → ${merged.overrides.join("; ")}`);
      }
    }
  } else {
    linkedin = { ...linkedin, github_url: env.githubUrl };
  }

  log("expand", `GitHub expand from ${env.githubUrl}`);
  const gh = await expandGithubFromUrl(env.githubUrl);
  if (!gh.profile) {
    throw new Error(`Failed to expand GitHub ${env.githubUrl}`);
  }

  // Upsert enriched hop-1 parent under the root.
  upsertProfile({
    name: linkedin.name || env.name,
    slug: parent,
    seed: root,
    relation: parentRelation,
    hop: 1,
    discovered_via: [
      `branch-expand:${root}`,
      `linkedin-direct:${env.linkedinUrl}`,
    ],
    parents: [root],
    linkedin,
    github: gh.profile,
    website: website ?? undefined,
    olympiad: lookupOlympiad(olympiadIndex, linkedin.name || env.name),
  });

  const hop2Edges: SeedTreeEdge[] = [];
  const hop2Candidates: {
    login: string;
    name: string;
    relation: ProfileRelation;
    github: NonNullable<typeof gh.profile>;
    website?: WebsiteProfile;
  }[] = [];

  log(
    "expand",
    `collaborators (${gh.collaborators.length}): ${gh.collaborators.slice(0, 10).join(", ") || "—"}`
  );

  for (const login of gh.collaborators.slice(0, MAX_COLLABORATOR_PROFILES)) {
    const profile = await fetchGithubProfile(login, {
      includeRecentCommits: false,
    });
    if (!profile) continue;
    const site = await websiteFromBlog(profile.blog);
    const display = profile.display_name || login;
    hop2Candidates.push({
      login,
      name: display,
      relation: "collaborator",
      github: profile,
      website: site,
    });
    hop2Edges.push({
      from: env.name,
      from_github: parent,
      to_github: login,
      via: "github-collaborator",
      hop: 2,
      via_node: parent,
      root_github: root,
      parent_relation: parentRelation,
      context_score: profile.context_score,
      context_signals: profile.context_signals,
    });
  }

  const followerProfiles: {
    login: string;
    profile: NonNullable<Awaited<ReturnType<typeof fetchGithubProfile>>>;
  }[] = [];
  for (const login of gh.profile.followers.slice(0, MAX_FOLLOWER_PROFILES)) {
    const profile = await fetchGithubProfile(login, {
      includeRecentCommits: false,
    });
    if (!profile) continue;
    followerProfiles.push({ login, profile });
  }
  followerProfiles.sort(
    (a, b) => b.profile.context_score - a.profile.context_score
  );
  const rich = followerProfiles.filter(
    (f) => f.profile.context_score >= MIN_CONTEXT_SCORE_TO_EXPAND
  );
  log(
    "expand",
    `rich followers: ${rich.map((f) => `${f.login}(${f.profile.context_score})`).join(", ") || "—"}`
  );

  for (const { login, profile } of rich) {
    const site = await websiteFromBlog(profile.blog);
    const display = profile.display_name || login;
    hop2Candidates.push({
      login,
      name: display,
      relation: "follower",
      github: profile,
      website: site,
    });
    hop2Edges.push({
      from: env.name,
      from_github: parent,
      to_github: login,
      via: "github-follower",
      hop: 2,
      via_node: parent,
      root_github: root,
      parent_relation: parentRelation,
      context_score: profile.context_score,
      context_signals: profile.context_signals,
    });
  }

  for (const c of hop2Candidates) {
    upsertProfile({
      name: c.name,
      slug: c.login,
      seed: root,
      relation: c.relation,
      hop: 2,
      parentSlug: parent,
      parentRelation,
      discovered_via: [`github-${c.relation}:${parent}`],
      parents: [root, parent],
      github: c.github,
      website: c.website,
      olympiad: lookupOlympiad(olympiadIndex, c.name),
    });
  }

  const existing = loadExistingSeedTree();
  const edges = mergeEdges(existing.edges, hop2Edges);
  const treePath = path.resolve(path.dirname(OUTPUT_PATH), "seed_tree.json");
  fs.mkdirSync(path.dirname(treePath), { recursive: true });
  fs.writeFileSync(
    treePath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        seeds: existing.seeds.length
          ? existing.seeds
          : [
              {
                name: root,
                github: `https://github.com/${root}`,
                website: null,
              },
            ],
        edges,
      },
      null,
      2
    ),
    "utf-8"
  );

  // Light-touch candidates merge so hop-2 people appear in output/
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const existingCand = JSON.parse(
        fs.readFileSync(OUTPUT_PATH, "utf-8")
      ) as unknown[];
      const raw = hop2Candidates.map((c) => ({
        key: c.login.toLowerCase(),
        name: c.name,
        discovered_via: [`github-${c.relation}:${parent}`],
        github: c.github,
        website: c.website,
        identity_confidence: 0,
      }));
      const parentRaw = {
        key: parent.toLowerCase(),
        name: linkedin.name || env.name,
        discovered_via: [`branch-expand:${root}`],
        linkedin,
        github: gh.profile,
        website: website ?? undefined,
        identity_confidence: 0.9,
      };
      const ranked = mergeCandidates([
        parentRaw,
        ...raw,
        ...(Array.isArray(existingCand)
          ? existingCand.map((c) => {
              const x = c as {
                key?: string;
                name: string;
                discovered_via?: string[];
                linkedin?: LinkedInProfile;
                github?: typeof gh.profile;
                website?: WebsiteProfile;
                identity_confidence?: number;
                olympiad?: unknown;
                substack?: unknown;
              };
              return {
                key: x.key ?? x.name.toLowerCase(),
                name: x.name,
                discovered_via: x.discovered_via ?? [],
                linkedin: x.linkedin,
                github: x.github,
                website: x.website,
                identity_confidence: x.identity_confidence ?? 0,
                olympiad: x.olympiad as never,
                substack: x.substack as never,
              };
            })
          : []),
      ]);
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(ranked, null, 2), "utf-8");
    } catch (err) {
      log(
        "merge",
        `candidates merge skipped: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  log(
    "done",
    `branch expand wrote ${hop2Candidates.length} hop-2 profiles under ${root}/${parentRelation}s/${parent}/`
  );
}
