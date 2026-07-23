/** PR evidence helpers (Phase D). */
export interface PullRequestEvidence {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  url: string;
  files?: string[];
}

export function filterCandidatePulls<T extends { userLogin?: string }>(
  pulls: T[],
  canonicalLogin: string
): T[] {
  const want = canonicalLogin.toLowerCase();
  return pulls.filter((p) => p.userLogin?.toLowerCase() === want);
}
