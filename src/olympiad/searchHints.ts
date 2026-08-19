import type { OlympiadProfile } from "../types.js";

const SOURCE_PRIORITY = ["IOI", "IMO", "IPHO", "ICHO", "ISEF"];

/** Short keywords for LinkedIn people search (name + hints + country). */
export function olympiadSearchHints(olympiad?: OlympiadProfile): string[] {
  if (!olympiad) return [];

  const hints: string[] = [];

  for (const source of SOURCE_PRIORITY) {
    if (olympiad.sources.includes(source)) {
      hints.push(source);
      break;
    }
  }

  const primarySource = hints[0]?.toUpperCase();
  // ISEF/EUCYS place awards rarely appear on LinkedIn; medal terms hurt recall.
  if (primarySource === "ISEF") {
    return hints;
  }

  const bestMedal = olympiad.prizes
    .map((p) => {
      const m = p.match(/\b(gold|silver|bronze)\b/i);
      return m ? m[1].toLowerCase() : null;
    })
    .find(Boolean);

  if (bestMedal && bestMedal !== "bronze") {
    hints.push(bestMedal);
  }

  return hints.slice(0, 2);
}

/** Drop trailing ", CA" / ", FL" state initials — they hurt LinkedIn people search. */
export function normalizeSchoolForSearch(school: string): string {
  return school
    .trim()
    .replace(/,\s*[A-Za-z]{2}\s*$/u, "")
    .trim();
}

/** Prefer a secondary-school-looking entry when multiple schools exist. */
export function olympiadHighSchool(
  olympiad?: OlympiadProfile
): string | undefined {
  const schools = olympiad?.schools?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (!schools.length) return undefined;
  const secondary = schools.find((s) =>
    /high school|preparatory|prep school|secondary|academy/i.test(s)
  );
  const picked = secondary ?? schools[0];
  const cleaned = normalizeSchoolForSearch(picked);
  return cleaned || undefined;
}

/** University-looking entry that is not the high school, when present. */
export function olympiadCollege(
  olympiad?: OlympiadProfile
): string | undefined {
  const schools = olympiad?.schools?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (!schools.length) return undefined;
  const hs = olympiadHighSchool(olympiad);
  const uni = schools.find(
    (s) =>
      s !== hs &&
      /university|college|institute of technology|polytechnic/i.test(s)
  );
  const picked = uni;
  if (!picked) return undefined;
  const cleaned = normalizeSchoolForSearch(picked);
  return cleaned || undefined;
}
