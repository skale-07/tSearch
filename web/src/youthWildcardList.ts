/** Score-page split: youth freeze vs everyone else. */

export function isYouthWildcardRow(c: {
  youth_wildcard?: boolean;
  youth_wildcard_alumni?: boolean;
}): boolean {
  return Boolean(c.youth_wildcard || c.youth_wildcard_alumni);
}

export function partitionYouthWildcardRows<
  T extends {
    youth_wildcard?: boolean;
    youth_wildcard_alumni?: boolean;
  },
>(rows: T[]): { current: T[]; past: T[]; rest: T[] } {
  const current: T[] = [];
  const past: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    if (row.youth_wildcard) current.push(row);
    else if (row.youth_wildcard_alumni) past.push(row);
    else rest.push(row);
  }
  return { current, past, rest };
}
