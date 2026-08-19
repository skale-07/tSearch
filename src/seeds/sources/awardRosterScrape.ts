import {
  AWARD_SCRAPE_CACHE_TTL_MS,
  AWARD_SCRAPE_DELAY_MS,
} from "../../config.js";
import { readCache, writeCache } from "../../storage/jsonStore.js";
import {
  writeAwardRosterRows,
  type RosterPerson,
} from "./rosterSource.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_YEARS = 6;
const UA = "Mozilla/5.0 (compatible; tSearch/2.0; +https://localhost)";

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI",
  "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN",
  "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH",
  "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT",
  "WA", "WI", "WV", "WY",
]);

const NOT_A_NAME = /^(scholarship|fellows?|recipients?|honorable|mentions?|eligibility|application|ceremony|categories|recognition|more about|current|past|class of|\d{4})/i;

export interface AwardScrapeJob {
  award_id: string;
  year: number;
  url?: string;
  count: number;
  error?: string;
}

export interface AwardScrapeReport {
  jobs: AwardScrapeJob[];
  names_written: number;
}

type FetchHtml = (url: string) => Promise<string | null>;

interface AwardScraper {
  award_id: string;
  minExpected: number;
  urlsForYear: (year: number) => string[];
  parse: (html: string) => RosterPerson[];
}

const SCRAPERS: AwardScraper[] = [
  {
    award_id: "davidson_fellows",
    minExpected: 5,
    urlsForYear: (year) => [
      `https://www.davidsongifted.org/gifted-programs/fellows-scholarship/fellows/current-and-past-fellows/${year}-fellows/`,
    ],
    parse: parseDavidsonFellowsHtml,
  },
  {
    award_id: "regeneron_sts",
    minExpected: 40,
    urlsForYear: (year) => [
      `https://www.societyforscience.org/regeneron-sts/${year}-scholars/`,
    ],
    parse: parseRegeneronStsHtml,
  },
  {
    award_id: "coca_cola_scholars",
    minExpected: 40,
    urlsForYear: (year) => [
      `https://www.coca-colascholarsfoundation.org/${year}-coke-scholars/`,
      `https://www.coca-colascholarsfoundation.org/blog/our-${year}-coke-scholars/`,
      `https://www.coca-colascholarsfoundation.org/about/${year}-scholar-bios/`,
    ],
    parse: parseCocaColaScholarsHtml,
  },
];

export function listScrapableAwardIds(): string[] {
  return SCRAPERS.map((s) => s.award_id);
}

export function yearsInRange(yearFrom: number, yearTo: number): number[] {
  const lo = Math.min(yearFrom, yearTo);
  const hi = Math.max(yearFrom, yearTo);
  const years: number[] = [];
  for (let y = lo; y <= hi; y++) years.push(y);
  if (years.length > MAX_YEARS) {
    throw new Error(`Year range too wide — cap is ${MAX_YEARS} years per scrape.`);
  }
  return years;
}

export function parseDavidsonFellowsHtml(html: string): RosterPerson[] {
  const cut = html.split(/Honorable Mentions/i)[0] ?? html;
  const out: RosterPerson[] = [];
  const chunks = cut.split(/<h3\b[^>]*>/i).slice(1);
  for (const chunk of chunks) {
    const close = chunk.search(/<\/h3>/i);
    const rawName = close >= 0 ? chunk.slice(0, close) : chunk;
    const after = close >= 0 ? chunk.slice(close) : "";
    const loc = stripTags(after).slice(0, 120);
    for (const name of splitTeam(stripTags(rawName))) {
      if (!looksLikePersonName(name)) continue;
      out.push({ name, country: countryFromLocation(loc) });
    }
  }
  return dedupePeople(out);
}

export function parseRegeneronStsHtml(html: string): RosterPerson[] {
  const out: RosterPerson[] = [];
  const fromStrong =
    /<strong>([\s\S]*?)<\/strong>\s*,\s*Age:\s*(\d{1,2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = fromStrong.exec(html))) {
    const name = stripTags(m[1] ?? "");
    const age = Number(m[2]);
    if (!looksLikePersonName(name) || age < 14 || age > 22) continue;
    const rest = html.slice(m.index + m[0].length, m.index + m[0].length + 200);
    out.push({
      name,
      age_at_award: age,
      country: countryFromStsTail(stripTags(rest)),
    });
  }
  if (out.length) return dedupePeople(out);

  const re =
    /^([A-Z][\p{L}'’.\-]+(?:\s+[A-Z][\p{L}'’.\-]+){1,4})\s*,\s*Age:\s*(\d{1,2})\b/u;
  for (const line of html.split(/\r?\n/)) {
    const text = stripTags(line);
    const hit = text.match(re);
    if (!hit) continue;
    const name = hit[1]!.trim();
    const age = Number(hit[2]);
    if (!looksLikePersonName(name) || age < 14 || age > 22) continue;
    out.push({
      name,
      age_at_award: age,
      country: countryFromStsTail(text.slice(hit[0].length)),
    });
  }
  return dedupePeople(out);
}

export function parseCocaColaScholarsHtml(html: string): RosterPerson[] {
  const fromTable = dedupePeople(parseFirstLastTable(html));
  if (fromTable.length >= 40) return fromTable;
  const fromH4: RosterPerson[] = [];
  for (const m of html.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi)) {
    const name = stripTags(m[1] ?? "");
    if (!looksLikePersonName(name)) continue;
    fromH4.push({ name, country: "United States" });
  }
  const merged = fromTable.length >= fromH4.length ? fromTable : fromH4;
  return dedupePeople(merged);
}

