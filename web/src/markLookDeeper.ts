/** Fields the look-deeper decision needs. Full MarkRecord lives in api.ts. */
export interface MarkLookDeeperInput {
  id: string;
  candidate_id?: string;
  seed_slug?: string;
  person_slug?: string;
}

export type MarkLookDeeper =
  | { kind: "digest"; href: string; title: string }
  | { kind: "graph"; title: string }
  | { kind: "assess"; candidateId: string; title: string }
  | { kind: "hint"; title: string };

const DIGEST_TITLE = "Open digest profile";
const GRAPH_TITLE = "Open graph profile";
const ASSESS_TITLE = "Run an assessment on them to look deeper";
const HINT_TITLE =
  "Confirm them on LinkedIn first — then you can open their profile";

export function isPageHitMarkId(id: string): boolean {
  return id.startsWith("page:");
}

/** Assessment / merge ids are `cand_` + hash. Graph slugs are not. */
export function looksLikeCandidateId(id: string): boolean {
  return id.startsWith("cand_");
}

export function assessedProfileHref(candidateId: string): string {
  return `/api/assessed/${encodeURIComponent(candidateId)}/profile.html`;
}

/** Prefer explicit candidate_id; page-hit ids are not identities. */
export function markCandidateId(mark: MarkLookDeeperInput): string | undefined {
  const fromField = mark.candidate_id?.trim();
  if (fromField) return fromField;
  const id = mark.id.trim();
  if (!id || isPageHitMarkId(id)) return undefined;
  return id;
}

/**
 * Tree node slug for reopen. person_slug wins; otherwise a non-page,
 * non-candidate mark id (typical graph star before GitHub attach).
 */
export function markGraphSlug(mark: MarkLookDeeperInput): string | undefined {
  const stored = mark.person_slug?.trim();
  if (stored) return stored;
  const id = mark.id.trim();
  if (!id || isPageHitMarkId(id) || looksLikeCandidateId(id)) return undefined;
  return id;
}

export function markLookDeeper(
  mark: MarkLookDeeperInput,
  assessedIds: Set<string>
): MarkLookDeeper {
  const candidateId = markCandidateId(mark);
  if (candidateId && assessedIds.has(candidateId)) {
    return {
      kind: "digest",
      href: assessedProfileHref(candidateId),
      title: DIGEST_TITLE,
    };
  }
  if (mark.seed_slug?.trim() && markGraphSlug(mark)) {
    return { kind: "graph", title: GRAPH_TITLE };
  }
  if (candidateId) {
    return { kind: "assess", candidateId, title: ASSESS_TITLE };
  }
  return { kind: "hint", title: HINT_TITLE };
}
