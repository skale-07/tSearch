import crypto from "crypto";
import fs from "fs";
import path from "path";
import { writeJsonAtomic, readJson } from "../../storage/jsonStore.js";
import {
  ASSESSMENT_CACHE_DIR,
  assessmentForceRefresh,
  ARTIFACT_CACHE_TTL_MS,
  JUDGE_CACHE_TTL_MS,
} from "../config.js";

interface CacheEnvelope<T> {
  fetched_at: string;
  key: string;
  data: T;
}

function fileFor(namespace: string, key: string): string {
  const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  return path.join(ASSESSMENT_CACHE_DIR, namespace, `${hash}.json`);
}

function readCache<T>(
  namespace: string,
  key: string,
  ttlMs: number
): T | null {
  if (assessmentForceRefresh()) return null;
  const entry = readJson<CacheEnvelope<T>>(fileFor(namespace, key));
  if (!entry || entry.key !== key) return null;
  const age = Date.now() - Date.parse(entry.fetched_at);
  if (!Number.isFinite(age) || age < 0 || age > ttlMs) return null;
  return entry.data;
}

function writeCache<T>(namespace: string, key: string, data: T): void {
  try {
    writeJsonAtomic(fileFor(namespace, key), {
      fetched_at: new Date().toISOString(),
      key,
      data,
    } satisfies CacheEnvelope<T>);
  } catch {
    // best-effort
  }
}

export function hashPayload(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function readArtifactCache<T>(cacheKey: string): T | null {
  return readCache<T>("artifacts", cacheKey, ARTIFACT_CACHE_TTL_MS);
}

export function writeArtifactCache<T>(cacheKey: string, data: T): void {
  writeCache("artifacts", cacheKey, data);
}

export function readJudgeCacheEnvelope(
  cacheKey: string
): CacheEnvelope<unknown> | null {
  if (assessmentForceRefresh()) return null;
  const entry = readJson<CacheEnvelope<unknown>>(fileFor("judges", cacheKey));
  if (!entry || entry.key !== cacheKey) return null;
  const age = Date.now() - Date.parse(entry.fetched_at);
  if (!Number.isFinite(age) || age < 0 || age > JUDGE_CACHE_TTL_MS) return null;
  return entry;
}

export function readJudgeCache<T>(cacheKey: string): T | null {
  return readCache<T>("judges", cacheKey, JUDGE_CACHE_TTL_MS);
}

export function writeJudgeCache<T>(cacheKey: string, data: T): void {
  writeCache("judges", cacheKey, data);
}

export function invalidateJudgeCache(cacheKey: string): void {
  try {
    const f = fileFor("judges", cacheKey);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch {
    /* ignore */
  }
}

export function ensureAssessmentCacheDirs(): void {
  fs.mkdirSync(path.join(ASSESSMENT_CACHE_DIR, "artifacts"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(ASSESSMENT_CACHE_DIR, "judges"), { recursive: true });
}

export const LEGACY_RUBRIC_BUNDLE_VERSION = "legacy-phase2";
export const TECHNICAL_JUDGE_IMPLEMENTATION_VERSION = "technical-judge-v2";
export const JUDGE_SCHEMA_VERSION = "judge-schema-v1";
