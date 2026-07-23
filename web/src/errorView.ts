import type { AssessmentError } from "./api";

export interface AssessmentErrorView {
  stage: string;
  title: string;
  message: string;
  technical_details?: string;
  retryable: boolean;
}

const stageTitles: Record<string, string> = {
  collecting: "Artifact collection failed",
  technical: "Technical assessment failed",
  writing: "Writing assessment failed",
  relationships: "Artifact linking failed",
  cross_artifact: "Cross-artifact assessment failed",
  cory: "Cory relevance assessment failed",
  synthesis: "Assessment synthesis failed",
  persistence: "Assessment storage failed",
};

export function assessmentErrorView(error: AssessmentError): AssessmentErrorView {
  const title =
    error.code === "JUDGE_SCHEMA_INVALID"
      ? "Judge response was invalid"
      : stageTitles[error.stage] ?? "Assessment failed";
  const message =
    error.code === "JUDGE_SCHEMA_INVALID"
      ? "The judge returned an invalid response after retries. You can retry this candidate."
      : error.code === "GITHUB_RATE_LIMIT"
        ? "GitHub rate limiting interrupted collection. Retry when capacity is available."
        : error.message || "An assessment stage failed.";

  return {
    stage: error.stage.replace(/_/g, " "),
    title,
    message,
    technical_details: error.technical_details,
    retryable: error.retryable,
  };
}
