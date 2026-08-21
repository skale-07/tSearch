import {
  canonicalizeUrl,
  hostnameOf,
  sameRegistrableHost,
} from "./canonicalizeUrl.js";
import { isNewsCoverageUrl, isWritingPlatformHost } from "./writingHubs.js";

export interface ArticleAuthorInput {
  canonical_url: string;
  author_text?: string;
}

export interface ArticleAuthorOpts {
  candidateName?: string;
  personalSiteUrl?: string;
  hubProfileUrls?: string[];
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return fold(s).split(/\s+/).filter(Boolean);
}

/** "Kwak, Grace" → "Grace Kwak" */
function flipLastFirst(name: string): string | null {
  const m = name.trim().match(/^([\p{L}.''-]+),\s*([\p{L}.'' -]+)$/u);
  if (!m) return null;
  return `${m[2]} ${m[1]}`;
}

export function splitAuthorList(text: string): string[] {
  const chunks = text.split(/\s*(?:;|\||\band\b|&)\s*/i);
  const out: string[] = [];
  for (const chunk of chunks) {
    const t = chunk.trim();
    if (!t) continue;
    if (/^[\p{L}.''-]+,\s*[\p{L}.'' -]+$/u.test(t)) {
      out.push(t);
      continue;
    }
    for (const part of t.split(/\s*,\s*/)) {
      const q = part.replace(/^\s*and\s+/i, "").trim();
      if (q.length >= 2) out.push(q);
    }
  }
  return out;
}

export function nameIsAmongAuthors(
  candidateName: string,
  authorText: string
): boolean {
  const want = tokens(candidateName);
  if (want.length === 0) return false;
  for (const raw of splitAuthorList(authorText)) {
    for (const variant of [raw, flipLastFirst(raw)].filter(
      (v): v is string => !!v
    )) {
      if (personMatches(want, tokens(variant))) return true;
    }
  }
  return false;
}

function personMatches(candidate: string[], author: string[]): boolean {
  if (author.length === 0) return false;
  if (candidate.length === 1) {
    return author.length === 1 && candidate[0] === author[0];
  }
  if (author.length === 1) return false;
  const cLast = candidate[candidate.length - 1]!;
  const aLast = author[author.length - 1]!;
  if (cLast !== aLast) return false;
  const cFirst = candidate[0]!;
  const aFirst = author[0]!;
  if (cFirst === aFirst) return true;
  if (aFirst.length === 1 && cFirst.startsWith(aFirst)) return true;
  if (cFirst.length === 1 && aFirst.startsWith(cFirst)) return true;
  return false;
}

function hostOf(url: string): string | null {
  return hostnameOf(url)?.replace(/^www\./i, "").toLowerCase() ?? null;
}

function mediumHandle(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (host.endsWith(".medium.com") && host !== "medium.com") {
    return host.slice(0, -".medium.com".length);
  }
  if (host === "medium.com") {
    try {
      const m = new URL(url).pathname.match(/^\/@([^/]+)/i);
      return m?.[1]?.toLowerCase() ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export function articleOnHubProfile(
  articleUrl: string,
  hubUrl: string
): boolean {
  const article = canonicalizeUrl(articleUrl) ?? articleUrl;
  const hub = canonicalizeUrl(hubUrl) ?? hubUrl;
  const aHandle = mediumHandle(article);
  const hHandle = mediumHandle(hub);
  if (aHandle && hHandle && aHandle === hHandle) return true;
  try {
    const au = new URL(article);
    const hu = new URL(hub);
    if (hostOf(article) !== hostOf(hub)) return false;
    const hubPath = hu.pathname.replace(/\/$/, "") || "/";
    const articlePath = au.pathname.replace(/\/$/, "") || "/";
    if (hubPath === "/") return true;
    return articlePath === hubPath || articlePath.startsWith(`${hubPath}/`);
  } catch {
    return false;
  }
}

function isInstitutionalHost(host: string): boolean {
  if (isNewsCoverageUrl(`https://${host}/`)) return true;
  if (/\.k12\./i.test(host)) return true;
  if (/\.(gov|edu)$/i.test(host) && !isWritingPlatformHost(host)) return true;
  return false;
}

/**
 * Same personal surface: their domain, or a path under an institutional
 * profile URL. News/org roots are not a personal blog.
 */
export function onPersonalWritingSurface(
  articleUrl: string,
  personalSiteUrl: string
): boolean {
  if (!sameRegistrableHost(articleUrl, personalSiteUrl)) return false;
  const host = hostOf(personalSiteUrl);
  if (!host) return false;
  if (isInstitutionalHost(host) || isNewsCoverageUrl(personalSiteUrl)) {
    try {
      const personalPath =
        new URL(personalSiteUrl).pathname.replace(/\/$/, "") || "/";
      const articlePath =
        new URL(articleUrl).pathname.replace(/\/$/, "") || "/";
      if (personalPath === "/") return false;
      return (
        articlePath === personalPath ||
        articlePath.startsWith(`${personalPath}/`)
      );
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Keep an article only when this person is the author or a co-author.
 * Unbylined pages on their personal site / writing hub still count.
 * News and org pages without a matching byline do not.
 */
export function articleAuthoredByCandidate(
  article: ArticleAuthorInput,
  opts: ArticleAuthorOpts
): boolean {
  const name = opts.candidateName?.trim();
  if (name && article.author_text?.trim()) {
    return nameIsAmongAuthors(name, article.author_text);
  }
  if (
    opts.hubProfileUrls?.some((hub) =>
      articleOnHubProfile(article.canonical_url, hub)
    )
  ) {
    return true;
  }
  if (
    opts.personalSiteUrl &&
    onPersonalWritingSurface(article.canonical_url, opts.personalSiteUrl)
  ) {
    return true;
  }
  return false;
}
