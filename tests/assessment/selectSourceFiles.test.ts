import { describe, expect, it } from "vitest";
import {
  selectSourceFiles,
  shouldIgnorePath,
} from "../../src/assessment/github/selectSourceFiles.js";

describe("selectSourceFiles", () => {
  it("excludes vendor and build output", () => {
    expect(shouldIgnorePath("node_modules/x/index.js")).toBe(true);
    expect(shouldIgnorePath("dist/bundle.js")).toBe(true);
    expect(shouldIgnorePath("src/engine.ts")).toBe(false);
  });

  it("selects manifests and central source files", () => {
    const tree = [
      { path: "package.json", type: "blob" as const, size: 100 },
      { path: "src/scheduler.ts", type: "blob" as const, size: 2000 },
      { path: "src/util.ts", type: "blob" as const, size: 400 },
      { path: "tests/scheduler.test.ts", type: "blob" as const, size: 500 },
      { path: "node_modules/lodash/index.js", type: "blob" as const, size: 1000 },
      { path: "package-lock.json", type: "blob" as const, size: 9000 },
    ];
    const selected = selectSourceFiles(tree, { maxCore: 2, maxTests: 2 });
    expect(selected.manifests).toContain("package.json");
    expect(selected.core[0]).toBe("src/scheduler.ts");
    expect(selected.tests.length).toBeGreaterThan(0);
    expect(selected.core.join(",")).not.toContain("node_modules");
  });

  it("respects file limits", () => {
    const tree = Array.from({ length: 20 }, (_, i) => ({
      path: `src/engine_${i}.ts`,
      type: "blob" as const,
      size: 1000,
    }));
    const selected = selectSourceFiles(tree, { maxCore: 3, maxTests: 1 });
    expect(selected.core.length).toBeLessThanOrEqual(3);
  });
});
