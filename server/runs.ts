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
import { readPersistedAssessmentStatus } from "./assessmentApi.js";
import { prepareAssessmentRun } from "./assessmentApi.js";

export type RunStatus = "running" | "done" | "failed";

export interface RunRecord {
  id: string;
  name: string;
  country: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  seedSlug?: string;
  assessmentRunId?: string;
  error?: string;
  logs: string[];
  listeners: Set<(line: string) => void>;
  child?: ChildProcessWithoutNullStreams;
  kind?: "seed" | "branch" | "assessment";
  cancelRequested?: boolean;
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
    if (run.cancelRequested) {
      run.status = "failed";
      run.error = "Cancelled by user";
      pushLog(run, "[ui] run cancelled by user");
      notifyDone(run, { type: "error", message: "Cancelled by user" });
      return;
    }
    onDone(code);
  });
}

export function cancelRun(
  id: string
): { ok: true } | { error: string; status: number } {
  const run = runs.get(id);
  if (!run) return { error: "Run not found", status: 404 };
  if (run.status !== "running" || !run.child) {
    return { error: "Run is not running", status: 409 };
  }
  run.cancelRequested = true;
  // SIGTERM lets the pipeline's finally blocks close the Chromium session.
  run.child.kill("SIGTERM");
  return { ok: true };
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

export function startSeedBatchRun(input: {
  seeds: Array<{ name: string; country?: string; award_id?: string }>;
  label?: string;
  /** LinkedIn identity only — no GitHub/Substack expand (Discover Resolve). */
  resolveOnly?: boolean;
}): { runId: string; batch: Array<{ name: string; country?: string; award_id?: string }> } | { error: string; status: number } {
  if (activeRunId) {
    return {
      error: `A run is already in progress (${activeRunId}). Wait for it to finish.`,
      status: 409,
    };
  }
  if (!input.seeds.length) {
    return { error: "No pending seeds to resolve.", status: 400 };
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
  const seedFile = path.join(tmpDir, `ui-pending-${id}.json`);
  fs.writeFileSync(
    seedFile,
    JSON.stringify(
      input.seeds.map((s) => ({
        name: s.name,
        country: s.country ?? "",
        ...(s.award_id ? { award_id: s.award_id } : {}),
      })),
      null,
      2
    ),
    "utf-8"
  );

  const resolveOnly = Boolean(input.resolveOnly);
  const label = input.label ?? input.seeds[0]!.name;
  const run: RunRecord = {
    id,
    name: label,
    country: input.seeds[0]?.country ?? "",
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
      MAX_IDENTITY_RESOLVES: String(input.seeds.length),
      ...(resolveOnly ? { RESOLVE_ONLY: "1" } : { RESOLVE_ONLY: "0" }),
    },
    shell: true,
  });

  pushLog(
    run,
    `[ui] started ${resolveOnly ? "resolve-only" : "pipeline"} batch ${id} (${input.seeds.length}): ${input.seeds.map((s) => s.name).join(", ")}`
  );
  attachChild(run, child, (code) => {
    if (code === 0) {
      const seedSlug = resolveSeedSlugFromTree(input.seeds[0]!.name);
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

  return { runId: id, batch: input.seeds };
}

export function startWebsiteGraphRun(input: {
  seed_slug: string;
  host_slug?: string;
  url: string;
  names: string[];
  org_hint?: string;
  hints?: Record<
    string,
    { linkedin_url?: string; github_url?: string; org_hint?: string }
  >;
}):
  | { runId: string; batch: string[] }
  | { error: string; status: number } {
  if (activeRunId) {
    return {
      error: `A run is already in progress (${activeRunId}). Wait for it to finish.`,
      status: 409,
    };
  }
  if (!input.names.length) {
    return { error: "Select at least one name to resolve.", status: 400 };
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
  const jobFile = path.join(tmpDir, `website-graph-${id}.json`);
  fs.writeFileSync(
    jobFile,
    JSON.stringify(
      {
        seed_slug: input.seed_slug,
        ...(input.host_slug ? { host_slug: input.host_slug } : {}),
        url: input.url,
        names: input.names,
        ...(input.org_hint ? { org_hint: input.org_hint } : {}),
        ...(input.hints ? { hints: input.hints } : {}),
      },
      null,
      2
    ),
    "utf-8"
  );

  const run: RunRecord = {
    id,
    name: `website:${input.seed_slug}`,
    country: "",
    status: "running",
    startedAt: new Date().toISOString(),
    logs: [],
    listeners: new Set(),
    kind: "seed",
    seedSlug: input.seed_slug,
  };
  runs.set(id, run);
  activeRunId = id;

  const child = spawn("npx", ["tsx", "src/pipeline/runPipeline.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WEBSITE_GRAPH: "1",
      WEBSITE_GRAPH_JOB: jobFile,
      MAX_IDENTITY_RESOLVES: String(input.names.length),
    },
    shell: true,
  });

  pushLog(
    run,
    `[ui] started website-graph ${id} under ${input.seed_slug} (${input.names.length}): ${input.names.join(", ")}`
  );
  attachChild(run, child, (code) => {
    try {
      fs.unlinkSync(jobFile);
    } catch {
      /* ignore */
    }
    if (code === 0) {
      run.status = "done";
      pushLog(run, `[ui] website-graph finished ok seedSlug=${input.seed_slug}`);
      notifyDone(run, {
        type: "done",
        seedSlug: input.seed_slug,
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
  });

  return { runId: id, batch: input.names };
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

function extractAssessmentRunId(logs: string[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i];
    const m =
      line.match(/Assessment run completed:\s*(arun_\S+)/) ||
      line.match(/Artifacts:\s*output\/assessment-runs\/(arun_[^/\s]+)/) ||
      line.match(/"assessment_run_id"\s*:\s*"(arun_[^"]+)"/);
    if (m) return m[1];
  }
  return null;
}

export function startAssessmentRun(input: {
  assessmentRunId: string;
  mock?: boolean;
  skipDigest?: boolean;
  resumeArgs?: string[];
  label?: string;
}): { runId: string; assessmentRunId: string } | { error: string; status: number } {
  if (activeRunId) {
    return {
      error: `A run is already in progress (${activeRunId}). Wait for it to finish.`,
      status: 409,
    };
  }

  const args = [
    "tsx",
    "scripts/assessCandidates.ts",
    "--resume",
    input.assessmentRunId,
  ];
  if (input.skipDigest !== false) args.push("--skip-digest");
  if (input.mock) args.push("--mock");
  if (input.resumeArgs?.length) args.push(...input.resumeArgs);

  const id = crypto.randomBytes(6).toString("hex");
  const run: RunRecord = {
    id,
    name: input.label ?? `assessment:${input.assessmentRunId}`,
    country: "",
    status: "running",
    startedAt: new Date().toISOString(),
    logs: [],
    listeners: new Set(),
    kind: "assessment",
    assessmentRunId: input.assessmentRunId,
  };
  runs.set(id, run);
  activeRunId = id;

  const child = spawn("npx", args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(input.mock ? { ASSESSMENT_MOCK_LLM: "1" } : {}),
    },
    shell: true,
  });

  pushLog(
    run,
    `[ui] started assessment job ${id} run=${input.assessmentRunId}`
  );
  attachChild(run, child, (code) => {
    const assessmentRunId =
      run.assessmentRunId ??
      extractAssessmentRunId(run.logs) ??
      input.assessmentRunId;
    run.assessmentRunId = assessmentRunId;

    let assessmentStatus: string | null = null;
    try {
      assessmentStatus = readPersistedAssessmentStatus(assessmentRunId);
    } catch {
      assessmentStatus = null;
    }

    const digestHint = assessmentRunId
      ? `output/assessment-runs/${assessmentRunId}/digest.md`
      : null;

    const exitCode = code ?? 1;
    const payloadBase = {
      job_id: id,
      run_id: assessmentRunId,
      process_exit_code: exitCode,
      assessment_status: assessmentStatus,
      assessmentRunId,
      digestHint,
      exitCode,
    };

    // Never treat exit 0 alone as success — require readable persisted status
    if (
      assessmentStatus === "completed" ||
      assessmentStatus === "completed_with_errors" ||
      assessmentStatus === "interrupted"
    ) {
      run.status = "done";
      pushLog(
        run,
        `[ui] assessment finished assessment_status=${assessmentStatus}`
      );
      notifyDone(run, {
        type: "done",
        ...payloadBase,
        ui_tone:
          assessmentStatus === "completed"
            ? "success"
            : "warning",
      });
      return;
    }

    if (assessmentStatus === "failed" || exitCode !== 0) {
      run.status = "failed";
      run.error =
        assessmentStatus === "failed"
          ? "Assessment run failed"
          : `Assessment exited with code ${exitCode}`;
      pushLog(run, `[ui] assessment failed: ${run.error}`);
      notifyDone(run, {
        type: "error",
        message: run.error,
        ...payloadBase,
        ui_tone: "danger",
      });
      return;
    }

    // Exit 0 but unreadable / nonterminal status — never success
    run.status = "failed";
    run.error =
      "Assessment process exited but persisted run status was unreadable or nonterminal";
    pushLog(run, `[ui] ${run.error}`);
    notifyDone(run, {
      type: "error",
      message: run.error,
      ...payloadBase,
      assessment_status: null,
      ui_tone: "danger",
    });
  });

  return { runId: id, assessmentRunId: input.assessmentRunId };
}

/** @deprecated Prefer prepareAssessmentRun + startAssessmentRun with assessmentRunId */
export function startAssessmentRunLegacy(input: {
  mode: "selected" | "top_n";
  candidateIds?: string[];
  limit?: number;
  mock?: boolean;
  inputPath: string;
}): { runId: string } | { error: string; status: number } {
  if (input.mode !== "selected") {
    return {
      error: "top_n is removed; pass candidate_ids for eligible candidates",
      status: 400,
    };
  }
  const prepared = prepareAssessmentRun({
    candidate_ids: input.candidateIds ?? [],
    mock_llm: input.mock,
    skip_digest: true,
    inputPath: input.inputPath,
  });
  if ("error" in prepared) return prepared;
  const started = startAssessmentRun({
    assessmentRunId: prepared.run_id,
    mock: prepared.mock_llm,
    skipDigest: prepared.skip_digest,
  });
  if ("error" in started) return started;
  return { runId: started.runId };
}
