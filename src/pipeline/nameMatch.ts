/** 0..1 name-similarity between a person name and a github login/display name. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function nameMatchConfidence(
  name: string,
  login: string,
  displayName: string | null
): number {
  const target = norm(name);
  const l = norm(login);
  const d = displayName ? norm(displayName) : "";
  if (d === target || l === target) return 1;
  if (d && (d.includes(target) || target.includes(d))) return 0.8;
  const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = norm(parts[0]!);
    const last = norm(parts[parts.length - 1]!);
    if (l.includes(first) && l.includes(last)) return 0.75;
    if (l.includes(last) || l.includes(first + (last[0] ?? ""))) return 0.45;
  }
  if (target.includes(l) || l.includes(target)) return 0.5;
  return 0.1;
}
