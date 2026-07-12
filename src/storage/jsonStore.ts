import crypto from "crypto";
import fs from "fs";
import path from "path";
import { CACHE_DIR, FORCE_REFRESH } from "../config.js";

export interface CacheEntry<T> {
  fetched_at: string;
  data: T;
}

export function slugify(s: string): string {
  const slug = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unnamed";
}

// Slug alone can collide ("/users/a/b" vs "/users/a-b"), so append a short hash.
function cacheFile(namespace: string, key: string): string {
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
  const slug = slugify(key).slice(0, 120);
  return path.join(CACHE_DIR, namespace, `${slug}-${hash}.json`);
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

/**
 * Returns the cache envelope, or null when the entry is missing, unparsable,
 * or older than ttlMs. A non-null envelope may still carry `data: null` —
 * that is a fresh negative entry ("we looked, there was nothing"), so callers
 * can skip re-fetching known misses.
 */
export function readCache<T>(
  namespace: string,
  key: string,
  ttlMs: number
): CacheEntry<T> | null {
  if (FORCE_REFRESH) return null;
  const entry = readJson<CacheEntry<T>>(cacheFile(namespace, key));
  if (!entry || typeof entry.fetched_at !== "string") return null;
  const age = Date.now() - Date.parse(entry.fetched_at);
  if (!Number.isFinite(age) || age < 0 || age > ttlMs) return null;
  return entry;
}

export function writeCache<T>(namespace: string, key: string, data: T): void {
  const entry: CacheEntry<T> = {
    fetched_at: new Date().toISOString(),
    data,
  };
  try {
    writeJsonAtomic(cacheFile(namespace, key), entry);
  } catch {
    // Cache writes are best-effort; a full disk must not kill the pipeline.
  }
}
