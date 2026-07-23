/**
 * Coerce common LLM shape mistakes into Zod-friendly payloads
 * before schema validation (especially dimensions keyed by id).
 */
export function normalizeLlmPayload(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const obj = { ...(raw as Record<string, unknown>) };
  if ("dimensions" in obj) {
    obj.dimensions = normalizeDimensions(obj.dimensions);
  }
  return obj;
}

function normalizeDimensions(dimensions: unknown): unknown {
  if (Array.isArray(dimensions)) {
    return dimensions.map((entry) => normalizeDimensionEntry(entry));
  }
  if (dimensions && typeof dimensions === "object") {
    return Object.entries(dimensions as Record<string, unknown>).map(
      ([key, value]) => normalizeDimensionEntry(value, key)
    );
  }
  return dimensions;
}

function normalizeDimensionEntry(value: unknown, keyHint?: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const dim = { ...(value as Record<string, unknown>) };
  if (typeof dim.dimension_id !== "string" || !dim.dimension_id) {
    if (typeof dim.dimension === "string" && dim.dimension) {
      dim.dimension_id = dim.dimension;
    } else if (keyHint) {
      dim.dimension_id = keyHint;
    }
  }
  if (!Array.isArray(dim.supporting_evidence_ids)) {
    dim.supporting_evidence_ids = [];
  }
  if (!Array.isArray(dim.counterevidence_ids)) {
    dim.counterevidence_ids = [];
  }
  if (!Array.isArray(dim.missing_information)) {
    dim.missing_information = [];
  }
  return dim;
}
