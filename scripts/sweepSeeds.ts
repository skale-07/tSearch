#!/usr/bin/env node
/**
 * Coverage sweep CLI: npm run sweep [-- --limit 200]
 * Qualifies olympiad-CSV names by GitHub footprint and refreshes the ranked
 * data/seed-queue.json. Pure GitHub API + cache — no LinkedIn, no LLM.
 */
import { GITHUB_TOKEN_SOURCE, OLYMPIAD_CSV_PATH, SEED_QUEUE_PATH } from "../src/config.js";
import { loadOlympiadCsv } from "../src/olympiad/parseOlympiad.js";
import {
  loadSeedQueue,
  sweepOlympiadSeeds,
} from "../src/pipeline/footprintSweep.js";

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
