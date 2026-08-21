import { describe, expect, it } from "vitest";
import {
  extractWritingHubProfiles,
  extractWritingPlatformArticleLinks,
  feedUrlsForWritingHub,
  firstWritingSurfaceUrl,
  isAuthoredPublicationUrl,
  isNewsCoverageUrl,
  isWritingHubProfileUrl,
  isWritingPlatformArticleUrl,
  isWritingPlatformHost,
} from "../../../src/assessment/blog/writingHubs.js";

describe("writingHubs", () => {
  it("classifies Medium profile vs story URLs", () => {
    expect(isWritingHubProfileUrl("https://armanco.medium.com/")).toBe(true);
    expect(isWritingHubProfileUrl("https://medium.com/@armanco")).toBe(true);
    expect(
      isWritingPlatformArticleUrl(
        "https://medium.com/@armanco/kotlin-tutorial-part-1-introduction-2dc17497b610"
      )
    ).toBe(true);
    expect(
      isWritingHubProfileUrl(
        "https://medium.com/@armanco/kotlin-tutorial-part-1-introduction-2dc17497b610"
      )
    ).toBe(false);
  });

  it("recognizes common off-site writing platforms", () => {
    expect(isWritingHubProfileUrl("https://alice.substack.com/")).toBe(true);
    expect(isWritingHubProfileUrl("https://dev.to/alice")).toBe(true);
    expect(isWritingHubProfileUrl("https://alice.hashnode.dev/")).toBe(true);
    expect(isWritingHubProfileUrl("https://hashnode.com/@alice")).toBe(true);
    expect(isWritingHubProfileUrl("https://alice.bearblog.dev/")).toBe(true);
    expect(isWritingHubProfileUrl("https://alice.ghost.io/")).toBe(true);
    expect(isWritingHubProfileUrl("https://alice.blogspot.com/")).toBe(true);
    expect(isWritingHubProfileUrl("https://alice.wordpress.com/")).toBe(true);
    expect(isWritingHubProfileUrl("https://subscribe.wordpress.com/")).toBe(
      false
    );
    expect(isWritingPlatformHost("https://subscribe.wordpress.com/")).toBe(
      false
    );
    expect(
      isWritingPlatformArticleUrl(
        "https://themichelleparkcom.wordpress.com/research/"
      )
    ).toBe(false);
    expect(
      isWritingPlatformArticleUrl(
        "https://themichelleparkcom.wordpress.com/2025/07/07/hello-world/"
      )
    ).toBe(true);
    expect(isWritingHubProfileUrl("https://alice.beehiiv.com/")).toBe(true);
    expect(isWritingHubProfileUrl("https://alice.tumblr.com/")).toBe(true);
    expect(
      firstWritingSurfaceUrl([
        "https://github.com/alice",
        "https://medium.com/@alice",
      ])
    ).toBe("https://medium.com/@alice");
    expect(isWritingHubProfileUrl("https://zenn.dev/alice")).toBe(true);
    expect(isWritingHubProfileUrl("https://qiita.com/alice")).toBe(true);
    expect(isWritingHubProfileUrl("https://mirror.xyz/alice")).toBe(true);
    expect(
      isWritingPlatformArticleUrl(
        "https://hackernoon.com/how-to-ship-faster-abc123"
      )
    ).toBe(true);
    expect(
      isWritingPlatformArticleUrl(
        "https://www.linkedin.com/pulse/some-essay-title-alice-smith"
      )
    ).toBe(true);
    expect(isWritingPlatformHost("https://github.com/alice/repo")).toBe(false);
    expect(
      isAuthoredPublicationUrl("https://arxiv.org/abs/2401.00001")
    ).toBe(true);
    expect(
      isAuthoredPublicationUrl(
        "https://www.nature.com/articles/s41586-024-00000-0"
      )
    ).toBe(true);
    expect(isAuthoredPublicationUrl("https://www.nytimes.com/2024/01/01/science/kid.html")).toBe(
      false
    );
    expect(isNewsCoverageUrl("https://techcrunch.com/2024/01/01/startup")).toBe(
      true
    );
    expect(
      firstWritingSurfaceUrl([
        "https://www.forbes.com/sites/someone",
        "https://arxiv.org/abs/2401.00001",
      ])
    ).toBe("https://arxiv.org/abs/2401.00001");
  });

  it("extracts hubs and stories from personal-site HTML", () => {
    const html = `<html><body>
      <a href="https://armanco.medium.com/">Medium</a>
      <a href="https://medium.com/@armanco/null-undefined-safety-in-typescript-165fb4977194">post</a>
      <a href="https://alice.substack.com/p/hello">Substack post</a>
      <a href="https://dev.to/alice/my-post-1">dev.to</a>
      <a href="/medium.svg">icon</a>
      <a href="https://github.com/armancodv">GitHub</a>
    </body></html>`;
    expect(extractWritingHubProfiles(html, "https://armanko.com/en/")).toEqual([
      "https://armanco.medium.com/",
    ]);
    const stories = extractWritingPlatformArticleLinks(
      html,
      "https://armanko.com/en/"
    );
    expect(stories).toContain(
      "https://medium.com/@armanco/null-undefined-safety-in-typescript-165fb4977194"
    );
    expect(stories.some((u) => u.includes("substack.com/p/"))).toBe(true);
    expect(stories.some((u) => u.includes("dev.to/alice/"))).toBe(true);
  });

  it("rejects Medium platform chrome (privacy / jobs)", () => {
    expect(
      isWritingPlatformHost("https://policy.medium.com/medium-privacy-policy-x")
    ).toBe(false);
    expect(
      isWritingPlatformArticleUrl(
        "https://policy.medium.com/medium-privacy-policy-f03bf92035c9"
      )
    ).toBe(false);
    expect(
      isWritingPlatformArticleUrl(
        "https://medium.com/jobs-at-medium/work-at-medium-959d1a85284e"
      )
    ).toBe(false);
    expect(
      isWritingPlatformArticleUrl(
        "https://armanco.medium.com/utility-types-in-typescript-7b50c50b7e8c"
      )
    ).toBe(true);
    expect(
      isWritingPlatformArticleUrl(
        "https://medium.com/@armanco/kotlin-tutorial-part-1-introduction-2dc17497b610"
      )
    ).toBe(true);
  });

  it("maps hub profiles to feed URLs", () => {
    expect(feedUrlsForWritingHub("https://armanco.medium.com/")).toEqual([
      "https://armanco.medium.com/feed",
    ]);
    expect(feedUrlsForWritingHub("https://medium.com/@armanco")).toEqual([
      "https://medium.com/feed/@armanco",
    ]);
    expect(feedUrlsForWritingHub("https://alice.substack.com/")).toEqual([
      "https://alice.substack.com/feed",
    ]);
    expect(feedUrlsForWritingHub("https://dev.to/alice")).toEqual([
      "https://dev.to/feed/alice",
    ]);
    expect(feedUrlsForWritingHub("https://alice.bearblog.dev/")).toEqual([
      "https://alice.bearblog.dev/rss/",
      "https://alice.bearblog.dev/feed/",
    ]);
    expect(feedUrlsForWritingHub("https://zenn.dev/alice")).toEqual([
      "https://zenn.dev/alice/feed",
    ]);
  });
});
