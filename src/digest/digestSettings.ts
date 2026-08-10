import path from "path";
import {
  DIGEST_EMAIL_FROM,
  DIGEST_EMAIL_TO,
} from "../assessment/config.js";
import { readJson, writeJsonAtomic } from "../storage/jsonStore.js";

/**
 * Send settings editable from the UI. Stored values (data/digest-settings.json,
 * gitignored) take precedence over the DIGEST_EMAIL_* env vars, which remain
 * the headless/bootstrap path.
 */

const SETTINGS_PATH = path.resolve(
  process.cwd(),
  process.env.DIGEST_SETTINGS_PATH ?? "data/digest-settings.json"
);

export interface DigestSendSettings {
  from?: string;
  /** Comma-separated recipient list. */
  to?: string;
}

export function loadDigestSettings(): DigestSendSettings {
  return readJson<DigestSendSettings>(SETTINGS_PATH) ?? {};
}

const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSettings(next: DigestSendSettings): string | null {
  if (next.from !== undefined && next.from.trim() !== "") {
    // Resend accepts "Name <addr@host>" — validate the addr part.
    const addr = next.from.match(/<([^>]+)>/)?.[1] ?? next.from.trim();
    if (!EMAILISH.test(addr)) return `"${next.from}" is not a valid From address`;
  }
  if (next.to !== undefined && next.to.trim() !== "") {
    for (const part of next.to.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!EMAILISH.test(part)) return `"${part}" is not a valid recipient`;
    }
  }
  return null;
}

export function saveDigestSettings(
  next: DigestSendSettings
): DigestSendSettings {
  const merged: DigestSendSettings = { ...loadDigestSettings() };
  if (next.from !== undefined) merged.from = next.from.trim() || undefined;
  if (next.to !== undefined) merged.to = next.to.trim() || undefined;
  writeJsonAtomic(SETTINGS_PATH, merged);
  return merged;
}

/** Stored settings win; env vars are the fallback. */
export function effectiveDigestSettings(): { from: string; to: string } {
  const stored = loadDigestSettings();
  return {
    from: stored.from ?? DIGEST_EMAIL_FROM,
    to: stored.to ?? DIGEST_EMAIL_TO,
  };
}
