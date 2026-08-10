import fs from "fs";
import type { OlympiadProfile } from "../types.js";

const OLY_SOURCES = new Set(["IMO", "IOI", "IPHO", "ICHO", "ISEF"]);
const OLY_SCORE: Record<string, number> = {
  IMO: 3,
  IOI: 3,
  IPHO: 2,
  ICHO: 1,
  ISEF: 2,
};
const MEDAL_SCORE: Record<string, number> = { gold: 3, silver: 2, bronze: 1 };

const HIGH_SIGNAL = new Set([
  "usa", "united states", "united states of america", "china",
  "people's republic of china", "chn", "india", "singapore", "south korea",
  "korea", "romania", "russia", "vietnam", "canada", "uk", "united kingdom",
  "germany",
]);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseMedal(award: string, rank: string): { label: string; score: number } {
  const text = `${award} ${rank}`.toLowerCase();
  for (const [medal, score] of Object.entries(MEDAL_SCORE)) {
    if (text.includes(medal)) return { label: medal, score };
  }
  if (text.includes("first award")) return { label: "gold", score: 3 };
  if (text.includes("second award")) return { label: "silver", score: 2 };
  if (text.includes("third award")) return { label: "bronze", score: 1 };
  return { label: "unknown", score: 0 };
}

function parseAge(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n < 30 ? n : null;
}

function ageScore(age: number | null): number {
  if (age === null) return 0;
  if (age === 16 || age === 17) return 2;
  if (age === 18 || age === 19) return 1;
  return 0;
}

function countryBonus(country: string): number {
  const c = country.toLowerCase().trim();
  for (const k of HIGH_SIGNAL) {
    if (c.includes(k)) return 0;
  }
  return 0;
}

export function loadOlympiadCsv(csvPath: string): Map<string, OlympiadProfile> {
  const text = fs.readFileSync(csvPath, "utf-8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (const [h, j] of Object.entries(idx)) {
      row[h] = cols[j] ?? "";
    }
    rows.push(row);
  }

  const byName = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const source = (row.source ?? "").toUpperCase();
    const year = parseInt(row.competition_year ?? "0", 10);
    const name = (row.name ?? "").trim();
    if (!name || !OLY_SOURCES.has(source) || year < 2020) continue;
    const key = normName(name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(row);
  }

  const profiles = new Map<string, OlympiadProfile>();
  for (const [key, personRows] of byName) {
    let olympiadPts = 0;
    let medalPts = 0;
    let recencyPts = 0;
    let agePts = 0;
    const years = new Set<number>();
    const sources = new Set<string>();
    const prizes: string[] = [];
    const countries = new Set<string>();
    const schools = new Set<string>();

    for (const row of personRows) {
      const source = row.source.toUpperCase();
      const year = parseInt(row.competition_year, 10);
      const medal = parseMedal(row.award ?? "", row.rank ?? "");
      years.add(year);
      sources.add(source);
      prizes.push(`${source} ${year} ${medal.label}`);
      if (row.country) countries.add(row.country.trim());
      const school = (row.school ?? "").trim();
      if (school) schools.add(school);

      olympiadPts = Math.max(olympiadPts, OLY_SCORE[source] ?? 0);
      medalPts = Math.max(medalPts, medal.score);
      recencyPts = Math.max(recencyPts, year - 2020);
      agePts = Math.max(agePts, ageScore(parseAge(row.age ?? "")));
      countryBonus(row.country ?? "");
    }

    const repeatBonus = 3 * (personRows.length - 1);
    profiles.set(key, {
      name: personRows[0].name.trim(),
      years: [...years].sort((a, b) => b - a),
      sources: [...sources].sort(),
      prizes,
      countries: [...countries],
      schools: [...schools],
      olympiadScore: olympiadPts + repeatBonus * 0.1,
      medalScore: medalPts,
      recencyScore: recencyPts,
      ageScore: agePts,
    });
  }

  return profiles;
}

export function lookupOlympiad(
  index: Map<string, OlympiadProfile>,
  name: string
): OlympiadProfile | undefined {
  return index.get(normName(name));
}
