#!/usr/bin/env node
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  CACHE_DIR,
  CONVERGENCE_PATH,
  COOKIES_PATH,
  GITHUB_TOKEN_SOURCE,
  OLYMPIAD_CSV_PATH,
  OUTPUT_PATH,
  PEOPLE_DIR,
  PROFILES_DIR,
  SEEDS_PATH,
  MAX_CANDIDATES,
  RESOLVE_ONLY,
} from "../config.js";
import type { Candidate, OlympiadProfile } from "../types.js";
import { loadOlympiadCsv, lookupOlympiad } from "../olympiad/parseOlympiad.js";
import { parseSeeds, type SeedQuery } from "../seeds/parseSeeds.js";
import { upsertPerson } from "../storage/personStore.js";
import { writeSeedTreeProfiles } from "../storage/profileStore.js";
import {
  loadConvergenceMap,
  refreshConvergenceStore,
} from "./convergence.js";
import { selectAutoAssess } from "./autoAssess.js";
import { hasAnyAssessment } from "../assessment/storage/assessmentRunStore.js";
import { resolveIdentities, type ResolveResults } from "./resolveIdentities.js";
import {
  expandGraph,
  identitiesToSeedPool,
  type IdentityNeighbors,
  type SeedTreeEdge,
} from "./expandGraph.js";
import { mergeCandidates, type RawCandidate } from "./mergeCandidates.js";
import { readBranchExpandEnv, runBranchExpand } from "./runBranchExpand.js";
import {
  readWebsiteGraphJob,
  runWebsiteGraphIngest,
} from "./websiteGraph.js";

function log(step: string, detail?: string): void {
  const ts = new Date().toLocaleTimeString();
  console.log(detail ? `[${ts}] ${step} — ${detail}` : `[${ts}] ${step}`);
}

function normKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
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

function candidateToRaw(c: Candidate): RawCandidate {
  return {
    key: c.key,
    name: c.name,
    discovered_via: c.discovered_via,
    linkedin: c.linkedin,
    identity_confidence: c.identity_confidence,
    github: c.github,
    substack: c.substack,
    website: c.website,
    olympiad: c.olympiad,
  };
}

function persistPeople(
  ranked: Candidate[],
  seeds: SeedQuery[],
  failed: ResolveResults["failed"],
  neighbors: Map<string, IdentityNeighbors>,
  olympiadIndex: Map<string, OlympiadProfile>
): number {
  const now = new Date().toISOString();
  const seedByKey = new Map(seeds.map((s) => [normKey(s.name), s]));
  let written = 0;

  // Every seed plus any discovered candidate with olympiad pedigree gets a
  // per-person metadata file that accumulates across runs.
  for (const c of ranked) {
    const seed = seedByKey.get(c.key);
    if (!seed && !c.olympiad) continue;

    const confirmed = !!c.linkedin && c.identity_confidence >= 0.35;
    const hood = neighbors.get(c.key);

    upsertPerson({
      name: c.name,
      country:
        seed?.country ??
        c.olympiad?.countries[0] ??
        c.linkedin?.country ??
        undefined,
      aliases: [seed?.name ?? "", c.linkedin?.name ?? ""].filter(Boolean),
      olympiad: c.olympiad,
      linkedin: confirmed ? c.linkedin : undefined,
      github: c.github,
      substack: c.substack,
      website: c.website,
      links: {
        linkedin_url: confirmed ? c.linkedin?.url : undefined,
        github_url:
          c.github?.profile_url ??
          c.linkedin?.github_url ??
          c.website?.github_url ??
          undefined,
        substack_url:
          c.substack?.url ??
          c.linkedin?.substack_url ??
          c.website?.substack_url ??
          undefined,
        twitter_url:
          c.linkedin?.twitter_url ?? c.website?.twitter_url ?? undefined,
        email: c.website?.email ?? undefined,
        personal_website: c.linkedin?.personal_website ?? undefined,
        website_url: c.linkedin?.website_url ?? c.website?.url ?? undefined,
        contact_links: c.linkedin?.contact_links,
        instagram_url: c.website?.instagram_url ?? undefined,
        youtube_url: c.website?.youtube_url ?? undefined,
      },
      identity: confirmed
        ? {
            status: "resolved",
            confidence: c.identity_confidence,
            resolved_at: now,
          }
        : { status: "not_attempted", confidence: c.identity_confidence },
      graph: {
        github_neighbors: hood?.github,
        github_collaborators: hood?.collaborators,
        github_followers: hood?.followers,
        substack_neighbors: hood?.substack,
        discovered_via: c.discovered_via,
      },
      scores: { ...c.score_breakdown, final_score: c.final_score },
      freshness: {
        linkedin_checked_at: confirmed ? now : undefined,
        github_checked_at: c.github ? now : undefined,
        substack_checked_at: c.substack ? now : undefined,
        website_checked_at: c.website ? now : undefined,
      },
    });
    written++;
  }

  // Seeds that never resolved still get a record, so failures aren't
  // silently forgotten and can be retried with better context later.
  for (const { seed, reason } of failed) {
    upsertPerson({
      name: seed.name,
      country: seed.country,
      olympiad: lookupOlympiad(olympiadIndex, seed.name),
      identity: { status: reason, confidence: 0 },
    });
    written++;
  }

  return written;
}

