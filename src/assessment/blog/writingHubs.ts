import { canonicalizeUrl, hostnameOf } from "./canonicalizeUrl.js";

/**
 * Personal sites often only *point at* the real writing corpus. The blog
 * collector must treat these hosts as first-class traversal targets, not drop
 * them under same-host filters.
 *
 * Keep this list to platforms where a personal-site href usually means
 * "this person's writing," not a random outbound citation.
 */

/** Exact hostnames (after stripping www.). */
const EXACT_WRITING_HOSTS = new Set([
  "medium.com",
  "substack.com",
  "hashnode.dev",
  "hashnode.com",
  "dev.to",
  "hackernoon.com",
  "zenn.dev",
  "qiita.com",
  "blogspot.com",
  "blogger.com",
  "write.as",
  "mirror.xyz",
  "micro.blog",
  "teletype.in",
  "habr.com",
  "tumblr.com",
]);

/** Host suffix matches (e.g. alice.substack.com, armanco.medium.com). */
const WRITING_HOST_SUFFIXES = [
  ".medium.com",
  ".substack.com",
  ".hashnode.dev",
  ".hashnode.com",
  ".ghost.io",
  ".blogspot.com",
  ".wordpress.com",
  ".bearblog.dev",
  ".writeas.com",
  ".beehiiv.com",
  ".micro.blog",
  ".notion.site",
  ".github.io",
  ".tumblr.com",
];

/** WordPress.com platform chrome — not personal blogs. */
const WORDPRESS_RESERVED_SUBDOMAINS = new Set([
  "subscribe",
  "public-api",
  "s0",
  "s1",
  "s2",
  "widgets",
  "widgets2",
  "r-login",
  "login",
  "forums",
  "en",
  "developer",
  "support",
  "wordpress",
]);

/** Medium platform chrome — never author writing. */
const MEDIUM_RESERVED_SUBDOMAINS = new Set([
  "policy",
  "help",
  "about",
  "status",
  "blog",
  "cdn-client",
  "miro",
  "bold",
  "spectrum",
]);

/** medium.com/<pub>/… publications that are Medium-the-company, not writers. */
const MEDIUM_RESERVED_PUBLICATIONS = new Set([
  "jobs-at-medium",
  "creators",
  "membership",
  "m",
  "me",
  "plans",
  "gift",
  "new-story",
  "tag",
  "topics",
]);

/** Path/slug chrome that shows up in sidebars and footers. */
const PLATFORM_CHROME_PATH =
  /\/(tag|tags|followers|about|privacy|terms|search|login|signup|archive|jobs?|careers?|cookie|cookies|tos|help|membership|pricing|subscribe)(\/|$)/i;

const CHROME_SLUG =
  /(?:^|\/)(?:medium-)?(?:privacy|privacy-policy|terms|terms-of-(?:service|use)|cookie-policy|work-at-medium|jobs?-at-medium)(?:-|$)/i;

function mediumSubdomain(host: string): string | null {
  if (host === "medium.com") return null;
  if (!host.endsWith(".medium.com")) return null;
  return host.slice(0, -".medium.com".length);
}

export function isWritingPlatformHost(hostOrUrl: string): boolean {
  const host = hostOrUrl.includes("://")
    ? hostnameOf(hostOrUrl)
    : hostOrUrl.toLowerCase().replace(/^www\./, "");
  if (!host) return false;
  const h = host.replace(/^www\./, "").toLowerCase();
  const sub = mediumSubdomain(h);
  if (sub && MEDIUM_RESERVED_SUBDOMAINS.has(sub)) return false;
  if (h.endsWith(".wordpress.com")) {
    const wpSub = h.slice(0, -".wordpress.com".length);
    if (!wpSub || WORDPRESS_RESERVED_SUBDOMAINS.has(wpSub)) return false;
  }
  if (h === "wordpress.com") return false;
  if (EXACT_WRITING_HOSTS.has(h)) return true;
  if (WRITING_HOST_SUFFIXES.some((s) => h.endsWith(s))) return true;
  // LinkedIn Pulse articles live on linkedin.com — host alone is not enough;
  // see isWritingPlatformArticleUrl / isWritingHubProfileUrl.
  if (h === "linkedin.com" || h.endsWith(".linkedin.com")) return false;
  if (h === "publish.obsidian.md") return true;
  return false;
}

