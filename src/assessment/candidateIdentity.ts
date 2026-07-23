import crypto from "crypto";
import type { Candidate } from "../types.js";
import type {
  CandidateIdSource,
  CandidateIdentityAssessment,
} from "./types.js";

function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function canonicalizeLinkedInUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/in\/([^/?#]+)/i);
    if (!m) return null;
    return `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}/`;
  } catch {
    return null;
  }
}

function canonicalizeWebsite(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    u.hash = "";
    u.search = "";
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const pathname = u.pathname.replace(/\/$/, "") || "";
    return `https://${host}${pathname}`;
  } catch {
    return null;
  }
}

function hashId(namespace: string, identifier: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${namespace}:${identifier}`)
    .digest("hex")
    .slice(0, 24);
  return `cand_${digest}`;
}

export interface IdentityInput {
  name: string;
  key?: string;
  github_username?: string | null;
  github_url?: string | null;
  linkedin_url?: string | null;
  website_url?: string | null;
}

export function githubUsernameFromCandidate(c: Candidate): string | undefined {
  const fromProfile = c.github?.username?.trim();
  if (fromProfile) return fromProfile.toLowerCase();
  const url =
    c.linkedin?.github_url ??
    c.website?.github_url ??
    c.github?.profile_url ??
    null;
  if (!url) return undefined;
  const m = url.match(/github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)/i);
  return m ? m[1].toLowerCase() : undefined;
}

export function resolveCandidateIdentity(
  input: IdentityInput
): CandidateIdentityAssessment {
  const display_name = input.name.trim();
  const gh =
    input.github_username?.trim().toLowerCase() ||
    (input.github_url
      ? input.github_url.match(
          /github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)/i
        )?.[1]?.toLowerCase()
      : undefined);

  if (gh) {
    return {
      candidate_id: hashId("github", gh),
      id_source: "github_username",
      id_raw: gh,
      display_name,
      github_username: gh,
      linkedin_url: input.linkedin_url ?? undefined,
      website_url: input.website_url ?? undefined,
    };
  }

  const li = input.linkedin_url
    ? canonicalizeLinkedInUrl(input.linkedin_url)
    : null;
  if (li) {
    return {
      candidate_id: hashId("linkedin", li),
      id_source: "linkedin_url",
      id_raw: li,
      display_name,
      linkedin_url: li,
      website_url: input.website_url ?? undefined,
    };
  }

  const site = input.website_url
    ? canonicalizeWebsite(input.website_url)
    : null;
  if (site) {
    const raw = `${site}|${normName(display_name)}`;
    return {
      candidate_id: hashId("website_name", raw),
      id_source: "website_name",
      id_raw: raw,
      display_name,
      website_url: site,
    };
  }

  const key = (input.key ?? normName(display_name)).trim().toLowerCase();
  const raw = `${key}|${normName(display_name)}`;
  return {
    candidate_id: hashId("candidate_key", raw),
    id_source: "candidate_key" as CandidateIdSource,
    id_raw: raw,
    display_name,
  };
}

export function identityFromCandidate(
  c: Candidate
): CandidateIdentityAssessment {
  return resolveCandidateIdentity({
    name: c.name,
    key: c.key,
    github_username: githubUsernameFromCandidate(c),
    github_url: c.github?.profile_url ?? c.linkedin?.github_url ?? null,
    linkedin_url: c.linkedin?.url ?? null,
    website_url:
      c.linkedin?.personal_website ?? c.website?.url ?? c.github?.blog ?? null,
  });
}
