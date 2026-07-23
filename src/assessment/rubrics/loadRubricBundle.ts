import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadRubricFromPath } from "./loadRubric.js";
import {
  assertRubricVersionsMatchBundle,
  validateRubricBundle,
} from "./validateRubric.js";
import type { LoadedRubricBundle } from "./types.js";

function sha256Hex(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

export function loadRubricBundle(
  rubricsDir = resolve(process.cwd(), "rubrics"),
  bundleFile = "rubric-bundle-v1.yaml"
): LoadedRubricBundle {
  const bundlePath = resolve(rubricsDir, bundleFile);
  const bundleRaw = readFileSync(bundlePath, "utf8");
  const bundle = validateRubricBundle(parseYaml(bundleRaw), bundlePath);

  const file_hashes: Record<string, string> = {
    [bundleFile]: sha256Hex(bundleRaw),
  };

  const rubrics = bundle.rubrics.map((entry) => {
    const path = resolve(rubricsDir, entry.file);
    const raw = readFileSync(path, "utf8");
    file_hashes[entry.file] = sha256Hex(raw);
    return loadRubricFromPath(path);
  });

  assertRubricVersionsMatchBundle(bundle, rubrics);

  return {
    bundle_id: bundle.bundle_id,
    version: bundle.version,
    rubrics,
    file_hashes,
  };
}
