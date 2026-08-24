import { describe, expect, it } from "vitest";
import { websiteFetchFailureMessage } from "../../src/website/fetchWebsiteHtml.js";

describe("websiteFetchFailureMessage", () => {
  it("names HTTP 404 so the operator can paste another URL", () => {
    expect(
      websiteFetchFailureMessage("https://ungaforskare.se/siyss/", {
        ok: false,
        httpStatus: 404,
        finalUrl: "https://ungaforskare.se/siyss/",
      })
    ).toMatch(/HTTP 404/);
  });

  it("falls back when the request never got a status", () => {
    expect(
      websiteFetchFailureMessage("https://lab.example/people", {
        ok: false,
        finalUrl: "https://lab.example/people",
      })
    ).toBe("Could not fetch https://lab.example/people");
  });
});
