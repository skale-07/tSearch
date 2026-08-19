import fs from "fs";
import path from "path";
import {
  COOKIES_PATH,
  MIN_TREE_CONTEXT_SCORE,
  OUTPUT_PATH,
  PROFILES_DIR,
  SEEDS_PATH,
} from "../src/config.js";
import type { ProfileRecord, ProfileRelation } from "../src/storage/profileStore.js";
import {
  linkedInUrlFromProfile,
  profileFilePath,
  relationDir,
} from "../src/storage/profileStore.js";
import { slugify } from "../src/storage/jsonStore.js";
import { loadConvergenceMap } from "../src/pipeline/convergence.js";
import {
  computeIdentitySurfaceScore,
  SURFACE_SCORE_MAX,
} from "../src/github/identitySurface.js";
import { ageFromPublicIdentity } from "../src/assessment/stage/deriveStage.js";
import { loadPerson } from "../src/storage/personStore.js";
import { loadAllPeople } from "../src/pipeline/convergence.js";
import { githubUsernameFromUrl } from "../src/linkedin/linkedinExtract.js";
import type { Candidate, LinkedInProfile, OlympiadProfile } from "../src/types.js";

/** Profile dirs are keyed by GitHub login when known, else name slug. */
function seedSlugsForPerson(
  name: string,
  githubUrl: string | null | undefined
): string[] {
  const slugs = [slugify(name)];
  const login = githubUsernameFromUrl(githubUrl ?? null);
  if (login) {
    const loginSlug = slugify(login);
    if (!slugs.includes(loginSlug)) slugs.push(loginSlug);
  }
  return slugs;
}

function personHasHop1Tree(
  name: string,
  githubUrl: string | null | undefined,
  withTree: Set<string>
): boolean {
  return seedSlugsForPerson(name, githubUrl).some((s) => withTree.has(s));
}

export interface TreeOption {
  slug: string;
  name: string;
  age_label: string | null;
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
  has_linkedin: boolean;
  has_writing_surface: boolean;
  /** Off-GitHub identity surface (LinkedIn/writing weighted > X). */
  surface_score: number;
  surface_signals: string[];
  surface_score_max: number;
  can_expand: boolean;
  /** Reachable from 2+ seed-set members (convergence heuristic). */
  bridge_seed_count?: number;
  bridge_seeds?: string[];
  /** Stated age or ~estimate from LinkedIn/olympiad. Null when unknown. */
  age_label: string | null;
}

