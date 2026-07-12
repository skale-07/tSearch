const q = encodeURIComponent('"Scott Wu" site:linkedin.com/in');
const url = `https://html.duckduckgo.com/html/?q=${q}`;
const res = await fetch(url, {
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
});
const html = await res.text();
console.log("status", res.status, "len", html.length);
console.log("result__a", (html.match(/result__a/g) || []).length);
console.log("linkedin", (html.match(/linkedin\.com\/in/g) || []).length);
console.log(html.slice(0, 3000));
