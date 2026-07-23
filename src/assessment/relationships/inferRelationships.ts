import crypto from "crypto";
import type { ArtifactRelationship, ArtifactUrlRef } from "./types.js";

function makeRelationshipId(
  source: string,
  target: string,
  type: string
): string {
  return `rel_${crypto
    .createHash("sha1")
    .update(`inferred:${source}:${target}:${type}`)
    .digest("hex")
    .slice(0, 12)}`;
}

/**
 * Weak inferred relationships (always deterministic:false).
 * Heuristic: shared hostname path tokens / overlapping title keywords.
 */
export function inferRelationships(
  artifacts: ArtifactUrlRef[],
  existing?: ArtifactRelationship[],
  opts?: { maxInferred?: number }
): ArtifactRelationship[] {
  const max = opts?.maxInferred ?? 20;
  const existingPairs = new Set(
    (existing ?? []).map(
      (r) => `${r.source_artifact_id}:${r.target_artifact_id}`
    )
  );

  const out: ArtifactRelationship[] = [];

  for (let i = 0; i < artifacts.length && out.length < max; i++) {
    for (let j = i + 1; j < artifacts.length && out.length < max; j++) {
      const a = artifacts[i];
      const b = artifacts[j];
      const pair = `${a.artifact_id}:${b.artifact_id}`;
      const rev = `${b.artifact_id}:${a.artifact_id}`;
      if (existingPairs.has(pair) || existingPairs.has(rev)) continue;

      const score = weakOverlapScore(a, b);
      if (score < 2) continue;

      out.push({
        relationship_id: makeRelationshipId(
          a.artifact_id,
          b.artifact_id,
          "inferred_connection"
        ),
        source_artifact_id: a.artifact_id,
        target_artifact_id: b.artifact_id,
        relationship_type: "inferred_connection",
        deterministic: false,
        confidence_support: score >= 4 ? "moderate" : "low",
        evidence_ids: [],
        explanation:
          "Weak lexical/URL overlap; not a deterministic link.",
      });
      existingPairs.add(pair);
    }
  }

  return out;
}

/** Pure helper for tests / scoring. */
export function weakOverlapScore(a: ArtifactUrlRef, b: ArtifactUrlRef): number {
  let score = 0;
  const tokensA = tokensOf(a);
  const tokensB = tokensOf(b);
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared++;
  score += shared;

  try {
    const ha = new URL(a.canonical_url).hostname.replace(/^www\./, "");
    const hb = new URL(b.canonical_url).hostname.replace(/^www\./, "");
    if (ha && hb && ha === hb) score += 1;
  } catch {
    // ignore
  }
  return score;
}

function tokensOf(a: ArtifactUrlRef): Set<string> {
  const text = `${a.canonical_url} ${a.text ?? ""}`.toLowerCase();
  return new Set(
    text
      .replace(/https?:\/\//g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4)
  );
}
