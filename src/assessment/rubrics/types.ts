export type SourceNoteStatus =
  | "empirically_supported"
  | "platform_constraint"
  | "provisional_product_rule"
  | "requires_calibration";

export type RubricScore = 0 | 1 | 2 | 3 | 4 | 5;

export interface RubricAnchor {
  score: RubricScore;
  description: string;
}

export interface RubricDimension {
  dimension_id: string;
  description: string;
  applicable_artifacts: string[];
  anchors: RubricAnchor[];
  strong_evidence_examples: string[];
  weak_evidence_examples: string[];
  counterevidence_examples: string[];
  prohibited_shortcuts: string[];
}

export interface ConfidenceCapRule {
  rule: string;
  max_confidence: number;
}

export interface AbstentionRule {
  condition: string;
  action: string;
}

export interface EvidenceRequirement {
  when: string;
  require: string;
}

export interface SourceNote {
  statement: string;
  status: SourceNoteStatus;
}

export interface RubricDefinition {
  rubric_id: string;
  version: string;
  construct: string;
  description: string;
  dimensions: RubricDimension[];
  prohibited_inferences: string[];
  confidence_caps: ConfidenceCapRule[];
  abstention_rules: AbstentionRule[];
  evidence_requirements: EvidenceRequirement[];
  source_notes: SourceNote[];
}

export interface RubricBundleEntry {
  rubric_id: string;
  version: string;
  file: string;
}

export interface RubricBundleDefinition {
  bundle_id: string;
  version: string;
  description?: string;
  rubrics: RubricBundleEntry[];
}

export interface LoadedRubricBundle {
  bundle_id: string;
  version: string;
  rubrics: RubricDefinition[];
  file_hashes: Record<string, string>;
}
