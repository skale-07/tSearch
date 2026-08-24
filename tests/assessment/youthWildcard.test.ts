import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasDetailedLinkedInExperience,
  interestingProfileLinks,
  ingestYouthWildcardAlumni,
  isYouthWildcardPoolMember,
  markYouthWildcardAssessed,
  pickYouthWildcardIds,
  resolveYouthWildcardFreeze,
  setYouthWildcardPinned,
  YOUTH_WILDCARD_LIMIT,
} from "../../src/assessment/youthWildcard.js";
import type { Candidate, LinkedInProfile } from "../../src/types.js";
import { identityFromCandidate } from "../../src/assessment/candidateIdentity.js";

function li(over: Partial<LinkedInProfile> = {}): LinkedInProfile {
  return {
    url: "https://www.linkedin.com/in/x",
    name: "Test",
    photo_url: null,
    headline: "Student",
    college: null,
    school: "East High",
    degree: null,
    country: "United States",
    graduation_year: null,
    education: [],
    keywords: [],
    github_url: null,
    substack_url: null,
    twitter_url: null,
    personal_website: null,
    website_url: null,
    contact_links: [],
    experience: [],
    awards: [],
    skills: [],
    stated_age: 18,
    ...over,
  };
}

function cand(
  name: string,
  over: Partial<Candidate> & { linkedin?: LinkedInProfile } = {}
): Candidate {
  return {
    name,
    key: name.toLowerCase(),
    discovered_via: [],
    identity_confidence: 0.8,
    final_score: 1,
    score_breakdown: {
      builder: 0,
      thinker: 0,
      olympiad: 1,
      weirdness: 0,
      identity: 0.2,
      estimated_age: 18,
    },
    linkedin: over.linkedin ?? li(),
    ...over,
  };
}

