import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { COOKIES_PATH } from "../src/config.js";
import { slugify } from "../src/storage/jsonStore.js";
import {
  linkedInUrlFromProfile,
  loadProfile,
  resolveSeedSlugFromTree,
} from "./tree.js";

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
  kind?: "seed" | "branch";
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

function attachChild(
  run: RunRecord,
  child: ChildProcessWithoutNullStreams,
  onDone: (code: number | null) => void
): void {
  run.child = child;
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
    onDone(code);
  });
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
    kind: "seed",
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

  pushLog(run, `[ui] started run ${id} for ${input.name}`);
  attachChild(run, child, (code) => {
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

export function startBranchRun(input: {
  rootSeedSlug: string;
  parentSlug: string;
  relation: "collaborator" | "follower";
}): { runId: string } | { error: string; status: number } {
  if (activeRunId) {
    return {
      error: `A run is already in progress (${activeRunId}). Wait for it to finish.`,
      status: 409,
    };
  }

  const root = slugify(input.rootSeedSlug);
  const parent = slugify(input.parentSlug);
  const profile = loadProfile(root, input.relation, parent, { hop: 1 });
  if (!profile) {
    return {
      error: `No hop-1 profile at profiles/${root}/${input.relation}s/${parent}/profile.json`,
      status: 404,
    };
  }

  const linkedinUrl = linkedInUrlFromProfile(profile);
  if (!linkedinUrl) {
    return {
      error: `Profile ${parent} has no LinkedIn URL on GitHub/social links — cannot expand branch.`,
      status: 400,
    };
  }

  const githubUrl =
    profile.github?.profile_url ??
    profile.links?.github_url ??
    `https://github.com/${parent}`;

  const id = crypto.randomBytes(6).toString("hex");
  const run: RunRecord = {
    id,
    name: profile.name,
    country: profile.linkedin?.country ?? "Unknown",
    status: "running",
    startedAt: new Date().toISOString(),
    logs: [],
    listeners: new Set(),
    kind: "branch",
    seedSlug: root,
  };
  runs.set(id, run);
  activeRunId = id;

  const child = spawn("npx", ["tsx", "src/pipeline/runPipeline.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BRANCH_EXPAND: "1",
      BRANCH_ROOT: root,
      BRANCH_PARENT: parent,
      BRANCH_RELATION: input.relation,
      BRANCH_LINKEDIN: linkedinUrl,
      BRANCH_GITHUB: githubUrl,
      BRANCH_NAME: profile.name,
    },
    shell: true,
  });

  pushLog(
    run,
    `[ui] branch expand ${parent} under ${root} via ${linkedinUrl}`
  );
  attachChild(run, child, (code) => {
    if (code === 0) {
      run.status = "done";
      run.seedSlug = root;
      pushLog(run, `[ui] branch expand finished ok seedSlug=${root}`);
      notifyDone(run, { type: "done", seedSlug: root, exitCode: code });
    } else {
      run.status = "failed";
      run.error = `Branch expand exited with code ${code}`;
      pushLog(run, `[ui] failed with exit code ${code}`);
      notifyDone(run, {
        type: "error",
        message: run.error,
        exitCode: code,
      });
    }
  });

  return { runId: id };
}
