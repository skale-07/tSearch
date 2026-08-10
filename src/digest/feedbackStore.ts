import fs from "fs";
import path from "path";
import { FEEDBACK_DIR } from "../config.js";
import { readJson, slugify, writeJsonAtomic } from "../storage/jsonStore.js";

/**
 * Phase 3 of the digest roadmap: reviewer feedback captured per candidate.
 * Bound to the stable assessment candidate_id (spec open-question #5) so it
 * survives re-runs and name collisions.
 */
export type FeedbackVerdict = "relevant" | "not_relevant" | "explore_network";

export const FEEDBACK_VERDICTS: readonly FeedbackVerdict[] = [
  "relevant",
  "not_relevant",
  "explore_network",
];

export interface FeedbackEntry {
  verdict: FeedbackVerdict;
  note?: string;
  at: string;
}

export interface FeedbackRecord {
  candidate_id: string;
  candidate_name?: string;
  entries: FeedbackEntry[];
  /** Most recent verdict — the one ranking refinement acts on. */
  latest_verdict: FeedbackVerdict;
  updated_at: string;
}

function feedbackPath(candidateId: string): string {
  return path.join(FEEDBACK_DIR, `${slugify(candidateId)}.json`);
}

export function loadFeedback(candidateId: string): FeedbackRecord | null {
  return readJson<FeedbackRecord>(feedbackPath(candidateId));
}

export function recordFeedback(input: {
  candidate_id: string;
  candidate_name?: string;
  verdict: FeedbackVerdict;
  note?: string;
}): FeedbackRecord {
  const now = new Date().toISOString();
  const existing = loadFeedback(input.candidate_id);
  const entry: FeedbackEntry = {
    verdict: input.verdict,
    ...(input.note ? { note: input.note } : {}),
    at: now,
  };
  const record: FeedbackRecord = {
    candidate_id: input.candidate_id,
    candidate_name: input.candidate_name ?? existing?.candidate_name,
    entries: [...(existing?.entries ?? []), entry],
    latest_verdict: input.verdict,
    updated_at: now,
  };
  writeJsonAtomic(feedbackPath(input.candidate_id), record);
  return record;
}

export function loadAllFeedback(): FeedbackRecord[] {
  if (!fs.existsSync(FEEDBACK_DIR)) return [];
  const records: FeedbackRecord[] = [];
  for (const file of fs.readdirSync(FEEDBACK_DIR)) {
    if (!file.endsWith(".json")) continue;
    const rec = readJson<FeedbackRecord>(path.join(FEEDBACK_DIR, file));
    if (rec?.candidate_id && rec.latest_verdict) records.push(rec);
  }
  return records;
}

/** Map keyed by candidate_id, ready for buildDigest. */
export function loadFeedbackMap(): Map<string, FeedbackRecord> {
  return new Map(loadAllFeedback().map((r) => [r.candidate_id, r]));
}

/** Candidates the reviewer asked to expand — feeds branch-expand runs. */
export function exploreQueue(): FeedbackRecord[] {
  return loadAllFeedback().filter(
    (r) => r.latest_verdict === "explore_network"
  );
}
