import crypto from "crypto";
import type { Candidate, LinkedInExperience, LinkedInProfile } from "../types.js";
import { ageFromPublicIdentity } from "./stage/deriveStage.js";
import { identityFromCandidate } from "./candidateIdentity.js";
import { isTechnicalExperience } from "../scoring/linkedinTechnical.js";

/** Frozen draw size — a chance on younger LinkedIn-only (or LinkedIn-first) people. */
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
  }).estimated_age;
  if (age == null || age < YOUTH_AGE_MIN || age > YOUTH_AGE_MAX) return false;
  if (!hasDetailedLinkedInExperience(candidate.linkedin)) return false;
  return interestingProfileLinks(candidate).length > 0;
}

function drawKey(candidateId: string): string {
  return crypto.createHash("sha256").update(`${DRAW_SALT}:${candidateId}`).digest("hex");
}

/**
 * Deterministic draw of up to 5 people from the 17–19 pool with detailed
 * LinkedIn experience AND featured/interesting links. Same freeze → same five.
 * Not live random — a flickering lottery would make the assess list unusable.
 */
export function pickYouthWildcardIds(
  candidates: Candidate[],
  limit = YOUTH_WILDCARD_LIMIT
): Set<string> {
  const pool = candidates
    .filter(isYouthWildcardPoolMember)
    .map((c) => identityFromCandidate(c).candidate_id);
  const unique = [...new Set(pool)];
  unique.sort((a, b) => drawKey(a).localeCompare(drawKey(b)));
  return new Set(unique.slice(0, Math.max(0, limit)));
}
