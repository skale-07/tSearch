import crypto from "crypto";
import fs from "fs";
import path from "path";
import { writeJsonAtomic, readJson } from "../../storage/jsonStore.js";
import { getAssessmentRunsDir, getDigestsDir } from "../config.js";
import type {
  AssessmentRun,
  AssessmentRunError,
  AssessmentRunStatus,
  CandidateAssessmentRecord,
} from "../types.js";
import { ASSESSMENT_SCHEMA_VERSION as SCHEMA } from "../types.js";
import { isTerminalRunStatus } from "../assessmentState.js";

export function assessmentRunDir(runId: string): string {
  return path.join(getAssessmentRunsDir(), runId);
}

export function makeAssessmentRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(4).toString("hex");
  return `arun_${ts}_${rand}`;
}

export function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function hashBytes(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function bumpRevision(prev?: number): number {
  return (prev ?? 0) + 1;
}

/** True when the run must not be mutated further (except nothing). */
export function isRunImmutable(status: AssessmentRunStatus): boolean {
  return status === "completed";
}

/** Terminal but resumable for retry. */
export function isRunResumable(status: AssessmentRunStatus): boolean {
  return (
    status === "completed_with_errors" ||
    status === "interrupted" ||
    status === "queued" ||
    status === "pending" ||
    status === "collecting" ||
    status === "judging" ||
    status === "rendering"
  );
}

export function readJsonWithRetry<T>(
  filePath: string,
  opts?: { attempts?: number; delayMs?: number }
): T | null {
  const attempts = opts?.attempts ?? 3;
  const delayMs = opts?.delayMs ?? 25;
  for (let i = 0; i < attempts; i++) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      if (i === attempts - 1) return null;
      const end = Date.now() + delayMs;
      while (Date.now() < end) {
        /* brief spin — sync context */
      }
    }
  }
  return null;
}

export function createAssessmentRun(
  partial: Omit<
    AssessmentRun,
    | "schema_version"
    | "id"
    | "created_at"
    | "status"
    | "errors"
    | "candidate_ids"
    | "revision"
    | "updated_at"
  > & {
    id?: string;
    candidate_ids?: string[];
    status?: AssessmentRunStatus;
  }
): AssessmentRun {
  const id = partial.id ?? makeAssessmentRunId();
  const dir = assessmentRunDir(id);
  if (fs.existsSync(path.join(dir, "run.json"))) {
    const existing = readJsonWithRetry<AssessmentRun>(
      path.join(dir, "run.json")
    );
    if (existing && isRunImmutable(existing.status)) {
      throw new Error(`Cannot overwrite completed assessment run ${id}`);
    }
  }
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assessments"), { recursive: true });

  const now = new Date().toISOString();
  const run: AssessmentRun = {
    schema_version: SCHEMA,
    id,
    created_at: now,
    updated_at: now,
    revision: 1,
    status: partial.status ?? "queued",
    source: partial.source,
    config: partial.config,
    candidate_ids: partial.candidate_ids ?? [],
    errors: [],
  };
  writeJsonAtomic(path.join(dir, "run.json"), run);
  return run;
}

export function loadAssessmentRun(runId: string): AssessmentRun | null {
  return readJsonWithRetry<AssessmentRun>(
    path.join(assessmentRunDir(runId), "run.json")
  );
}

export function saveAssessmentRun(run: AssessmentRun): void {
  const next: AssessmentRun = {
    ...run,
    updated_at: new Date().toISOString(),
    revision: bumpRevision(run.revision),
  };
  writeJsonAtomic(path.join(assessmentRunDir(run.id), "run.json"), next);
}

export function updateAssessmentRunStatus(
  runId: string,
  status: AssessmentRunStatus,
  patch?: Partial<
    Pick<
      AssessmentRun,
      "candidate_ids" | "errors" | "completed_at" | "digest_id" | "source" | "config"
    >
  >
): AssessmentRun {
  const run = loadAssessmentRun(runId);
  if (!run) throw new Error(`Assessment run not found: ${runId}`);
  if (isRunImmutable(run.status) && status !== "completed") {
    throw new Error(`Completed run ${runId} is immutable`);
  }
  const terminal =
    status === "completed" ||
    status === "completed_with_errors" ||
    status === "failed" ||
    status === "interrupted";
  const next: AssessmentRun = {
    ...run,
    status,
    candidate_ids: patch?.candidate_ids ?? run.candidate_ids,
    errors: patch?.errors ?? run.errors,
    digest_id: patch?.digest_id !== undefined ? patch.digest_id : run.digest_id,
    source: patch?.source ?? run.source,
    config: patch?.config ?? run.config,
    completed_at:
      patch?.completed_at ??
      (terminal ? new Date().toISOString() : run.completed_at),
    updated_at: new Date().toISOString(),
    revision: bumpRevision(run.revision),
  };
  writeJsonAtomic(path.join(assessmentRunDir(runId), "run.json"), next);
  return next;
}

