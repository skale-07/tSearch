import { describe, expect, it } from "vitest";
import { createLlmJudgeClient } from "../../src/assessment/judges/llmClient.js";
import type { PagePerson } from "../../src/website/extractPagePeople.js";
import {
  applyNameScreenKeep,
  heuristicNameScreen,
  screenPagePeople,
} from "../../src/website/screenPagePeople.js";

function person(
  name: string,
  extra: Partial<PagePerson> = {}
): PagePerson {
  return {
    name,
    confidence: extra.confidence ?? "medium",
    evidence: extra.evidence ?? "team/people list item",
    checked_default: extra.checked_default ?? true,
    ...extra,
  };
}

describe("screenPagePeople", () => {
  it("always keeps LinkedIn/GitHub-anchored names", () => {
    const people = [
      person("Ada Lovelace", {
        linkedin_url: "https://www.linkedin.com/in/ada/",
        confidence: "high",
      }),
      person("USA Astronomy"),
    ];
    const kept = applyNameScreenKeep(people, []);
    expect(kept.map((p) => p.name)).toEqual(["Ada Lovelace"]);
  });

  it("offline heuristic drops leftover title-case, keeps roster rows", () => {
    const people = [
      person("Ada Lovelace"),
      person("United States", { confidence: "low", checked_default: false }),
    ];
    expect(heuristicNameScreen(people).map((p) => p.name)).toEqual([
      "Ada Lovelace",
    ]);
  });

  it("LLM keep-list drops org titles that look like names", async () => {
    const client = createLlmJudgeClient({
      mock: true,
      mockResponder: () => ({ keep: ["Grace Hopper"] }),
    });
    const people = [
      person("Grace Hopper"),
      person("USA Astronomy"),
      person("United States"),
    ];
    const kept = await screenPagePeople(people, {
      pageUrl: "https://usaaao.org/team",
      mock: false,
      llmClient: client,
    });
    expect(kept.map((p) => p.name)).toEqual(["Grace Hopper"]);
  });
});
