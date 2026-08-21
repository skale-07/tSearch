import { parseStatedAge } from "../../linkedin/linkedinAge.js";
import type {
  GitHubProfile,
  LinkedInProfile,
  WebsiteProfile,
} from "../../types.js";

/** Typical age at bachelor's graduation. Class-of years are read against this. */
export const TYPICAL_BACHELORS_AGE = 22;

export type PublicTextAgeBasis =
  | "text_stated_age"
  | "text_class_year"
  | "text_standing"
  | "text_age_floor";

export interface PublicTextAgeHint {
  age: number;
  /** True when the figure is a lower bound (alumni, PhD, years of experience). */
  floor: boolean;
  confidence: number;
  basis: PublicTextAgeBasis;
  explanation: string;
}

const ACADEMIC =
  /\b(?:college|university|undergrad(?:uate)?|student|studying|majoring|campus|bachelor|b\.?\s*s\.?|b\.?\s*a\.?)\b/i;
const HIGH_SCHOOL = /\bhigh[\s-]?school\b|\bsecondary school\b/i;
const JOB_JUNIOR =
  /\bjunior\s+(?:software|swe|engineer|developer|dev|intern|analyst|associate|designer|pm)\b/i;

const STANDING_WORD =
  /\b(freshman|frosh|sophomore|junior|senior|first[\s-]?year|1st[\s-]?year|second[\s-]?year|2nd[\s-]?year|third[\s-]?year|3rd[\s-]?year|fourth[\s-]?year|4th[\s-]?year|final[\s-]?year)\b/gi;

const COLLEGE_AGE: Record<string, number> = {
  freshman: 18,
  frosh: 18,
  "first-year": 18,
  "first year": 18,
  "1st-year": 18,
  "1st year": 18,
  sophomore: 19,
  "second-year": 19,
  "second year": 19,
  "2nd-year": 19,
  "2nd year": 19,
  junior: 20,
  "third-year": 20,
  "third year": 20,
  "3rd-year": 20,
  "3rd year": 20,
  senior: 21,
  "fourth-year": 21,
  "fourth year": 21,
  "4th-year": 21,
  "4th year": 21,
  "final-year": 21,
  "final year": 21,
};

const HS_AGE: Record<string, number> = {
  freshman: 15,
  frosh: 15,
  "first-year": 15,
  "first year": 15,
  sophomore: 16,
  "second-year": 16,
  "second year": 16,
  junior: 17,
  "third-year": 17,
  "third year": 17,
  senior: 18,
  "fourth-year": 18,
  "fourth year": 18,
  "final-year": 18,
  "final year": 18,
};

function identityBlob(input: {
  linkedin?: LinkedInProfile;
  website?: WebsiteProfile;
  github?: Pick<GitHubProfile, "bio">;
  extraTexts?: string[];
}): string {
  const li = input.linkedin;
  const edu = (li?.education ?? [])
    .map((e) => [e.school, e.degree, e.field, e.years].filter(Boolean).join(" "))
    .join("\n");
  const extras = (input.extraTexts ?? [])
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .join("\n");
  return [
    li?.headline,
    li?.degree,
    li?.school,
    li?.college,
    edu,
    input.website?.text_excerpt,
    input.github?.bio,
    extras,
  ]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join("\n")
    .slice(0, 12_000);
}

function windowAt(text: string, index: number, radius = 56): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius));
}