export async function scrapeAwardRosters(opts: {
  award_ids?: string[];
  yearFrom: number;
  yearTo: number;
  dir?: string;
  delayMs?: number;
  fetchHtml?: FetchHtml;
}): Promise<AwardScrapeReport> {
  const years = yearsInRange(opts.yearFrom, opts.yearTo);
  const wanted = new Set(
    (opts.award_ids?.length ? opts.award_ids : listScrapableAwardIds()).map(
      (id) => id.trim()
    )
  );
  const scrapers = SCRAPERS.filter((s) => wanted.has(s.award_id));
  if (!scrapers.length) {
    throw new Error(
      "No scraper for that award. Davidson Fellows, Regeneron STS, and Coca-Cola Scholars have live scrapers; others still need a pasted roster."
    );
  }

  const fetchHtml = opts.fetchHtml ?? fetchHtmlCached;
  const delayMs = opts.delayMs ?? AWARD_SCRAPE_DELAY_MS;
  const jobs: AwardScrapeJob[] = [];
  let names_written = 0;
  let fetches = 0;

  for (const scraper of scrapers) {
    for (const year of years) {
      let lastError = "no names parsed";
      let saved: AwardScrapeJob | null = null;
      for (const url of scraper.urlsForYear(year)) {
        if (fetches > 0 && delayMs > 0) await sleep(delayMs);
        fetches++;
        let html: string | null;
        try {
          html = await fetchHtml(url);
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          continue;
        }
        if (!html) {
          lastError = `empty response from ${url}`;
          continue;
        }
        const rows = scraper.parse(html);
        if (rows.length < scraper.minExpected) {
          lastError = `${url} parsed ${rows.length} names (need ≥${scraper.minExpected})`;
          continue;
        }
        const written = writeAwardRosterRows({
          award_id: scraper.award_id,
          year,
          rows,
          dir: opts.dir,
        });
        names_written += written.count;
        saved = { award_id: scraper.award_id, year, url, count: written.count };
        break;
      }
      jobs.push(
        saved ?? {
          award_id: scraper.award_id,
          year,
          count: 0,
          error: lastError,
        }
      );
    }
  }

  console.log(
    `[seeds] scraped ${names_written} names across ${jobs.length} award-year jobs`
  );
  return { jobs, names_written };
}

async function fetchHtmlCached(url: string): Promise<string | null> {
  const cached = readCache<string | null>(
    "award-rosters",
    url,
    AWARD_SCRAPE_CACHE_TTL_MS
  );
  if (cached) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) {
      writeCache("award-rosters", url, null);
      console.log(`[seeds] ${url} → HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    writeCache("award-rosters", url, html);
    return html;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[seeds] ${url} failed: ${msg}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseFirstLastTable(html: string): RosterPerson[] {
  const rows: string[][] = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (c) => stripTags(c[1] ?? "")
    );
    if (cells.length >= 2) rows.push(cells);
  }
  if (!rows.length) return [];
  const header = rows[0]!.map((c) => c.toLowerCase());
  const firstIdx = header.findIndex((c) => c === "first" || c === "first name");
  const lastIdx = header.findIndex((c) => c === "last" || c === "last name");
  const stateIdx = header.findIndex((c) => c === "state");
  if (firstIdx < 0 || lastIdx < 0) return [];
  const out: RosterPerson[] = [];
  for (const cells of rows.slice(1)) {
    const first = cells[firstIdx] ?? "";
    const last = cells[lastIdx] ?? "";
    if (/^first$/i.test(first) || /^last$/i.test(last)) continue;
    const name = `${first} ${last}`.replace(/\s+/g, " ").trim();
    if (!looksLikePersonName(name)) continue;
    const state = (cells[stateIdx] ?? "").toUpperCase();
    out.push({
      name,
      country: US_STATES.has(state) ? "United States" : undefined,
    });
  }
  return out;
}

function splitTeam(name: string): string[] {
  if (!name.includes("&") && !/\band\b/i.test(name)) return [name];
  return name
    .split(/\s*(?:&|\band\b)\s*/i)
    .map((n) => n.replace(/\s*Team Project.*$/i, "").trim())
    .filter(Boolean);
}

function looksLikePersonName(name: string): boolean {
  if (!name || name.length > 70 || NOT_A_NAME.test(name)) return false;
  if (/https?:|@|\d{3,}/.test(name)) return false;
  const parts = name.split(/\s+/);
  if (parts.length < 2 || parts.length > 5) return false;
  return parts.every((p) => /^[\p{L}][\p{L}'’.\-]*$/u.test(p));
}

function countryFromLocation(loc: string): string | undefined {
  const m = loc.match(/\b([A-Z]{2})\b/);
  if (m && US_STATES.has(m[1]!)) return "United States";
  return undefined;
}

function countryFromStsTail(rest: string): string | undefined {
  const beforeTitle = rest.split(/Project Title/i)[0] ?? rest;
  const state = beforeTitle.match(/,\s*([A-Z]{2})\s*$/);
  if (state && US_STATES.has(state[1]!)) return "United States";
  return undefined;
}

function stripTags(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupePeople(rows: RosterPerson[]): RosterPerson[] {
  const seen = new Set<string>();
  const out: RosterPerson[] = [];
  for (const row of rows) {
    const key = row.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
