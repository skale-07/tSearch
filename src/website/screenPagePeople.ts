import { z } from "zod";
import { llmUseMock } from "../assessment/config.js";
import {
  createLlmJudgeClient,
  type LlmJudgeClient,
} from "../assessment/judges/llmClient.js";
import {
  normalizeNameKey,
  type PagePerson,
} from "./extractPagePeople.js";

const SCREEN_VERSION = "page-people-v1";

const nameScreenSchema = z.object({
  keep: z.array(z.string()),
});

const NAME_SCREEN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["keep"],
  properties: {
    keep: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const SYSTEM = `You filter strings extracted from a public team/org webpage.

Return keep: the subset that are human personal names (given name + family name).

Drop:
- organizations, programs, olympiads, awards, labs, schools
- page titles and country + discipline fragments ("USA Astronomy")
- nav labels, roles without a person ("Board of Directors")
- teams, products, and acronyms used as names

Keep unusual but real personal names. LinkedIn/GitHub URLs are already trusted — you only see unanchored strings.

Return JSON { "keep": ["Ada Lovelace", ...] } using the exact input strings.`;

function hasProfileUrl(p: PagePerson): boolean {
  return Boolean(p.linkedin_url || p.github_url);
}

/** Offline: keep profile-URL hits and roster (medium) names; drop leftover title-case. */
export function heuristicNameScreen(people: PagePerson[]): PagePerson[] {
  return people.filter((p) => hasProfileUrl(p) || p.confidence !== "low");
}

export function applyNameScreenKeep(
  people: PagePerson[],
  keep: string[]
): PagePerson[] {
  const keys = new Set(keep.map((n) => normalizeNameKey(n)));
  return people.filter(
    (p) => hasProfileUrl(p) || keys.has(normalizeNameKey(p.name))
  );
}

export async function screenPagePeople(
  people: PagePerson[],
  opts: {
    pageUrl: string;
    mock?: boolean;
    llmClient?: LlmJudgeClient;
  }
): Promise<PagePerson[]> {
  if (!people.length) return [];
  const mock = opts.mock ?? llmUseMock();
  const anchored = people.filter(hasProfileUrl);
  const unanchored = people.filter((p) => !hasProfileUrl(p));
  if (!unanchored.length) return people;

  if (mock && !opts.llmClient) {
    return heuristicNameScreen(people);
  }

  const client =
    opts.llmClient ??
    (mock
      ? undefined
      : createLlmJudgeClient());
  if (!client) return heuristicNameScreen(people);

  try {
    const result = await client.generateStructured({
      systemPrompt: SYSTEM,
      userPayload: {
        page_url: opts.pageUrl,
        names: unanchored.map((p) => ({
          name: p.name,
          evidence: p.evidence,
          confidence: p.confidence,
        })),
      },
      outputSchema: nameScreenSchema,
      jsonSchema: NAME_SCREEN_JSON_SCHEMA,
      jsonSchemaName: "page_people_name_screen",
      cacheNamespace: "website-name-screen",
      judgeSchemaVersion: SCREEN_VERSION,
      temperature: 0,
    });
    const screened = applyNameScreenKeep(people, result.value.keep);
    console.log(
      `[website-graph] name screen kept ${screened.length}/${people.length} (anchored ${anchored.length})`
    );
    return screened;
  } catch (err) {
    console.warn(
      `[website-graph] name screen failed — keep URL-anchored only: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return people.filter(hasProfileUrl);
  }
}
