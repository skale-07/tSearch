/** Releases / CODEOWNERS / workflows collection hooks (Phase D). */
export interface RepositoryOperationsSnapshot {
  has_codeowners: boolean;
  release_count: number;
  workflow_file_paths: string[];
}

export function emptyOperationsSnapshot(): RepositoryOperationsSnapshot {
  return {
    has_codeowners: false,
    release_count: 0,
    workflow_file_paths: [],
  };
}
