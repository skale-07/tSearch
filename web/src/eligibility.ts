export interface EligibilityCandidate {
  github_username?: string | null;
  website_url?: string | null;
  blog_url?: string | null;
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
  const reasons: string[] = [];

  if (!githubPathAvailable) reasons.push("No GitHub path available");
  if (!writingEligible) reasons.push("No website or blog available");

  return {
    technicalEligible: githubPathAvailable,
    githubPathAvailable,
    writingEligible,
    eligible: githubPathAvailable || writingEligible,
    reasons,
  };
}
