import type { Repo } from "../../types.js";

export interface RepoSelectionInput {
  username: string;
  repos: Repo[];
  details?: Record<
    string,
    {
      fork?: boolean;
      archived?: boolean;
      is_template?: boolean;
      size?: number;
      description?: string | null;
      default_branch?: string;
      created_at?: string | null;
      pushed_at?: string | null;
      topics?: string[];
      language?: string | null;
      stars?: number;
    }
  >;
}

export interface SelectedRepo {
  name: string;
  score: number;
  reasons: string[];
  is_fork: boolean;
  is_archived: boolean;
  stars: number;
}

const TEMPLATE_HINT =
  /awesome-|dotfiles|curriculum|homework|assignment|tutorial|course-|lab-|starter|boilerplate|template|portfolio-site|my-website/i;

const TECHNICAL_HINT =
  /engine|runtime|compiler|parser|scheduler|optimizer|pipeline|evaluator|graph|algorithm|model|infra|sdk|lib|core|server|client|storage|index|search|agent|ml|llm|crypto|protocol/i;

export function selectRepositories(
  input: RepoSelectionInput,
  limit: number
): SelectedRepo[] {
  const scored: SelectedRepo[] = [];

  for (const repo of input.repos) {
    const detail = input.details?.[repo.name];
    const is_fork = detail?.fork ?? false;
    const is_archived = detail?.archived ?? false;
    const is_template = detail?.is_template ?? false;
    const size = detail?.size ?? 0;
    const desc = (detail?.description ?? "").toLowerCase();
    const topics = (detail?.topics ?? repo.topics ?? []).join(" ");
    const name = repo.name;
    const language = detail?.language ?? repo.language;

    const reasons: string[] = [];
    let score = 0;

    if (is_archived) {
      reasons.push("archived");
      score -= 5;
    }
    if (is_template) {
      reasons.push("template_flag");
      score -= 8;
    }
    if (size === 0 && (detail?.stars ?? repo.stars) === 0 && !language) {
      reasons.push("empty_or_trivial");
      score -= 10;
    }
    if (
      TEMPLATE_HINT.test(name) ||
      TEMPLATE_HINT.test(desc) ||
      TEMPLATE_HINT.test(topics)
    ) {
      reasons.push("template_or_course_hint");
      score -= 8;
    }
    if (is_fork) {
      reasons.push("fork");
      score -= 4;
    } else {
      reasons.push("candidate_owned");
      score += 6;
    }

    if (language) {
      reasons.push(`language:${language}`);
      score += 2;
    }
    if (TECHNICAL_HINT.test(name) || TECHNICAL_HINT.test(desc) || TECHNICAL_HINT.test(topics)) {
      reasons.push("technical_naming");
      score += 4;
    }
    const pushed = detail?.pushed_at ?? repo.pushed_at;
    if (pushed) {
      const ageDays =
        (Date.now() - Date.parse(pushed)) / (24 * 60 * 60 * 1000);
      if (Number.isFinite(ageDays) && ageDays < 365) {
        reasons.push("recent_activity");
        score += 2;
      }
    }
    // Stars are a weak secondary signal only
    const stars = detail?.stars ?? repo.stars;
    if (stars > 0) score += Math.min(2, Math.log10(stars + 1));

    if (score < 0) continue;

    scored.push({
      name,
      score,
      reasons,
      is_fork,
      is_archived,
      stars,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.is_fork !== b.is_fork) return a.is_fork ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return scored.slice(0, Math.max(0, limit));
}