export interface TreeEdge {
  from: string;
  to: string;
  via: "github-collaborator" | "github-follower";
  context_score: number;
  hop: 1 | 2;
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

function listNeighborDirs(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

type AgeSources = {
  linkedin?: LinkedInProfile;
  olympiad?: OlympiadProfile;
};

function candidateAgeIndex(): {
  byName: Map<string, AgeSources>;
  byGithub: Map<string, AgeSources>;
} {
  const byName = new Map<string, AgeSources>();
  const byGithub = new Map<string, AgeSources>();
  try {
    const raw = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8")) as unknown;
    if (!Array.isArray(raw)) return { byName, byGithub };
    for (const c of raw as Candidate[]) {
      const src: AgeSources = { linkedin: c.linkedin, olympiad: c.olympiad };
      if (c.name) byName.set(normName(c.name), src);
      const gh = c.github?.username?.toLowerCase();
      if (gh) byGithub.set(gh, src);
    }
  } catch {
    /* candidates.json missing — person/profile only */
  }
  return { byName, byGithub };
}

function ageLabelForProfile(
  p: ProfileRecord,
  index: ReturnType<typeof candidateAgeIndex>
): string | null {
  const direct = ageFromPublicIdentity({
    linkedin: p.linkedin,
    olympiad: p.olympiad,
  });
  if (direct.age_label) return direct.age_label;

  const rec = loadPerson(p.name);
  if (rec) {
    const linkedin =
      rec.identity.status !== "no_name_match" ? rec.linkedin : undefined;
    const fromPerson = ageFromPublicIdentity({
      linkedin,
      olympiad: rec.olympiad ?? p.olympiad,
    });
    if (fromPerson.age_label) return fromPerson.age_label;
  }

  const fromName = index.byName.get(normName(p.name));
  if (fromName) {
    const hit = ageFromPublicIdentity(fromName);
    if (hit.age_label) return hit.age_label;
  }
  const gh = p.github?.username?.toLowerCase();
  if (gh) {
    const fromGh = index.byGithub.get(gh);
    if (fromGh) {
      const hit = ageFromPublicIdentity(fromGh);
      if (hit.age_label) return hit.age_label;
    }
  }
  return null;
}

function toSummary(
  p: ProfileRecord,
  index: ReturnType<typeof candidateAgeIndex> = candidateAgeIndex()
): TreeNodeSummary {
  const linkedin_url = linkedInUrlFromProfile(p) ?? undefined;
  const website_url =
    p.links?.personal_website?.trim() ||
    p.website?.url?.trim() ||
    undefined;
  const blogRaw = p.links?.blog?.trim() || p.github?.blog?.trim() || undefined;
  const blog_url =
    blogRaw && blogRaw !== website_url ? blogRaw : website_url ? undefined : blogRaw;
  const writing = website_url || blogRaw || undefined;
  const surface = computeIdentitySurfaceScore({
    linkedin_url,
    website_url,
    blog_url: blogRaw,
    twitter_url: p.links?.twitter_url,
    twitter_username: p.github?.twitter_username,
    email: p.links?.email ?? p.github?.email,
    social_accounts:
      p.links?.social_accounts ?? p.github?.social_accounts ?? null,
  });
  const hop = p.hop ?? (p.relation === "seed" ? 0 : 1);
  return {
    id: hop === 2 && p.parents.length > 1 ? `${p.parents[1]}:${p.slug}` : p.slug,
    name: p.name,
    relation: p.relation,
    hop: hop as 0 | 1 | 2,
    parentId: hop === 2 ? p.parents[p.parents.length - 1] : hop === 1 ? p.seed : undefined,
    context_score: p.context_score ?? 0,
    context_signals: p.context_signals ?? [],
    photo_url: p.linkedin?.photo_url ?? undefined,
    linkedin_url,
    website_url,
    blog_url,
    has_linkedin: !!linkedin_url,
    has_writing_surface: !!writing,
    surface_score: surface.score,
    surface_signals: surface.signals,
    surface_score_max: SURFACE_SCORE_MAX,
    can_expand: hop === 1 && !!linkedin_url,
    age_label: ageLabelForProfile(p, index),
  };
}

function githubLoginFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/?#]+)/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

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
  if (tree.seeds.length === 1) {
    return githubLoginFromUrl(tree.seeds[0].github);
  }
  return null;
}

export function loadProfile(
  seedSlug: string,
  relation: ProfileRelation,
  nodeSlug?: string,
  opts?: {
    hop?: 0 | 1 | 2;
    parentSlug?: string;
    parentRelation?: "collaborator" | "follower";
  }
): ProfileRecord | null {
  const seed = slugify(seedSlug);
  const file = profileFilePath({
    seed,
    relation,
    slug: nodeSlug,
    hop: opts?.hop ?? (relation === "seed" ? 0 : opts?.parentSlug ? 2 : 1),
    parentSlug: opts?.parentSlug,
    parentRelation: opts?.parentRelation,
  });
  return readJson<ProfileRecord>(file);
}

/** Logins that pollute hop graphs but aren't GitHub Apps/bots. */
const TREE_EXCLUDED_LOGINS = new Set([
  "idouble", // "Alp ₿📈🚀🌕" — crypto-spam persona, appears under many seeds
  "standardgalactic", // "Cogito Ergo Sum" — spam/agent persona across trees
]);

function isBotLogin(slug: string, name: string): boolean {
  const login = slug.toLowerCase();
  if (TREE_EXCLUDED_LOGINS.has(login)) return true;
  const s = `${slug} ${name}`.toLowerCase();
  return (
    /\[bot\]/.test(s) ||
    /(^|[\s_-])bot($|[\s_-])/.test(s) ||
    /dependabot|renovate|github-actions|actions-user|opencode-agent/.test(s)
  );
}

function includeOnTree(p: ProfileRecord, hop: 0 | 1 | 2): boolean {
  if (hop === 0) return true;
  if (isBotLogin(p.slug, p.name)) return false;
  // Prefer root score; fall back to github.context_score if root missing
  const score = Number(
    p.context_score ?? p.github?.context_score ?? 0
  );
  // Hop-1 and hop-2 (incl. under Arihant): hide scores ≤ 3
  return score >= MIN_TREE_CONTEXT_SCORE;
}

export function buildTree(seedSlug: string): TreeResponse | null {
  const seed = slugify(seedSlug);
  const seedProfile = loadProfile(seed, "seed");
  if (!seedProfile) return null;

  const index = candidateAgeIndex();
  const nodes: TreeNodeSummary[] = [toSummary({ ...seedProfile, hop: 0 }, index)];
  const edges: TreeEdge[] = [];
  const seenNode = new Set<string>([seed]);

  for (const parentRel of ["collaborator", "follower"] as const) {
    const folder = relationDir(parentRel)!;
    const hop1Dir = path.join(PROFILES_DIR, seed, folder);
    for (const login of listNeighborDirs(hop1Dir)) {
      const p = loadProfile(seed, parentRel, login, { hop: 1 });
      if (!p || !includeOnTree(p, 1)) continue;
      const summary = toSummary({ ...p, hop: 1, parents: [seed] }, index);
      if (!seenNode.has(summary.id)) {
        nodes.push(summary);
        seenNode.add(summary.id);
      }
      edges.push({
        from: seed,
        to: summary.id,
        via:
          parentRel === "collaborator"
            ? "github-collaborator"
            : "github-follower",
        context_score: p.context_score ?? 0,
        hop: 1,
      });

      for (const childRel of ["collaborator", "follower"] as const) {
        const childFolder = relationDir(childRel)!;
        const hop2Dir = path.join(hop1Dir, login, childFolder);
        for (const childLogin of listNeighborDirs(hop2Dir)) {
          const child = loadProfile(seed, childRel, childLogin, {
            hop: 2,
            parentSlug: login,
            parentRelation: parentRel,
          });
          if (!child || !includeOnTree(child, 2)) continue;
          const childSummary = toSummary({
            ...child,
            hop: 2,
            parents: [seed, login],
          }, index);
          if (!seenNode.has(childSummary.id)) {
            nodes.push(childSummary);
            seenNode.add(childSummary.id);
          }
          edges.push({
            from: login,
            to: childSummary.id,
            via:
              childRel === "collaborator"
                ? "github-collaborator"
                : "github-follower",
            context_score: child.context_score ?? 0,
            hop: 2,
          });
        }
      }
    }
  }

  // Annotate multi-seed bridges (convergence store spans ALL seed trees, so
  // this is where cross-tree overlap becomes visible inside one tree).
  const convergence = loadConvergenceMap();
  if (convergence.size) {
    for (const node of nodes) {
      const login = (
        node.id.includes(":") ? node.id.split(":")[1] : node.id
      ).toLowerCase();
      const bridge = convergence.get(login);
      if (bridge) {
        node.bridge_seed_count = bridge.seed_count;
        node.bridge_seeds = bridge.seeds;
      }
    }
  }

  return { seedSlug: seed, seed: seedProfile, nodes, edges };
}

export function seedHasHop1Neighbors(seedSlug: string): boolean {
  const root = path.join(PROFILES_DIR, seedSlug);
  for (const rel of ["collaborators", "followers"] as const) {
    const dir = path.join(root, rel);
    if (!fs.existsSync(dir)) continue;
    const hasChild = fs
      .readdirSync(dir, { withFileTypes: true })
      .some(
        (d) =>
          d.isDirectory() &&
          fs.existsSync(path.join(dir, d.name, "profile.json"))
      );
    if (hasChild) return true;
  }
  return false;
}

/** Every seed profile dir, including those with no hop-1 graph. Assess uses this. */
export function listAllSeedProfileSlugs(): string[] {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs
    .readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) =>
      fs.existsSync(path.join(PROFILES_DIR, d.name, "profile.json"))
    )
    .map((d) => d.name);
}

