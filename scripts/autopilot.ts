#!/usr/bin/env node
/**
 * Autopilot: one supervised cycle of the continuous-discovery loop.
 *
 *   sweep top-up → next N qualified seeds from data/seed-queue.json
 *     → discovery pipeline (live LinkedIn, paced, capped)
 *     → assessment (mock LLM unless AUTOPILOT_LIVE_LLM=1)
 *     → digest build → send (DRY-RUN unless AUTOPILOT_SEND=1)
 *
 * Designed for a local cron/launchd cadence (LinkedIn needs this machine's
 * cookies + headed Chromium), e.g. weekly:
 *   0 9 * * 1  cd ~/tSearch && npm run autopilot >> autopilot.log 2>&1
 *
 * Fail-closed defaults per CLAUDE.md: small seed batches (LinkedIn ban risk),
 * mock LLM, and no real email without an explicit AUTOPILOT_SEND=1.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  COOKIES_PATH,
  OLYMPIAD_CSV_PATH,
  SEED_QUEUE_PATH,
} from "../src/config.js";
import { getDigestsDir } from "../src/assessment/config.js";
import { loadOlympiadCsv } from "../src/olympiad/parseOlympiad.js";
import {
  loadSeedQueue,
  sweepOlympiadSeeds,
  type QueueEntry,
} from "../src/pipeline/footprintSweep.js";
import { loadPerson } from "../src/storage/personStore.js";
import { readJson, writeJsonAtomic } from "../src/storage/jsonStore.js";

const SEEDS_PER_RUN = Number(process.env.AUTOPILOT_SEEDS_PER_RUN ?? 5);
const SWEEP_TOPUP = Number(process.env.AUTOPILOT_SWEEP_LIMIT ?? 25);
const RETRY_TTL_MS = Number(
  process.env.AUTOPILOT_RETRY_TTL_MS ?? 14 * 24 * 60 * 60 * 1000
);
const LIVE_LLM = process.env.AUTOPILOT_LIVE_LLM === "1";
const REAL_SEND = process.env.AUTOPILOT_SEND === "1";
const LEDGER_PATH = path.resolve(process.cwd(), "data/autopilot-log.json");

function log(msg: string): void {
  console.log(`[autopilot] ${msg}`);
}

function run(label: string, args: string[], env?: NodeJS.ProcessEnv): number {
  log(`stage: ${label}`);
  // Windows: npx is a .cmd — spawnSync without shell:true → ENOENT.
  const res = spawnSync("npx", ["tsx", ...args], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (res.error) {
    log(`spawn failed (${label}): ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}

/** Skip seeds whose last resolve attempt failed recently — no retry-hammer. */
function attemptedRecently(entry: QueueEntry): boolean {
  const rec = loadPerson(entry.name);
  if (!rec) return false;
  const failedStatus =
    rec.identity.status === "no_results" ||
    rec.identity.status === "no_name_match";
  if (!failedStatus) return false;
  const age = Date.now() - Date.parse(rec.last_updated);
  return Number.isFinite(age) && age < RETRY_TTL_MS;
}

function latestDigestId(): string | null {
  const dir = getDigestsDir();
  if (!fs.existsSync(dir)) return null;
  const newest = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0];
  return newest ? newest.f.replace(/\.json$/, "") : null;
}

interface LedgerEntry {
  at: string;
  seeds: string[];
  pipeline_exit: number;
  assess_exit: number | null;
  digest_id: string | null;
  sent: "real" | "dry-run" | "skipped";
}

function appendLedger(entry: LedgerEntry): void {
  const doc = readJson<{ runs: LedgerEntry[] }>(LEDGER_PATH) ?? { runs: [] };
  doc.runs.push(entry);
  writeJsonAtomic(LEDGER_PATH, doc);
}

async function main(): Promise<void> {
  log(`config: seeds/run=${SEEDS_PER_RUN} live_llm=${LIVE_LLM} send=${REAL_SEND ? "REAL" : "dry-run"}`);

  if (!fs.existsSync(COOKIES_PATH)) {
    console.error(
      `[autopilot] missing ${COOKIES_PATH} — live LinkedIn discovery needs this machine's session. Run "npm run login" first.`
    );
    process.exit(1);
  }

  // 1. Sweep top-up keeps the queue from starving as it drains.
  if (SWEEP_TOPUP > 0) {
    const stats = await sweepOlympiadSeeds(loadOlympiadCsv(OLYMPIAD_CSV_PATH), {
      limit: SWEEP_TOPUP,
    });
    log(
      `sweep top-up: swept=${stats.swept} qualified=${stats.qualified} (queue @ ${SEED_QUEUE_PATH})`
    );
  }

  // 2. Next batch off the queue.
  const batch = loadSeedQueue()
    .filter((e) => !attemptedRecently(e))
    .slice(0, SEEDS_PER_RUN);
  if (!batch.length) {
    log("queue empty (or everything attempted recently) — nothing to do.");
    return;
  }
  log(`batch: ${batch.map((b) => b.name).join(", ")}`);

  const seedsPath = path.resolve(process.cwd(), "output/autopilot-seeds.json");
  writeJsonAtomic(
    seedsPath,
    batch.map((b) => ({ name: b.name, country: b.country ?? "" }))
  );

  // 3. Discovery (live LinkedIn — paced by the pipeline itself).
  const pipelineExit = run("discovery pipeline", ["src/pipeline/runPipeline.ts"], {
    SEEDS_PATH: seedsPath,
    MAX_IDENTITY_RESOLVES: String(batch.length),
  });
  if (pipelineExit !== 0) {
    log(`pipeline failed (exit ${pipelineExit}) — stopping this cycle.`);
    appendLedger({
      at: new Date().toISOString(),
      seeds: batch.map((b) => b.name),
      pipeline_exit: pipelineExit,
      assess_exit: null,
      digest_id: null,
      sent: "skipped",
    });
    process.exit(pipelineExit);
  }

  // 4. Assessment + digest build (mock LLM unless explicitly live).
  const assessArgs = ["scripts/assessCandidates.ts"];
  if (!LIVE_LLM) assessArgs.push("--mock");
  const assessExit = run("assessment + digest", assessArgs);

  // 5. Send — dry-run unless explicitly armed.
  const digestId = latestDigestId();
  let sent: LedgerEntry["sent"] = "skipped";
  if (assessExit === 0 && digestId) {
    const sendArgs = ["scripts/sendDigest.ts", "--digest", digestId];
    if (!REAL_SEND) sendArgs.push("--dry-run");
    const sendExit = run(
      REAL_SEND ? "digest send (REAL)" : "digest send (dry-run)",
      sendArgs
    );
    sent = sendExit === 0 ? (REAL_SEND ? "real" : "dry-run") : "skipped";
  }

  appendLedger({
    at: new Date().toISOString(),
    seeds: batch.map((b) => b.name),
    pipeline_exit: pipelineExit,
    assess_exit: assessExit,
    digest_id: digestId,
    sent,
  });
  log(
    `cycle complete — digest=${digestId ?? "none"} sent=${sent}. Ledger: ${LEDGER_PATH}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
