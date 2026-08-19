import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-treeseeds-"));

beforeEach(() => {
  vi.resetModules();
  process.env.PROFILES_DIR = tmpDir;
  for (const name of fs.readdirSync(tmpDir)) {
    fs.rmSync(path.join(tmpDir, name), { recursive: true, force: true });
  }
});

afterEach(() => {
  delete process.env.PROFILES_DIR;
});

function writeSeed(slug: string): void {
  const dir = path.join(tmpDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.json"),
    JSON.stringify({ slug, name: slug, relation: "seed" }),
    "utf-8"
  );
}

function writeNeighbor(
  seed: string,
  relation: "collaborators" | "followers",
  login: string
): void {
  const dir = path.join(tmpDir, seed, relation, login);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.json"),
    JSON.stringify({ slug: login, name: login, relation }),
    "utf-8"
  );
}

describe("listProfileSeeds", () => {
  it("omits seeds with no hop-1 collaborators or followers", async () => {
    writeSeed("lonely");
    writeSeed("with-collab");
    writeNeighbor("with-collab", "collaborators", "alice");
    writeSeed("with-follower");
    writeNeighbor("with-follower", "followers", "bob");

    const { listProfileSeeds, seedHasHop1Neighbors } = await import(
      "../../server/tree.js"
    );

    expect(seedHasHop1Neighbors("lonely")).toBe(false);
    expect(seedHasHop1Neighbors("with-collab")).toBe(true);
    expect(listProfileSeeds().sort()).toEqual(
      ["with-collab", "with-follower"].sort()
    );
  });

  it("ignores empty relation folders without profile.json children", async () => {
    writeSeed("hollow");
    fs.mkdirSync(path.join(tmpDir, "hollow", "collaborators"), {
      recursive: true,
    });

    const { listProfileSeeds } = await import("../../server/tree.js");
    expect(listProfileSeeds()).toEqual([]);
  });
});
