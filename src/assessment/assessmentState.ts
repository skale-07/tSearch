import crypto from "crypto";
import type {
  AssessmentError,
  CandidateAssessmentStage,
  CandidateAssessmentStatus,
  CandidateJudgeStatuses,
  JudgeExecutionState,
  JudgeExecutionStatus,
  SynthesisExecutionState,
} from "./types.js";

export function emptyJudgeState(
  status: JudgeExecutionStatus = "pending"
): JudgeExecutionState {
  return {
    status,
    attempt_count: 0,
    error_ids: [],
  };
}

export function initialJudgeStatuses(input: {
  hasGithub: boolean;
  hasWritingSurface: boolean;
}): CandidateJudgeStatuses {
  return {
    technical: emptyJudgeState(input.hasGithub ? "pending" : "not_applicable"),
    writing: emptyJudgeState(
      input.hasWritingSurface ? "pending" : "not_applicable"
    ),
    cross_artifact: emptyJudgeState("pending"),
    cory: emptyJudgeState("pending"),
  };
}

export function markJudgeRunning(
  state: JudgeExecutionState
): JudgeExecutionState {
  return {
    ...state,
    status: "running",
    started_at: new Date().toISOString(),
    attempt_count: state.attempt_count + 1,
  };
}

export function markJudgeTerminal(
  state: JudgeExecutionState,
  status: Exclude<JudgeExecutionStatus, "pending" | "running">,
  errorId?: string
): JudgeExecutionState {
  return {
    ...state,
    status,
    completed_at: new Date().toISOString(),
    error_ids: errorId
      ? [...state.error_ids, errorId]
      : state.error_ids,
  };
}

export function initialSynthesisState(): SynthesisExecutionState {
  return {
    status: "pending",
    valid_for_ranking: false,
    fallback_used: false,
  };
}

export function synthesisCompleted(input: {
  valid_for_ranking: boolean;
  fallback_used: boolean;
  partial?: boolean;
}): SynthesisExecutionState {
  return {
    status: input.partial ? "partial" : "completed",
    valid_for_ranking: input.valid_for_ranking,
    fallback_used: input.fallback_used,
    completed_at: new Date().toISOString(),
  };
}

export function makeErrorId(): string {
  return `err_${crypto.randomBytes(4).toString("hex")}`;
}

export function makeAssessmentError(
  partial: Omit<AssessmentError, "id" | "occurred_at"> & {
    id?: string;
    occurred_at?: string;
  }
): AssessmentError {
  return {
    id: partial.id ?? makeErrorId(),
    stage: partial.stage,
    code: partial.code,
    message: partial.message,
    technical_details: partial.technical_details,
    retryable: partial.retryable,
    judge: partial.judge,
    attempt_count: partial.attempt_count,
    candidate_id: partial.candidate_id,
    occurred_at: partial.occurred_at ?? new Date().toISOString(),
  };
}

/** Map raw Zod / schema dumps into UI-safe message + technical_details. */
export function splitJudgeError(err: unknown): {
  message: string;
  technical_details?: string;
  code: string;
} {
  const raw = err instanceof Error ? err.message : String(err);
  const isSchema =
    /schema validation failed|zod|expected array|received object|dimension_id|invalid_type|invalid input/i.test(
      raw
    );
  if (isSchema) {
    return {
      code: "JUDGE_SCHEMA_INVALID",
      message:
        "Technical judge returned an invalid response after retries.",
      technical_details: raw,
    };
  }
  if (/rate limit/i.test(raw)) {
    return {
      code: "GITHUB_RATE_LIMIT",
      message: "GitHub rate limit interrupted collection.",
      technical_details: raw,
    };
  }
  return {
    code: "ASSESSMENT_FAILED",
    message: "Assessment stage failed.",
    technical_details: raw,
  };
}

export function humanHighlightForJudgeFailure(
  judge: "technical" | "writing" | "cross_artifact" | "cory"
): string {
  switch (judge) {
    case "technical":
      return "Technical judging failed.";
    case "writing":
      return "Writing judging failed.";
    case "cross_artifact":
      return "Cross-artifact judging failed.";
    case "cory":
      return "Cory relevance judging failed.";
  }
}

export function deriveTerminalCandidateStatus(input: {
  insufficientContext?: boolean;
  errors: AssessmentError[];
  judge_statuses: CandidateJudgeStatuses;
}): CandidateAssessmentStatus {
  if (input.insufficientContext) return "insufficient_context";
  const statuses = Object.values(input.judge_statuses).map((j) => j.status);
  const anyFailed = statuses.includes("failed") || input.errors.length > 0;
  const anyCompleted = statuses.some(
    (s) => s === "completed" || s === "abstained"
  );
  if (anyFailed && anyCompleted) return "partial";
  if (anyFailed && !anyCompleted) return "failed";
  return "completed";
}

export function isTerminalCandidateStatus(
  status: CandidateAssessmentStatus
): boolean {
  return (
    status === "completed" ||
    status === "partial" ||
    status === "failed" ||
    status === "insufficient_context"
  );
}

export function isTerminalRunStatus(status: string): boolean {
  return (
    status === "completed" ||
    status === "completed_with_errors" ||
    status === "failed" ||
    status === "interrupted"
  );
}

export function normalizeRunStatus(
  status: string
): Exclude<import("./types.js").AssessmentRunStatus, "pending"> | "queued" {
  if (status === "pending") return "queued";
  return status as Exclude<
    import("./types.js").AssessmentRunStatus,
    "pending"
  >;
}

export function stageLabel(stage: CandidateAssessmentStage): string {
  switch (stage) {
    case "pending":
      return "Pending";
    case "collecting":
      return "Collecting artifacts";
    case "judging_technical":
      return "Technical judge";
    case "judging_writing":
      return "Writing judge";
    case "linking_artifacts":
      return "Linking artifacts";
    case "judging_cross_artifact":
      return "Cross-artifact judge";
    case "judging_cory":
      return "Cory relevance";
    case "synthesizing":
      return "Synthesizing";
    case "done":
      return "Done";
  }
}
