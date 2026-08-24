import crypto from "crypto";
import fs from "fs";
import path from "path";
import { MARKS_DIR } from "../config.js";
import { readJson, slugify, writeJsonAtomic } from "../storage/jsonStore.js";

/**
 * Recruiter watchlist. Does not affect digest ranking — that is
 * `feedbackStore` (relevant / not_relevant / explore_network).
 */
export const MARK_SOURCES = [
  "graph",
  "assess",
  "website_preview",
  "discover",
] as const;

export type MarkSource = (typeof MARK_SOURCES)[number];

export interface MarkRecord {
  id: string;
  name: string;
  note?: string;
  source: MarkSource;
  created_at: string;
  updated_at: string;
  seed_slug?: string;
  page_url?: string;
  candidate_id?: string;
  /** Graph node slug — mark id is often candidate_id, which is not a tree id. */
  person_slug?: string;
}

function markPath(id: string): string {
  return path.join(MARKS_DIR, `${slugify(id)}.json`);
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Stable id for a name on a page before LinkedIn resolve. */
export function pageHitMarkId(pageUrl: string, name: string): string {
  const key = `${pageUrl.trim().toLowerCase()}|${normalizeName(name)}`;
  const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `page:${hash}`;
}

export function loadMark(id: string): MarkRecord | null {
  const rec = readJson<MarkRecord>(markPath(id));
  if (!rec?.id || !rec.name) return null;
  return rec;
}

export function loadAllMarks(): MarkRecord[] {
  if (!fs.existsSync(MARKS_DIR)) return [];
  const records: MarkRecord[] = [];
  for (const file of fs.readdirSync(MARKS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const rec = readJson<MarkRecord>(path.join(MARKS_DIR, file));
    if (rec?.id && rec.name) records.push(rec);
  }
  return records.sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)
  );
}

export function upsertMark(input: {
  id: string;
  name: string;
  source: MarkSource;
  note?: string;
  seed_slug?: string;
  page_url?: string;
  candidate_id?: string;
  person_slug?: string;
}): MarkRecord {
  const id = input.id.trim();
  const name = input.name.trim();
  if (!id) throw new Error("mark id required");
  if (!name) throw new Error("mark name required");
  const now = new Date().toISOString();
  const existing = loadMark(id);
  const record: MarkRecord = {
    id,
    name,
    source: input.source,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    ...(input.note?.trim()
      ? { note: input.note.trim() }
      : existing?.note
        ? { note: existing.note }
        : {}),
    ...(input.seed_slug?.trim()
      ? { seed_slug: input.seed_slug.trim() }
      : existing?.seed_slug
        ? { seed_slug: existing.seed_slug }
        : {}),
    ...(input.page_url?.trim()
      ? { page_url: input.page_url.trim() }
      : existing?.page_url
        ? { page_url: existing.page_url }
        : {}),
    ...(input.candidate_id?.trim()
      ? { candidate_id: input.candidate_id.trim() }
      : existing?.candidate_id
        ? { candidate_id: existing.candidate_id }
        : {}),
    ...(input.person_slug?.trim()
      ? { person_slug: input.person_slug.trim() }
      : existing?.person_slug
        ? { person_slug: existing.person_slug }
        : {}),
  };
  writeJsonAtomic(markPath(id), record);
  return record;
}

export function deleteMark(id: string): boolean {
  const file = markPath(id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/**
 * After a page-hit resolves to a candidate_id, move the watchlist row
 * onto the stable identity. No-op if `fromId` is missing.
 */
export function rewriteMarkId(
  fromId: string,
  toId: string,
  extra?: Partial<Pick<MarkRecord, "candidate_id" | "name">>
): MarkRecord | null {
  const existing = loadMark(fromId);
  if (!existing) return null;
  const next = upsertMark({
    id: toId,
    name: extra?.name?.trim() || existing.name,
    source: existing.source,
    note: existing.note,
    seed_slug: existing.seed_slug,
    page_url: existing.page_url,
    candidate_id: extra?.candidate_id ?? toId,
    person_slug: existing.person_slug,
  });
  if (fromId !== toId) deleteMark(fromId);
  return next;
}
