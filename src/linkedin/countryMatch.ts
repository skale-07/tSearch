const COUNTRY_ALIASES: Record<string, string[]> = {
  usa: ["usa", "united states", "united states of america", "u.s.", "america"],
  "united states of america": [
    "usa",
    "united states",
    "united states of america",
    "u.s.",
    "america",
  ],
  china: ["china", "chinese", "people's republic of china", "prc"],
  "new zealand": ["new zealand"],
  poland: ["poland", "polish"],
  israel: ["israel", "israeli"],
  romania: ["romania", "romanian"],
  canada: ["canada", "canadian"],
  "united kingdom": [
    "united kingdom",
    "uk",
    "britain",
    "england",
    "scotland",
    "wales",
  ],
  germany: ["germany", "german"],
  india: ["india", "indian"],
  singapore: ["singapore", "singaporean"],
  australia: ["australia", "australian"],
  japan: ["japan", "japanese"],
  korea: ["south korea", "korea", "republic of korea"],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function countrySearchTerms(country: string): string[] {
  const key = norm(country);
  const aliases = COUNTRY_ALIASES[key];
  if (aliases) return [...new Set(aliases.map(norm))].map((a) => a);
  return [country];
}

/** Single term for LinkedIn keyword search — no duplicate aliases. */
export function primaryCountrySearchTerm(country: string): string {
  const key = norm(country);
  if (
    key === "usa" ||
    key === "united states of america" ||
    key === "united states" ||
    key === "u s a" ||
    key === "america"
  ) {
    return "United States";
  }
  return country.trim();
}

export function countryFromLocation(location: string | null): string | null {
  if (!location) return null;
  const parts = location
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

export function countryMatchesText(country: string, text: string): boolean {
  const blob = norm(text);
  if (!blob) return false;
  return countrySearchTerms(country).some((term) => blob.includes(norm(term)));
}

export function countriesMatch(a: string, b: string): boolean {
  const termsA = new Set(countrySearchTerms(a).map(norm));
  const termsB = new Set(countrySearchTerms(b).map(norm));
  for (const ta of termsA) {
    for (const tb of termsB) {
      if (ta === tb || ta.includes(tb) || tb.includes(ta)) return true;
    }
  }
  return false;
}
