#!/usr/bin/env node
/**
 * Refresh pending-seeds from every source, then optionally run discovery on
 * the next N (LinkedIn resolve + graph expand). GitHub name-search is not a
 * pre-filter — it runs after LinkedIn, and only attaches when name + a
 * credential match.
 *
 *   npm run sweep
 *   npm run resolve            # --resolve-top (default 10) — full discovery
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { COOKIES_PATH, GITHUB_TOKEN_SOURCE } from "../src/config.js";
import {
  loadPendingSeeds,
  refreshSeeds,
  takePendingBatch,
} from "../src/seeds/refreshSeeds.js";
import { loadPerson } from "../src/storage/personStore.js";
import { writeJsonAtomic } from "../src/storage/jsonStore.js";

const RETRY_TTL_MS = Number(
  process.env.AUTOPILOT_RETRY_TTL_MS ?? 14 * 24 * 60 * 60 * 1000
);

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function attemptedRecently(name: string): boolean {
  const rec = loadPerson(name);
  if (!rec) return false;
  const failedStatus =
    rec.identity.status === "no_results" ||
    rec.identity.status === "no_name_match";
  if (!failedStatus) return false;
  const age = Date.now() - Date.parse(rec.last_updated);
  return Number.isFinite(age) && age < RETRY_TTL_MS;
}

async function main(): Promise<void> {
  const limit = Number(argValue("--limit") ?? process.env.SWEEP_LIMIT ?? 40);
  console.log(`[sweep] GITHUB_TOKEN=${GITHUB_TOKEN_SOURCE}`);

  const result = refreshSeeds();
  console.log(
    `[sweep] pending=${result.new_seeds.length} (known=${result.already_known} dupes=${result.duplicates_within_run})`
  );

  const pending = loadPendingSeeds()
    .filter((s) => !attemptedRecently(s.name))
    .slice(0, limit);
  for (const entry of pending.slice(0, 10)) {
    console.log(
      `[queue]   ${entry.name.padEnd(28)} ${entry.country ?? "—"}  (${entry.source_id})`
    );
  }

  // Flag present without a count (e.g. `npm run resolve`) defaults to 10.
  const resolveTop = process.argv.includes("--resolve-top")
    ? Number(argValue("--resolve-top") ?? 10) || 10
    : 0;
  if (resolveTop > 0) {
    const batch = takePendingBatch(resolveTop, {
      skip: (s) => attemptedRecently(s.name),
    });
    if (!batch.length) {
      console.log("[resolve] pending-seeds empty — nothing to auto-resolve.");
      return;
    }
    if (!fs.existsSync(COOKIES_PATH)) {
      console.error(
        `[resolve] skipping — missing ${COOKIES_PATH}. Run "npm run login", then re-run with --resolve-top (pending-seeds is saved).`
      );
      return;
    }

    console.log(
      `[resolve] discovery pipeline for next ${batch.length} seeds: ${batch.map((b) => b.name).join(", ")}`
    );
    const seedsPath = path.resolve(process.cwd(), "output/sweep-seeds.json");
    writeJsonAtomic(
      seedsPath,
      batch.map((b) => ({
        name: b.name,
        country: b.country ?? "",
        ...(b.award_id ? { award_id: b.award_id } : {}),
      }))
    );
    const res = spawnSync("npx", ["tsx", "src/pipeline/runPipeline.ts"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        SEEDS_PATH: seedsPath,
        MAX_IDENTITY_RESOLVES: String(batch.length),
        RESOLVE_ONLY: "0",
      },
    });
    if (res.error) {
      console.error(`[resolve] failed to spawn pipeline: ${res.error.message}`);
      process.exit(1);
    }
    process.exit(res.status ?? 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
