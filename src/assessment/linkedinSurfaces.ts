import type { Candidate } from "../types.js";
import { githubUsernameFromUrl } from "../linkedin/linkedinExtract.js";
import { canonicalizeUrl } from "./blog/canonicalizeUrl.js";
import {
  firstWritingSurfaceUrl,
  isAuthoredPublicationUrl,
  isNewsCoverageUrl,
  isWritingHubProfileUrl,
  isWritingPlatformArticleUrl,
} from "./blog/writingHubs.js";

function outboundUrls(candidate: Candidate): string[] {
  const li = candidate.linkedin;
  const raw = [
    li?.github_url,
    li?.substack_url,
    li?.personal_website,
    li?.website_url,
    ...(li?.featured_links ?? []),
    ...(li?.contact_links ?? []),
    candidate.website?.url,
    candidate.website?.github_url,
    candidate.website?.medium_url,
    candidate.website?.substack_url,
    candidate.github?.blog,
    candidate.substack?.url,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item?.trim()) continue;
    const u = canonicalizeUrl(item) ?? item.trim();
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** GitHub login pinned on LinkedIn (Contact, Featured, or stored github_url). */
export function githubUsernameFromLinkedInSurfaces(
  candidate: Candidate
): string | undefined {
  for (const url of outboundUrls(candidate)) {
    const login = githubUsernameFromUrl(url);
    if (login) return login.toLowerCase();
  }
  return undefined;
}

/**
 * Surfaces the person published or maintains: blogs, papers, GitHub-adjacent
 * writing hubs. Press-about-them URLs are dropped.
 */
export function authoredWritingUrls(candidate: Candidate): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of outboundUrls(candidate)) {
    if (isNewsCoverageUrl(url)) continue;
    if (
      !isWritingHubProfileUrl(url) &&
      !isWritingPlatformArticleUrl(url) &&
      !isAuthoredPublicationUrl(url)
    ) {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function primaryWritingSurfaceUrl(candidate: Candidate): string | null {
  return firstWritingSurfaceUrl(authoredWritingUrls(candidate));
}
