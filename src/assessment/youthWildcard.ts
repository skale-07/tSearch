import crypto from "crypto";
import path from "path";
import type { Candidate, LinkedInExperience, LinkedInProfile } from "../types.js";
import { readJson, writeJsonAtomic } from "../storage/jsonStore.js";
import { ageFromPublicIdentity } from "./stage/deriveStage.js";
import { identityFromCandidate } from "./candidateIdentity.js";
import { isTechnicalExperience } from "../scoring/linkedinTechnical.js";

/** Frozen draw size from the 17–19 pool. */
export const YOUTH_WILDCARD_LIMIT = 5;
export const YOUTH_AGE_MIN = 17;
export const YOUTH_AGE_MAX = 19;

const DRAW_SALT = "youth-wildcard-v1";

const GENERIC_LINK =
  /linkedin\.com|twitter\.com|\bx\.com\b|facebook\.com|instagram\.com|^mailto:/i;

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Role has a title, a company, and at least one extra field (dates, place, or prose). */
export function experienceHasDetail(role: LinkedInExperience): boolean {
  if (!role.title?.trim() || !role.company?.trim()) return false;
  if (role.dates?.trim()) return true;
  if (role.location?.trim()) return true;
  return (role.description?.trim().length ?? 0) >= 80;
}

export function hasDetailedLinkedInExperience(
  linkedin?: LinkedInProfile | null
): boolean {
  const rows = (linkedin?.experience ?? []).filter(experienceHasDetail);
  if (rows.length >= 2) return true;
  if (rows.length === 1 && isTechnicalExperience(rows[0]!)) return true;
  return rows.some((r) => (r.description?.trim().length ?? 0) >= 80);
}

/**
 * Featured pins first. Older scrapes never stored Featured — fall back to
 * Contact-info / personal-site outbound links that aren't generic socials.
 */
export function interestingProfileLinks(candidate: Candidate): string[] {
  const featured = (candidate.linkedin?.featured_links ?? []).filter(isHttpUrl);
  if (featured.length) {
    return [...new Set(featured.filter((u) => !GENERIC_LINK.test(u)))];
  }
  const fallback = [
    ...(candidate.linkedin?.contact_links ?? []),
    ...(candidate.website?.other_links ?? []),
  ].filter((u) => isHttpUrl(u) && !GENERIC_LINK.test(u));
  return [...new Set(fallback)];
}

export function isYouthWildcardPoolMember(candidate: Candidate): boolean {
  const age = ageFromPublicIdentity({
    linkedin: candidate.linkedin,
    olympiad: candidate.olympiad,
    website: candidate.website,
    github: candidate.github,
  }).estimated_age;
  if (age == null || age < YOUTH_AGE_MIN || age > YOUTH_AGE_MAX) return false;
  if (!hasDetailedLinkedInExperience(candidate.linkedin)) return false;
  return interestingProfileLinks(candidate).length > 0;
}

function drawKey(candidateId: string): string {
  return crypto.createHash("sha256").update(`${DRAW_SALT}:${candidateId}`).digest("hex");
}

export interface YouthWildcardFreeze {
  ids: string[];
  pinned_ids: string[];
  pending_rotate_ids: string[];
  /** Left the freeze (rotated or aged out). Newest first. Never overlaps `ids`. */
  alumni_ids: string[];
}

interface YouthWildcardState {
  ids: string[];
  pinned_ids: string[];
  pending_rotate_ids: string[];
  alumni_ids: string[];
  active_session_id: string | null;
}

function youthWildcardPath(): string {
  return path.resolve(
    process.cwd(),
    process.env.YOUTH_WILDCARD_PATH ?? "data/youth-wildcard.json"
  );
}

function emptyState(): YouthWildcardState {
  return {
    ids: [],
    pinned_ids: [],
    pending_rotate_ids: [],
    alumni_ids: [],
    active_session_id: null,
  };
}

