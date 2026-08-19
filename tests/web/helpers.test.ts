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
    const youth = assessmentEligibility({ youth_wildcard: true });
    expect(youth.eligible).toBe(true);
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

describe("pending filters", () => {
  it("filters olympiad rows by competition year and program", async () => {
    const { matchesPendingFilter, uniquePendingYears, uniquePendingPrograms } =
      await import("../../web/src/discovery.js");
    const rows = [
      {
        name: "A",
        source_id: "olympiad:isef",
        source_kind: "olympiad_csv" as const,
        cohort_year: 2025,
        first_seen: "2026-01-01",
      },
      {
        name: "B",
        source_id: "olympiad:imo",
        source_kind: "olympiad_csv" as const,
        cohort_year: 2024,
        first_seen: "2026-01-01",
      },
      {
        name: "C",
        award_id: "coca_cola_scholars",
        source_id: "coca_cola_scholars:2025",
        source_kind: "award_roster" as const,
        cohort_year: 2025,
        first_seen: "2026-01-01",
      },
    ];
    expect(
      rows.filter((s) =>
        matchesPendingFilter(s, { kind: "olympiad_csv", year: 2025 })
      ).map((s) => s.name)
    ).toEqual(["A"]);
    expect(
      rows.filter((s) => matchesPendingFilter(s, { program: "ISEF" })).map((s) => s.name)
    ).toEqual(["A"]);
    expect(
      rows.filter((s) =>
        matchesPendingFilter(s, { year: 2025, program: "coca_cola_scholars" })
      ).map((s) => s.name)
    ).toEqual(["C"]);
    expect(uniquePendingYears(rows)).toEqual([2025, 2024]);
    expect(uniquePendingPrograms(rows).map((p) => p.id).sort()).toEqual(
      ["ISEF", "IMO", "coca_cola_scholars"].sort()
    );
  });
});

describe("findPendingByName", () => {
  it("matches the pending list case-insensitively and rejects unknowns", async () => {
    const { findPendingByName, PERSON_NOT_ON_LIST, pendingNameKey } =
      await import("../../web/src/discovery.js");
    const rows = [
      {
        name: "Jane Smith",
        source_id: "coca_cola_scholars.2025",
        first_seen: "2026-01-01",
      },
    ];
    expect(findPendingByName(rows, "  jane   smith ")?.name).toBe("Jane Smith");
    expect(findPendingByName(rows, "Jane Smyth")).toBeNull();
    expect(pendingNameKey("José")).toBe("jose");
    expect(PERSON_NOT_ON_LIST).toBe("This person is not on the list");
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
