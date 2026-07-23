import crypto from "crypto";
import { GITHUB_DELAY_MS, GITHUB_TOKEN } from "../../config.js";
import {
  CORE_SOURCE_CHARS,
  CORE_SOURCE_FILE_MAX,
  CANDIDATE_COMMIT_MAX,
  CANDIDATE_PR_MAX,
  README_MAX_CHARS,
  TEST_FILE_MAX,
} from "../config.js";
import type {
  ArtifactReference,
  EvidenceItem,
  GithubRepositoryArtifactDetail,
  RepoTreeEntry,
} from "../types.js";
import { EvidenceStore } from "../evidence/evidenceStore.js";
import {
  readArtifactCache,
  writeArtifactCache,
  hashPayload,
} from "../storage/artifactCache.js";
import { selectSourceFiles, shouldIgnorePath } from "./selectSourceFiles.js";
import {
  collectOwnershipEvidence,
  isCoreContributionPath,
  ownershipV2ToLegacy,
} from "./collectOwnershipEvidence.js";
import {
  buildPhaseAIdentityMap,
  commitMatchesCanonicalLogin,
} from "./matchCommitLogin.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ghJson<T>(
  apiPath: string,
  opts?: { skipCache?: boolean }
): Promise<T | null> {
  void opts;
  await sleep(GITHUB_DELAY_MS);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "tsearch-assessment",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${apiPath}`, { headers });
  if (res.status === 403 || res.status === 429) {
    const err = new Error(`GitHub rate limit: ${res.status} ${apiPath}`);
    (err as Error & { code?: string }).code = "GITHUB_RATE_LIMIT";
    throw err;
  }
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n/* truncated */";
}

function makeArtifactId(owner: string, repo: string): string {
  const h = crypto
    .createHash("sha1")
    .update(`github_repository:${owner}/${repo}`)
    .digest("hex")
    .slice(0, 12);
  return `art_${h}`;
}

export interface CollectRepoResult {
  reference: ArtifactReference;
  detail: GithubRepositoryArtifactDetail;
  evidence: EvidenceItem[];
}

export interface FixtureCommitSampleEntry {
  sha: string;
  message?: string;
  date?: string | null;
  url?: string;
  author_login?: string | null;
  committer_login?: string | null;
  files_changed?: string[];
}

export interface FixtureRepoPackage {
  owner: string;
  name: string;
  description?: string | null;
  default_branch?: string;
  is_fork?: boolean;
  is_archived?: boolean;
  is_template?: boolean;
  language?: string | null;
  languages?: Record<string, number>;
  topics?: string[];
  license?: string | null;
  stars?: number;
  pushed_at?: string | null;
  created_at?: string | null;
  readme?: string;
  tree: RepoTreeEntry[];
  files: Record<string, string>;
  /** Unfiltered recent-window sample for share calculation */
  repository_commit_sample?: FixtureCommitSampleEntry[];
  candidate_commits?: GithubRepositoryArtifactDetail["candidate_commits"];
  /** Optional per-sha files for author-filtered inspection */
  candidate_commit_files?: Record<string, string[]>;
  candidate_prs?: GithubRepositoryArtifactDetail["candidate_prs"];
}

function computeShareFromSample(
  sample: FixtureCommitSampleEntry[],
  canonicalLogin: string
): {
  repository_commit_count_sampled: number;
  candidate_commits_in_repository_sample: number;
  candidate_commit_share?: number;
  sample_earliest_commit_at?: string;
  sample_latest_commit_at?: string;
  login_coverage: number;
} {
  const identity = buildPhaseAIdentityMap(canonicalLogin);
  let matched = 0;
  let withLogin = 0;
  const dates: string[] = [];
  for (const c of sample) {
    const hasLogin = !!(c.author_login || c.committer_login);
    if (hasLogin) withLogin++;
    if (
      commitMatchesCanonicalLogin(
        {
          author: { login: c.author_login },
          committer: { login: c.committer_login },
        },
        identity.canonical_login
      )
    ) {
      matched++;
    }
    if (c.date) dates.push(c.date);
  }
  dates.sort();
  const coverage = sample.length ? withLogin / sample.length : 0;
  // Omit share when identity low or login coverage poor
  const omitShare =
    identity.identity_support === "low" ||
    sample.length === 0 ||
    coverage < 0.5;

  return {
    repository_commit_count_sampled: sample.length,
    candidate_commits_in_repository_sample: matched,
    ...(omitShare
      ? {}
      : {
          candidate_commit_share:
            sample.length > 0 ? matched / sample.length : undefined,
        }),
    sample_earliest_commit_at: dates[0],
    sample_latest_commit_at: dates[dates.length - 1],
    login_coverage: coverage,
  };
}

function corePathsFromChanges(
  selectedCentral: string[],
  changedByCandidate: string[]
): string[] {
  const central = new Set(selectedCentral);
  return [
    ...new Set(
      changedByCandidate.filter((p) => isCoreContributionPath(p, central))
    ),
  ];
}

/** Offline collector from fixture packages (tests / mock mode). */
export function collectRepositoryFromFixture(
  fixture: FixtureRepoPackage,
  candidateUsername: string,
  selectedReason: string
): CollectRepoResult {
  const artifact_id = makeArtifactId(fixture.owner, fixture.name);
  const repo_url = `https://github.com/${fixture.owner}/${fixture.name}`;
  const selected = selectSourceFiles(fixture.tree, {
    maxCore: CORE_SOURCE_FILE_MAX,
    maxTests: TEST_FILE_MAX,
  });

  const readme = truncate(fixture.readme ?? "", README_MAX_CHARS);
  const core_source_files = selected.core.map((p) => ({
    path: p,
    excerpt: truncate(fixture.files[p] ?? "", CORE_SOURCE_CHARS),
  }));
  const test_files = selected.tests.map((p) => ({
    path: p,
    excerpt: truncate(fixture.files[p] ?? "", CORE_SOURCE_CHARS),
  }));
  const manifests = selected.manifests.map((p) => ({
    path: p,
    excerpt: truncate(fixture.files[p] ?? "", 4000),
  }));

  const commits = (fixture.candidate_commits ?? []).slice(
    0,
    CANDIDATE_COMMIT_MAX
  );
  const prs = (fixture.candidate_prs ?? []).slice(0, CANDIDATE_PR_MAX);

  // Build unfiltered sample: explicit or synthesize from candidate list WITHOUT using it as share numerator incorrectly
  const sample: FixtureCommitSampleEntry[] =
    fixture.repository_commit_sample ??
    // If only candidate commits provided, pad with non-matching placeholders so share ≠ 1.0 by default
    [
      ...commits.map((c) => ({
        sha: c.sha,
        message: c.message,
        date: c.date,
        url: c.url,
        author_login: candidateUsername,
        committer_login: candidateUsername,
        files_changed: fixture.candidate_commit_files?.[c.sha],
      })),
    ];

  const share = computeShareFromSample(sample, candidateUsername);

  const changedFiles: string[] = [];
  for (const c of commits) {
    const files = fixture.candidate_commit_files?.[c.sha] ?? [];
    changedFiles.push(...files);
  }
  // Also gather from sample entries attributed to candidate
  for (const s of sample) {
    if (
      commitMatchesCanonicalLogin(
        {
          author: { login: s.author_login },
          committer: { login: s.committer_login },
        },
        candidateUsername
      )
    ) {
      changedFiles.push(...(s.files_changed ?? []));
    }
  }

  const corePaths = corePathsFromChanges(selected.core, changedFiles);

  const identity = buildPhaseAIdentityMap(candidateUsername);
  const { ownership, evidence: ownershipEvidence } = collectOwnershipEvidence({
    artifact_id,
    repo_url,
    repo_owner: fixture.owner,
    candidate_username: candidateUsername,
    identity_support: identity.identity_support,
    is_fork: !!fixture.is_fork,
    is_template: !!fixture.is_template,
    is_course_or_tutorial: /homework|tutorial|course|assignment/i.test(
      fixture.name + (fixture.description ?? "")
    ),
    repository_commit_count_sampled: share.repository_commit_count_sampled,
    candidate_commits_in_repository_sample:
      share.candidate_commits_in_repository_sample,
    candidate_commit_share: share.candidate_commit_share,
    sample_earliest_commit_at: share.sample_earliest_commit_at,
    sample_latest_commit_at: share.sample_latest_commit_at,
    candidate_commit_count: commits.length,
    candidate_pr_count: prs.length,
    candidate_merged_pr_count: prs.filter((p) => p.state === "closed" || p.state === "merged").length,
    candidate_core_file_paths: corePaths,
    selected_central_paths: selected.core,
  });

  const store = new EvidenceStore();
  store.addMany(ownershipEvidence);

  if (core_source_files[0]) {
    store.create({
      artifact_id,
      source_type: "github_file",
      source_url: `${repo_url}/blob/HEAD/${core_source_files[0].path}`,
      observation: `Core source file present: ${core_source_files[0].path} (${core_source_files[0].excerpt.length} chars excerpt).`,
      supports_claim:
        "Repository contains nontrivial source code selected as central.",
      strength: "strong",
      candidate_ownership_confidence: ownershipV2ToLegacy(ownership).confidence,
      location: { file_path: core_source_files[0].path },
      salt: core_source_files[0].path,
    });
  }
  if (readme) {
    store.create({
      artifact_id,
      source_type: "github_file",
      source_url: `${repo_url}#readme`,
      observation: `README present (${readme.length} chars).`,
      supports_claim: "Repository documents intended purpose.",
      strength: "moderate",
      candidate_ownership_confidence: ownershipV2ToLegacy(ownership).confidence,
      location: { file_path: "README.md" },
      salt: "readme",
    });
  }

  const content_hash = hashPayload({
    tree: fixture.tree,
    files: fixture.files,
    commits,
    sample,
  });

  const detail: GithubRepositoryArtifactDetail = {
    owner: fixture.owner,
    name: fixture.name,
    full_name: `${fixture.owner}/${fixture.name}`,
    description: fixture.description ?? null,
    default_branch: fixture.default_branch ?? "main",
    is_fork: !!fixture.is_fork,
    is_archived: !!fixture.is_archived,
    language: fixture.language ?? null,
    languages: fixture.languages ?? {},
    topics: fixture.topics ?? [],
    license: fixture.license ?? null,
    stars: fixture.stars ?? 0,
    pushed_at: fixture.pushed_at ?? null,
    created_at: fixture.created_at ?? null,
    readme_excerpt: readme,
    tree: fixture.tree,
    manifests,
    core_source_files,
    test_files,
    candidate_commits: commits,
    candidate_prs: prs,
    ownership,
    ownership_legacy: ownershipV2ToLegacy(ownership),
  };

  const reference: ArtifactReference = {
    artifact_id,
    kind: "github_repository",
    title: detail.full_name,
    canonical_url: repo_url,
    author_identity_confidence: 0.9,
    candidate_ownership_confidence: ownershipV2ToLegacy(ownership).confidence,
    discovered_from: "github_profile_repos",
    selected_reason: selectedReason,
    collected_at: new Date().toISOString(),
    content_hash,
  };

  return { reference, detail, evidence: store.all() };
}

