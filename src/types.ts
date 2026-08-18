export interface Repo {
  name: string;
  topics: string[];
  language: string | null;
  stars: number;
  pushed_at: string | null;
}

export interface GitHubSocialLink {
  provider: string;
  url: string;
}

export interface GitHubProfile {
  username: string;
  display_name: string | null;
  profile_url: string;
  bio: string | null;
  blog: string | null;
  twitter_username: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  social_accounts: GitHubSocialLink[];
  /** How much external identity signal this GitHub profile exposes. */
  context_score: number;
  context_signals: string[];
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

export interface LinkedInEducation {
  school: string;
  degree: string | null;
  field: string | null;
  years: string | null;
}

export interface LinkedInExperience {
  title: string;
  company: string | null;
  dates: string | null;
  location: string | null;
}

export interface LinkedInAward {
  title: string;
  issuer: string | null;
  date: string | null;
}

export interface WebsiteProfile {
  url: string;
  scraped_at: string;
  github_url: string | null;
  substack_url: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  email: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  /** External non-social links found on the site. */
  other_links: string[];
  /** Deduped href inventory (capped). */
  all_links: string[];
}

export interface LinkedInProfile {
  url: string;
  name: string;
  photo_url: string | null;
  headline: string | null;
  /** Primary college/university from education section. */
  college: string | null;
  school: string | null;
  degree: string | null;
  country: string | null;
  graduation_year: number | null;
  education: LinkedInEducation[];
  keywords: string[];
  github_url: string | null;
  substack_url: string | null;
  twitter_url: string | null;
  /** Personal portfolio site from LinkedIn Contact info. */
  personal_website: string | null;
  website_url: string | null;
  /** All external links found in Contact info. */
  contact_links: string[];
  experience: LinkedInExperience[];
  awards: LinkedInAward[];
  skills: string[];
  /**
   * Stated connection count. LinkedIn shows an exact number up to 500 and then
   * caps the display at "500+", so this is exact below 500 and a floor at it —
   * which is the useful direction for measuring how undiscovered someone is.
   */
  connections?: number | null;
  /** True when the profile showed "500+" rather than an exact count. */
  connections_saturated?: boolean;
  /** Bumped when scrape logic changes; invalidates stale profile cache. */
  scrape_version?: number;
}

export interface OlympiadProfile {
  name: string;
  years: number[];
  sources: string[];
  prizes: string[];
  countries: string[];
  /** High schools / secondary schools from olympiad CSV rows (ISEF etc.). */
  schools: string[];
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
  website?: WebsiteProfile | null;
}

export interface Candidate {
  name: string;
  key: string;
  discovered_via: string[];
  linkedin?: LinkedInProfile;
  identity_confidence: number;
  github?: GitHubProfile;
  substack?: SubstackProfile;
  website?: WebsiteProfile;
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
  /** Bonus for being reachable from 2+ seed-set members (network bridge). */
  convergence?: number;
  /**
   * How undiscovered this person's public footprint is (0 = highly visible,
   * 1 = essentially invisible). Deliberately EXCLUDED from `final_score` — it
   * is a surfacing lens, not a quality bonus, and rewarding it additively
   * would put empty profiles on top.
   */
  obscurity?: number;
  obscurity_confidence?: number;
}
