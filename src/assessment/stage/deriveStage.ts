import { ageFromAwardMatch, matchAwards } from "../../awards/awardRegistry.js";
import type { LinkedInProfile, OlympiadProfile } from "../../types.js";

/**
 * Life-stage estimation for age-relative scoring.
 *
 * Stage is DERIVED from stated dates only — education timelines, competition
 * years, dated awards. It is never inferred from a photo, a name, a country,
 * or a school. Unknown is a first-class outcome: a missing stage must read as
 * "cannot judge", never as an average, because the largest group in the seed
 * set (teenagers with sparse LinkedIn profiles) would otherwise be silently
 * penalized.
 */
export type StageBucket =
  | "hs_underclass"
  | "hs_senior"
  | "early_undergrad"
  | "late_undergrad"
  | "post_grad"
  | "unknown";

export type StageBasis =
  | "olympiad_age_band"
  | "award_cohort"
  | "olympiad_year"
  | "linkedin_graduation_year"
  | "none";

export interface StageEstimate {
  bucket: StageBucket;
  estimated_age: number | null;
  /** 0..1 — how much the underlying date evidence supports the estimate. */
  confidence: number;
  basis: StageBasis;
  /** Human-readable provenance for the digest and judge prompt. */
  explanation: string;
}

/** Typical age of an olympiad competitor when the CSV gives no age column. */
const TYPICAL_OLYMPIAD_AGE = 17;
/** Typical age at bachelor's graduation, for reading LinkedIn grad years. */
const TYPICAL_GRADUATION_AGE = 22;

export function bucketForAge(age: number): StageBucket {
  if (age <= 16) return "hs_underclass";
  if (age <= 18) return "hs_senior";
  if (age <= 20) return "early_undergrad";
  if (age <= 22) return "late_undergrad";
  return "post_grad";
}

function unknownStage(): StageEstimate {
  return {
    bucket: "unknown",
    estimated_age: null,
    confidence: 0,
    basis: "none",
    explanation: "No stated education dates, competition years, or dated awards.",
  };
}

export function deriveStage(input: {
  linkedin?: LinkedInProfile;
  olympiad?: OlympiadProfile;
  now?: Date;
}): StageEstimate {
  const now = input.now ?? new Date();
  const currentYear = now.getFullYear();
  const { linkedin, olympiad } = input;

  // 1. Olympiad CSV age band — the only source with a stated age.
  //    ageScore 2 => competitor was 16–17; 1 => 18–19; 0 is ambiguous
  //    (either older or simply unrecorded), so it is not usable.
  const latestOlympiadYear = olympiad?.years?.length
    ? Math.max(...olympiad.years)
    : null;
  if (olympiad && latestOlympiadYear && olympiad.ageScore >= 1) {
    const ageAtCompetition = olympiad.ageScore === 2 ? 16.5 : 18.5;
    const age = Math.round(ageAtCompetition + (currentYear - latestOlympiadYear));
    return {
      bucket: bucketForAge(age),
      estimated_age: age,
      confidence: 0.9,
      basis: "olympiad_age_band",
      explanation: `Stated age band at ${latestOlympiadYear} competition, aged forward to ${currentYear}.`,
    };
  }

  // 2. A dated hs_senior award pins the cohort year directly.
  if (linkedin?.awards?.length) {
    const matches = matchAwards(
      linkedin.awards.map((a) => ({
        title: a.title,
        issuer: a.issuer,
        date: a.date,
      }))
    );
    const dated = matches
      .map((m) => ({ m, age: ageFromAwardMatch(m, currentYear) }))
      .filter((x): x is { m: typeof matches[number]; age: { age: number; confidence: number } } => !!x.age)
      // Most recent award year gives the tightest read.
      .sort((a, b) => (b.m.year ?? 0) - (a.m.year ?? 0));
    const best = dated[0];
    if (best) {
      return {
        bucket: bucketForAge(best.age.age),
        estimated_age: best.age.age,
        confidence: best.age.confidence,
        basis: "award_cohort",
        explanation: `${best.m.award.display_name} (${best.m.year}) is awarded to high-school seniors; aged forward to ${currentYear}.`,
      };
    }
  }

  // 3. LinkedIn graduation year — stated education timeline.
  if (linkedin?.graduation_year) {
    const age = TYPICAL_GRADUATION_AGE - (linkedin.graduation_year - currentYear);
    if (age >= 10 && age <= 60) {
      return {
        bucket: bucketForAge(age),
        estimated_age: age,
        confidence: 0.75,
        basis: "linkedin_graduation_year",
        explanation: `Stated graduation year ${linkedin.graduation_year}, read against a typical ${TYPICAL_GRADUATION_AGE}-year-old graduation age.`,
      };
    }
  }

  // 4. Competition year alone — high-school-stage competitions imply a band.
  if (latestOlympiadYear) {
    const age = TYPICAL_OLYMPIAD_AGE + (currentYear - latestOlympiadYear);
    return {
      bucket: bucketForAge(age),
      estimated_age: age,
      confidence: 0.6,
      basis: "olympiad_year",
      explanation: `Competed in ${latestOlympiadYear}; olympiad competitors are typically ~${TYPICAL_OLYMPIAD_AGE} at the time.`,
    };
  }

  return unknownStage();
}

export const STAGE_NORMS: Record<Exclude<StageBucket, "unknown">, string> = {
  hs_underclass:
    "15–16. Norm: coursework, tutorials, contest practice. Anything shipped to real users is already unusual.",
  hs_senior:
    "17–18. Norm: class projects, competition prep, a portfolio site. Independent systems with real users are well above norm.",
  early_undergrad:
    "19–20. Norm: coursework, first internships, hackathon projects. Original research or maintained tools are above norm.",
  late_undergrad:
    "21–22. Norm: capstone projects, solid internships, some open-source contribution. The bar for 'remarkable' is higher.",
  post_grad:
    "23+. Norm: professional work of decent quality is expected; only genuinely exceptional output reads as remarkable for stage.",
};
