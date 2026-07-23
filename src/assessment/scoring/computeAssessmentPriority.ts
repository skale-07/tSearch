import {
  PRIORITY_WEIGHTS,
  PRIORITY_WEIGHT_VERSION,
} from "../config.js";

export interface PriorityInput {
  technical?: number;
  research?: number;
  writing?: number;
  curiosity?: number;
  unusual_problem_selection?: number;
  persistence?: number;
  ownership?: number;
  evidence_completeness: number;
  /** 0-1 aggregate confidence */
  aggregate_confidence: number;
}

export interface PriorityResult {
  priority_score: number;
  weight_version: string;
  components: Record<string, number>;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

/** Domain scores are 0-10; normalize to 0-1 for weighting. */
function n10(v: number | undefined): number | undefined {
  if (v === undefined || Number.isNaN(v)) return undefined;
  return clamp01(v / 10);
}

export function computeAssessmentPriority(input: PriorityInput): PriorityResult {
  const domains = [
    n10(input.technical),
    n10(input.research),
    n10(input.writing),
  ].filter((x): x is number => x !== undefined);

  domains.sort((a, b) => b - a);
  const strongest = domains[0];
  const second = domains[1];

  const curiosity = n10(input.curiosity) ?? 0;
  const unusual = n10(input.unusual_problem_selection) ?? 0;
  const persistence = n10(input.persistence) ?? 0;
  const ownership = n10(input.ownership) ?? 0;
  const completeness = clamp01(input.evidence_completeness);

  const W = {
    strongest_domain: PRIORITY_WEIGHTS.strongest_domain as number,
    second_domain: PRIORITY_WEIGHTS.second_domain as number,
    curiosity: PRIORITY_WEIGHTS.curiosity as number,
    unusual_problem_selection: PRIORITY_WEIGHTS.unusual_problem_selection as number,
    persistence: PRIORITY_WEIGHTS.persistence as number,
    ownership: PRIORITY_WEIGHTS.ownership as number,
    evidence_completeness: PRIORITY_WEIGHTS.evidence_completeness as number,
  };
  let wStrong = W.strongest_domain;
  let wSecond = W.second_domain;
  let wCur = W.curiosity;
  let wUnu = W.unusual_problem_selection;
  let wPer = W.persistence;
  let wOwn = W.ownership;
  let wComp = W.evidence_completeness;

  if (strongest === undefined) {
    // No domain scores — fall back to non-domain signals only
    wStrong = 0;
    wSecond = 0;
    const rest = wCur + wUnu + wPer + wOwn + wComp;
    const scale = rest > 0 ? 1 / rest : 1;
    wCur *= scale;
    wUnu *= scale;
    wPer *= scale;
    wOwn *= scale;
    wComp *= scale;
  } else if (second === undefined) {
    // Redistribute second-domain weight across curiosity/persistence/ownership/completeness
    const share = wSecond / 4;
    wSecond = 0;
    wCur += share;
    wPer += share;
    wOwn += share;
    wComp += share;
  }

  const base =
    (strongest !== undefined ? wStrong * strongest : 0) +
    (second !== undefined ? wSecond * second : 0) +
    wCur * curiosity +
    wUnu * unusual +
    wPer * persistence +
    wOwn * ownership +
    wComp * completeness;

  const conf = clamp01(input.aggregate_confidence);
  const adjusted = base * (0.75 + 0.25 * conf);
  // base is already ~0-1; scale to 0-100
  const priority_score = clamp100(adjusted * 100);

  return {
    priority_score,
    weight_version: PRIORITY_WEIGHT_VERSION,
    components: {
      strongest: strongest ?? 0,
      second: second ?? 0,
      curiosity,
      unusual,
      persistence,
      ownership,
      completeness,
      aggregate_confidence: conf,
      base,
      adjusted,
    },
  };
}
