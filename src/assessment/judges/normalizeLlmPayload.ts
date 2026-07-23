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
  // Top-level evidence arrays often omitted by models
  for (const key of [
    "strongest_evidence_ids",
    "counterevidence_ids",
    "unsupported_or_unverifiable_claims",
    "missing_information",
  ] as const) {
    if (key in obj && !Array.isArray(obj[key])) {
      obj[key] = [];
    }
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

  // Live models often return score + not_applicable together — Zod rejects that.
  const applicability = dim.applicability;
  if (
    applicability === "not_applicable" ||
    applicability === "insufficient_evidence"
  ) {
    dim.score = null;
  } else if (applicability === "applicable" && dim.score === null) {
    dim.applicability = "insufficient_evidence";
  } else if (
    (applicability === undefined || applicability === null) &&
    dim.score === null
  ) {
    dim.applicability = "insufficient_evidence";
  } else if (
    (applicability === undefined || applicability === null) &&
    typeof dim.score === "number"
  ) {
    dim.applicability = "applicable";
  }

  return dim;
}

/**
 * Post-Zod coercion before evidence validation: demote scored dims that lack
 * usable evidence IDs instead of failing the whole judge.
 */
export function coerceScoredDimensionsForEvidence<
  T extends {
    dimensions: Array<{
      dimension_id: string;
      score: number | null;
      applicability: string;
      rationale: string;
      supporting_evidence_ids: string[];
      counterevidence_ids: string[];
      missing_information: string[];
    }>;
    strongest_evidence_ids?: string[];
  },
>(
  value: T,
  allowedEvidenceIds: Set<string>,
  evidenceStrength?: Map<string, string>
): T {
  const fallbackIds = (value.strongest_evidence_ids ?? []).filter((id) =>
    allowedEvidenceIds.has(id)
  );

  const dimensions = value.dimensions.map((dim) => {
    const next = {
      ...dim,
      supporting_evidence_ids: dim.supporting_evidence_ids.filter((id) =>
        allowedEvidenceIds.has(id)
      ),
      counterevidence_ids: dim.counterevidence_ids.filter((id) =>
        allowedEvidenceIds.has(id)
      ),
    };

    if (
      next.applicability !== "applicable" ||
      next.score === null ||
      next.score <= 0
    ) {
      if (next.applicability !== "applicable") next.score = null;
      return next;
    }

    if (next.supporting_evidence_ids.length === 0 && fallbackIds.length) {
      next.supporting_evidence_ids = fallbackIds.slice(0, 2);
    }

    if (next.supporting_evidence_ids.length === 0) {
      return {
        ...next,
        score: null,
        applicability: "insufficient_evidence",
        missing_information: [
          ...next.missing_information,
          "No supporting evidence IDs were provided for this score.",
        ],
      };
    }

    // Score 5 requires strong evidence — demote rather than fail closed
    if (next.score >= 5 && evidenceStrength) {
      const hasStrong = next.supporting_evidence_ids.some(
        (id) => evidenceStrength.get(id) === "strong"
      );
      if (!hasStrong) {
        next.score = 4;
      }
    }

    return next;
  });

  return { ...value, dimensions };
}
