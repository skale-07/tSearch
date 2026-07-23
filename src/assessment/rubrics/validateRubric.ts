import { z } from "zod";
import { parseWithSchema } from "../schemas.js";
import type {
  LoadedRubricBundle,
  RubricBundleDefinition,
  RubricDefinition,
} from "./types.js";

const sourceNoteStatusSchema = z.enum([
  "empirically_supported",
  "platform_constraint",
  "provisional_product_rule",
  "requires_calibration",
]);

const rubricScoreSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const rubricAnchorSchema = z.object({
  score: rubricScoreSchema,
  description: z.string().min(1),
});

const rubricDimensionSchema = z.object({
  dimension_id: z.string().min(1),
  description: z.string().min(1),
  applicable_artifacts: z.array(z.string().min(1)).min(1),
  anchors: z.array(rubricAnchorSchema).min(1),
  strong_evidence_examples: z.array(z.string().min(1)).min(1),
  weak_evidence_examples: z.array(z.string().min(1)).min(1),
  counterevidence_examples: z.array(z.string().min(1)).min(1),
  prohibited_shortcuts: z.array(z.string().min(1)).min(1),
});

export const rubricDefinitionSchema = z.object({
  rubric_id: z.string().min(1),
  version: z.string().min(1),
  construct: z.string().min(1),
  description: z.string().min(1),
  dimensions: z.array(rubricDimensionSchema).min(1),
  prohibited_inferences: z.array(z.string().min(1)).min(1),
  confidence_caps: z
    .array(
      z.object({
        rule: z.string().min(1),
        max_confidence: z.number().min(0).max(1),
      })
    )
    .min(1),
  abstention_rules: z
    .array(
      z.object({
        condition: z.string().min(1),
        action: z.string().min(1),
      })
    )
    .min(1),
  evidence_requirements: z
    .array(
      z.object({
        when: z.string().min(1),
        require: z.string().min(1),
      })
    )
    .min(1),
  source_notes: z
    .array(
      z.object({
        statement: z.string().min(1),
        status: sourceNoteStatusSchema,
      })
    )
    .min(1),
});

export const rubricBundleDefinitionSchema = z.object({
  bundle_id: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1).optional(),
  rubrics: z
    .array(
      z.object({
        rubric_id: z.string().min(1),
        version: z.string().min(1),
        file: z.string().min(1),
      })
    )
    .min(1),
});

const REQUIRED_ANCHOR_SCORES = [0, 1, 3, 5] as const;

function assertRequiredAnchors(rubric: RubricDefinition, label: string): void {
  for (const dim of rubric.dimensions) {
    const scores = new Set(dim.anchors.map((a) => a.score));
    for (const required of REQUIRED_ANCHOR_SCORES) {
      if (!scores.has(required)) {
        throw new Error(
          `Schema validation failed (${label}): dimension ${dim.dimension_id} missing anchor score ${required}`
        );
      }
    }
  }
}

export function validateRubric(
  value: unknown,
  label = "rubric"
): RubricDefinition {
  const rubric = parseWithSchema(rubricDefinitionSchema, value, label);
  assertRequiredAnchors(rubric, label);
  return rubric;
}

export function validateRubricBundle(
  value: unknown,
  label = "rubric-bundle"
): RubricBundleDefinition {
  return parseWithSchema(rubricBundleDefinitionSchema, value, label);
}

export function assertRubricVersionsMatchBundle(
  bundle: RubricBundleDefinition,
  rubrics: RubricDefinition[]
): void {
  if (bundle.rubrics.length !== rubrics.length) {
    throw new Error(
      `Rubric bundle ${bundle.bundle_id}: expected ${bundle.rubrics.length} rubrics, loaded ${rubrics.length}`
    );
  }

  for (let i = 0; i < bundle.rubrics.length; i++) {
    const entry = bundle.rubrics[i]!;
    const rubric = rubrics[i]!;
    if (rubric.rubric_id !== entry.rubric_id) {
      throw new Error(
        `Rubric bundle ${bundle.bundle_id}: entry ${entry.file} has rubric_id ${rubric.rubric_id}, expected ${entry.rubric_id}`
      );
    }
    if (rubric.version !== entry.version) {
      throw new Error(
        `Rubric bundle ${bundle.bundle_id}: entry ${entry.file} has version ${rubric.version}, expected ${entry.version}`
      );
    }
  }
}

export type { LoadedRubricBundle, RubricBundleDefinition, RubricDefinition };
