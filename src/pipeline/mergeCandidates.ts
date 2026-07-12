import type {
  Candidate,
  GitHubProfile,
  LinkedInProfile,
  OlympiadProfile,
  SubstackProfile,
} from "../types.js";
import { scoreCandidate } from "../scoring/computeScore.js";

export interface RawCandidate {
  key: string;
  name: string;
  discovered_via: string[];
  linkedin?: LinkedInProfile;
  identity_confidence: number;
  github?: GitHubProfile;
  substack?: SubstackProfile;
  olympiad?: OlympiadProfile;
}

function normKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function mergeCandidates(raw: RawCandidate[]): Candidate[] {
  const map = new Map<string, RawCandidate>();

  for (const item of raw) {
    const key = item.key || normKey(item.name);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...item,
        key,
        discovered_via: [...item.discovered_via],
        identity_confidence: item.identity_confidence ?? 0,
      });
      continue;
    }
    existing.discovered_via = [
      ...new Set([...existing.discovered_via, ...item.discovered_via]),
    ];
    if (item.linkedin && !existing.linkedin) existing.linkedin = item.linkedin;
    if (item.identity_confidence > existing.identity_confidence) {
      existing.identity_confidence = item.identity_confidence;
    }
    if (item.github && !existing.github) existing.github = item.github;
    if (item.substack && !existing.substack) existing.substack = item.substack;
    if (item.olympiad && !existing.olympiad) existing.olympiad = item.olympiad;
    if (!existing.name && item.name) existing.name = item.name;
  }

  return [...map.values()]
    .map((c) =>
      scoreCandidate({
        name: c.name,
        key: c.key,
        discovered_via: c.discovered_via,
        linkedin: c.linkedin,
        identity_confidence: c.identity_confidence,
        github: c.github,
        substack: c.substack,
        olympiad: c.olympiad,
      })
    )
    .sort((a, b) => b.final_score - a.final_score);
}

export function addRaw(
  pool: Map<string, RawCandidate>,
  entry: Omit<RawCandidate, "key" | "identity_confidence"> & {
    key?: string;
    identity_confidence?: number;
  }
): void {
  const key = entry.key ?? normKey(entry.name);
  const existing = pool.get(key);
  if (!existing) {
    pool.set(key, {
      key,
      name: entry.name,
      discovered_via: [...entry.discovered_via],
      linkedin: entry.linkedin,
      identity_confidence: entry.identity_confidence ?? 0,
      github: entry.github,
      substack: entry.substack,
      olympiad: entry.olympiad,
    });
    return;
  }
  existing.discovered_via = [
    ...new Set([...existing.discovered_via, ...entry.discovered_via]),
  ];
  if (entry.linkedin) existing.linkedin = entry.linkedin;
  if ((entry.identity_confidence ?? 0) > existing.identity_confidence) {
    existing.identity_confidence = entry.identity_confidence ?? 0;
  }
  if (entry.github) existing.github = entry.github;
  if (entry.substack) existing.substack = entry.substack;
  if (entry.olympiad) existing.olympiad = entry.olympiad;
}
