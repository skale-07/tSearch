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
  relation: "collaborators" | "followers" | "website",
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
    writeSeed("with-website");
    writeNeighbor("with-website", "website", "cara");

    const { listProfileSeeds, seedHasHop1Neighbors } = await import(
      "../../server/tree.js"
    );

    expect(seedHasHop1Neighbors("lonely")).toBe(false);
    expect(seedHasHop1Neighbors("with-collab")).toBe(true);
    expect(seedHasHop1Neighbors("with-website")).toBe(true);
    expect(listProfileSeeds().sort()).toEqual(
      ["with-collab", "with-follower", "with-website"].sort()
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

  it("walks hop-2 collaborators under a website neighbor", async () => {
    writeSeed("feodor");
    writeNeighbor("feodor", "website", "ada");
    const hop2 = path.join(
      tmpDir,
      "feodor",
      "website",
      "ada",
      "collaborators",
      "ghopper"
    );
    fs.mkdirSync(hop2, { recursive: true });
    fs.writeFileSync(
      path.join(hop2, "profile.json"),
      JSON.stringify({
        slug: "ghopper",
        name: "Grace Hopper",
        relation: "collaborator",
        hop: 2,
        seed: "feodor",
        parents: ["feodor", "ada"],
        context_score: 6,
        context_signals: [],
        discovered_via: [],
      }),
      "utf-8"
    );

    const { buildTree } = await import("../../server/tree.js");
    const tree = buildTree("feodor");
    expect(tree).not.toBeNull();
    const ids = tree!.nodes.map((n) => n.id);
    expect(ids).toContain("ada");
    expect(ids).toContain("ada:ghopper");
    expect(
      tree!.edges.some(
        (e) =>
          e.from === "ada" &&
          e.to === "ada:ghopper" &&
          e.via === "github-collaborator" &&
          e.hop === 2
      )
    ).toBe(true);
  });

  it("lists seed profiles without a hop-1 tree as hang targets", async () => {
    writeSeed("lonely");
    writeSeed("with-collab");
    writeNeighbor("with-collab", "collaborators", "alice");

    const { listHangSeedOptions } = await import("../../server/tree.js");
    const hang = listHangSeedOptions();
    expect(hang.map((h) => h.slug).sort()).toEqual(["lonely", "with-collab"].sort());
    expect(hang.find((h) => h.slug === "lonely")?.hasTree).toBe(false);
    expect(hang.find((h) => h.slug === "with-collab")?.hasTree).toBe(true);
  });
});
