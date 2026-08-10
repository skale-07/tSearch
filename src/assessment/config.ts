import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const DAY_MS = 24 * 60 * 60 * 1000;

export function getAssessmentRunsDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.ASSESSMENT_RUNS_DIR ?? "output/assessment-runs"
  );
}

export function getDigestsDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.DIGESTS_DIR ?? "output/digests"
  );
}

/** @deprecated use getAssessmentRunsDir() for testability */
export const ASSESSMENT_RUNS_DIR = getAssessmentRunsDir();
/** @deprecated use getDigestsDir() for testability */
export const DIGESTS_DIR = getDigestsDir();

export const ASSESSMENT_CACHE_DIR = path.resolve(
  process.cwd(),
  process.env.CACHE_DIR ?? "cache",
  "assessment"
);

export function assessmentForceRefresh(): boolean {
  return process.env.ASSESSMENT_FORCE_REFRESH === "1";
}

/** @deprecated Prefer assessmentForceRefresh() so tests can toggle env. */
export const ASSESSMENT_FORCE_REFRESH = process.env.ASSESSMENT_FORCE_REFRESH === "1";

export const ASSESSMENT_CANDIDATE_LIMIT = Number(
  process.env.ASSESSMENT_CANDIDATE_LIMIT ?? 10
);
export const ASSESSMENT_REPOSITORY_LIMIT = Number(
  process.env.ASSESSMENT_REPOSITORY_LIMIT ?? 3
);
/** How many candidates to assess in parallel (GitHub/OpenAI rate limits apply). */
export const ASSESSMENT_CANDIDATE_CONCURRENCY = Math.max(
  1,
  Number(process.env.ASSESSMENT_CANDIDATE_CONCURRENCY ?? 2)
);
/** How many repos to fetch in parallel per candidate. */
export const ASSESSMENT_REPO_FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.ASSESSMENT_REPO_FETCH_CONCURRENCY ?? 3)
);
export const ASSESSMENT_PUBLICATION_LIMIT = Number(
  process.env.ASSESSMENT_PUBLICATION_LIMIT ?? 3
);
export const ASSESSMENT_ARTICLE_LIMIT = Number(
  process.env.ASSESSMENT_ARTICLE_LIMIT ?? 3
);

export type LlmProvider = "openai" | "anthropic";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

/** Fail closed on unknown providers. Prefer resolveLlmProvider() in new code. */
export function resolveLlmProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? "openai").trim().toLowerCase();
  if (raw === "openai" || raw === "anthropic") return raw;
  throw new Error(
    `Invalid LLM_PROVIDER="${process.env.LLM_PROVIDER ?? ""}". Use openai or anthropic.`
  );
}

export function resolveLlmApiKey(
  provider: LlmProvider = resolveLlmProvider()
): string {
  const shared = process.env.LLM_API_KEY?.trim() || "";
  if (provider === "anthropic") {
    return process.env.ANTHROPIC_API_KEY?.trim() || shared || "";
  }
  return process.env.OPENAI_API_KEY?.trim() || shared || "";
}

export function resolveLlmModel(
  provider: LlmProvider = resolveLlmProvider()
): string {
  const explicit = process.env.LLM_MODEL?.trim();
  if (explicit) return explicit;
  return provider === "anthropic"
    ? DEFAULT_ANTHROPIC_MODEL
    : DEFAULT_OPENAI_MODEL;
}

/** True when mock is forced or the selected provider has no API key. */
export function llmUseMock(): boolean {
  return process.env.ASSESSMENT_MOCK_LLM === "1" || !resolveLlmApiKey();
}

export const LLM_PROVIDER = resolveLlmProvider();
/** API key for the selected LLM_PROVIDER (not necessarily OpenAI). */
export const LLM_API_KEY = resolveLlmApiKey();
export const LLM_MODEL = resolveLlmModel();
export const LLM_USE_MOCK = llmUseMock();

export const PROMPT_VERSIONS = {
  technical: "technical-prompt-v2",
  technical_v1_legacy: "technical-v1",
  writing: "writing-prompt-v1",
  cross_artifact: "cross-artifact-prompt-v1",
  cory: "cory-relevance-v1",
  research: "research-v1",
  curiosity: "curiosity-v1",
  synthesis: "synthesis-v1",
} as const;

export const PRIORITY_WEIGHT_VERSION = "priority-v2";

export const PRIORITY_WEIGHTS = {
  strongest_domain: 0.3,
  second_domain: 0.15,
  curiosity: 0.2,
  unusual_problem_selection: 0.1,
  persistence: 0.1,
  ownership: 0.1,
  evidence_completeness: 0.05,
} as const;

/** Content limits for GitHub collection */
export const README_MAX_CHARS = 15_000;
export const CORE_SOURCE_FILE_MAX = 8;
export const CORE_SOURCE_CHARS = 12_000;
export const TEST_FILE_MAX = 4;
export const CANDIDATE_COMMIT_MAX = 30;
export const CANDIDATE_PR_MAX = 20;

export const ARTIFACT_CACHE_TTL_MS = Number(
  process.env.ASSESSMENT_ARTIFACT_CACHE_TTL_MS ?? 14 * DAY_MS
);
export const JUDGE_CACHE_TTL_MS = Number(
  process.env.ASSESSMENT_JUDGE_CACHE_TTL_MS ?? 30 * DAY_MS
);

export const DIGEST_TOP_N = Number(process.env.DIGEST_TOP_N ?? 10);
/** Minimum assessment priority to include in the Cory digest (0–100). */
export const DIGEST_MIN_PRIORITY = Number(
  process.env.DIGEST_MIN_PRIORITY ?? 50
);
export const DIGEST_EMAIL_TO = process.env.DIGEST_EMAIL_TO?.trim() ?? "";
export const DIGEST_EMAIL_FROM = process.env.DIGEST_EMAIL_FROM?.trim() ?? "";
export const DIGEST_EMAIL_SUBJECT_PREFIX =
  process.env.DIGEST_EMAIL_SUBJECT_PREFIX?.trim() ?? "[tSearch Digest]";

function resolveEmailApiKey(): string {
  const candidates = [
    process.env.EMAIL_PROVIDER_API_KEY,
    process.env.RESEND_API_KEY,
  ];
  for (const raw of candidates) {
    const key = raw?.trim() ?? "";
    // Ignore .env.example-style placeholders
    if (!key || key === "re_..." || key.endsWith("...")) continue;
    return key;
  }
  return "";
}

export const EMAIL_PROVIDER_API_KEY = resolveEmailApiKey();
