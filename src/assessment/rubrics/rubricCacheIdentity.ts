import { createHash } from "node:crypto";
import type { LoadedRubricBundle } from "./types.js";

/** Sort object keys for stable JSON (shallow). */
export function sortKeys(
  obj: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = obj[key]!;
  }
  return out;
}

/**
 * Canonical rubric cache identity.
 * YAML edits change file_hashes → identity changes → judge cache miss.
 * Sorted keys prevent load-order drift.
 */
export function rubricCacheIdentity(bundle: LoadedRubricBundle): string {
  const sorted = sortKeys(bundle.file_hashes);
  const payload = bundle.version + JSON.stringify(sorted);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Human-readable run config value: bundle version + short content hash. */
export function rubricBundleVersionLabel(bundle: LoadedRubricBundle): string {
  const hash = rubricCacheIdentity(bundle).slice(0, 16);
  return `${bundle.version}:${hash}`;
}
