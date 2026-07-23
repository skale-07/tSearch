import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonAtomic, readJson } from "../../src/storage/jsonStore.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("writeJsonAtomic", () => {
  it("overwrites an existing file (Windows-safe replace)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-atomic-"));
    tmpDirs.push(dir);
    const file = path.join(dir, "record.json");

    writeJsonAtomic(file, { revision: 1, status: "running" });
    expect(readJson<{ revision: number }>(file)?.revision).toBe(1);

    // Second write is what failed in assessment checkpoints on Windows
    writeJsonAtomic(file, { revision: 2, status: "partial" });
    expect(readJson<{ revision: number; status: string }>(file)).toEqual({
      revision: 2,
      status: "partial",
    });

    const leftoverTmp = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".tmp"));
    expect(leftoverTmp).toEqual([]);
  });
});
