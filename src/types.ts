export interface Repo {
  name: string;
  topics: string[];
  language: string | null;
  stars: number;
  pushed_at: string | null;
}

export interface GitHubProfile {
  username: string;
  display_name: string | null;
  profile_url: string;
  repos: Repo[];
  contributors: string[];
  stars: string[];
  forks: string[];
  followers: string[];
  following: string[];
  recent_commits: number;
  active: boolean;
}

export interface SubstackProfile {
  url: string | null;
  slug: string | null;
  posts: number | null;
  commenters: string[];
  recommenders: string[];
  active: boolean;
}

export interface LinkedInProfile {
  url: string;
  name: string;
  photo_url: string | null;
  headline: string | null;
  school: string | null;
  degree: string | null;
  country: string | null;
  graduation_year: number | null;
  keywords: string[];
  github_url: string | null;
  substack_url: string | null;
  twitter_url: string | null;
  website_url: string | null;
  experience: string[];
  skills: string[];
}

export interface OlympiadProfile {
  name: string;
  years: number[];
  sources: string[];
  prizes: string[];
  countries: string[];
  olympiadScore: number;
  medalScore: number;
  recencyScore: number;
  ageScore: number;
}

export interface ResolvedIdentity {
  query_name: string;
  linkedin: LinkedInProfile;
  identity_confidence: number;
  github_url: string | null;
  substack_url: string | null;
}

export interface Candidate {
  name: string;
  key: string;
  discovered_via: string[];
  linkedin?: LinkedInProfile;
  identity_confidence: number;
  github?: GitHubProfile;
  substack?: SubstackProfile;
  olympiad?: OlympiadProfile;
  final_score: number;
  score_breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  builder: number;
  thinker: number;
  olympiad: number;
  weirdness: number;
  identity: number;
}
