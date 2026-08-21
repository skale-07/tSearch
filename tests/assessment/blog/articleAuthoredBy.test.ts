import { describe, expect, it } from "vitest";
import {
  articleAuthoredByCandidate,
  nameIsAmongAuthors,
  splitAuthorList,
} from "../../../src/assessment/blog/articleAuthoredBy.js";

describe("nameIsAmongAuthors", () => {
  it("matches the sole author and a co-author list", () => {
    expect(nameIsAmongAuthors("Jane Doe", "Jane Doe")).toBe(true);
    expect(
      nameIsAmongAuthors("Jane Doe", "Alice Smith, Jane Doe, and Bob Lee")
    ).toBe(true);
    expect(nameIsAmongAuthors("Jane Doe", "Doe, Jane; Smith, Bob")).toBe(true);
    expect(nameIsAmongAuthors("Jane Doe", "J. Doe")).toBe(true);
  });

  it("does not match coverage about the person", () => {
    expect(nameIsAmongAuthors("Jane Doe", "School District Newsroom")).toBe(
      false
    );
    expect(nameIsAmongAuthors("Jane Doe", "Alice Smith")).toBe(false);
    expect(splitAuthorList("Alice Smith, Bob Lee").includes("Jane Doe")).toBe(
      false
    );
  });
});

describe("articleAuthoredByCandidate", () => {
  it("keeps a matching byline and drops a foreign byline", () => {
    expect(
      articleAuthoredByCandidate(
        {
          canonical_url: "https://arxiv.org/abs/2401.1",
          author_text: "Jane Doe, Alice Smith",
        },
        { candidateName: "Jane Doe" }
      )
    ).toBe(true);
    expect(
      articleAuthoredByCandidate(
        {
          canonical_url: "https://news.example/p",
          author_text: "District Communications",
        },
        { candidateName: "Jane Doe" }
      )
    ).toBe(false);
  });

  it("keeps unbylined posts on the personal site, not news or school sites", () => {
    expect(
      articleAuthoredByCandidate(
        { canonical_url: "https://janedoe.me/blog/runtime" },
        {
          candidateName: "Jane Doe",
          personalSiteUrl: "https://janedoe.me/",
        }
      )
    ).toBe(true);
    expect(
      articleAuthoredByCandidate(
        { canonical_url: "https://www.nytimes.com/2024/01/01/science/kid.html" },
        {
          candidateName: "Jane Doe",
          personalSiteUrl: "https://janedoe.me/",
        }
      )
    ).toBe(false);
    expect(
      articleAuthoredByCandidate(
        {
          canonical_url: "https://www.apsva.k12.va.us/message-of-support",
        },
        {
          candidateName: "Jane Doe",
          personalSiteUrl: "https://www.apsva.k12.va.us/",
        }
      )
    ).toBe(false);
  });

  it("keeps unbylined stories on a writing hub linked from the personal site", () => {
    expect(
      articleAuthoredByCandidate(
        {
          canonical_url:
            "https://medium.com/@jane/kotlin-tutorial-part-1-abc",
        },
        {
          candidateName: "Jane Doe",
          personalSiteUrl: "https://janedoe.me/",
          hubProfileUrls: ["https://jane.medium.com/"],
        }
      )
    ).toBe(true);
  });
});
