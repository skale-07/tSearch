/** Bounded commit evidence helpers (Phase D expansion point). */
export interface CommitFileChange {
  sha: string;
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
}

export function intersectCentralChanges(
  changedFiles: string[],
  centralPaths: string[]
): string[] {
  const central = new Set(centralPaths);
  return [...new Set(changedFiles.filter((f) => central.has(f)))];
}