export function appendRunError(
  runId: string,
  error: AssessmentRunError
): void {
  const run = loadAssessmentRun(runId);
  if (!run) throw new Error(`Assessment run not found: ${runId}`);
  if (isRunImmutable(run.status)) {
    throw new Error(`Completed run ${runId} is immutable`);
  }
  run.errors.push(error);
  run.updated_at = new Date().toISOString();
  run.revision = bumpRevision(run.revision);
  writeJsonAtomic(path.join(assessmentRunDir(runId), "run.json"), run);
}

export function clearCandidateRunErrors(
  runId: string,
  candidateId: string
): void {
  const run = loadAssessmentRun(runId);
  if (!run) throw new Error(`Assessment run not found: ${runId}`);
  if (isRunImmutable(run.status)) {
    throw new Error(`Completed run ${runId} is immutable`);
  }
  run.errors = run.errors.filter((e) => e.candidate_id !== candidateId);
  run.updated_at = new Date().toISOString();
  run.revision = bumpRevision(run.revision);
  writeJsonAtomic(path.join(assessmentRunDir(runId), "run.json"), run);
}

/**
 * Write source-candidates.json and return hash of exact serialized bytes on disk.
 */
export function writeSourceCandidates(
  runId: string,
  candidates: unknown
): string {
  const filePath = path.join(assessmentRunDir(runId), "source-candidates.json");
  writeJsonAtomic(filePath, candidates);
  const bytes = fs.readFileSync(filePath);
  return hashBytes(bytes);
}

export function writeCandidateAssessment(
  runId: string,
  record: CandidateAssessmentRecord
): void {
  const run = loadAssessmentRun(runId);
  if (run && isRunImmutable(run.status)) {
    throw new Error(`Completed run ${runId} is immutable`);
  }
  const prev = loadCandidateAssessment(runId, record.candidate_id);
  const next: CandidateAssessmentRecord = {
    ...record,
    updated_at: new Date().toISOString(),
    revision: bumpRevision(prev?.revision ?? record.revision),
  };
  writeJsonAtomic(
    path.join(
      assessmentRunDir(runId),
      "assessments",
      `${record.candidate_id}.json`
    ),
    next
  );
}

export function loadCandidateAssessment(
  runId: string,
  candidateId: string
): CandidateAssessmentRecord | null {
  return readJsonWithRetry(
    path.join(assessmentRunDir(runId), "assessments", `${candidateId}.json`)
  );
}

export function listCandidateAssessments(
  runId: string
): CandidateAssessmentRecord[] {
  const dir = path.join(assessmentRunDir(runId), "assessments");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) =>
      readJsonWithRetry<CandidateAssessmentRecord>(path.join(dir, f))
    )
    .filter((x): x is CandidateAssessmentRecord => !!x);
}

export function writeRunDigestFiles(
  runId: string,
  digest: unknown,
  markdown: string,
  html: string
): void {
  const dir = assessmentRunDir(runId);
  writeJsonAtomic(path.join(dir, "digest.json"), digest);
  fs.writeFileSync(path.join(dir, "digest.md"), markdown, "utf-8");
  fs.writeFileSync(path.join(dir, "digest.html"), html, "utf-8");
}

