import path from "path";

export const GITHUB_TOKEN = process.env.GITHUB_TOKEN?.trim() ?? "";
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
