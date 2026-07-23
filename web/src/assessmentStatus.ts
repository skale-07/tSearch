export type AssessmentTone = "neutral" | "success" | "warning" | "danger";

export function runStatusTone(status?: string | null): AssessmentTone {
  switch (status) {
    case "completed":
      return "success";
    case "completed_with_errors":
    case "interrupted":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function candidateStatusTone(status?: string | null): AssessmentTone {
  switch (status) {
    case "completed":
      return "success";
    case "partial":
    case "insufficient_context":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function stageLabel(stage?: string | null): string {
  const labels: Record<string, string> = {
    pending: "Pending",
    collecting: "Collecting artifacts",
    judging_technical: "Technical judge",
    judging_writing: "Writing judge",
    linking_artifacts: "Linking artifacts",
    judging_cross_artifact: "Cross-artifact judge",
    judging_cory: "Cory relevance",
    synthesizing: "Synthesizing",
    done: "Done",
  };
  return (stage && labels[stage]) || "Pending";
}

export function judgeStatusLabel(status?: string | null): string {
  if (!status) return "Not started";
  return status.replace(/_/g, " ");
}

export function judgeStatusTone(status?: string | null): AssessmentTone {
  switch (status) {
    case "completed":
    case "abstained":
    case "not_applicable":
      return "success";
    case "failed":
      return "danger";
    case "running":
      return "warning";
    default:
      return "neutral";
  }
}

export function judgeAttemptsLabel(attempts?: number | null): string | null {
  return typeof attempts === "number" ? `${attempts} attempt${attempts === 1 ? "" : "s"}` : null;
}
