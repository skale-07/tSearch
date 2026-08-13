import { WEIRD_TOPICS } from "../config.js";
import { computeObscurity } from "./computeObscurity.js";
import type {
  Candidate,
  GitHubProfile,
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
  website?: WebsiteProfile
): { final_score: number; breakdown: ScoreBreakdown } {
  const repos = github?.repos.length ?? 0;
  const recent = github?.recent_commits ?? 0;
  const posts = substack?.posts ?? 0;

  const builder =
    (github?.active ? 0.3 : 0) +
    (repos > 3 ? 0.2 : 0) +
    (recent > 5 ? 0.2 : 0);

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

  const obscurityResult = computeObscurity({ github, substack, website });

  const breakdown: ScoreBreakdown = {
    builder: Math.round(builder * 100) / 100,
    thinker: Math.round(thinker * 100) / 100,
    olympiad: Math.round(olympiadScore * 100) / 100,
    weirdness: Math.round(weirdness * 100) / 100,
    identity: Math.round(identity * 100) / 100,
    convergence: Math.round(convergence * 100) / 100,
    obscurity: obscurityResult.obscurity,
    obscurity_confidence: obscurityResult.confidence,
  };

  // `obscurity` is intentionally absent from this sum — see ScoreBreakdown.
  const final_score =
    Math.round(
      (breakdown.builder +
        breakdown.thinker +
        breakdown.olympiad +
        breakdown.weirdness +
        breakdown.identity +
        (breakdown.convergence ?? 0)) *
        100
    ) / 100;

  return { final_score, breakdown };
}

export function scoreCandidate(
  candidate: Omit<Candidate, "final_score" | "score_breakdown">,
  convergenceSeedCount = 0
): Candidate {
  const { final_score, breakdown } = computeScore(
    candidate.github,
    candidate.substack,
    candidate.olympiad,
    candidate.identity_confidence,
    convergenceSeedCount,
    candidate.website
  );
  return { ...candidate, final_score, score_breakdown: breakdown };
}
