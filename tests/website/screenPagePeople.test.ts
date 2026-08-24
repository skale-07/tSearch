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

  it("offline heuristic drops leftover title-case", () => {
    const people = [
      person("Ada Lovelace"),
      person("United States", { confidence: "low", checked_default: false }),
    ];
    expect(heuristicNameScreen(people).map((p) => p.name)).toEqual([
      "Ada Lovelace",
    ]);
  });

  it("LLM keep [] drops unanchored leftovers", async () => {
    const client = createLlmJudgeClient({
      mock: true,
      mockResponder: () => ({ keep: [] }),
    });
    const people = [
      person("Ada Lovelace", {
        linkedin_url: "https://www.linkedin.com/in/ada/",
        confidence: "high",
      }),
      person("Visual Studio Code", { confidence: "low", checked_default: false }),
    ];
    const kept = await screenPagePeople(people, {
      pageUrl: "https://isef.net/project/x",
      mock: false,
      llmClient: client,
    });
    expect(kept.map((p) => p.name)).toEqual(["Ada Lovelace"]);
  });

  it("LLM throw keeps URL-anchored names only", async () => {
    const client = createLlmJudgeClient({
      mock: true,
      mockResponder: () => {
        throw new Error("provider down");
      },
    });
    const people = [
      person("Ada Lovelace", {
        linkedin_url: "https://www.linkedin.com/in/ada/",
        confidence: "high",
      }),
      person("Visual Studio Code", {
        confidence: "low",
        checked_default: false,
      }),
    ];
    const kept = await screenPagePeople(people, {
      pageUrl: "https://www.wral.com/news/local/story/",
      mock: false,
      llmClient: client,
    });
    expect(kept.map((p) => p.name)).toEqual(["Ada Lovelace"]);
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
