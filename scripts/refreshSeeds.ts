/**
 * Continuous seed refresh — reads every configured seed source, drops people
 * already in data/people/, and writes the remainder to pending-seeds.json.
 *
 * Nomination only: nothing here resolves identity. Point the pipeline at the
 * output with SEEDS_PATH=data/pending-seeds.json to run them.
 *
 *   npm run seeds:refresh
 */
import { collectSources, refreshSeeds } from "../src/seeds/refreshSeeds.js";

function main(): void {
  const sources = collectSources();
  if (!sources.length) {
    console.log(
      "[seeds] no sources found. Drop award rosters in data/rosters/ " +
        "(<award_id>.<year>.csv) or names in data/manual-cohort.json."
    );
    return;
  }
  const before = Date.now();
  const result = refreshSeeds({ sources });
  console.log(
    `[seeds] done in ${Date.now() - before}ms · ${result.sources_read} sources · ` +
      `${result.duplicates_within_run} duplicates skipped`
  );
}

main();