/** Seed roots that have a hop-1 graph (collaborator and/or follower nodes). */
export function listProfileSeeds(): string[] {
  return listAllSeedProfileSlugs().filter((slug) => seedHasHop1Neighbors(slug));
}

export function listTreeOptions(): TreeOption[] {
  const index = candidateAgeIndex();
  return listProfileSeeds().map((slug) => {
    const p = loadProfile(slug, "seed");
    return {
      slug,
      name: p?.name ?? slug,
      age_label: p ? ageLabelForProfile(p, index) : null,
      hasTree: true,
    };
  });
}

export function listSeedOptions(): Array<{
  name: string;
  country: string;
  hasTree: boolean;
}> {
  const withTree = new Set(listProfileSeeds());
  const people = loadAllPeople();
  const byName = new Map(people.map((p) => [p.name.trim().toLowerCase(), p]));
  return loadSeedsFile().map((s) => {
    const rec = byName.get(s.name.trim().toLowerCase());
    const github = rec?.links.github_url ?? rec?.linkedin?.github_url;
    return {
      ...s,
      hasTree: personHasHop1Tree(s.name, github, withTree),
    };
  });
}

export function profileWithAgeLabel(p: ProfileRecord): ProfileRecord & {
  age_label: string | null;
} {
  return { ...p, age_label: ageLabelForProfile(p, candidateAgeIndex()) };
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

export { linkedInUrlFromProfile };
