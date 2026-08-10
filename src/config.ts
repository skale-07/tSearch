import { execSync } from "child_process";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function tokenFromGhCli(): string {
  try {
    return execSync("gh auth token", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function resolveGithubToken(): { token: string; source: string } {
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "GITHUB_TOKEN env" };

  const fromGh = tokenFromGhCli();
  if (fromGh) return { token: fromGh, source: "gh auth token" };

  return { token: "", source: "not set" };
}

const githubAuth = resolveGithubToken();

export const GITHUB_TOKEN = githubAuth.token;
export const GITHUB_TOKEN_SOURCE = githubAuth.source;
export const GITHUB_DELAY_MS = Number(process.env.GITHUB_DELAY_MS ?? 800);
export const SUBSTACK_DELAY_MS = Number(process.env.SUBSTACK_DELAY_MS ?? 600);
export const LINKEDIN_DELAY_MS = Number(process.env.LINKEDIN_DELAY_MS ?? 1200);

export const SEEDS_PATH = path.resolve(
  process.cwd(),
  process.env.SEEDS_PATH ?? "src/seeds/seeds.json"
);

export const OLYMPIAD_CSV_PATH = path.resolve(
  process.cwd(),
  process.env.OLYMPIAD_CSV ?? "olympiad_winners.csv"
);

export const OUTPUT_PATH = path.resolve(
  process.cwd(),
  process.env.OUTPUT_PATH ?? "output/candidates.json"
);

export const COOKIES_PATH = path.resolve(
  process.cwd(),
  process.env.COOKIES_PATH ?? "cookies.json"
);

export const CACHE_DIR = path.resolve(
  process.cwd(),
  process.env.CACHE_DIR ?? "cache"
);

export const PEOPLE_DIR = path.resolve(
  process.cwd(),
  process.env.PEOPLE_DIR ?? "data/people"
);

export const FEEDBACK_DIR = path.resolve(
  process.cwd(),
  process.env.FEEDBACK_DIR ?? "data/feedback"
);

/** Flat per-person profile folders: profiles/<slug>/profile.json */
export const PROFILES_DIR = path.resolve(
  process.cwd(),
  process.env.PROFILES_DIR ?? "profiles"
);

export const MAX_FOLLOWER_PROFILES = Number(
  process.env.MAX_FOLLOWER_PROFILES ?? 20
);
/** Minimum context_score to profile a follower during pipeline expand. */
export const MIN_CONTEXT_SCORE_TO_EXPAND = Number(
  process.env.MIN_CONTEXT_SCORE_TO_EXPAND ?? 2
);
/** Minimum context_score for a node to appear on the UI tree (hop ≥ 1). */
export const MIN_TREE_CONTEXT_SCORE = Number(
  process.env.MIN_TREE_CONTEXT_SCORE ?? 4
);

const DAY_MS = 24 * 60 * 60 * 1000;
export const GITHUB_CACHE_TTL_MS = Number(
  process.env.GITHUB_CACHE_TTL_MS ?? 7 * DAY_MS
);
export const LINKEDIN_CACHE_TTL_MS = Number(
  process.env.LINKEDIN_CACHE_TTL_MS ?? 30 * DAY_MS
);
export const LINKEDIN_SEARCH_CACHE_TTL_MS = Number(
  process.env.LINKEDIN_SEARCH_CACHE_TTL_MS ?? 7 * DAY_MS
);
export const SUBSTACK_CACHE_TTL_MS = Number(
  process.env.SUBSTACK_CACHE_TTL_MS ?? 7 * DAY_MS
);
export const FORCE_REFRESH = process.env.FORCE_REFRESH === "1";

export const MAX_LINKEDIN_RESULTS = Number(process.env.MAX_LINKEDIN_RESULTS ?? 5);
export const MAX_GITHUB_STARGAZERS_PER_REPO = Number(
  process.env.MAX_STARGAZERS_PER_REPO ?? 15
);
export const MAX_REPOS_EXPAND = Number(process.env.MAX_REPOS_EXPAND ?? 5);
export const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES ?? 80);
export const MAX_IDENTITY_RESOLVES = Number(process.env.MAX_IDENTITY_RESOLVES ?? 40);

export const WEIRD_TOPICS = [
  "ai",
  "agents",
  "machine-learning",
  "llm",
  "crypto",
  "mathematics",
  "math",
  "rust",
  "competitive-programming",
];

export const BROWSER_LAUNCH_OPTIONS = {
  headless: false as const,
  slowMo: 50,
};
