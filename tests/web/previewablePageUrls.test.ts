import { describe, expect, it } from "vitest";
import { previewablePageUrls } from "../../web/src/previewablePageUrls.js";

describe("previewablePageUrls", () => {
  it("keeps website and blog, skips LinkedIn and GitHub profiles", () => {
    expect(
      previewablePageUrls({
        website: "https://www.example.com/lab/",
        blog: "https://notes.example.com/posts/hello",
      })
    ).toEqual([
      {
        label: "Website · example.com/lab",
        url: "https://www.example.com/lab",
      },
      {
        label: "Blog · notes.example.com/posts/hello",
        url: "https://notes.example.com/posts/hello",
      },
    ]);

    expect(
      previewablePageUrls({
        website: "https://www.linkedin.com/in/ada/",
        blog: "https://github.com/ada",
      })
    ).toEqual([]);
  });

  it("dedupes after canonicalize and includes blog-only", () => {
    expect(
      previewablePageUrls({
        website: "https://lab.example/people/",
        blog: "https://lab.example/people",
      })
    ).toHaveLength(1);

    const blogOnly = previewablePageUrls({
      blog: "https://janak.substack.com/",
    });
    expect(blogOnly).toHaveLength(1);
    expect(blogOnly[0]?.label).toBe("Blog · janak.substack.com");
  });

  it("allows GitHub Pages hosts and extra/profile URLs", () => {
    const opts = previewablePageUrls(
      { website: "https://ada.github.io/notes/" },
      ["https://ada.github.io/notes/", "https://papers.example/ada"]
    );
    expect(opts.map((o) => o.label)).toEqual([
      "Website · ada.github.io/notes",
      "Site · papers.example/ada",
    ]);
  });
});
