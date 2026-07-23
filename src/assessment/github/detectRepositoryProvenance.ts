/** Deterministic provenance flags for originality gating. */
export interface RepositoryProvenanceFlags {
  fork: boolean;
  template: boolean;
  known_tutorial_structure: boolean;
  generated_paths: string[];
  vendored_paths: string[];
  framework_scaffold: boolean;
}

export function detectRepositoryProvenance(input: {
  is_fork?: boolean;
  is_template?: boolean;
  name: string;
  description?: string | null;
  tree_paths: string[];
}): RepositoryProvenanceFlags {
  const blob = `${input.name} ${input.description ?? ""}`.toLowerCase();
  const generated = input.tree_paths.filter((p) =>
    /(^|\/)(generated|gen\/|\.pb\.|__generated__)/i.test(p)
  );
  const vendored = input.tree_paths.filter((p) =>
    /(^|\/)(vendor|third_party|node_modules)(\/|$)/i.test(p)
  );
  return {
    fork: !!input.is_fork,
    template: !!input.is_template,
    known_tutorial_structure:
      /tutorial|homework|assignment|course-|starter|boilerplate/.test(blob),
    generated_paths: generated.slice(0, 20),
    vendored_paths: vendored.slice(0, 20),
    framework_scaffold: /create-react-app|next-app|rails new/i.test(blob),
  };
}