async function main(): Promise<void> {
  const branchEnv = readBranchExpandEnv();
  if (branchEnv) {
    log("start", "BRANCH_EXPAND mode — known LinkedIn URL, forced GitHub");
    log("start", `GITHUB_TOKEN=${GITHUB_TOKEN_SOURCE}`);
    await runBranchExpand(branchEnv);
    return;
  }

  const websiteJob = readWebsiteGraphJob();
  if (websiteJob) {
    log("start", "WEBSITE_GRAPH mode — LinkedIn + GitHub profile, no collab expand");
    log("start", `GITHUB_TOKEN=${GITHUB_TOKEN_SOURCE}`);
    await runWebsiteGraphIngest(websiteJob);
    return;
  }

  if (!fs.existsSync(SEEDS_PATH)) {
    console.error(`Missing seeds file: ${SEEDS_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(OLYMPIAD_CSV_PATH)) {
    console.error(`Missing olympiad CSV: ${OLYMPIAD_CSV_PATH}`);
    process.exit(1);
  }

  const seeds = parseSeeds(JSON.parse(fs.readFileSync(SEEDS_PATH, "utf-8")));
  log(
    "start",
    RESOLVE_ONLY
      ? `LinkedIn identity resolve only (${seeds.length} seeds) — no graph expand`
      : `LinkedIn-first pipeline via Playwright (${seeds.length} seeds)`
  );
  log("start", `GITHUB_TOKEN=${GITHUB_TOKEN_SOURCE}`);
  log("start", `COOKIES_PATH=${COOKIES_PATH}`);
  log("start", `CACHE_DIR=${CACHE_DIR}`);

  if (!fs.existsSync(COOKIES_PATH)) {
    // Not fatal anymore: a fully cached run never launches Chromium. Any
    // LinkedIn cache miss will still fail with a clear "run npm run login".
    console.warn(
      `Missing ${COOKIES_PATH} — only cached LinkedIn data can be used. Run "npm run login" before a fresh scrape.`
    );
  }

  log("olympiad", `loading ${OLYMPIAD_CSV_PATH}`);
  const olympiadIndex = loadOlympiadCsv(OLYMPIAD_CSV_PATH);
  log("olympiad", `indexed ${olympiadIndex.size} medalists`);

  const existingCandidates = loadExistingCandidates();
  if (existingCandidates.length) {
    log("cache", `${existingCandidates.length} candidates loaded from ${OUTPUT_PATH}`);
  }

  log("resolve", "LinkedIn identity resolution...");
  const { resolved: identities, failed } = await resolveIdentities(
    seeds,
    olympiadIndex,
    existingCandidates
  );
  log("resolve", `${identities.length}/${seeds.length} identities resolved`);

  if (!identities.length && !existingCandidates.length) {
    console.error("No identities resolved. Check seeds, network, or cookies.json.");
    process.exit(1);
  }

  let pool: Map<string, RawCandidate>;
  let neighbors: Map<string, IdentityNeighbors>;
  let seedTree: SeedTreeEdge[] = [];

  if (!identities.length) {
    log("expand", "skipped — no new identities");
    pool = new Map();
    neighbors = new Map();
  } else if (RESOLVE_ONLY) {
    log("expand", "skipped — RESOLVE_ONLY=1 (use Graph → Run pipeline to expand)");
    const seeded = identitiesToSeedPool(identities, olympiadIndex);
    pool = seeded.pool;
    neighbors = seeded.neighbors;
    seedTree = seeded.seedTree;
  } else {
    log("expand", "GitHub collaborator + rich follower tree + Substack...");
    const expanded = await expandGraph(identities, olympiadIndex);
    pool = expanded.pool;
    neighbors = expanded.neighbors;
    seedTree = expanded.seedTree;
  }

  // Convergence from prior runs' person records boosts this run's ranking;
  // the store itself is refreshed after persistPeople below.
  const priorConvergence = loadConvergenceMap();
  const convergenceSeeds = new Map(
    [...priorConvergence.values()].map((e) => [e.login, e.seed_count])
  );
  if (priorConvergence.size) {
    log("converge", `${priorConvergence.size} known multi-seed bridges applied to scoring`);
  }

  log("merge", `merging ${pool.size} raw candidates`);
  const merged = mergeCandidates(
    [...pool.values(), ...existingCandidates.map(candidateToRaw)],
    convergenceSeeds
  );
  const ranked = merged.slice(0, MAX_CANDIDATES);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(ranked, null, 2), "utf-8");

  const treePath = path.resolve(path.dirname(OUTPUT_PATH), "seed_tree.json");
  fs.writeFileSync(
    treePath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        seeds: identities.map((i) => ({
          name: i.query_name,
          github: i.github_url,
          website: i.website?.url ?? null,
        })),
        edges: seedTree,
      },
      null,
      2
    ),
    "utf-8"
  );
  const collabEdges = seedTree.filter((e) => e.via === "github-collaborator")
    .length;
  const followerEdges = seedTree.filter((e) => e.via === "github-follower")
    .length;
  log(
    "tree",
    `${seedTree.length} edges (${collabEdges} collaborators, ${followerEdges} rich followers) → ${treePath}`
  );

  log("done", `wrote ${ranked.length} candidates → ${OUTPUT_PATH}`);

  const profilesWritten = writeSeedTreeProfiles(merged, {
    seeds: identities.map((i) => ({
      name: i.query_name,
      github: i.github_url,
      website: i.website?.url ?? null,
    })),
    edges: seedTree,
  });
  log(
    "profiles",
    `upserted ${profilesWritten} from ${merged.length} merged (not top-${ranked.length}) → ${PROFILES_DIR}/<seed>/{profile.json,collaborators|followers/<login>/}`
  );

  const people = persistPeople(ranked, seeds, failed, neighbors, olympiadIndex);
  log("people", `upserted ${people} person records → ${PEOPLE_DIR}`);

  const bridges = refreshConvergenceStore();
  if (bridges.length) {
    log("converge", `${bridges.length} people reachable from 2+ seeds → ${CONVERGENCE_PATH}`);
    for (const b of bridges.slice(0, 5)) {
      log("converge", `  ${b.login} ← ${b.seeds.join(", ")} (w=${b.weight})`);
    }
  }

  // Auto-assess only on full pipeline runs — resolve-only is intake.
  if (!RESOLVE_ONLY && process.env.AUTO_ASSESS !== "0") {
    const picks = selectAutoAssess(ranked, { hasReport: hasAnyAssessment });
    if (picks.length) {
      const live = process.env.AUTO_ASSESS_LIVE === "1";
      log(
        "auto-assess",
        `${picks.length} candidate(s) meet the base condition (${live ? "LIVE LLM" : "mock"}): ${picks.map((p) => p.name).join(", ")}`
      );
      const args = [
        "tsx",
        "scripts/assessCandidates.ts",
        "--candidates",
        picks.map((p) => p.candidate_id).join(","),
      ];
      if (!live) args.push("--mock");
      const res = spawnSync("npx", args, {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (res.status !== 0) {
        log("auto-assess", `assessment exited with ${res.status ?? "spawn error"} (discovery output is unaffected)`);
      }
    } else {
      log("auto-assess", "no new candidates meet the base condition");
    }
  }

  console.log("\n=== TOP CANDIDATES ===\n");
  for (const c of ranked.slice(0, 15)) {
    const gh = c.github ? `@${c.github.username}` : "—";
    const li = c.linkedin ? "yes" : "no";
    const oly = c.olympiad ? c.olympiad.prizes.slice(0, 2).join(", ") : "—";
    console.log(
      `${c.final_score.toFixed(2)}  ${c.name.padEnd(24)} li=${li} gh=${gh.padEnd(16)} substack=${c.substack?.active ? "yes" : "no"}`
    );
    console.log(
      `         builder=${c.score_breakdown.builder} thinker=${c.score_breakdown.thinker} olympiad=${c.score_breakdown.olympiad} weird=${c.score_breakdown.weirdness} identity=${c.score_breakdown.identity}`
    );
    if (c.olympiad) console.log(`         ${oly}`);
    console.log(`         via: ${c.discovered_via.slice(0, 3).join(", ")}`);
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
