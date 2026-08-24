import { readCache, writeCache } from "../storage/jsonStore.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = Number(process.env.WEBSITE_PEOPLE_CACHE_TTL_MS ?? 7 * DAY_MS);
const FETCH_TIMEOUT_MS = Number(process.env.WEBSITE_FETCH_TIMEOUT_MS ?? 12000);

export interface WebsiteHtml {
  html: string;
  finalUrl: string;
}

export type WebsiteHtmlFetch =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; httpStatus?: number; finalUrl: string };

/** Operator-facing copy when a team page cannot be loaded. */
export function websiteFetchFailureMessage(
  requestedUrl: string,
  fail: Extract<WebsiteHtmlFetch, { ok: false }>
): string {
  const shown = fail.finalUrl || requestedUrl;
  if (fail.httpStatus === 404 || fail.httpStatus === 410) {
    return `That page is gone (HTTP ${fail.httpStatus}): ${shown}. Paste another URL.`;
  }
  if (fail.httpStatus) {
    return `Could not load that page (HTTP ${fail.httpStatus}): ${shown}`;
  }
  return `Could not fetch ${requestedUrl}`;
}

/**
 * Cached HTML for people extraction. Separate from website-profile so a
 * social-link scrape does not stand in for a team-page parse.
 */
export async function fetchWebsiteHtml(
  websiteUrl: string
): Promise<WebsiteHtmlFetch> {
  const cached = readCache<WebsiteHtml>("website-people", websiteUrl, TTL_MS);
  if (cached?.data?.html) {
    return {
      ok: true,
      html: cached.data.html,
      finalUrl: cached.data.finalUrl || websiteUrl,
    };
  }

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
      return {
        ok: false,
        httpStatus: res.status,
        finalUrl: res.url || websiteUrl,
      };
    }
    const html = await res.text();
    const data: WebsiteHtml = { html, finalUrl: res.url || websiteUrl };
    writeCache("website-people", websiteUrl, data);
    return { ok: true, ...data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[website-people] ${websiteUrl} failed: ${msg}`);
    return { ok: false, finalUrl: websiteUrl };
  } finally {
    clearTimeout(timer);
  }
}
