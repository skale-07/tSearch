import { describe, expect, it } from "vitest";
import {
  ageFromAwardMatch,
  awardLinkedInSearchTerm,
  loadAwardRegistry,
  matchAwards,
  parseAwardYear,
} from "../../src/awards/awardRegistry.js";
import { deriveStage } from "../../src/assessment/stage/deriveStage.js";
import { buildExperienceEvidence } from "../../src/assessment/judges/experienceJudge.js";
import { diffNewSeeds, inspectSources, pendingKind } from "../../src/seeds/refreshSeeds.js";
import { parseRosterFilename, writeAwardRoster } from "../../src/seeds/sources/rosterSource.js";
import { parseManualCohort } from "../../src/seeds/sources/manualCohortSource.js";
import { createOlympiadCsvSource } from "../../src/seeds/sources/olympiadCsvSource.js";
import { sortAssessedRows, type AssessedCandidateRow } from "../../server/assessmentApi.js";
import type { SeedCandidateRow } from "../../src/seeds/sources/types.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("award registry", () => {
  it("loads, and every award has unique id and aliases", () => {
    const registry = loadAwardRegistry();
    expect(registry.awards.length).toBeGreaterThan(15);
    const ids = new Set(registry.awards.map((a) => a.award_id));
    expect(ids.size).toBe(registry.awards.length);
    for (const a of registry.awards) expect(a.aliases.length).toBeGreaterThan(0);
  });

  it("LinkedIn search term is the award display name", () => {
    expect(awardLinkedInSearchTerm("davidson_fellows")).toBe("Davidson Fellows");
    expect(awardLinkedInSearchTerm("cameron_impact")).toBe(
      "Cameron Impact Scholarship"
    );
    expect(awardLinkedInSearchTerm("not_a_real_award")).toBeUndefined();
  });

  it("matches stated award strings case- and punctuation-insensitively", () => {
    const matches = matchAwards([
      { title: "Coca-Cola Scholar", issuer: null, date: "2026" },
      { title: "cameron impact scholarship", issuer: null, date: null },
    ]);
    expect(matches.map((m) => m.award.award_id)).toEqual(
      expect.arrayContaining(["coca_cola_scholars", "cameron_impact"])
    );
  });

  it("does not match unrelated honors", () => {
    const matches = matchAwards([
      { title: "Employee of the Month", issuer: "Local Cafe", date: "2025" },
    ]);
    expect(matches).toHaveLength(0);
  });

  it("reads the concluding year from a range", () => {
    expect(parseAwardYear("2023-2024")).toBe(2024);
    expect(parseAwardYear("May 2026")).toBe(2026);
    expect(parseAwardYear(null)).toBeNull();
  });

  it("derives an age band only from hs_senior awards", () => {
    const [senior] = matchAwards([
      { title: "U.S. Presidential Scholar", issuer: null, date: "2020" },
    ]);
    expect(ageFromAwardMatch(senior!, 2026)).toEqual({ age: 24, confidence: 0.85 });

    const [broad] = matchAwards([
      { title: "ISEF Grand Award", issuer: null, date: "2020" },
    ]);
    expect(ageFromAwardMatch(broad!, 2026)).toBeNull();
  });
});

describe("award-driven stage and evidence", () => {
  it("uses a dated senior award as the stage basis", () => {
    const stage = deriveStage({
      linkedin: {
        awards: [{ title: "Cameron Impact Scholarship", issuer: null, date: "2026" }],
      } as never,
      now: new Date("2026-08-13"),
    });
    expect(stage.basis).toBe("award_cohort");
    expect(stage.bucket).toBe("hs_senior");
    expect(stage.estimated_age).toBe(18);
  });

  it("upgrades registry-matched awards from weak self-report to moderate", () => {
    const { evidence } = buildExperienceEvidence("cand_a", {
      headline: null,
      experience: [],
      awards: [
        { title: "Davidson Fellow", issuer: "Davidson Institute", date: "2026" },
        { title: "Best Costume, School Play", issuer: null, date: "2025" },
      ],
      education: [],
      olympiad_prizes: [],
    });
    const matched = evidence.find((e) => e.observation.includes("Davidson"));
    const unmatched = evidence.find((e) => e.observation.includes("Costume"));
    expect(matched?.strength).toBe("moderate");
    expect(matched?.supports_claim).toMatch(/registry/i);
    expect(unmatched?.strength).toBe("weak");
  });
});

const row = (name: string, source_id = "s"): SeedCandidateRow => ({
  name,
  source_id,
  source_kind: "award_roster",
  as_of: "2026-08-13T00:00:00.000Z",
});

