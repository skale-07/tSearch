import type { ArtifactRelationship } from "./types.js";
import { artifactRelationshipSchema } from "./schemas.js";

export class RelationshipValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelationshipValidationError";
  }
}

/**
 * Reject relationships that reference missing artifact ids or violate schema.
 * LLM/inferred connections must never be stored as deterministic.
 */
export function validateRelationships(
  relationships: ArtifactRelationship[],
  knownArtifactIds: Iterable<string>
): ArtifactRelationship[] {
  const known = new Set(knownArtifactIds);
  const valid: ArtifactRelationship[] = [];

  for (const rel of relationships) {
    const parsed = artifactRelationshipSchema.safeParse(rel);
    if (!parsed.success) {
      throw new RelationshipValidationError(
        `Invalid relationship ${rel.relationship_id}: ${parsed.error.issues
          .map((i) => i.message)
          .join("; ")}`
      );
    }
    if (!known.has(rel.source_artifact_id)) {
      throw new RelationshipValidationError(
        `Relationship ${rel.relationship_id}: missing source_artifact_id ${rel.source_artifact_id}`
      );
    }
    if (!known.has(rel.target_artifact_id)) {
      throw new RelationshipValidationError(
        `Relationship ${rel.relationship_id}: missing target_artifact_id ${rel.target_artifact_id}`
      );
    }
    if (rel.relationship_type === "inferred_connection" && rel.deterministic) {
      throw new RelationshipValidationError(
        `Relationship ${rel.relationship_id}: inferred_connection must have deterministic:false`
      );
    }
    valid.push(rel);
  }

  return valid;
}

/** Drop relationships with unknown ids instead of throwing. */
export function filterValidRelationships(
  relationships: ArtifactRelationship[],
  knownArtifactIds: Iterable<string>
): ArtifactRelationship[] {
  const known = new Set(knownArtifactIds);
  return relationships.filter(
    (r) =>
      known.has(r.source_artifact_id) && known.has(r.target_artifact_id)
  );
}