/** Invalidate digests for an incomplete run (force/retry). No broad scan. */
export function invalidateRunDigests(runId: string): void {
  const run = loadAssessmentRun(runId);
  if (!run) throw new Error(`Assessment run not found: ${runId}`);
  if (isRunImmutable(run.status)) {
    throw new Error(`Completed run ${runId} is immutable`);
  }
  const dir = assessmentRunDir(runId);
  const digestJsonPath = path.join(dir, "digest.json");
  let digestId: string | undefined = run.digest_id;
  if (fs.existsSync(digestJsonPath)) {
    const doc = readJsonWithRetry<{ digest_id?: string }>(digestJsonPath);
    if (doc?.digest_id) digestId = doc.digest_id;
    fs.unlinkSync(digestJsonPath);
  }
  for (const name of ["digest.md", "digest.html"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (digestId) {
    const digestsDir = getDigestsDir();
    for (const ext of [".json", ".md", ".html"]) {
      const p = path.join(digestsDir, `${digestId}${ext}`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  const next = {
    ...run,
    digest_id: undefined,
    updated_at: new Date().toISOString(),
    revision: bumpRevision(run.revision),
  };
  writeJsonAtomic(path.join(dir, "run.json"), next);
}

export function listAssessmentRunIds(): string[] {
  const root = getAssessmentRunsDir();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => name.startsWith("arun_"))
    .filter((name) =>
      fs.existsSync(path.join(root, name, "run.json"))
    );
}

export function listNonterminalRuns(): AssessmentRun[] {
  return listAssessmentRunIds()
    .map((id) => loadAssessmentRun(id))
    .filter((r): r is AssessmentRun => !!r && !isTerminalRunStatus(r.status));
}

export interface ResumeCompatConfig {
  schema_version: string;
  source_candidates_hash?: string;
  candidates_file_hash: string;
  candidate_ids: string[];
  prompt_versions: Record<string, string>;
  weight_version: string;
  judge_schema_version?: string;
  rubric_bundle_version?: string;
  judge_implementation_version?: string;
  model?: string;
  mock_llm: boolean;
  candidate_limit: number;
  repository_limit: number;
  collection_config_version?: string;
}

export function assertResumeCompatible(
  run: AssessmentRun,
  expected: ResumeCompatConfig
): void {
  if (isRunImmutable(run.status)) {
    throw new Error(`Completed run ${run.id} is immutable; cannot resume`);
  }
  const mismatches: string[] = [];
  if (run.schema_version !== expected.schema_version) {
    mismatches.push("schema_version");
  }
  if (run.source.candidates_file_hash !== expected.candidates_file_hash) {
    mismatches.push("candidates_file_hash");
  }
  if (
    expected.source_candidates_hash &&
    run.source.source_candidates_hash &&
    run.source.source_candidates_hash !== expected.source_candidates_hash
  ) {
    mismatches.push("source_candidates_hash");
  }
  if (
    JSON.stringify(run.candidate_ids) !== JSON.stringify(expected.candidate_ids)
  ) {
    mismatches.push("candidate_ids");
  }
  if (
    JSON.stringify(run.config.prompt_versions) !==
    JSON.stringify(expected.prompt_versions)
  ) {
    mismatches.push("prompt_versions");
  }
  if (run.config.weight_version !== expected.weight_version) {
    mismatches.push("weight_version");
  }
  if (
    (run.config.judge_implementation_version ?? "") !==
    (expected.judge_implementation_version ?? "")
  ) {
    mismatches.push("judge_implementation_version");
  }
  if (
    (run.config.judge_schema_version ?? "") !==
    (expected.judge_schema_version ?? "")
  ) {
    mismatches.push("judge_schema_version");
  }
  if (
    (run.config.rubric_bundle_version ?? "") !==
    (expected.rubric_bundle_version ?? "")
  ) {
    mismatches.push("rubric_bundle_version");
  }
  if ((run.config.model ?? "") !== (expected.model ?? "")) {
    mismatches.push("model");
  }
  if (run.config.mock_llm !== expected.mock_llm) {
    mismatches.push("mock_llm");
  }
  if (run.config.candidate_limit !== expected.candidate_limit) {
    mismatches.push("candidate_limit");
  }
  if (run.config.repository_limit !== expected.repository_limit) {
    mismatches.push("repository_limit");
  }
  if (
    (run.config.collection_config_version ?? "") !==
    (expected.collection_config_version ?? "")
  ) {
    mismatches.push("collection_config_version");
  }
  if (mismatches.length) {
    throw new Error(
      `Resume incompatible with run ${run.id}: ${mismatches.join(", ")}. Start a new run.`
    );
  }
}

// re-export for callers that used readJson from here historically
export { readJson };

/** True when any run (any status) holds a persisted assessment for this candidate. */
export function hasAnyAssessment(candidateId: string): boolean {
  const root = getAssessmentRunsDir();
  if (!fs.existsSync(root)) return false;
  for (const runId of fs.readdirSync(root)) {
    if (!runId.startsWith("arun_")) continue;
    if (
      fs.existsSync(
        path.join(assessmentRunDir(runId), "assessments", `${candidateId}.json`)
      )
    ) {
      return true;
    }
  }
  return false;
}
