import { readCache, writeCache } from "../storage/jsonStore.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = Number(process.env.WEBSITE_PEOPLE_CACHE_TTL_MS ?? 7 * DAY_MS);
const FETCH_TIMEOUT_MS = Number(process.env.WEBSITE_FETCH_TIMEOUT_MS ?? 12000);

export interface WebsiteHtml {
  html: string;
  finalUrl: string;
}

/**
 * Cached HTML for people extraction. Separate from website-profile so a
 * social-link scrape does not stand in for a team-page parse.
 */
export async function fetchWebsiteHtml(
  websiteUrl: string
): Promise<WebsiteHtml | null> {
  const cached = readCache<WebsiteHtml>("website-people", websiteUrl, TTL_MS);
  if (cached?.data?.html) return cached.data;

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
      console.log(`[website-people] ${websiteUrl} → HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    const data: WebsiteHtml = { html, finalUrl: res.url || websiteUrl };
    writeCache("website-people", websiteUrl, data);
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[website-people] ${websiteUrl} failed: ${msg}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
