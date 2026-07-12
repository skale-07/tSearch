import { parseStringPromise } from "xml2js";

export async function fetchSubstackFeed(
  slug: string
): Promise<{ posts: number; titles: string[] } | null> {
  const url = `https://${slug}.substack.com/feed`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "tsearch-unseen-talent" },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const parsed = await parseStringPromise(xml);
    const items =
      parsed?.rss?.channel?.[0]?.item ?? parsed?.feed?.entry ?? [];
    const list = Array.isArray(items) ? items : [];
    const titles = list
      .map((it: { title?: string[] }) => it.title?.[0] ?? "")
      .filter(Boolean);
    return { posts: list.length, titles };
  } catch {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "tsearch-unseen-talent" },
      });
      const text = await res.text();
      const m = text.match(/<item[\s>]/gi);
      return m ? { posts: m.length, titles: [] } : null;
    } catch {
      return null;
    }
  }
}
