import crypto from "crypto";
import type { EvidenceItem, EvidenceStrength } from "../types.js";

export function makeEvidenceId(
  artifactId: string,
  sourceType: string,
  salt: string
): string {
  const h = crypto
    .createHash("sha1")
    .update(`${artifactId}:${sourceType}:${salt}`)
    .digest("hex")
    .slice(0, 12);
  return `ev_${h}`;
}

export class EvidenceStore {
  private items: EvidenceItem[] = [];

  add(item: EvidenceItem): EvidenceItem {
    this.items.push(item);
    return item;
  }

  addMany(items: EvidenceItem[]): void {
    this.items.push(...items);
  }

  all(): EvidenceItem[] {
    return [...this.items];
  }

  byArtifact(artifactId: string): EvidenceItem[] {
    return this.items.filter((e) => e.artifact_id === artifactId);
  }

  create(input: {
    artifact_id: string;
    source_type: EvidenceItem["source_type"];
    source_url: string;
    observation: string;
    supports_claim: string;
    strength: EvidenceStrength;
    candidate_ownership_confidence: number;
    location?: EvidenceItem["location"];
    salt?: string;
  }): EvidenceItem {
    const evidence_id = makeEvidenceId(
      input.artifact_id,
      input.source_type,
      input.salt ?? input.observation.slice(0, 80)
    );
    const item: EvidenceItem = {
      evidence_id,
      artifact_id: input.artifact_id,
      source_type: input.source_type,
      source_url: input.source_url,
      location: input.location,
      observation: input.observation,
      supports_claim: input.supports_claim,
      strength: input.strength,
      candidate_ownership_confidence: input.candidate_ownership_confidence,
    };
    this.items.push(item);
    return item;
  }
}
