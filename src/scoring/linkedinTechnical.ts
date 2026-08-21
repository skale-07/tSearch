import type { LinkedInExperience, LinkedInProfile } from "../types.js";

/**
 * Coarse technical-role detector for discovery scoring. Not a substitute for
 * GitHub evidence — internships and research titles only. Generic CS/student
 * headlines are a weak bump, not a career grade.
 */
const TECH_TITLE =
  /\b(swe|sde|software|engineer|developer|programmer|research(?:er)?|scientist|machine learning|\bml\b|\bai\b|data(?:\s|-)?(?:scien|engin)|robot|hardware|firmware|quant|computational|bioinformatic|full[- ]?stack|backend|frontend|systems|security|crypto|compiler)\b/i;

const TECH_ORG =
  /\b(lab|labs|tech|ai|software|systems|robotics|research|computing|engineering)\b/i;

export function isTechnicalExperience(role: LinkedInExperience): boolean {
  const title = role.title ?? "";
  const company = role.company ?? "";
  const description = role.description ?? "";
  const blob = `${title} ${company} ${description}`;
  if (TECH_TITLE.test(title)) return true;
  if (TECH_TITLE.test(description) && /\b(intern|assistant|fellow|associate|engineer)\b/i.test(title)) {
    return true;
  }
  if (/\bintern\b/i.test(title) && (TECH_ORG.test(company) || TECH_TITLE.test(blob))) {
    return true;
  }
  return TECH_TITLE.test(company);
}

/**
 * 0–0.35. Empty experience is 0 — never a penalty. Capped below GitHub builder
 * (0.7) so LinkedIn titles cannot outrank real repos.
 */
export function linkedinTechnicalSignal(linkedin?: LinkedInProfile | null): number {
  if (!linkedin) return 0;
  const techRoles = (linkedin.experience ?? []).filter(isTechnicalExperience);
  let s = 0;
  if (techRoles.length >= 1) s += 0.15;
  if (techRoles.length >= 2) s += 0.1;
  if (TECH_TITLE.test(linkedin.headline ?? "")) s += 0.1;
  const skills = (linkedin.skills ?? []).join(" ");
  if (
    TECH_TITLE.test(skills) ||
    /\b(python|pytorch|c\+\+|rust|java|typescript)\b/i.test(skills)
  ) {
    s += 0.05;
  }
  return Math.min(0.35, Math.round(s * 100) / 100);
}
