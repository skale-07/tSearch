export interface SeedQuery {
  name: string;
  country?: string;
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
      const obj = entry as { name: string; country?: string };
      return {
        name: String(obj.name).trim(),
        country: obj.country?.trim() || undefined,
      };
    }
    throw new Error("Each seed must be a string or { name, country? } object");
  });
}
