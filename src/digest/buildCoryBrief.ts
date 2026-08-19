import type { CandidateAssessmentRecord } from "../assessment/types.js";

const JUNK_TITLE =
  /^(page redirection|terms of service|privacy policy|medium privacy policy|work at medium|home|index|untitled)\b/i;

export type DigestWorkLink = {
  artifact_id: string;
  title: string;
  url: string;
  kind: string;
};

export type DigestProfileLinks = {
  linkedin?: string;
  github?: string;
  website?: string;
  blog?: string;
};

function isHttpUrl(raw: string | undefined): raw is string {
  if (!raw?.trim()) return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isLinkedInUrl(url: string): boolean {
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isGithubUrl(url: string): boolean {
  try {
    return /(^|\.)github\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Prefer real profile URLs; fold misfiled LinkedIn/GitHub website fields. */
export function resolveProfileLinks(
  record: CandidateAssessmentRecord
): DigestProfileLinks {
  const src = record.source_candidate;
  const username = record.identity.github_username ?? src.github_username;
  let linkedin = isHttpUrl(src.linkedin_url) ? src.linkedin_url.trim() : undefined;
  let github = isHttpUrl(src.github_url) ? src.github_url.trim() : undefined;
  let website = isHttpUrl(src.website_url) ? src.website_url.trim() : undefined;
  let blog = isHttpUrl(src.blog_url) ? src.blog_url.trim() : undefined;

  if (!github && username) {
    github = `https://github.com/${username}`;
  }

  for (const field of [website, blog]) {
    if (!field) continue;
    if (!linkedin && isLinkedInUrl(field)) linkedin = field;
    if (!github && isGithubUrl(field)) github = field;
  }

  if (website && (isLinkedInUrl(website) || isGithubUrl(website))) {
    website = undefined;
  }
  if (blog && (isLinkedInUrl(blog) || isGithubUrl(blog))) {
    blog = undefined;
  }
  // Drop LinkedIn login interstitial URLs
  if (linkedin && /\/uas\/login/i.test(linkedin)) linkedin = undefined;

  return { linkedin, github, website, blog };
}

export function selectNamedWorks(
  record: CandidateAssessmentRecord,
  limit = 4
): DigestWorkLink[] {
  const refs = record.artifacts.references ?? [];
  const scored = refs
    .filter((r) => isHttpUrl(r.canonical_url) && r.title?.trim())
    .filter((r) => !JUNK_TITLE.test(r.title.trim()))
    .map((r) => {
      let rank = 0;
      if (r.kind === "github_repository") rank += 3;
      if (r.kind === "technical_article") rank += 2;
      if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(r.title)) rank += 1;
      return { r, rank };
    })
    .sort((a, b) => b.rank - a.rank);

  const out: DigestWorkLink[] = [];
  const seen = new Set<string>();
  for (const { r } of scored) {
    const key = r.canonical_url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      artifact_id: r.artifact_id,
      title: r.title.trim(),
      url: r.canonical_url.trim(),
      kind: r.kind,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function firstSentence(text: string | undefined, max = 220): string | undefined {
  if (!text?.trim()) return undefined;
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^(.{40,400}?[.!?])(\s|$)/);
  const sentence = (m?.[1] ?? cleaned).slice(0, max).trim();
  return sentence.endsWith(".") || sentence.endsWith("!") || sentence.endsWith("?")
    ? sentence
    : `${sentence}.`;
}

function formatWorkList(works: DigestWorkLink[]): string {
  if (!works.length) return "the assessed public artifacts";
  if (works.length === 1) return `"${works[0]!.title}"`;
  if (works.length === 2) {
    return `"${works[0]!.title}" and "${works[1]!.title}"`;
  }
  const head = works
    .slice(0, -1)
    .map((w) => `"${w.title}"`)
    .join(", ");
  return `${head}, and "${works[works.length - 1]!.title}"`;
}

/**
 * Cory-facing brief: a few sentences naming specific repos/articles.
 * Built from persisted assessment fields — no extra LLM call.
 */
export function buildCoryBrief(record: CandidateAssessmentRecord): {
  claim: string;
  rationale: string;
  evidence_ids: string[];
  works: DigestWorkLink[];
  cory_relevance?: string;
  cory_reasons: string[];
} {
  const works = selectNamedWorks(record);
  const tech = record.judge_results.technical;
  const writing = record.judge_results.writing;
  const cory = record.judge_results.cory;
  const priority = record.synthesis.priority_score;
  const name = record.source_candidate.name;

  // Lead with what the person is actually doing — the judge's own opening
  // sentences — and keep scores/labels out of the prose entirely (the digest
  // card and structured fields already carry the numbers).
  const techBit = firstSentence(tech?.summary, 320);
  const writingBit =
    writing &&
    writing.overall_writing_depth !== "insufficient_public_evidence"
      ? firstSentence(writing.summary, 260)
      : undefined;

  const workClause = formatWorkList(works);
  const parts: string[] = [];

  if (techBit) parts.push(techBit);
  if (writingBit) parts.push(writingBit);
  if (!parts.length) {
    parts.push(
      `${name} surfaced through the collaboration graph; the inspectable evidence is thin, so treat this as a lead rather than a verdict.`
    );
  }
  parts.push(`Start with ${workClause}.`);
  const reason = cory?.reasons?.[0];
  if (reason && /[a-z]/i.test(reason)) {
    parts.push(firstSentence(reason, 220)!);
  }

  const evidence_ids = [
    ...(record.synthesis.strongest_evidence_ids ?? []),
    ...(tech?.strongest_evidence_ids ?? []),
    ...(writing?.strongest_evidence_ids ?? []),
  ].filter((id, i, arr) => arr.indexOf(id) === i);

  return {
    claim:
      record.synthesis.primary_strength ||
      `${name}: assessed from public work`,
    rationale: parts.join(" ").slice(0, 900),
    evidence_ids: evidence_ids.slice(0, 6),
    works,
    cory_relevance: cory?.relevance,
    cory_reasons: cory?.reasons?.slice(0, 3) ?? [],
  };
}
