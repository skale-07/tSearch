import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { COOKIES_PATH } from "../src/config.js";
import { resolveSeedSlugFromTree } from "./tree.js";

export type RunStatus = "running" | "done" | "failed";

export interface RunRecord {
  id: string;
  name: string;
  country: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  seedSlug?: string;
  error?: string;
  logs: string[];
  listeners: Set<(line: string) => void>;
  child?: ChildProcessWithoutNullStreams;
}

const MAX_LOG_LINES = 2000;
const runs = new Map<string, RunRecord>();
let activeRunId: string | null = null;

export function getRun(id: string): RunRecord | undefined {
  return runs.get(id);
}

export function getActiveRunId(): string | null {
  return activeRunId;
}

function pushLog(run: RunRecord, line: string): void {
  const cleaned = line.replace(/\r/g, "");
  if (!cleaned.trim()) return;
  for (const part of cleaned.split("\n")) {
    if (!part.length) continue;
    run.logs.push(part);
    if (run.logs.length > MAX_LOG_LINES) run.logs.shift();
    for (const listener of run.listeners) listener(part);
  }
}

function notifyDone(run: RunRecord, payload: object): void {
  const line = `__EVENT__${JSON.stringify(payload)}`;
  for (const listener of run.listeners) listener(line);
}

export function startRun(input: {
  name: string;
  country: string;
}): { runId: string } | { error: string; status: number } {
  if (activeRunId) {
    return {
      error: `A run is already in progress (${activeRunId}). Wait for it to finish.`,
      status: 409,
    };
  }

  if (!fs.existsSync(COOKIES_PATH)) {
    return {
      error: `Missing ${COOKIES_PATH}. Run "npm run login" before starting a pipeline.`,
      status: 400,
    };
  }

  const id = crypto.randomBytes(6).toString("hex");
  const tmpDir = path.resolve(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const seedFile = path.join(tmpDir, `ui-seed-${id}.json`);
  fs.writeFileSync(
    seedFile,
    JSON.stringify([{ name: input.name, country: input.country }], null, 2),
    "utf-8"
  );

  const run: RunRecord = {
    id,
    name: input.name,
    country: input.country,
    status: "running",
    startedAt: new Date().toISOString(),
    logs: [],
    listeners: new Set(),
  };
  runs.set(id, run);
  activeRunId = id;

  const child = spawn("npx", ["tsx", "src/pipeline/runPipeline.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SEEDS_PATH: seedFile,
      MAX_IDENTITY_RESOLVES: "1",
    },
    shell: true,
  });
  run.child = child;

  pushLog(run, `[ui] started run ${id} for ${input.name}`);

  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => pushLog(run, chunk));
  child.stderr.on("data", (chunk: string) => pushLog(run, chunk));

  child.on("error", (err) => {
    run.status = "failed";
    run.error = err.message;
    run.finishedAt = new Date().toISOString();
    activeRunId = null;
    pushLog(run, `[ui] spawn error: ${err.message}`);
    notifyDone(run, { type: "error", message: err.message });
  });

  child.on("close", (code) => {
    run.finishedAt = new Date().toISOString();
    activeRunId = null;

    if (code === 0) {
      const seedSlug = resolveSeedSlugFromTree(input.name);
      run.status = "done";
      run.seedSlug = seedSlug ?? undefined;
      pushLog(
        run,
        `[ui] finished ok${seedSlug ? ` seedSlug=${seedSlug}` : " (no seedSlug found)"}`
      );
      notifyDone(run, {
        type: "done",
        seedSlug: seedSlug ?? null,
        exitCode: code,
      });
    } else {
      run.status = "failed";
      run.error = `Pipeline exited with code ${code}`;
      pushLog(run, `[ui] failed with exit code ${code}`);
      notifyDone(run, {
        type: "error",
        message: run.error,
        exitCode: code,
      });
    }

    try {
      fs.unlinkSync(seedFile);
    } catch {
      /* ignore */
    }
  });

  return { runId: id };
}