export async function collectRepositoryArtifact(
  owner: string,
  repo: string,
  candidateUsername: string,
  selectedReason: string,
  opts?: { metaCache?: Record<string, unknown> }
): Promise<CollectRepoResult> {
  const cacheKey = `repo:${owner}/${repo}:v2:${candidateUsername}`;
  const cached = readArtifactCache<CollectRepoResult>(cacheKey);
  if (cached) return cached;

  const meta =
    (opts?.metaCache?.[`${owner}/${repo}`] as {
      name: string;
      full_name: string;
      description: string | null;
      default_branch: string;
      fork: boolean;
      archived: boolean;
      is_template?: boolean;
      language: string | null;
      stargazers_count: number;
      pushed_at: string | null;
      created_at: string | null;
      topics?: string[];
      license?: { spdx_id?: string } | null;
      size: number;
    } | undefined) ??
    (await ghJson<{
      name: string;
      full_name: string;
      description: string | null;
      default_branch: string;
      fork: boolean;
      archived: boolean;
      is_template?: boolean;
      language: string | null;
      stargazers_count: number;
      pushed_at: string | null;
      created_at: string | null;
      topics?: string[];
      license?: { spdx_id?: string } | null;
      size: number;
    }>(`/repos/${owner}/${repo}`));

  if (!meta) {
    throw Object.assign(new Error(`Repository not found: ${owner}/${repo}`), {
      code: "REPO_NOT_FOUND",
    });
  }

  const branch = meta.default_branch || "main";
  const ref = await ghJson<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/ref/heads/${branch}`
  );
  const sha = ref?.object?.sha;
  let tree: RepoTreeEntry[] = [];
  let treeTruncated = false;
  if (sha) {
    const treeRes = await ghJson<{
      tree: Array<{ path: string; type: string; size?: number }>;
      truncated?: boolean;
    }>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
    treeTruncated = !!treeRes?.truncated;
    tree =
      treeRes?.tree
        ?.filter((t) => t.type === "blob" || t.type === "tree")
        .map((t) => ({
          path: t.path,
          type: t.type === "tree" ? "tree" : "blob",
          size: t.size,
        })) ?? [];
  }
  void treeTruncated;

  const selected = selectSourceFiles(tree, {
    maxCore: CORE_SOURCE_FILE_MAX,
    maxTests: TEST_FILE_MAX,
  });

  async function fetchFile(path: string): Promise<string> {
    const data = await ghJson<{ content?: string; encoding?: string }>(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${branch}`
    );
    if (!data?.content) return "";
    if (data.encoding === "base64") {
      return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString(
        "utf-8"
      );
    }
    return data.content;
  }

  let readme = "";
  for (const name of ["README.md", "Readme.md", "readme.md", "README"]) {
    try {
      readme = await fetchFile(name);
      if (readme) break;
    } catch {
      /* continue */
    }
  }
  readme = truncate(readme, README_MAX_CHARS);

  const files: Record<string, string> = {};
  for (const p of [...selected.core, ...selected.tests, ...selected.manifests]) {
    if (shouldIgnorePath(p)) continue;
    files[p] = truncate(await fetchFile(p), CORE_SOURCE_CHARS);
  }

  // Unfiltered sample for share
  const repoSampleRaw =
    (await ghJson<
      Array<{
        sha: string;
        html_url: string;
        author?: { login?: string } | null;
        committer?: { login?: string } | null;
        commit: { message: string; author?: { date?: string } };
      }>
    >(
      `/repos/${owner}/${repo}/commits?per_page=${CANDIDATE_COMMIT_MAX}`
    )) ?? [];

  const repository_commit_sample: FixtureCommitSampleEntry[] =
    repoSampleRaw.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0] ?? "",
      date: c.commit.author?.date ?? null,
      url: c.html_url,
      author_login: c.author?.login ?? null,
      committer_login: c.committer?.login ?? null,
    }));

  // Author-filtered for inspection / continuity (not share numerator)
  const commitsRaw =
    (await ghJson<
      Array<{
        sha: string;
        html_url: string;
        commit: { message: string; author?: { date?: string } };
      }>
    >(
      `/repos/${owner}/${repo}/commits?author=${encodeURIComponent(candidateUsername)}&per_page=${CANDIDATE_COMMIT_MAX}`
    )) ?? [];

  const candidate_commit_files: Record<string, string[]> = {};
  const inspectLimit = Math.min(commitsRaw.length, 10);
  for (let i = 0; i < inspectLimit; i++) {
    const c = commitsRaw[i]!;
    const detail = await ghJson<{
      files?: Array<{ filename: string }>;
    }>(`/repos/${owner}/${repo}/commits/${c.sha}`);
    candidate_commit_files[c.sha] =
      detail?.files?.map((f) => f.filename) ?? [];
  }

  const prsRaw =
    (await ghJson<
      Array<{
        number: number;
        title: string;
        state: string;
        html_url: string;
        user?: { login: string };
        merged_at?: string | null;
      }>
    >(`/repos/${owner}/${repo}/pulls?state=all&per_page=30`)) ?? [];

  const languages =
    (await ghJson<Record<string, number>>(
      `/repos/${owner}/${repo}/languages`
    )) ?? {};

  const fixture: FixtureRepoPackage = {
    owner,
    name: repo,
    description: meta.description,
    default_branch: branch,
    is_fork: meta.fork,
    is_archived: meta.archived,
    is_template: meta.is_template,
    language: meta.language,
    languages,
    topics: meta.topics ?? [],
    license: meta.license?.spdx_id ?? null,
    stars: meta.stargazers_count,
    pushed_at: meta.pushed_at,
    created_at: meta.created_at,
    readme,
    tree,
    files,
    repository_commit_sample,
    candidate_commits: commitsRaw.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0] ?? "",
      date: c.commit.author?.date ?? null,
      url: c.html_url,
    })),
    candidate_commit_files,
    candidate_prs: prsRaw
      .filter(
        (p) =>
          p.user?.login?.toLowerCase() === candidateUsername.toLowerCase()
      )
      .slice(0, CANDIDATE_PR_MAX)
      .map((p) => ({
        number: p.number,
        title: p.title,
        state: p.merged_at ? "merged" : p.state,
        url: p.html_url,
      })),
  };

  const result = collectRepositoryFromFixture(
    fixture,
    candidateUsername,
    selectedReason
  );
  writeArtifactCache(cacheKey, result);
  return result;
}
