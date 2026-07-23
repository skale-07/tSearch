import { describe, expect, it } from "vitest";
import { selectRepositories } from "../../src/assessment/github/selectRepositories.js";
import type { Repo } from "../../src/types.js";

function repo(partial: Partial<Repo> & { name: string }): Repo {
  return {
    topics: [],
    language: "TypeScript",
    stars: 0,
    pushed_at: new Date().toISOString(),
    ...partial,
  };
}

describe("selectRepositories", () => {
  it("does not sort primarily by stars", () => {
    const picked = selectRepositories(
      {
        username: "dev",
        repos: [
          repo({ name: "star-bait", stars: 50000, language: "HTML" }),
          repo({ name: "custom-scheduler-engine", stars: 2, language: "Rust" }),
        ],
        details: {
          "star-bait": { fork: false, size: 10 },
          "custom-scheduler-engine": { fork: false, size: 400 },
        },
      },
      1
    );
    expect(picked[0]?.name).toBe("custom-scheduler-engine");
  });

  it("excludes empty and template-like repos", () => {
    const picked = selectRepositories(
      {
        username: "dev",
        repos: [
          repo({ name: "homework-lab-1", language: null, stars: 0 }),
          repo({ name: "real-parser", language: "Go", stars: 1 }),
        ],
        details: {
          "homework-lab-1": { size: 0, description: "course homework" },
          "real-parser": { size: 200, fork: false },
        },
      },
      5
    );
    expect(picked.map((p) => p.name)).toContain("real-parser");
    expect(picked.map((p) => p.name)).not.toContain("homework-lab-1");
  });

  it("down-ranks forks without treating them as primary", () => {
    const picked = selectRepositories(
      {
        username: "dev",
        repos: [
          repo({ name: "linux", language: "C", stars: 100 }),
          repo({ name: "my-runtime", language: "C", stars: 0 }),
        ],
        details: {
          linux: { fork: true, size: 1000 },
          "my-runtime": { fork: false, size: 100 },
        },
      },
      1
    );
    expect(picked[0]?.name).toBe("my-runtime");
  });

  it("respects repository limit", () => {
    const repos = Array.from({ length: 10 }, (_, i) =>
      repo({ name: `proj-${i}`, language: "Python" })
    );
    const picked = selectRepositories({ username: "dev", repos }, 3);
    expect(picked.length).toBe(3);
  });

  it("handles no repositories", () => {
    expect(selectRepositories({ username: "dev", repos: [] }, 3)).toEqual([]);
  });
});