const detailedExp = [
  {
    title: "Software Engineering Intern",
    company: "Acme Robotics",
    dates: "Jun 2025 – Aug 2025",
    location: "Boston, MA",
  },
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-youth-"));

beforeEach(() => {
  process.env.YOUTH_WILDCARD_PATH = path.join(tmpDir, "youth-wildcard.json");
  if (fs.existsSync(process.env.YOUTH_WILDCARD_PATH)) {
    fs.unlinkSync(process.env.YOUTH_WILDCARD_PATH);
  }
});

afterEach(() => {
  delete process.env.YOUTH_WILDCARD_PATH;
});

function poolOf(n: number): ReturnType<typeof cand>[] {
  return Array.from({ length: n }, (_, i) =>
    cand(`Person ${i}`, {
      linkedin: li({
        url: `https://www.linkedin.com/in/p${i}`,
        name: `Person ${i}`,
        experience: detailedExp,
        featured_links: [`https://example.com/p${i}`],
        stated_age: 17 + (i % 3),
      }),
    })
  );
}

describe("youthWildcard", () => {
  it("requires detailed experience and interesting links", () => {
    expect(hasDetailedLinkedInExperience(li({ experience: detailedExp }))).toBe(
      true
    );
    expect(
      hasDetailedLinkedInExperience(
        li({ experience: [{ title: "Student", company: null, dates: null, location: null }] })
      )
    ).toBe(false);
    const withFeatured = cand("A", {
      linkedin: li({
        experience: detailedExp,
        featured_links: ["https://isef.net/project/abc"],
      }),
    });
    expect(interestingProfileLinks(withFeatured).length).toBeGreaterThan(0);
    expect(isYouthWildcardPoolMember(withFeatured)).toBe(true);
    expect(
      isYouthWildcardPoolMember(
        cand("B", {
          linkedin: li({
            experience: detailedExp,
            featured_links: ["https://example.com/x"],
            stated_age: 22,
          }),
        })
      )
    ).toBe(false);
  });

  it("draws a stable set of at most 5 from the pool", () => {
    const pool = poolOf(8);
    const first = pickYouthWildcardIds(pool);
    const second = pickYouthWildcardIds(pool);
    expect(first.size).toBe(YOUTH_WILDCARD_LIMIT);
    expect([...first].sort()).toEqual([...second].sort());
    const ids = pool.map((c) => identityFromCandidate(c).candidate_id);
    for (const id of first) expect(ids).toContain(id);
  });

  it("queues only assessed freeze members; they swap next session unless Kept", () => {
    const pool = poolOf(8);
    const sessionA = resolveYouthWildcardFreeze(pool, { sessionId: "sess-a" });
    expect(sessionA.ids).toHaveLength(YOUTH_WILDCARD_LIMIT);
    const assessedOne = sessionA.ids[0]!;
    const untouched = sessionA.ids.slice(1);

    markYouthWildcardAssessed([assessedOne]);
    const sameSession = resolveYouthWildcardFreeze(pool, {
      sessionId: "sess-a",
    });
    expect(sameSession.ids).toEqual(sessionA.ids);
    expect(sameSession.pending_rotate_ids).toEqual([assessedOne]);

    const sessionB = resolveYouthWildcardFreeze(pool, { sessionId: "sess-b" });
    expect(sessionB.ids).toContain(untouched[0]);
    expect(sessionB.ids).not.toContain(assessedOne);
    expect(sessionB.pending_rotate_ids).toEqual([]);
  });

  it("records rotated people as alumni so Score can still list them", () => {
    const pool = poolOf(8);
    const sessionA = resolveYouthWildcardFreeze(pool, { sessionId: "sess-a" });
    const assessedOne = sessionA.ids[0]!;
    markYouthWildcardAssessed([assessedOne]);
    const sessionB = resolveYouthWildcardFreeze(pool, { sessionId: "sess-b" });
    expect(sessionB.ids).not.toContain(assessedOne);
    expect(sessionB.alumni_ids).toContain(assessedOne);
    expect(sessionB.alumni_ids.some((id) => sessionB.ids.includes(id))).toBe(
      false
    );
  });

  it("Keep holds an assessed person through the next session", () => {
    const pool = poolOf(8);
    const sessionA = resolveYouthWildcardFreeze(pool, { sessionId: "sess-a" });
    const kept = sessionA.ids[0]!;
    const alsoAssessed = sessionA.ids[1]!;
    const result = setYouthWildcardPinned(pool, kept, true);
    if ("error" in result) throw new Error(result.error);

    markYouthWildcardAssessed([kept, alsoAssessed]);
    const sessionB = resolveYouthWildcardFreeze(pool, { sessionId: "sess-b" });
    expect(sessionB.ids).toContain(kept);
    expect(sessionB.ids).not.toContain(alsoAssessed);
    expect(sessionB.pinned_ids).toContain(kept);
    expect(sessionB.alumni_ids).toContain(alsoAssessed);
    expect(sessionB.alumni_ids).not.toContain(kept);
  });

  it("does not queue rotation when the run has no wildcard people", () => {
    const pool = poolOf(8);
    const sessionA = resolveYouthWildcardFreeze(pool, { sessionId: "sess-a" });
    markYouthWildcardAssessed(["not-a-wildcard"]);
    const sessionB = resolveYouthWildcardFreeze(pool, { sessionId: "sess-b" });
    expect(sessionB.ids).toEqual(sessionA.ids);
  });

  it("falls back to contact/site links when Featured was never stored", () => {
    const c = cand("C", {
      linkedin: li({
        experience: detailedExp,
        contact_links: ["https://my-isef-project.example/writeup"],
      }),
    });
    expect(interestingProfileLinks(c)).toEqual([
      "https://my-isef-project.example/writeup",
    ]);
    expect(isYouthWildcardPoolMember(c)).toBe(true);
  });

  it("ingests prior freeze members as alumni without pulling them back in", () => {
    const pool = poolOf(8);
    const freeze = resolveYouthWildcardFreeze(pool, { sessionId: "sess-a" });
    const outsider = pool
      .map((c) => identityFromCandidate(c).candidate_id)
      .find((id) => !freeze.ids.includes(id))!;
    const next = ingestYouthWildcardAlumni([outsider, freeze.ids[0]!]);
    expect(next.alumni_ids).toContain(outsider);
    expect(next.alumni_ids).not.toContain(freeze.ids[0]);
    expect(next.ids).toEqual(freeze.ids);
  });
});
