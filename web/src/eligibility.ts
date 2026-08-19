export interface EligibilityCandidate {
  github_username?: string | null;
  website_url?: string | null;
  blog_url?: string | null;
  /** Frozen draw of 17–19-year-olds with LinkedIn experience + featured links. */
  youth_wildcard?: boolean;
}

export interface AssessmentEligibility {
  technicalEligible: boolean;
  githubPathAvailable: boolean;
  writingEligible: boolean;
  eligible: boolean;
  reasons: string[];
}

export function assessmentEligibility(
  candidate: EligibilityCandidate
): AssessmentEligibility {
  const githubPathAvailable = Boolean(candidate.github_username);
  const writingEligible = Boolean(candidate.website_url || candidate.blog_url);
  const youthWildcard = Boolean(candidate.youth_wildcard);
  const reasons: string[] = [];

  if (!githubPathAvailable) reasons.push("No GitHub path available");
  if (!writingEligible) reasons.push("No website or blog available");
  if (youthWildcard) {
    reasons.push("Youth wildcard: LinkedIn experience + featured links");
  }

  return {
    technicalEligible: githubPathAvailable,
    githubPathAvailable,
    writingEligible,
    eligible: githubPathAvailable || writingEligible || youthWildcard,
    reasons,
  };
}
