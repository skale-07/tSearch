import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildIndex,
  isStale,
  listIndexFiles,
  searchIndex,
  tokenize,
} from "../../src/oracle/index.js";
import { answerQuestion } from "../../src/oracle/answer.js";

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-oracle-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "src/pipeline"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "README.md"),
    "# Demo\n\nUnseen talent discovery pipeline.\n\n## Scoring\n\nfinal_score is the discovery heuristic; priority_score comes from assessment judges and they are never collapsed.\n"
  );
  fs.writeFileSync(
    path.join(root, "docs/notes.md"),
    "# Notes\n\n## Cookies\n\nLinkedIn login writes storageState to cookies.json via npm run login.\n"
  );
  fs.writeFileSync(
    path.join(root, "src/pipeline/score.ts"),
    "// discovery scoring\nexport function computeFinalScore(): number {\n  return 0;\n}\n"
  );
  // PII-shaped dirs that must never be indexed
  fs.mkdirSync(path.join(root, "profiles/person"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "profiles/person/profile.md"),
    "SECRET-PII-TOKEN real person data"
  );
  fs.mkdirSync(path.join(root, "data/people"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "data/people/x.md"),
    "SECRET-PII-TOKEN more person data"
  );
  return root;
}

describe("oracle index", () => {
  it("indexes only allowlisted roots — PII dirs never enter", () => {
    const root = makeRepo();
    const files = listIndexFiles(root);
    expect(files).toContain("README.md");
    expect(files.some((f) => f.startsWith("profiles"))).toBe(false);
    expect(files.some((f) => f.startsWith("data"))).toBe(false);

    const index = buildIndex(root);
    const hits = searchIndex(index, "SECRET-PII-TOKEN person", 5);
    expect(
      hits.every((h) => !h.chunk.text.includes("SECRET-PII-TOKEN"))
    ).toBe(true);
  });

  it("retrieves the scoring doc for a scoring question with line numbers", () => {
    const index = buildIndex(makeRepo());
    const hits = searchIndex(index, "priority_score final_score collapsed", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunk.file).toBe("README.md");
    expect(hits[0].chunk.start_line).toBeGreaterThan(0);
  });

  it("detects staleness when an indexed file changes", async () => {
    const root = makeRepo();
    const index = buildIndex(root);
    expect(isStale(index)).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    fs.writeFileSync(path.join(root, "docs/notes.md"), "# Changed\n");
    expect(isStale(index)).toBe(true);
  });

  it("tokenizes code identifiers", () => {
    expect(tokenize("computeFinalScore(x_y)")).toContain("computefinalscore");
    expect(tokenize("computeFinalScore(x_y)")).toContain("x_y");
  });
});

describe("oracle answers", () => {
  it("extractive answers carry file:line citations", async () => {
    const index = buildIndex(makeRepo());
    const result = await answerQuestion(index, "how does cookies login work", {
      live: false,
    });
    expect(result.mode).toBe("extractive");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0].file).toBe("docs/notes.md");
    expect(result.answer).toMatch(/docs\/notes\.md:\d+-\d+/);
  });

  it("says so plainly when nothing matches", async () => {
    const index = buildIndex(makeRepo());
    const result = await answerQuestion(index, "zzzqqqxxyy", { live: false });
    expect(result.citations).toEqual([]);
    expect(result.answer).toMatch(/No indexed passage/);
  });
});
