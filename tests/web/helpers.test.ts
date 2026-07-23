import { describe, expect, it } from "vitest";
import { assessmentEligibility } from "../../web/src/eligibility.js";
import {
  runStatusTone,
  candidateStatusTone,
  stageLabel,
} from "../../web/src/assessmentStatus.js";
import { assessmentErrorView } from "../../web/src/errorView.js";

describe("eligibility", () => {
  it("labels GitHub path availability and requires either path", () => {
    const ok = assessmentEligibility({ github_username: "a" });
    expect(ok.githubPathAvailable).toBe(true);
    expect(ok.eligible).toBe(true);
    const writing = assessmentEligibility({ website_url: "https://x" });
    expect(writing.writingEligible).toBe(true);
    const no = assessmentEligibility({});
    expect(no.eligible).toBe(false);
    expect(no.reasons.join(" ")).toMatch(/GitHub path/i);
  });
});

describe("assessmentStatus tones", () => {
  it("maps completed_with_errors to warning not success", () => {
    expect(runStatusTone("completed")).toBe("success");
    expect(runStatusTone("completed_with_errors")).toBe("warning");
    expect(runStatusTone("interrupted")).toBe("warning");
    expect(runStatusTone("failed")).toBe("danger");
    expect(candidateStatusTone("partial")).toBe("warning");
    expect(stageLabel("judging_technical")).toMatch(/technical/i);
  });
});

describe("errorView", () => {
  it("keeps Zod out of primary message", () => {
    const view = assessmentErrorView({
      stage: "technical",
      code: "JUDGE_SCHEMA_INVALID",
      message: "Technical judge returned an invalid response after retries.",
      technical_details:
        "Schema validation failed: dimensions expected array received object dimension_id",
      retryable: true,
      occurred_at: new Date().toISOString(),
    });
    expect(view.message).not.toMatch(/expected array/i);
    expect(view.technical_details).toMatch(/Schema validation/i);
  });
});

describe("terminal run statuses", () => {
  it("treats completed_with_errors as terminal for polling", () => {
    const terminal = new Set([
      "completed",
      "completed_with_errors",
      "failed",
      "interrupted",
    ]);
    expect(terminal.has("completed")).toBe(true);
    expect(terminal.has("judging")).toBe(false);
  });
});

describe("evidenceCitations", () => {
  it("names and links artifacts and evidence", async () => {
    const {
      resolveEvidenceCitations,
      workCitations,
      worksFromEvidenceIds,
    } = await import("../../web/src/evidenceCitations.js");
    const artifacts = {
      references: [
        {
          artifact_id: "art_1",
          kind: "github_repository",
          title: "rtaori/data_feedback",
          canonical_url: "https://github.com/rtaori/data_feedback",
        },
      ],
      evidence: [
        {
          evidence_id: "ev_1",
          artifact_id: "art_1",
          source_type: "github_file",
          source_url:
            "https://github.com/rtaori/data_feedback/blob/HEAD/data/preprocess_cinic10.py",
          location: { file_path: "data/preprocess_cinic10.py" },
        },
      ],
    };
    expect(workCitations(artifacts)[0]).toMatchObject({
      label: "rtaori/data_feedback",
      href: "https://github.com/rtaori/data_feedback",
      kind: "repo",
    });
    expect(resolveEvidenceCitations(["ev_1"], artifacts)[0]).toMatchObject({
      label: "rtaori/data_feedback · data/preprocess_cinic10.py",
      href: "https://github.com/rtaori/data_feedback/blob/HEAD/data/preprocess_cinic10.py",
    });
    expect(worksFromEvidenceIds(["ev_1"], artifacts)[0]?.label).toBe(
      "rtaori/data_feedback"
    );
  });
});