function pathRoot(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function isMediumStoryUrl(host: string, path: string): boolean {
  const sub = mediumSubdomain(host);
  if (sub && MEDIUM_RESERVED_SUBDOMAINS.has(sub)) return false;
  if (CHROME_SLUG.test(path)) return false;

  if (host === "medium.com") {
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    // /@author/story-slug-hash
    if (parts[0]!.startsWith("@")) {
      return parts.length >= 2 && !CHROME_SLUG.test(parts[1]!);
    }
    // /publication/story-slug — reject Medium-company pubs
    if (MEDIUM_RESERVED_PUBLICATIONS.has(parts[0]!.toLowerCase())) return false;
    return true;
  }

  // author.medium.com/story-slug
  if (sub) {
    const slug = path.split("/").filter(Boolean)[0] ?? "";
    if (!slug || CHROME_SLUG.test(slug)) return false;
    return true;
  }
  return false;
}

/** Profile / publication / author root — not an individual story. */
export function isWritingHubProfileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = pathRoot(u.pathname);
    if (host === "publish.obsidian.md") {
      return /^\/[^/]+$/i.test(path);
    }
    if (!isWritingPlatformHost(host) && host !== "linkedin.com") return false;

    if (host === "medium.com" || host.endsWith(".medium.com")) {
      if (host === "medium.com" && /^\/@[^/]+$/i.test(path)) return true;
      if (host.endsWith(".medium.com") && path === "/") {
        const sub = mediumSubdomain(host);
        return !!sub && !MEDIUM_RESERVED_SUBDOMAINS.has(sub);
      }
      return false;
    }
    if (host.endsWith(".substack.com") || host === "substack.com") {
      return path === "/" || /^\/(about|archive)$/i.test(path);
    }
    if (host === "dev.to") {
      return /^\/[^/]+$/i.test(path);
    }
    if (host === "hashnode.com") {
      return /^\/@[^/]+$/i.test(path);
    }
    if (host.endsWith(".hashnode.dev") || host === "hashnode.dev") {
      return path === "/";
    }
    if (host === "hackernoon.com") {
      return /^\/u\/[^/]+$/i.test(path) || /^\/@[^/]+$/i.test(path);
    }
    if (host === "zenn.dev") {
      return /^\/[^/]+$/i.test(path);
    }
    if (host === "qiita.com") {
      return /^\/[^/]+$/i.test(path);
    }
    if (host.endsWith(".ghost.io") || host.endsWith(".bearblog.dev")) {
      return path === "/";
    }
    if (host.endsWith(".blogspot.com") || host === "blogspot.com") {
      return path === "/";
    }
    if (host.endsWith(".wordpress.com")) {
      const wpSub = host.slice(0, -".wordpress.com".length);
      if (!wpSub || WORDPRESS_RESERVED_SUBDOMAINS.has(wpSub)) return false;
      // Author blog root only — /research|/publications stubs are not hubs.
      return path === "/";
    }
    if (host === "write.as" || host.endsWith(".writeas.com")) {
      return /^\/[^/]+$/i.test(path) || path === "/";
    }
    if (host === "mirror.xyz") {
      return /^\/[^/]+$/i.test(path);
    }
    if (host.endsWith(".beehiiv.com")) {
      return path === "/" || /^\/archive$/i.test(path);
    }
    if (host === "micro.blog" || host.endsWith(".micro.blog")) {
      return path === "/" || /^\/[^/]+$/i.test(path);
    }
    if (host.endsWith(".notion.site")) {
      return path === "/" || /^\/[^/]+$/i.test(path);
    }
    if (host.endsWith(".github.io")) {
      return path === "/" || /^\/[^/]+$/i.test(path);
    }
    if (host === "tumblr.com" || host.endsWith(".tumblr.com")) {
      return path === "/";
    }
    if (host === "teletype.in") {
      return /^\/@[^/]+$/i.test(path);
    }
    if (host === "habr.com") {
      return /^\/(?:ru|en)\/users\/[^/]+\/?$/i.test(path + "/");
    }
    return false;
  } catch {
    return false;
  }
}

/** Individual post/story on a writing platform. */
export function isWritingPlatformArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.toLowerCase();

    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      return /\/pulse\//i.test(path) || /\/posts\//i.test(path);
    }

    if (!isWritingPlatformHost(host)) return false;
    if (isWritingHubProfileUrl(url)) return false;
    if (path === "/" || path === "") return false;
    if (/\.(svg|png|jpg|gif|css|js|woff2?)$/i.test(path)) return false;
    if (PLATFORM_CHROME_PATH.test(path)) return false;
    if (/\/feed(\/|$)/i.test(path) || /\/rss(\/|$)/i.test(path)) return false;
    if (CHROME_SLUG.test(path)) return false;

    if (host === "medium.com" || host.endsWith(".medium.com")) {
      return isMediumStoryUrl(host, path);
    }

    if (host === "zenn.dev" && !/^\/[^/]+\/(?:articles|books)\//i.test(path)) {
      return false;
    }
    if (host === "qiita.com" && !/^\/[^/]+\/items\//i.test(path)) {
      return false;
    }
    if (host === "hackernoon.com" && /^\/u\//i.test(path)) return false;

    // WordPress.com: only dated posts count as articles (not /research stubs
    // or platform marketing pages).
    if (host.endsWith(".wordpress.com") || host === "wordpress.com") {
      return /^\/\d{4}\/\d{2}\/\d{2}\//.test(path);
    }

    return true;
  } catch {
    return false;
  }
}

