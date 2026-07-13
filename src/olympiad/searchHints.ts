import type { OlympiadProfile } from "../types.js";

const SOURCE_PRIORITY = ["IOI", "IMO", "IPHO", "ICHO", "ISEF"];

/** Short keywords for LinkedIn people search (name + hints + country). */
export function olympiadSearchHints(olympiad?: OlympiadProfile): string[] {
  if (!olympiad) return [];

  const hints: string[] = [];

  for (const source of SOURCE_PRIORITY) {
    if (olympiad.sources.includes(source)) {
      hints.push(source);
      break;
    }
  }

  const primarySource = hints[0]?.toUpperCase();
  // ISEF/EUCYS place awards rarely appear on LinkedIn; medal terms hurt recall.
  if (primarySource === "ISEF") {
    return hints;
  }

  const bestMedal = olympiad.prizes
    .map((p) => {
      const m = p.match(/\b(gold|silver|bronze)\b/i);
      return m ? m[1].toLowerCase() : null;
    })
    .find(Boolean);

  if (bestMedal && bestMedal !== "bronze") {
    hints.push(bestMedal);
  }

  return hints.slice(0, 2);
}
