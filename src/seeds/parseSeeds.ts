export interface SeedQuery {
  name: string;
  country?: string;
  /** Registry award_id — LinkedIn search uses the award name, not country. */
  award_id?: string;
  /** Short org / lab token for LinkedIn people search (not a legal name). */
  org_hint?: string;
}

export function parseSeeds(raw: unknown): SeedQuery[] {
  if (!Array.isArray(raw)) {
    throw new Error("seeds.json must be a JSON array");
  }
  return raw.map((entry) => {
    if (typeof entry === "string") {
      return { name: entry.trim() };
    }
    if (entry && typeof entry === "object" && "name" in entry) {
      const obj = entry as {
        name: string;
        country?: string;
        award_id?: string;
        org_hint?: string;
      };
      return {
        name: String(obj.name).trim(),
        country: obj.country?.trim() || undefined,
        award_id: obj.award_id?.trim() || undefined,
        org_hint: obj.org_hint?.trim() || undefined,
      };
    }
    throw new Error(
      "Each seed must be a string or { name, country?, award_id? } object"
    );
  });
}
