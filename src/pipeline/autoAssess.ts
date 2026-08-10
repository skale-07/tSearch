import type { Candidate } from "../types.js";
import { identityFromCandidate } from "../assessment/candidateIdentity.js";

/**
 * Auto-assess condition: a GitHub path AND a writing surface (personal
 * website / blog / Substack) is the solid base case — both judge paths have
 * real material, so the LLM run is worth its cost without a human picking.
 *
 * Context score is used only as a FLOOR for automatic runs (graph-connection
 * strength ≥ threshold), never as an assessment input: priority_score must
 * stay evidence-based on the person's own work, and manual runs from the UI
 * ignore the floor entirely.
 */

export const AUTO_ASSESS_MIN_CONTEXT = Number(
  process.env.AUTO_ASSESS_MIN_CONTEXT ?? 4
);

export function hasGithubPath(c: Candidate): boolean {
  return Boolean(c.github?.username || c.github?.profile_url);
}

export function hasWritingSurface(c: Candidate): boolean {
  return Boolean(
    c.linkedin?.personal_website ||
      c.linkedin?.website_url ||
      c.website?.url ||
      c.github?.blog?.trim() ||
      c.substack?.url
  );
}

export interface AutoAssessPick {
  candidate_id: string;
  name: string;
}

export function selectAutoAssess(
  candidates: Candidate[],
  opts: {
    hasReport: (candidateId: string) => boolean;
    minContext?: number;
  }
): AutoAssessPick[] {
  const minContext = opts.minContext ?? AUTO_ASSESS_MIN_CONTEXT;
  const picks: AutoAssessPick[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (!hasGithubPath(c) || !hasWritingSurface(c)) continue;
    // Seeds (identity-resolved) always qualify; discovered neighbors need
    // graph-connection strength so we don't auto-spend on weak matches.
    const isSeedResolved = c.identity_confidence >= 0.35;
    const context = c.github?.context_score ?? 0;
    if (!isSeedResolved && context < minContext) continue;

    const candidate_id = identityFromCandidate(c).candidate_id;
    if (seen.has(candidate_id) || opts.hasReport(candidate_id)) continue;
    seen.add(candidate_id);
    picks.push({ candidate_id, name: c.name });
  }
  return picks;
}
