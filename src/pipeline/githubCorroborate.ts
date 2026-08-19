import type { LinkedInProfile, OlympiadProfile } from "../types.js";

/**
 * Distinctive tokens from school / college / major. Generic words
 * ("university", "computer science") are not identity.
 */
const STOP = new Set([
  "the",
  "and",
  "of",
  "for",
  "at",
  "in",
  "a",
  "an",
  "high",
  "school",
  "schools",
  "senior",
  "junior",
  "secondary",
  "college",
  "university",
  "universities",
  "academy",
  "institute",
  "technology",
  "preparatory",
  "prep",
  "public",
  "private",
  "international",
  "united",
  "states",
  "america",
  "usa",
  "inc",
  "llc",
  "department",
  "dept",
  "campus",
  "computer",
  "science",
  "sciences",
  "engineering",
  "biology",
  "chemistry",
  "physics",
  "mathematics",
  "math",
  "business",
  "economics",
  "electrical",
  "mechanical",
  "software",
  "studies",
  "arts",
  "bachelor",
  "master",
  "degree",
  "bs",
  "ba",
  "ms",
  "phd",
]);

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Needles that are allowed to prove school/college/major overlap. */
export function distinctiveNeedles(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const folded = fold(trimmed);
  const words = folded.split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
  const out: string[] = [];

  const acronym = trimmed.replace(/[^A-Za-z]/g, "");
  if (/^[A-Za-z]{2,6}$/.test(acronym) && !STOP.has(acronym.toLowerCase())) {
    out.push(acronym.toLowerCase());
  }

  if (words.length >= 2) {
    const phrase = words.join(" ");
    if (phrase.length >= 8) out.push(phrase);
  }
  for (const w of words) {
    if (w.length >= 5) out.push(w);
  }
  return [...new Set(out)];
}

export function identityAnchors(
  linkedin: LinkedInProfile,
  olympiad?: OlympiadProfile
): string[] {
  const raw: string[] = [];
  if (linkedin.school) raw.push(linkedin.school);
  if (linkedin.college) raw.push(linkedin.college);
  for (const edu of linkedin.education ?? []) {
    if (edu.school) raw.push(edu.school);
    if (edu.field) raw.push(edu.field);
  }
  for (const school of olympiad?.schools ?? []) raw.push(school);
  return [...new Set(raw.flatMap(distinctiveNeedles))];
}

export function githubProfileBlob(parts: {
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  blog?: string | null;
  readme?: string | null;
  orgs?: string | null;
}): string {
  return fold(
    [
      parts.bio,
      parts.company,
      parts.location,
      parts.blog,
      parts.readme,
      parts.orgs,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

export function corroboratingHits(
  anchors: string[],
  blob: string
): string[] {
  if (!anchors.length || !blob) return [];
  const hit: string[] = [];
  for (const needle of anchors) {
    if (needle.length <= 4) {
      const re = new RegExp(`(?:^| )${needle}(?: |$)`);
      if (re.test(blob)) hit.push(needle);
      continue;
    }
    if (blob.includes(needle)) hit.push(needle);
  }
  return hit;
}

export function linkedInSlugFromUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const href = url.startsWith("http") ? url : `https://${url}`;
    const m = new URL(href).pathname.match(/\/in\/([^/]+)/i);
    if (!m?.[1]) return null;
    return decodeURIComponent(m[1]).toLowerCase().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Personal-site host only — not LinkedIn/GitHub/Twitter themselves. */
export function personalSiteHost(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const href = url.startsWith("http") ? url : `https://${url}`;
    const host = new URL(href).hostname.replace(/^www\./i, "").toLowerCase();
    if (!host) return null;
    if (
      /^(github\.com|linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com)$/.test(
        host
      )
    ) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the GitHub bio/README/socials cite this LinkedIn slug. */
export function profileCitesLinkedIn(text: string, slug: string): boolean {
  if (!text || !slug) return false;
  return new RegExp(
    `linkedin\\.com/in/${escapeRe(slug)}(?:[/?#\\s'"\\)]|$)`,
    "i"
  ).test(text);
}

export function profileCitesWebsite(text: string, host: string): boolean {
  if (!text || !host) return false;
  return new RegExp(
    `(?:https?://)?(?:www\\.)?${escapeRe(host)}(?:[/?#\\s'"\\)]|$)`,
    "i"
  ).test(text);
}

export type GithubLinkHit = { via: "linkedin" | "website"; detail: string };

/**
 * Strong identity: the GitHub profile points back at the LinkedIn or
 * personal site we already resolved. School tokens are a weaker fallback
 * (see corroboratingHits) — most people never put high school in a README.
 */
export function githubCitesKnownIdentity(
  text: string,
  linkedinUrl: string | null | undefined,
  websiteUrls: Array<string | null | undefined>
): GithubLinkHit | null {
  const slug = linkedInSlugFromUrl(linkedinUrl);
  if (slug && profileCitesLinkedIn(text, slug)) {
    return { via: "linkedin", detail: slug };
  }
  for (const url of websiteUrls) {
    const host = personalSiteHost(url);
    if (host && profileCitesWebsite(text, host)) {
      return { via: "website", detail: host };
    }
  }
  return null;
}
