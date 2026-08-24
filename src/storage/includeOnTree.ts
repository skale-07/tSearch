import { MIN_TREE_CONTEXT_SCORE } from "../config.js";
import type { ProfileRecord } from "./profileStore.js";

/** Logins that pollute hop graphs but aren't GitHub Apps/bots. */
const TREE_EXCLUDED_LOGINS = new Set([
  "idouble", // "Alp ₿📈🚀🌕" — crypto-spam persona, appears under many seeds
  "standardgalactic", // "Cogito Ergo Sum" — spam/agent persona across trees
]);

export function isBotLogin(slug: string, name: string): boolean {
  const login = slug.toLowerCase();
  if (TREE_EXCLUDED_LOGINS.has(login)) return true;
  const s = `${slug} ${name}`.toLowerCase();
  return (
    /\[bot\]/.test(s) ||
    /(^|[\s_-])bot($|[\s_-])/.test(s) ||
    /dependabot|renovate|github-actions|actions-user|opencode-agent/.test(s)
  );
}

/**
 * Hop-1/2 visibility. Collaborators and operator-picked website neighbors
 * are already a graph edge — they skip the identity-surface floor.
 * Followers still need MIN_TREE_CONTEXT_SCORE (noisy otherwise).
 */
export function includeOnTree(
  p: Pick<ProfileRecord, "slug" | "name" | "relation" | "context_score"> & {
    github?: { context_score?: number } | undefined;
  },
  hop: 0 | 1 | 2
): boolean {
  if (hop === 0) return true;
  if (isBotLogin(p.slug, p.name)) return false;
  if (p.relation === "website" || p.relation === "collaborator") return true;
  const score = Number(p.context_score ?? p.github?.context_score ?? 0);
  return score >= MIN_TREE_CONTEXT_SCORE;
}
