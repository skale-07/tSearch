#!/usr/bin/env node
/**
 * Coverage sweep CLI: npm run sweep [-- --limit 200 [--resolve-top 5]]
 * Qualifies olympiad-CSV names by GitHub footprint and refreshes the ranked
 * data/seed-queue.json. Pure GitHub API + cache — no LinkedIn, no LLM.
 *
 * --resolve-top N chains straight into the LinkedIn pipeline for the N
 * highest-confidence queue entries (score ≥ QUEUE_AUTORESOLVE_MIN, default
 * 0.6). LinkedIn stays the identity authority — the sweep only decides who
 * is worth its scarce, paced attention.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  COOKIES_PATH,
  GITHUB_TOKEN_SOURCE,
  OLYMPIAD_CSV_PATH,
  SEED_QUEUE_PATH,
} from "../src/config.js";
import { loadOlympiadCsv } from "../src/olympiad/parseOlympiad.js";
import {
  loadSeedQueue,
  sweepOlympiadSeeds,
} from "../src/pipeline/footprintSweep.js";
import { writeJsonAtomic } from "../src/storage/jsonStore.js";

const AUTORESOLVE_MIN = Number(process.env.QUEUE_AUTORESOLVE_MIN ?? 0.6);

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const limit = Number(argValue("--limit") ?? process.env.SWEEP_LIMIT ?? 40);
  console.log(`[sweep] GITHUB_TOKEN=${GITHUB_TOKEN_SOURCE}`);
  if (GITHUB_TOKEN_SOURCE === "not set") {
    console.warn(
      "[sweep] no GitHub token — unauthenticated search limits will throttle hard; set GITHUB_TOKEN"
    );
  }

  const olympiadIndex = loadOlympiadCsv(OLYMPIAD_CSV_PATH);
  console.log(
    `[sweep] ${olympiadIndex.size} seed-set names indexed; sweeping up to ${limit} unchecked`
  );

  const stats = await sweepOlympiadSeeds(olympiadIndex, {
    limit,
    log: (msg) => console.log(`[sweep] ${msg}`),
  });

  console.log(
    `[sweep] done — swept=${stats.swept} qualified=${stats.qualified} skipped_fresh=${stats.skipped_fresh} skipped_resolved=${stats.skipped_resolved}`
  );

  const queue = loadSeedQueue();
  console.log(`[queue] ${queue.length} qualified seeds → ${SEED_QUEUE_PATH}`);
  for (const entry of queue.slice(0, 10)) {
    console.log(
      `[queue]   ${entry.footprint_score.toFixed(2)}  ${entry.name.padEnd(28)} gh=${entry.github_login_guess ?? "—"} (${entry.signals.join(", ")})`
    );
  }

  const resolveTop = Number(argValue("--resolve-top") ?? 0);
  if (resolveTop > 0) {
    const batch = queue
      .filter((e) => e.footprint_score >= AUTORESOLVE_MIN)
      .slice(0, resolveTop);
    if (!batch.length) {
      console.log(
        `[resolve] no queue entries at or above confidence ${AUTORESOLVE_MIN} — nothing to auto-resolve.`
      );
      return;
    }
    if (!fs.existsSync(COOKIES_PATH)) {
      console.error(
        `[resolve] skipping — missing ${COOKIES_PATH}. Run "npm run login", then re-run with --resolve-top (the queue is saved).`
      );
      return;
    }

    console.log(
      `[resolve] LinkedIn verification for top ${batch.length} high-confidence seeds: ${batch.map((b) => b.name).join(", ")}`
    );
    const seedsPath = path.resolve(process.cwd(), "output/sweep-seeds.json");
    writeJsonAtomic(
      seedsPath,
      batch.map((b) => ({ name: b.name, country: b.country ?? "" }))
    );
    const res = spawnSync("npx", ["tsx", "src/pipeline/runPipeline.ts"], {
      stdio: "inherit",
      env: {
        ...process.env,
        SEEDS_PATH: seedsPath,
        MAX_IDENTITY_RESOLVES: String(batch.length),
      },
    });
    process.exit(res.status ?? 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
