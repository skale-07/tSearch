import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateRubric } from "./validateRubric.js";
import type { RubricDefinition } from "./types.js";

export function loadRubricFromPath(filePath: string): RubricDefinition {
  const absolute = resolve(filePath);
  const raw = readFileSync(absolute, "utf8");
  const parsed: unknown = parseYaml(raw);
  return validateRubric(parsed, absolute);
}

export function loadRubric(
  rubricFile: string,
  rubricsDir = resolve(process.cwd(), "rubrics")
): RubricDefinition {
  return loadRubricFromPath(resolve(rubricsDir, rubricFile));
}