export function extractWritingHubProfiles(
  html: string,
  baseUrl: string
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const c = canonicalizeUrl(m[1], baseUrl);
    if (!c || seen.has(c)) continue;
    if (!isWritingHubProfileUrl(c)) continue;
    try {
      const hubHost = hostnameOf(c);
      const baseHost = hostnameOf(baseUrl);
      if (hubHost && baseHost && hubHost === baseHost) continue;
    } catch {
      // continue
    }
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function extractWritingPlatformArticleLinks(
  html: string,
  baseUrl: string
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const c = canonicalizeUrl(m[1], baseUrl);
    if (!c || seen.has(c)) continue;
    if (!isWritingPlatformArticleUrl(c)) continue;
    try {
      const articleHost = hostnameOf(c);
      const baseHost = hostnameOf(baseUrl);
      if (articleHost && baseHost && articleHost === baseHost) continue;
    } catch {
      // continue
    }
    seen.add(c);
    out.push(c);
  }
  return out;
}

/**
 * Best-effort RSS/Atom endpoints for known writing hubs.
 */
export function feedUrlsForWritingHub(hubUrl: string): string[] {
  try {
    const u = new URL(hubUrl);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "") || "";

    if (host.endsWith(".medium.com") && host !== "medium.com") {
      const sub = mediumSubdomain(host);
      if (!sub || MEDIUM_RESERVED_SUBDOMAINS.has(sub)) return [];
      return [`https://${host}/feed`];
    }
    if (host === "medium.com") {
      const m = path.match(/^\/(@[^/]+)/i);
      if (m) return [`https://medium.com/feed/${m[1]}`];
    }
    if (host.endsWith(".substack.com")) {
      return [`https://${host}/feed`];
    }
    if (host === "dev.to") {
      const m = path.match(/^\/([^/]+)$/);
      if (m) return [`https://dev.to/feed/${m[1]}`];
    }
    if (host.endsWith(".hashnode.dev")) {
      return [`https://${host}/rss.xml`];
    }
    if (host === "hashnode.com") {
      const m = path.match(/^\/@([^/]+)/i);
      if (m) return [`https://${m[1]}.hashnode.dev/rss.xml`];
    }
    if (host.endsWith(".ghost.io") || host.endsWith(".bearblog.dev")) {
      return [`https://${host}/rss/`, `https://${host}/feed/`];
    }
    if (host.endsWith(".blogspot.com")) {
      return [`https://${host}/feeds/posts/default?alt=rss`];
    }
    if (host.endsWith(".wordpress.com")) {
      return [`https://${host}/feed/`];
    }
    if (host === "zenn.dev") {
      const m = path.match(/^\/([^/]+)$/);
      if (m) return [`https://zenn.dev/${m[1]}/feed`];
    }
    if (host === "qiita.com") {
      const m = path.match(/^\/([^/]+)$/);
      if (m) return [`https://qiita.com/${m[1]}/feed`];
    }
    if (host.endsWith(".beehiiv.com")) {
      return [`https://${host}/feed`];
    }
    if (host === "hackernoon.com") {
      const m = path.match(/^\/(?:u\/|@)([^/]+)/i);
      if (m) return [`https://hackernoon.com/feed/${m[1]}`];
    }
    if (host.endsWith(".github.io")) {
      return [
        `https://${host}/feed.xml`,
        `https://${host}/atom.xml`,
        `https://${host}/rss.xml`,
        path && path !== "/" ? `https://${host}${path}/feed.xml` : "",
      ].filter(Boolean);
    }
    if (host === "write.as" || host.endsWith(".writeas.com")) {
      const m = path.match(/^\/([^/]+)$/);
      if (m) return [`https://write.as/${m[1]}/feed/`];
      if (host.endsWith(".writeas.com")) return [`https://${host}/feed/`];
    }
  } catch {
    return [];
  }
  return [];
}

/** First writing-hub profile or story URL in a list (LinkedIn Contact / Featured). */
export function firstWritingSurfaceUrl(
  urls: Array<string | null | undefined>
): string | null {
  for (const raw of urls) {
    if (!raw?.trim()) continue;
    const u = canonicalizeUrl(raw);
    if (!u) continue;
    if (isWritingHubProfileUrl(u) || isWritingPlatformArticleUrl(u)) return u;
  }
  return null;
}

/** True if URL may join the writing corpus for this personal-site crawl. */
export function isAllowedWritingUrl(
  url: string,
  personalSiteUrl: string
): boolean {
  try {
    const personalHost = hostnameOf(personalSiteUrl);
    const host = hostnameOf(url);
    if (!host || !personalHost) return false;
    if (
      host === personalHost ||
      host.endsWith(`.${personalHost}`) ||
      personalHost.endsWith(`.${host}`)
    ) {
      return true;
    }
    if (isWritingPlatformArticleUrl(url) || isWritingHubProfileUrl(url)) {
      return true;
    }
    return isWritingPlatformHost(host);
  } catch {
    return false;
  }
}
