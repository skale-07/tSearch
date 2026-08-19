import { WEIRD_TOPICS } from "../config.js";
import { deriveStage } from "../assessment/stage/deriveStage.js";
import { ageScalar, toOverallScore10 } from "./ageScalar.js";
import { computeObscurity } from "./computeObscurity.js";
import { linkedinTechnicalSignal } from "./linkedinTechnical.js";
import { hasDetailedLinkedInExperience } from "../assessment/youthWildcard.js";
import type {
  Candidate,
  GitHubProfile,
  LinkedInProfile,
  OlympiadProfile,
  ScoreBreakdown,
  SubstackProfile,
  WebsiteProfile,
} from "../types.js";

function hasWeirdTopics(github?: GitHubProfile): boolean {
  if (!github) return false;
  const topics = github.repos.flatMap((r) => r.topics).map((t) => t.toLowerCase());
  return topics.some((t) =>
    WEIRD_TOPICS.some((w) => t.includes(w) || w.includes(t))
  );
}

export function computeScore(
  github?: GitHubProfile,
  substack?: SubstackProfile,
  olympiad?: OlympiadProfile,
  identityConfidence = 0,
  convergenceSeedCount = 0,
  website?: WebsiteProfile,
  linkedin?: LinkedInProfile
): { final_score: number; overall_score: number; breakdown: ScoreBreakdown } {
  const repos = github?.repos.length ?? 0;
  const recent = github?.recent_commits ?? 0;
  const posts = substack?.posts ?? 0;

  const githubBuilder =
    (github?.active ? 0.3 : 0) +
    (repos > 3 ? 0.2 : 0) +
    (recent > 5 ? 0.2 : 0);
  const liTech = linkedinTechnicalSignal(linkedin);
  // LinkedIn titles fill in when GitHub is missing. They never subtract, and
  // they cannot beat a full GitHub builder — max(), not a missing-experience penalty.
  const builder = Math.max(githubBuilder, liTech);

  const thinker =
    (substack?.active ? 0.3 : 0) + (posts > 5 ? 0.2 : 0);

  const olympiadScore = olympiad
    ? olympiad.olympiadScore * 0.3 +
      olympiad.medalScore * 0.2 +
      olympiad.recencyScore * 0.1
    : 0;

  const weirdness = hasWeirdTopics(github) ? 0.3 : 0;
  const identity = identityConfidence * 0.2;
  // Each seed-set member beyond the first that reaches this person adds
  // signal; capped so convergence flavors ranking without dominating it.
  const convergence = Math.min(0.45, Math.max(0, convergenceSeedCount - 1) * 0.15);

  const obscurityResult = computeObscurity({
    github,
    substack,
    website,
    linkedinConnections: linkedin?.connections ?? null,
    linkedinConnectionsSaturated: linkedin?.connections_saturated ?? false,
    githubOnLinkedIn: !!linkedin?.github_url,
    linkedinExperiencePresent: hasDetailedLinkedInExperience(linkedin),
  });

  const stage = deriveStage({ linkedin, olympiad });
  const scalar = ageScalar(stage.estimated_age);

  const preAge =
    Math.round(
      (builder + thinker + olympiadScore + weirdness + identity + convergence) *
        100
    ) / 100;

  // `obscurity` is intentionally absent from this sum — see ScoreBreakdown.
  // Chronological age scales the whole pre-age total (younger → higher).
  const final_score = Math.round(preAge * scalar * 100) / 100;
  // Historical final_score is ~0–3; operator-facing overall is 1–10.
  // final_score is ~0–3; toOverallScore10 expects 0–100.
  const overall_score = toOverallScore10(final_score * (100 / 3));

  const breakdown: ScoreBreakdown = {
    builder: Math.round(builder * 100) / 100,
    thinker: Math.round(thinker * 100) / 100,
    olympiad: Math.round(olympiadScore * 100) / 100,
    weirdness: Math.round(weirdness * 100) / 100,
    identity: Math.round(identity * 100) / 100,
    convergence: Math.round(convergence * 100) / 100,
    obscurity: obscurityResult.obscurity,
    obscurity_confidence: obscurityResult.confidence,
    age_scalar: scalar,
    estimated_age: stage.estimated_age,
    overall_score,
  };

  return { final_score, overall_score, breakdown };
}

export function scoreCandidate(
  candidate: Omit<Candidate, "final_score" | "score_breakdown">,
  convergenceSeedCount = 0
): Candidate {
  const { final_score, overall_score, breakdown } = computeScore(
    candidate.github,
    candidate.substack,
    candidate.olympiad,
    candidate.identity_confidence,
    convergenceSeedCount,
    candidate.website,
    candidate.linkedin
  );
  return {
    ...candidate,
    final_score,
    overall_score,
    score_breakdown: breakdown,
  };
}
