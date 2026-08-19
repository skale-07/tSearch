import { githubUsernameFromUrl } from "../linkedin/linkedinExtract.js";
import { readCache, writeCache } from "../storage/jsonStore.js";
import type { WebsiteProfile } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEBSITE_CACHE_TTL_MS = Number(
  process.env.WEBSITE_CACHE_TTL_MS ?? 7 * DAY_MS
);
const FETCH_TIMEOUT_MS = Number(process.env.WEBSITE_FETCH_TIMEOUT_MS ?? 12000);

type SocialKind =
  | "github"
  | "substack"
  | "medium"
  | "twitter"
  | "email"
  | "linkedin"
  | "instagram"
  | "youtube"
  | "other";

function normalizeUrl(raw: string, baseUrl: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("javascript:")) {
    return null;
  }
  if (trimmed.toLowerCase().startsWith("mailto:")) {
    const email = trimmed.slice("mailto:".length).split("?")[0].trim();
    return email ? `mailto:${email}` : null;
  }
  try {
    const u = new URL(trimmed, baseUrl);
    if (!/^https?:$/i.test(u.protocol)) return null;
    u.hash = "";
    return u.toString().replace(/\/$/, "") || u.toString();
  } catch {
    return null;
  }
}

function classifyLink(url: string): SocialKind {
  if (url.startsWith("mailto:")) return "email";
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    // Profile identity only — *.github.io is a Pages site, not a login.
    if (host === "github.com" && githubUsernameFromUrl(url)) return "github";
    if (host === "substack.com" || host.endsWith(".substack.com")) {
      return "substack";
    }
    if (host === "medium.com" || host.endsWith(".medium.com")) {
      return "medium";
    }
    if (host === "twitter.com" || host === "x.com") return "twitter";
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      return "linkedin";
    }
    if (host === "instagram.com") return "instagram";
    if (
      host === "youtube.com" ||
      host === "youtu.be" ||
      host.endsWith(".youtube.com")
    ) {
      return "youtube";
    }
  } catch {
    return "other";
  }
  return "other";
}

function extractHrefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    out.push(m[1]);
  }
  for (const m of html.matchAll(
    /\b(?:src|content)\s*=\s*["'](mailto:[^"']+|https?:\/\/[^"']+)["']/gi
  )) {
    out.push(m[1]);
  }
  // Bare emails in text / mailto-less pages.
  for (const m of html.matchAll(
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
  )) {
    out.push(`mailto:${m[0]}`);
  }
  return out;
}

/** Strip API tokens from scraped URLs so they never land in profiles/git. */
function scrubSecretsInUrl(url: string): string {
  return url.replace(
    /([?&](?:amp;)?access_token=)[^&"'\s]+/gi,
    "$1REDACTED"
  );
}

function firstOf(kind: SocialKind, links: { kind: SocialKind; url: string }[]) {
  return links.find((l) => l.kind === kind)?.url ?? null;
}

function emailFromMailto(url: string | null): string | null {
  if (!url?.startsWith("mailto:")) return null;
  return url.slice("mailto:".length);
}

export async function scrapeWebsite(
  websiteUrl: string
): Promise<WebsiteProfile | null> {
  const cached = readCache<WebsiteProfile>(
    "website-profile",
    websiteUrl,
    WEBSITE_CACHE_TTL_MS
  );
  if (cached?.data) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(websiteUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; tSearch/2.0; +https://localhost)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      console.log(`  [website] ${websiteUrl} → HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();
    const finalUrl = res.url || websiteUrl;
    const classified: { kind: SocialKind; url: string }[] = [];
    const seen = new Set<string>();

    for (const raw of extractHrefs(html)) {
      const normalized = normalizeUrl(raw, finalUrl);
      if (!normalized) continue;
      const url = scrubSecretsInUrl(normalized);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      classified.push({ kind: classifyLink(url), url });
    }

    const social = classified.filter((l) => l.kind !== "other");
    const other = classified
      .filter((l) => l.kind === "other")
      .map((l) => l.url)
      .filter((u) => {
        try {
          const host = new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
          const siteHost = new URL(finalUrl).hostname
            .replace(/^www\./i, "")
            .toLowerCase();
          return host !== siteHost;
        } catch {
          return false;
        }
      })
      .slice(0, 20);

    const githubRaw = firstOf("github", social);
    const githubLogin = githubUsernameFromUrl(githubRaw);
    const profile: WebsiteProfile = {
      url: finalUrl,
      scraped_at: new Date().toISOString(),
      github_url: githubLogin ? `https://github.com/${githubLogin}` : null,
      substack_url: firstOf("substack", social),
      medium_url: firstOf("medium", social),
      twitter_url: firstOf("twitter", social),
      linkedin_url: firstOf("linkedin", social),
      email: emailFromMailto(firstOf("email", social)),
      instagram_url: firstOf("instagram", social),
      youtube_url: firstOf("youtube", social),
      other_links: other,
      all_links: [...new Set(classified.map((l) => l.url))].slice(0, 40),
    };

    writeCache("website-profile", websiteUrl, profile);
    return profile;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [website] ${websiteUrl} failed: ${msg}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Personal website (discovered via LinkedIn Contact info) is source of truth
 * for identity links. Any field present on the site overrides LinkedIn.
 * LinkedIn contact/featured values only fill gaps the site didn't provide.
 */
export function applyWebsiteToLinkedInUrls(
  githubUrl: string | null,
  substackUrl: string | null,
  twitterUrl: string | null,
  website: WebsiteProfile | null
): {
  github_url: string | null;
  substack_url: string | null;
  twitter_url: string | null;
  overrides: string[];
} {
  const overrides: string[] = [];
  const pick = (
    field: string,
    fromSite: string | null | undefined,
    fromLinkedIn: string | null
  ): string | null => {
    if (fromSite) {
      if (
        fromLinkedIn &&
        fromSite.replace(/\/$/, "").toLowerCase() !==
          fromLinkedIn.replace(/\/$/, "").toLowerCase()
      ) {
        overrides.push(`${field}:${fromLinkedIn}→${fromSite}`);
      }
      return fromSite;
    }
    return fromLinkedIn;
  };

  return {
    github_url: pick(
      "github",
      githubUsernameFromUrl(website?.github_url ?? null)
        ? website?.github_url ?? null
        : null,
      githubUsernameFromUrl(githubUrl) ? githubUrl : null
    ),
    substack_url: pick("substack", website?.substack_url, substackUrl),
    twitter_url: pick("twitter", website?.twitter_url, twitterUrl),
    overrides,
  };
}
