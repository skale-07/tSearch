import { ghFetch } from "../src/github/githubSearch.js";

const u = await ghFetch<Record<string, unknown>>("/users/arihantchoudhary");
const s = await ghFetch<unknown[]>("/users/arihantchoudhary/social_accounts");
console.log(
  JSON.stringify(
    {
      login: u?.login,
      name: u?.name,
      bio: u?.bio,
      blog: u?.blog,
      twitter_username: u?.twitter_username,
      company: u?.company,
      location: u?.location,
      email: u?.email,
      html_url: u?.html_url,
      social: s,
    },
    null,
    2
  )
);