function loadState(): YouthWildcardState {
  const rec = readJson<YouthWildcardState & {
    held_ids?: string[];
    rotating_ids?: string[];
    rotate_after_session?: boolean;
  }>(youthWildcardPath());
  if (!rec) return emptyState();
  const fromSlots = [
    ...(Array.isArray(rec.held_ids) ? rec.held_ids : []),
    ...(Array.isArray(rec.rotating_ids) ? rec.rotating_ids : []),
  ].filter((id) => typeof id === "string");
  const ids = (
    Array.isArray(rec.ids) && rec.ids.length ? rec.ids : fromSlots
  ).filter((id) => typeof id === "string");
  return {
    ids,
    pinned_ids: Array.isArray(rec.pinned_ids)
      ? rec.pinned_ids.filter((id) => typeof id === "string")
      : [],
    pending_rotate_ids: Array.isArray(rec.pending_rotate_ids)
      ? rec.pending_rotate_ids.filter((id) => typeof id === "string")
      : [],
    alumni_ids: Array.isArray(rec.alumni_ids)
      ? rec.alumni_ids.filter((id) => typeof id === "string")
      : [],
    active_session_id:
      typeof rec.active_session_id === "string" ? rec.active_session_id : null,
  };
}

function saveState(state: YouthWildcardState): void {
  writeJsonAtomic(youthWildcardPath(), state);
}

export function rankedYouthWildcardPool(candidates: Candidate[]): string[] {
  const pool = candidates
    .filter(isYouthWildcardPoolMember)
    .map((c) => identityFromCandidate(c).candidate_id);
  const unique = [...new Set(pool)];
  unique.sort((a, b) => drawKey(a).localeCompare(drawKey(b)));
  return unique;
}

function takeFrom(
  pool: string[],
  n: number,
  exclude: Set<string>
): string[] {
  const out: string[] = [];
  for (const id of pool) {
    if (out.length >= n) break;
    if (exclude.has(id)) continue;
    out.push(id);
    exclude.add(id);
  }
  return out;
}

function fillFreeze(
  ids: string[],
  pool: string[]
): { ids: string[]; dropped: string[] } {
  const poolSet = new Set(pool);
  const dropped = ids.filter((id) => !poolSet.has(id));
  const kept = ids.filter((id) => poolSet.has(id));
  const exclude = new Set(kept);
  return {
    ids: [
      ...kept,
      ...takeFrom(pool, YOUTH_WILDCARD_LIMIT - kept.length, exclude),
    ].slice(0, YOUTH_WILDCARD_LIMIT),
    dropped,
  };
}

function withAlumni(
  state: YouthWildcardState,
  dropped: string[]
): YouthWildcardState {
  const current = new Set(state.ids);
  const incoming = dropped.filter((id) => id && !current.has(id));
  const seen = new Set(incoming);
  const rest = state.alumni_ids.filter(
    (id) => !seen.has(id) && !current.has(id)
  );
  return { ...state, alumni_ids: [...incoming, ...rest] };
}

function reconcileState(
  state: YouthWildcardState,
  pool: string[]
): YouthWildcardState {
  const filled = fillFreeze(state.ids, pool);
  const idSet = new Set(filled.ids);
  return withAlumni(
    {
      ...state,
      ids: filled.ids,
      pinned_ids: state.pinned_ids.filter((id) => idSet.has(id)),
      pending_rotate_ids: state.pending_rotate_ids.filter((id) =>
        idSet.has(id)
      ),
    },
    filled.dropped
  );
}

function applyQueuedRotation(
  state: YouthWildcardState,
  pool: string[]
): YouthWildcardState {
  const base = reconcileState(state, pool);
  const pinned = new Set(base.pinned_ids);
  const drop = base.pending_rotate_ids.filter((id) => !pinned.has(id));
  if (!drop.length) {
    return { ...base, pending_rotate_ids: [] };
  }
  const dropSet = new Set(drop);
  const stay = base.ids.filter((id) => !dropSet.has(id));
  const previous = new Set(base.ids);
  const exclude = new Set(stay);
  const need = YOUTH_WILDCARD_LIMIT - stay.length;
  const fresh = takeFrom(
    pool.filter((id) => !previous.has(id)),
    need,
    exclude
  );
  const rest = takeFrom(pool, need - fresh.length, exclude);
  return withAlumni(
    {
      ...base,
      ids: [...stay, ...fresh, ...rest].slice(0, YOUTH_WILDCARD_LIMIT),
      pending_rotate_ids: [],
    },
    drop
  );
}