function normalizeStanding(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

function standingAge(token: string, hs: boolean): number | null {
  const key = normalizeStanding(token);
  const table = hs ? HS_AGE : COLLEGE_AGE;
  return table[key] ?? null;
}

function yearsNearGraduation(text: string, currentYear: number): number[] {
  const years: number[] = [];
  for (const m of text.matchAll(/\bgraduated\b/gi)) {
    if (m.index == null) continue;
    const window = text.slice(Math.max(0, m.index - 48), m.index + 180);
    for (const y of window.matchAll(/\b((?:19|20)\d{2})\b/g)) {
      const n = Number(y[1]);
      if (n >= 1970 && n <= currentYear + 1) years.push(n);
    }
  }
  return years;
}

function parseClassYear(text: string, currentYear: number): PublicTextAgeHint | null {
  const cleaned = text.replace(/\b(?:19|20)\d{2}\s*[-–—]\s*present\b/gi, " ");
  const patterns = [
    /\bclass of ['’]?((?:19|20)\d{2})\b/gi,
    /\bgraduat(?:ing|ed|ion)\s+(?:in\s+)?['’]?((?:19|20)\d{2})\b/gi,
    /\bexpected(?:\s+to\s+graduate)?\s+(?:in\s+)?['’]?((?:19|20)\d{2})\b/gi,
  ];
  const years: number[] = [...yearsNearGraduation(cleaned, currentYear)];
  for (const re of patterns) {
    re.lastIndex = 0;
    for (const m of cleaned.matchAll(re)) {
      const y = Number(m[1]);
      if (y >= 1970 && y <= currentYear + 8) years.push(y);
    }
  }
  if (!years.length) return null;
  // Future class year is the tightest "still in school" read; a past year
  // is a graduation date. Prefer the future year if both appear.
  const future = years.filter((y) => y > currentYear);
  const year = future.length ? Math.min(...future) : Math.max(...years);
  const age =
    year >= currentYear
      ? TYPICAL_BACHELORS_AGE - (year - currentYear)
      : TYPICAL_BACHELORS_AGE + (currentYear - year);
  if (age < 14 || age > 55) return null;
  const floor = year < currentYear;
  return {
    age,
    floor,
    confidence: 0.7,
    basis: "text_class_year",
    explanation: floor
      ? `Public text names class/graduation year ${year}; typical bachelor's age ${TYPICAL_BACHELORS_AGE} then, aged forward. Could be older.`
      : `Public text names class of ${year}; typical age ${age} now if bachelor's lands at ${TYPICAL_BACHELORS_AGE}.`,
  };
}

function parseGraduateStanding(text: string): PublicTextAgeHint | null {
  if (
    /\bpost[\s-]?doc(?:toral)?\b|\bpostdoctoral\b/i.test(text)
  ) {
    return {
      age: 28,
      floor: true,
      confidence: 0.7,
      basis: "text_age_floor",
      explanation:
        "Public text describes a postdoc — age is at least ~28 and may be higher.",
    };
  }
  if (
    /\bph\.?d\.?\s+(?:student|candidate|applicant)\b|\bdoctoral\s+(?:student|candidate)\b|\bdoctorate\b/i.test(
      text
    )
  ) {
    return {
      age: 25,
      floor: true,
      confidence: 0.65,
      basis: "text_age_floor",
      explanation:
        "Public text describes a PhD/doctoral student — age is at least ~25 and may be higher.",
    };
  }
  if (
    /\bgrad(?:uate)?\s+student\b|\bgraduate\s+school\b|\bmaster['’]?s\s+student\b|\bm\.?s\.?\s+(?:student|candidate)\b|\bmba\s+student\b|\bpursuing\s+(?:a\s+)?(?:master|mba|m\.?s)/i.test(
      text
    )
  ) {
    return {
      age: 23,
      floor: true,
      confidence: 0.6,
      basis: "text_age_floor",
      explanation:
        "Public text describes a master's/graduate student — age is at least ~23 and may be higher.",
    };
  }
  return null;
}

function parseCollegeOrHsStanding(text: string): PublicTextAgeHint | null {
  if (JOB_JUNIOR.test(text)) {
    // Job titles still allow a later academic phrase; strip the title span.
    text = text.replace(JOB_JUNIOR, " ");
  }
  STANDING_WORD.lastIndex = 0;
  let best: PublicTextAgeHint | null = null;
  for (const m of text.matchAll(STANDING_WORD)) {
    const token = m[1];
    if (!token || m.index == null) continue;
    const ctx = windowAt(text, m.index);
    const hs = HIGH_SCHOOL.test(ctx);
    const academic = ACADEMIC.test(ctx);
    if (!hs && !academic) continue;
    const age = standingAge(token, hs);
    if (age == null) continue;
    const hint: PublicTextAgeHint = {
      age,
      floor: false,
      confidence: hs ? 0.7 : 0.72,
      basis: "text_standing",
      explanation: hs
        ? `Public text names a high-school ${normalizeStanding(token)} — typical age ~${age}.`
        : `Public text names a college ${normalizeStanding(token)} — typical age ~${age}.`,
    };
    // Conservative: if both HS and college fire, keep the older read.
    if (!best || hint.age > best.age) best = hint;
  }
  return best;
}

function parseAlumniFloor(text: string): PublicTextAgeHint | null {
  if (/\bgrad(?:uate)?\s+student\b|\bgraduate\s+school\b/i.test(text)) {
    return null;
  }
  const alumni =
    /\bgraduated\s+from\b|\bgraduate\s+of\b|\balumn(?:a|us|i)\b|\brecent\s+grad(?:uate)?\b|\b(?:college|university|undergrad(?:uate)?)\s+grad(?:uate)?s?\b(?!\s+student)/i.test(
      text
    ) ||
    /\b(?:i(?:['’]m| am)\s+(?:a\s+)?)?[\w.'-]{2,40}\s+grad(?:uate)?s?\b(?!\s+student)/i.test(
      text
    );
  if (!alumni) return null;
  return {
    age: TYPICAL_BACHELORS_AGE,
    floor: true,
    confidence: 0.55,
    basis: "text_age_floor",
    explanation: `Public text describes a completed bachelor's with no year — age is at least ${TYPICAL_BACHELORS_AGE} and may be higher.`,
  };
}

function parseExperienceFloor(text: string): PublicTextAgeHint | null {
  const m = text.match(
    /\b(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:professional\s+)?experience\b/i
  );
  if (!m) return null;
  const years = Number(m[1]);
  if (!Number.isFinite(years) || years < 3 || years > 40) return null;
  const age = Math.min(55, 18 + years);
  if (age < 21) return null;
  return {
    age,
    floor: true,
    confidence: 0.45,
    basis: "text_age_floor",
    explanation: `Public text claims ${years} years of experience — treating age as at least ${age}.`,
  };
}

/**
 * Age from website / GitHub / LinkedIn prose — class standing, class-of year,
 * graduate programs, alumni language, stated age. School brand names are
 * not used. Returns the most specific signal; when several floors apply,
 * the older (more conservative for youth ranking) wins.
 */
export function publicTextAgeHint(input: {
  linkedin?: LinkedInProfile;
  website?: WebsiteProfile;
  github?: Pick<GitHubProfile, "bio">;
  extraTexts?: string[];
  currentYear: number;
}): PublicTextAgeHint | null {
  const blob = identityBlob(input);
  if (!blob.trim()) return null;

  const stated = parseStatedAge(blob);
  if (stated != null) {
    return {
      age: stated,
      floor: false,
      confidence: 0.9,
      basis: "text_stated_age",
      explanation: `Stated age ${stated} in public profile text.`,
    };
  }

  const classYear = parseClassYear(blob, input.currentYear);
  if (classYear) return classYear;

  const graduate = parseGraduateStanding(blob);
  if (graduate) return graduate;

  const standing = parseCollegeOrHsStanding(blob);
  if (standing) return standing;

  const floors = [parseAlumniFloor(blob), parseExperienceFloor(blob)].filter(
    (h): h is PublicTextAgeHint => h != null
  );
  if (!floors.length) return null;
  floors.sort((a, b) => b.age - a.age);
  return floors[0] ?? null;
}
