import type { LinkedInEducation, LinkedInProfile } from "../types.js";

const STATED_MIN = 14;
const STATED_MAX = 49;
const TYPICAL_HS_GRAD_AGE = 18;
const TYPICAL_COLLEGE_GRAD_AGE = 22;

export interface LinkedInAgeHint {
  age: number;
  confidence: number;
  basis: "linkedin_stated_age" | "linkedin_hs_year" | "linkedin_graduation_year";
  explanation: string;
}

/**
 * Current age written in a headline or About blurb.
 * Conservative on purpose: bare numbers and "class of 19" are not ages.
 */
export function parseStatedAge(text: string | null | undefined): number | null {
  if (!text) return null;
  const patterns: RegExp[] = [
    /\b(?:i(?:['’]m| am))\s+(\d{1,2})\b/gi,
    /\baged?\s*[:\-]?\s*(\d{1,2})\b(?!\s*[-–—]\s*\d)/gi,
    /\b(\d{1,2})\s*(?:years?\s*old|yrs?\s*old|y(?:ears?)?\.?\s*o(?:ld)?\.?)\b/gi,
    /\b(\d{1,2})\s*[|•·]\s*(?:student|high[\s-]?school|college|undergrad|founder|engineer|swe)\b/i,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= STATED_MIN && n <= STATED_MAX) return n;
  }
  return null;
}

export function ageFromLinkedInProfile(
  linkedin: Pick<
    LinkedInProfile,
    "headline" | "stated_age" | "education" | "school" | "graduation_year" | "degree"
  >,
  currentYear: number
): LinkedInAgeHint | null {
  const stated =
    (linkedin.stated_age != null &&
    linkedin.stated_age >= STATED_MIN &&
    linkedin.stated_age <= STATED_MAX
      ? linkedin.stated_age
      : null) ?? parseStatedAge(linkedin.headline);
  if (stated != null) {
    return {
      age: stated,
      confidence: 0.95,
      basis: "linkedin_stated_age",
      explanation: `Stated age ${stated} in LinkedIn headline or About.`,
    };
  }

  const fromEdu = ageFromEducation(linkedin.education ?? [], currentYear);
  if (fromEdu) return fromEdu;

  const year = linkedin.graduation_year;
  if (year && year >= 1970 && year <= currentYear + 6) {
    const hs = looksLikeHighSchool(linkedin.school, linkedin.degree);
    const typical = hs ? TYPICAL_HS_GRAD_AGE : TYPICAL_COLLEGE_GRAD_AGE;
    const age = typical + (currentYear - year);
    if (age >= 14 && age <= 55) {
      return {
        age,
        confidence: hs ? 0.8 : 0.7,
        basis: hs ? "linkedin_hs_year" : "linkedin_graduation_year",
        explanation: hs
          ? `High-school end year ${year}; typical age ${TYPICAL_HS_GRAD_AGE} then, aged forward to ${currentYear}.`
          : `Stated graduation year ${year}, read against a typical ${TYPICAL_COLLEGE_GRAD_AGE}-year-old bachelor's graduation.`,
      };
    }
  }
  return null;
}

function ageFromEducation(
  education: LinkedInEducation[],
  currentYear: number
): LinkedInAgeHint | null {
  let hs: LinkedInAgeHint | null = null;
  let college: LinkedInAgeHint | null = null;
  for (const edu of education) {
    const end = parseEducationEndYear(edu.years, currentYear);
    if (end == null) continue;
    const kind = educationKind(edu);
    const elapsed = currentYear - end;
    if (elapsed < -1 || elapsed > 50) continue;
    if (kind === "hs" && !hs) {
      const age = TYPICAL_HS_GRAD_AGE + elapsed;
      if (age >= 14 && age <= 55) {
        hs = {
          age,
          confidence: 0.8,
          basis: "linkedin_hs_year",
          explanation: `High school ${edu.school} ended ${end}; typical age ${TYPICAL_HS_GRAD_AGE} then, aged forward to ${currentYear}.`,
        };
      }
    } else if (kind === "college" && !college) {
      const age = TYPICAL_COLLEGE_GRAD_AGE + elapsed;
      if (age >= 14 && age <= 55) {
        college = {
          age,
          confidence: 0.7,
          basis: "linkedin_graduation_year",
          explanation: `College ${edu.school} ended ${end}; typical age ${TYPICAL_COLLEGE_GRAD_AGE} then, aged forward to ${currentYear}.`,
        };
      }
    }
  }
  return hs ?? college;
}

function educationKind(edu: LinkedInEducation): "hs" | "college" | "unknown" {
  if (looksLikeHighSchool(edu.school, edu.degree)) return "hs";
  const blob = `${edu.school} ${edu.degree ?? ""} ${edu.field ?? ""}`.toLowerCase();
  if (
    /\b(ph\.?d|doctorate|master|mba|bachelor|b\.?s\.?|b\.?a\.?|m\.?s\.?|associate|undergrad)\b/.test(
      blob
    )
  ) {
    return "college";
  }
  if (/university|college|institute of technology/.test(blob)) return "college";
  return "unknown";
}

function looksLikeHighSchool(
  school: string | null | undefined,
  degree: string | null | undefined
): boolean {
  const blob = `${school ?? ""} ${degree ?? ""}`.toLowerCase();
  return /high school|secondary school|preparatory school|\bprep school\b|senior high/.test(
    blob
  );
}

/** End year of an education row: "2004-2008", "Class of '08", "2012". */
export function parseEducationEndYear(
  years: string | null | undefined,
  currentYear: number
): number | null {
  if (!years || /present/i.test(years)) return null;
  const fours = [...years.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) =>
    Number(m[1])
  );
  const validFours = fours.filter((y) => y >= 1970 && y <= currentYear + 6);
  if (validFours.length) return Math.max(...validFours);

  const two = years.match(/['’](\d{2})\b|\bclass of\s+['’]?(\d{2})\b/i);
  const token = two?.[1] ?? two?.[2];
  if (!token) return null;
  return expandTwoDigitYear(Number(token), currentYear);
}

export function expandTwoDigitYear(two: number, currentYear: number): number | null {
  if (!Number.isInteger(two) || two < 0 || two > 99) return null;
  const thisCentury = Math.floor(currentYear / 100) * 100 + two;
  const lastCentury = thisCentury - 100;
  if (thisCentury <= currentYear + 1 && currentYear - thisCentury <= 80) {
    return thisCentury;
  }
  if (currentYear - lastCentury <= 80) return lastCentury;
  return null;
}
