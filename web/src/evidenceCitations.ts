export type CitationArtifactRef = {
  artifact_id: string;
  kind?: string;
  title: string;
  canonical_url: string;
};

export type CitationEvidence = {
  evidence_id: string;
  artifact_id: string;
  source_type?: string;
  source_url: string;
  location?: {
    file_path?: string;
    heading?: string;
    section?: string;
    commit_sha?: string;
  };
  observation?: string;
};

export type AssessmentArtifacts = {
  references?: CitationArtifactRef[];
  evidence?: CitationEvidence[];
  github_repositories?: Record<string, { full_name?: string; name?: string }>;
  blog_articles?: Record<string, { title?: string; canonical_url?: string }>;
};

export type WorkCitation = {
  key: string;
  label: string;
  href: string;
  kind?: string;
};

export type EvidenceCitation = {
  evidence_id: string;
  label: string;
  href: string;
  artifact_title?: string;
};

function kindLabel(kind?: string): string | undefined {
  if (!kind) return undefined;
  if (kind === "github_repository") return "repo";
  if (kind === "technical_article") return "article";
  return kind.replace(/_/g, " ");
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function titleForArtifact(
  artifactId: string,
  artifacts: AssessmentArtifacts | undefined
): string | undefined {
  const ref = artifacts?.references?.find((r) => r.artifact_id === artifactId);
  if (ref?.title?.trim()) return ref.title.trim();
  const repo = artifacts?.github_repositories?.[artifactId];
  if (repo?.full_name) return repo.full_name;
  if (repo?.name) return repo.name;
  const article = artifacts?.blog_articles?.[artifactId];
  if (article?.title?.trim()) return article.title.trim();
  return undefined;
}

function hrefForArtifact(
  artifactId: string,
  artifacts: AssessmentArtifacts | undefined
): string | undefined {
  const ref = artifacts?.references?.find((r) => r.artifact_id === artifactId);
  if (ref?.canonical_url?.trim()) return ref.canonical_url.trim();
  const article = artifacts?.blog_articles?.[artifactId];
  if (article?.canonical_url?.trim()) return article.canonical_url.trim();
  const repo = artifacts?.github_repositories?.[artifactId];
  if (repo?.full_name) return `https://github.com/${repo.full_name}`;
  return undefined;
}

/** Named links for assessed projects / articles. */
export function workCitations(
  artifacts: AssessmentArtifacts | undefined,
  artifactIds?: string[]
): WorkCitation[] {
  const refs = artifacts?.references ?? [];
  const wanted = artifactIds?.length
    ? new Set(artifactIds)
    : null;
  const fromRefs = refs
    .filter((r) => r.canonical_url && r.title)
    .filter((r) => !wanted || wanted.has(r.artifact_id))
    .map((r) => ({
      key: r.artifact_id,
      label: r.title,
      href: r.canonical_url,
      kind: kindLabel(r.kind),
    }));
  if (fromRefs.length || !wanted) return dedupeByHref(fromRefs);

  // Fallback when references missing but ids known
  const fallback: WorkCitation[] = [];
  for (const id of wanted) {
    const title = titleForArtifact(id, artifacts);
    const href = hrefForArtifact(id, artifacts);
    if (title && href) {
      fallback.push({ key: id, label: title, href });
    }
  }
  return dedupeByHref(fallback);
}

function dedupeByHref(items: WorkCitation[]): WorkCitation[] {
  const seen = new Set<string>();
  const out: WorkCitation[] = [];
  for (const item of items) {
    const k = item.href.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function resolveEvidenceCitations(
  evidenceIds: string[] | undefined,
  artifacts: AssessmentArtifacts | undefined
): EvidenceCitation[] {
  if (!evidenceIds?.length || !artifacts?.evidence?.length) return [];
  const byId = new Map(
    artifacts.evidence.map((e) => [e.evidence_id, e] as const)
  );
  const out: EvidenceCitation[] = [];
  const seen = new Set<string>();
  for (const id of evidenceIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const ev = byId.get(id);
    if (!ev?.source_url) continue;
    const artifactTitle = titleForArtifact(ev.artifact_id, artifacts);
    const parts: string[] = [];
    if (artifactTitle) parts.push(artifactTitle);
    const loc =
      ev.location?.file_path ||
      ev.location?.heading ||
      ev.location?.section ||
      (ev.location?.commit_sha
        ? `commit ${ev.location.commit_sha.slice(0, 7)}`
        : undefined);
    if (loc) {
      parts.push(
        ev.location?.file_path ? shortPath(ev.location.file_path) : loc
      );
    } else if (!artifactTitle) {
      parts.push(ev.source_type?.replace(/_/g, " ") || "evidence");
    }
    out.push({
      evidence_id: id,
      label: parts.join(" · "),
      href: ev.source_url,
      artifact_title: artifactTitle,
    });
  }
  return out;
}

/** Unique works implied by evidence ids (for “projects cited” chips). */
export function worksFromEvidenceIds(
  evidenceIds: string[] | undefined,
  artifacts: AssessmentArtifacts | undefined
): WorkCitation[] {
  if (!evidenceIds?.length || !artifacts?.evidence?.length) return [];
  const byId = new Map(
    artifacts.evidence.map((e) => [e.evidence_id, e] as const)
  );
  const artifactIds: string[] = [];
  const seen = new Set<string>();
  for (const id of evidenceIds) {
    const art = byId.get(id)?.artifact_id;
    if (!art || seen.has(art)) continue;
    seen.add(art);
    artifactIds.push(art);
  }
  return workCitations(artifacts, artifactIds);
}