function freezeFromState(state: YouthWildcardState): YouthWildcardFreeze {
  const current = new Set(state.ids);
  return {
    ids: [...state.ids],
    pinned_ids: [...state.pinned_ids],
    pending_rotate_ids: [...state.pending_rotate_ids],
    alumni_ids: state.alumni_ids.filter((id) => !current.has(id)),
  };
}

/**
 * Current five. Assessed wildcards (minus Keep) swap on the first list
 * load of a *new* browser session — not in the session that queued them.
 */
export function resolveYouthWildcardFreeze(
  candidates: Candidate[],
  opts?: { sessionId?: string }
): YouthWildcardFreeze {
  const pool = rankedYouthWildcardPool(candidates);
  let state = reconcileState(loadState(), pool);
  const sessionId = opts?.sessionId?.trim() ?? "";
  if (
    sessionId &&
    state.active_session_id &&
    sessionId !== state.active_session_id &&
    state.pending_rotate_ids.length
  ) {
    state = applyQueuedRotation(state, pool);
  }
  if (sessionId) state.active_session_id = sessionId;
  saveState(state);
  return freezeFromState(state);
}

/**
 * Queue freeze members who were in this assessment. Next session replaces
 * them unless Keep is on. Assessing zero wildcards does nothing.
 */
export function markYouthWildcardAssessed(assessedIds: string[]): void {
  const state = loadState();
  const freeze = new Set(state.ids);
  const queued = assessedIds.filter((id) => freeze.has(id));
  if (!queued.length) return;
  const pending = new Set(state.pending_rotate_ids);
  for (const id of queued) pending.add(id);
  state.pending_rotate_ids = [...pending];
  saveState(state);
}

export function setYouthWildcardPinned(
  candidates: Candidate[],
  candidateId: string,
  pinned: boolean
): YouthWildcardFreeze | { error: string } {
  const freeze = resolveYouthWildcardFreeze(candidates);
  if (!freeze.ids.includes(candidateId)) {
    return { error: "That person is not in the current youth-wildcard freeze." };
  }
  const state = loadState();
  const next = new Set(state.pinned_ids);
  if (pinned) next.add(candidateId);
  else next.delete(candidateId);
  state.pinned_ids = [...next];
  saveState(state);
  return freezeFromState(state);
}

/**
 * Merge ids that used to sit in a freeze (assessment-run snapshots).
 * Current freeze members are skipped. Does not rotate.
 */
export function ingestYouthWildcardAlumni(ids: string[]): YouthWildcardFreeze {
  const state = withAlumni(loadState(), ids);
  saveState(state);
  return freezeFromState(state);
}

export function youthWildcardRowFlags(
  candidateId: string,
  freeze: YouthWildcardFreeze
): {
  youth_wildcard: boolean;
  youth_wildcard_pinned: boolean;
  youth_wildcard_pending: boolean;
  youth_wildcard_alumni: boolean;
} {
  const current = freeze.ids.includes(candidateId);
  return {
    youth_wildcard: current,
    youth_wildcard_pinned: current && freeze.pinned_ids.includes(candidateId),
    youth_wildcard_pending:
      current && freeze.pending_rotate_ids.includes(candidateId),
    youth_wildcard_alumni: !current && freeze.alumni_ids.includes(candidateId),
  };
}

/**
 * Current freeze ids. Pass sessionId from the Assess UI so a pending
 * rotation can apply after the previous session.
 */
export function pickYouthWildcardIds(
  candidates: Candidate[],
  opts?: { sessionId?: string }
): Set<string> {
  return new Set(resolveYouthWildcardFreeze(candidates, opts).ids);
}
