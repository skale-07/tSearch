#!/usr/bin/env node
import fs from "fs";
import path from "path";
import {
  COOKIES_PATH,
  OLYMPIAD_CSV_PATH,
  OUTPUT_PATH,
  SEEDS_PATH,
  MAX_CANDIDATES,
} from "../config.js";
import { loadOlympiadCsv } from "../olympiad/parseOlympiad.js";
import { resolveIdentities } from "./resolveIdentities.js";
import { expandGraph } from "./expandGraph.js";
import { mergeCandidates } from "./mergeCandidates.js";

function log(step: string, detail?: string): void {
  const ts = new Date().toLocaleTimeString();
  console.log(detail ? `[${ts}] ${step} — ${detail}` : `[${ts}] ${step}`);
}

async function main(): Promise<void> {
  if (!fs.existsSync(SEEDS_PATH)) {
    console.error(`Missing seeds file: ${SEEDS_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(OLYMPIAD_CSV_PATH)) {
    console.error(`Missing olympiad CSV: ${OLYMPIAD_CSV_PATH}`);
    process.exit(1);
  }

  const seeds = JSON.parse(fs.readFileSync(SEEDS_PATH, "utf-8")) as string[];
  log("start", `LinkedIn-first pipeline via Playwright (${seeds.length} seeds)`);
  log("start", `GITHUB_TOKEN=${process.env.GITHUB_TOKEN ? "set" : "not set"}`);
  log("start", `COOKIES_PATH=${COOKIES_PATH}`);

  if (!fs.existsSync(COOKIES_PATH)) {
    console.error(`Missing ${COOKIES_PATH}. Run: npm run login`);
    process.exit(1);
  }

  log("olympiad", `loading ${OLYMPIAD_CSV_PATH}`);
  const olympiadIndex = loadOlympiadCsv(OLYMPIAD_CSV_PATH);
  log("olympiad", `indexed ${olympiadIndex.size} medalists`);

  log("resolve", "LinkedIn identity resolution...");
  const identities = await resolveIdentities(seeds, olympiadIndex);
  log("resolve", `${identities.length}/${seeds.length} identities resolved`);

  if (!identities.length) {
    console.error("No identities resolved. Check seeds, network, or cookies.json.");
    process.exit(1);
  }

  log("expand", "GitHub/Substack graph expansion from verified URLs...");
  const pool = await expandGraph(identities, olympiadIndex);

  log("merge", `merging ${pool.size} raw candidates`);
  const ranked = mergeCandidates([...pool.values()]).slice(0, MAX_CANDIDATES);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(ranked, null, 2), "utf-8");

  log("done", `wrote ${ranked.length} candidates → ${OUTPUT_PATH}`);

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
