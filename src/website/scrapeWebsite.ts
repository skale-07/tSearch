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
    if (host === "github.com" || host.endsWith(".github.io")) return "github";
    if (host === "substack.com" || host.endsWith(".substack.com")) {
      return "substack";
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
      const url = normalizeUrl(raw, finalUrl);
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

    const github = firstOf("github", social);
    const profile: WebsiteProfile = {
      url: finalUrl,
      scraped_at: new Date().toISOString(),
      github_url: github?.includes("github.com/")
        ? github.replace(/\/$/, "")
        : github,
      substack_url: firstOf("substack", social),
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

export function applyWebsiteToLinkedInUrls(
  githubUrl: string | null,
  substackUrl: string | null,
  twitterUrl: string | null,
  website: WebsiteProfile | null
): {
  github_url: string | null;
  substack_url: string | null;
  twitter_url: string | null;
} {
  return {
    github_url: githubUrl ?? website?.github_url ?? null,
    substack_url: substackUrl ?? website?.substack_url ?? null,
    twitter_url: twitterUrl ?? website?.twitter_url ?? null,
  };
}
