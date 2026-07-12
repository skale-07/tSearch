const q = encodeURIComponent('"Scott Wu" site:linkedin.com/in');
const url = `https://www.bing.com/search?q=${q}`;
const res = await fetch(url, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html",
  },
});
const html = await res.text();
console.log("status", res.status, "len", html.length);
console.log("linkedin", (html.match(/linkedin\.com\/in/g) || []).length);
const links = [...html.matchAll(/https?:\/\/[^"'\s<>]*linkedin\.com\/in\/[a-zA-Z0-9_-]+/gi)];
for (const m of links.slice(0, 8)) console.log(m[0]);
