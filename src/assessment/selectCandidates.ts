import fs from "fs";
import type { Candidate } from "../types.js";
import {
  githubUsernameFromCandidate,
  identityFromCandidate,
} from "./candidateIdentity.js";
import type { SourceCandidateSnapshot } from "./types.js";

export interface SelectedCandidate {
  candidate: Candidate;
  candidate_id: string;
  identity: ReturnType<typeof identityFromCandidate>;
  source_snapshot: SourceCandidateSnapshot;
}

export function loadCandidatesFromPath(filePath: string): Candidate[] {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!Array.isArray(raw)) {
    throw new Error(`Expected candidates array at ${filePath}`);
  }
  return raw as Candidate[];
}

export function selectCandidatesForAssessment(
  candidates: Candidate[],
  opts: {
    limit: number;
    candidateId?: string;
    candidateIds?: string[];
    seedName?: string;
  }
): SelectedCandidate[] {
  let pool = [...candidates].sort(
    (a, b) => (b.final_score ?? 0) - (a.final_score ?? 0)
  );

  if (opts.seedName) {
    const want = opts.seedName.trim().toLowerCase();
    pool = pool.filter(
      (c) =>
        c.name.trim().toLowerCase() === want ||
        c.key.trim().toLowerCase() === want
    );
  }

  const idFilter =
    opts.candidateIds && opts.candidateIds.length > 0
      ? new Set(opts.candidateIds)
      : opts.candidateId
        ? new Set([opts.candidateId])
        : null;

  const selected: SelectedCandidate[] = [];
  const seen = new Set<string>();

  for (const c of pool) {
    if (selected.length >= opts.limit) break;
    const identity = identityFromCandidate(c);
    if (idFilter && !idFilter.has(identity.candidate_id)) {
      continue;
    }
    if (seen.has(identity.candidate_id)) continue;
    seen.add(identity.candidate_id);

    const ghUser = githubUsernameFromCandidate(c);
    selected.push({
      candidate: c,
      candidate_id: identity.candidate_id,
      identity,
      source_snapshot: {
        key: c.key,
        name: c.name,
        discovery_score: c.final_score,
        score_breakdown: c.score_breakdown,
        discovered_via: [...c.discovered_via],
        linkedin_url: c.linkedin?.url,
        github_username: ghUser,
        github_url: c.github?.profile_url ?? c.linkedin?.github_url ?? undefined,
        website_url:
          c.linkedin?.personal_website ?? c.website?.url ?? undefined,
        blog_url: c.github?.blog ?? c.substack?.url ?? undefined,
      },
    });
  }

  return selected;
}