describe("seed refresh", () => {
  it("drops people already known and dedupes within the run", () => {
    const result = diffNewSeeds(
      [row("Ada Lovelace"), row("ada  lovelace"), row("Grace Hopper")],
      (name) => name === "Grace Hopper"
    );
    expect(result.new_seeds.map((s) => s.name)).toEqual(["Ada Lovelace"]);
    expect(result.already_known).toBe(1);
    expect(result.duplicates_within_run).toBe(1);
  });

  it("normalizes accents when deduping against the pending file", () => {
    const result = diffNewSeeds([row("José García")], () => false, [
      {
        name: "Jose Garcia",
        source_id: "prev",
        first_seen: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(result.new_seeds).toHaveLength(1);
    expect(result.duplicates_within_run).toBe(1);
  });

  it("prunes resolved names already sitting in the pending file", () => {
    const result = diffNewSeeds([row("Ada Lovelace")], (name) => name === "Grace Hopper", [
      {
        name: "Grace Hopper",
        source_id: "prev",
        first_seen: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(result.new_seeds.map((s) => s.name)).toEqual(["Ada Lovelace"]);
    expect(result.already_known).toBe(1);
  });

  it("always reports olympiad, scholarship, and manual channels", () => {
    const kinds = new Set(inspectSources().map((c) => c.kind));
    expect(kinds.has("olympiad_csv")).toBe(true);
    expect(kinds.has("award_roster")).toBe(true);
    expect(kinds.has("manual_cohort")).toBe(true);
    expect(pendingKind({ name: "X", source_id: "olympiad:ioi", first_seen: "t" })).toBe(
      "olympiad_csv"
    );
  });

  it("parses roster filenames with and without a year", () => {
    expect(parseRosterFilename("cameron_impact.2026.csv")).toEqual({
      award_id: "cameron_impact",
      year: 2026,
    });
    expect(parseRosterFilename("davidson_fellows.txt")).toEqual({
      award_id: "davidson_fellows",
      year: undefined,
    });
    expect(parseRosterFilename("notes.md")).toBeNull();
  });

  it("writes a scholarship roster file from pasted names", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-roster-"));
    const saved = writeAwardRoster({
      award_id: "cameron_impact",
      year: 2026,
      namesText: "Ada Lovelace\nGrace Hopper\n",
      dir,
    });
    expect(saved).toEqual({ file: "cameron_impact.2026.csv", count: 2 });
    const body = fs.readFileSync(path.join(dir, saved.file), "utf8");
    expect(body).toMatch(/Ada Lovelace/);
    expect(body).toMatch(/Grace Hopper/);
    expect(() =>
      writeAwardRoster({
        award_id: "not_a_real_award",
        year: 2026,
        namesText: "Ada",
        dir,
      })
    ).toThrow(/Unknown award_id/);
  });

  it("manual cohort intake keeps only names, skipping malformed rows", () => {
    const rows = parseManualCohort([
      { name: "Ada Lovelace", cohort_year: 2032, country: "UK" },
      { name: "   " },
      { cohort_year: 2032 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Ada Lovelace",
      cohort_year: 2032,
      source_kind: "manual_cohort",
    });
  });

  it("manual cohort keeps a stated age at award when present", () => {
    const rows = parseManualCohort([
      { name: "Ada Lovelace", cohort_year: 2022, age_at_award: 18 },
    ]);
    expect(rows[0]?.age_at_award).toBe(18);
  });

  it("olympiad CSV source nominates unique names, newest first", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-oly-"));
    const csv = path.join(dir, "olympiad_winners.csv");
    fs.writeFileSync(
      csv,
      [
        "source,competition_year,name,age,school,country,award,rank",
        "IOI,2023,Grace Hopper,16,,Canada,Silver,",
        "IMO,2024,Ada Lovelace,,,United States,Gold,",
        "IMO,2024,Ada Lovelace,,,United States,Gold,",
      ].join("\n")
    );
    const source = createOlympiadCsvSource(csv);
    expect(source).not.toBeNull();
    const rows = source!.read();
    expect(rows.map((r) => r.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(rows[0]).toMatchObject({
      source_kind: "olympiad_csv",
      country: "United States",
      cohort_year: 2024,
    });
    expect(rows[1]).toMatchObject({
      name: "Grace Hopper",
      age_at_award: 16,
      cohort_year: 2023,
    });
  });
});

describe("assessed ranking dials", () => {
  const rows: AssessedCandidateRow[] = [
    {
      candidate_id: "a",
      name: "Scored high quality",
      priority_score: 90,
      archetype: "x",
      status: "completed",
      run_id: "r",
      updated_at: "2026-01-01",
      age_relative: 4,
      obscurity: 0.1,
      upside_score: 0.04,
    },
    {
      candidate_id: "b",
      name: "Young and hidden",
      priority_score: 60,
      archetype: "x",
      status: "completed",
      run_id: "r",
      updated_at: "2026-02-01",
      age_relative: 9,
      obscurity: 0.9,
      upside_score: 0.81,
    },
    {
      candidate_id: "c",
      name: "Unscored",
      priority_score: 70,
      archetype: "x",
      status: "completed",
      run_id: "r",
      updated_at: "2026-03-01",
      age_relative: null,
      obscurity: null,
      upside_score: null,
    },
  ];

  it("quality still ranks by priority score", () => {
    expect(sortAssessedRows(rows, "quality")[0]!.candidate_id).toBe("a");
  });

  it("upside surfaces the young, undiscovered candidate over the higher score", () => {
    expect(sortAssessedRows(rows, "upside")[0]!.candidate_id).toBe("b");
  });

  it("unscored candidates sort last on every dial, never first", () => {
    for (const dial of ["upside", "obscurity", "age_adjusted"] as const) {
      const sorted = sortAssessedRows(rows, dial);
      expect(sorted[sorted.length - 1]!.candidate_id).toBe("c");
    }
  });
});
