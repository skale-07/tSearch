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

export function createAssessmentRun(
  partial: Omit<
    AssessmentRun,
    "schema_version" | "id" | "created_at" | "status" | "errors" | "candidate_ids"
  > & {
    id?: string;
    candidate_ids?: string[];
  }
): AssessmentRun {
  const id = partial.id ?? makeAssessmentRunId();
  const dir = assessmentRunDir(id);
  if (fs.existsSync(path.join(dir, "run.json"))) {
    const existing = readJson<AssessmentRun>(path.join(dir, "run.json"));
    if (existing?.status === "completed") {
      throw new Error(`Cannot overwrite completed assessment run ${id}`);
    }
  }
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assessments"), { recursive: true });

  const run: AssessmentRun = {
    schema_version: SCHEMA,
    id,
    created_at: new Date().toISOString(),
    status: "pending",
    source: partial.source,
    config: partial.config,
    candidate_ids: partial.candidate_ids ?? [],
    errors: [],
  };
  writeJsonAtomic(path.join(dir, "run.json"), run);
  return run;
}

export function loadAssessmentRun(runId: string): AssessmentRun | null {
  return readJson<AssessmentRun>(
    path.join(assessmentRunDir(runId), "run.json")
  );
}

export function saveAssessmentRun(run: AssessmentRun): void {
  writeJsonAtomic(path.join(assessmentRunDir(run.id), "run.json"), run);
}

export function updateAssessmentRunStatus(
  runId: string,
  status: AssessmentRunStatus,
  patch?: Partial<
    Pick<AssessmentRun, "candidate_ids" | "errors" | "completed_at" | "digest_id" | "source" | "config">
  >
): AssessmentRun {
  const run = loadAssessmentRun(runId);
  if (!run) throw new Error(`Assessment run not found: ${runId}`);
  if (run.status === "completed" && status !== "completed") {
    throw new Error(`Completed run ${runId} is immutable`);
  }
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
      (status === "completed" || status === "failed"
        ? new Date().toISOString()
        : run.completed_at),
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
  if (run.status === "completed") {
    throw new Error(`Completed run ${runId} is immutable`);
  }
  run.errors.push(error);
  writeJsonAtomic(path.join(assessmentRunDir(runId), "run.json"), run);
}

export function clearCandidateRunErrors(
  runId: string,
  candidateId: string
): void {
  const run = loadAssessmentRun(runId);
  if (!run) throw new Error(`Assessment run not found: ${runId}`);
  if (run.status === "completed") {
    throw new Error(`Completed run ${runId} is immutable`);
  }
  run.errors = run.errors.filter((e) => e.candidate_id !== candidateId);
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
  if (run?.status === "completed") {
    throw new Error(`Completed run ${runId} is immutable`);
  }
  writeJsonAtomic(
    path.join(
      assessmentRunDir(runId),
      "assessments",
      `${record.candidate_id}.json`
    ),
    record
  );
}

export function loadCandidateAssessment(
  runId: string,
  candidateId: string
): CandidateAssessmentRecord | null {
  return readJson(
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
    .map((f) => readJson<CandidateAssessmentRecord>(path.join(dir, f)))
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
  if (run.status === "completed") {
    throw new Error(`Completed run ${runId} is immutable`);
  }
  const dir = assessmentRunDir(runId);
  const digestJsonPath = path.join(dir, "digest.json");
  let digestId: string | undefined = run.digest_id;
  if (fs.existsSync(digestJsonPath)) {
    const doc = readJson<{ digest_id?: string }>(digestJsonPath);
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
  const next = { ...run, digest_id: undefined };
  writeJsonAtomic(path.join(dir, "run.json"), next);
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
  if (run.status === "completed") {
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
