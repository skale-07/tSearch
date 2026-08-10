import { describe, it, expect } from "vitest";
import type { Page } from "playwright";
import {
  assertLinkedInAuth,
  LinkedInAuthError,
} from "../../src/linkedin/linkedinBrowser.js";

const pageAt = (url: string) => ({ url: () => url }) as unknown as Page;

describe("assertLinkedInAuth", () => {
  it("throws LinkedInAuthError on login/checkpoint/authwall redirects", () => {
    for (const url of [
      "https://www.linkedin.com/login",
      "https://www.linkedin.com/checkpoint/challenge/xyz",
      "https://www.linkedin.com/authwall?trk=x",
      "https://www.linkedin.com/uas/login?session_redirect=/feed",
    ]) {
      expect(() => assertLinkedInAuth(pageAt(url))).toThrow(LinkedInAuthError);
    }
  });

  it("passes on ordinary profile, search, and feed pages", () => {
    for (const url of [
      "https://www.linkedin.com/feed/",
      "https://www.linkedin.com/in/someone/",
      "https://www.linkedin.com/search/results/people/?keywords=x",
      // profile slug containing the word "login" must not trip the guard
      "https://www.linkedin.com/in/loginova/",
    ]) {
      expect(() => assertLinkedInAuth(pageAt(url))).not.toThrow();
    }
  });
});
