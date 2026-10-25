/** Web addresses in a message (http(s) or www.), without trailing punctuation; at most five. */
export function findLinks(text: string): string[] {
  const found = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi) ?? [];
  const urls = found.map((u) => {
    const clean = u.replace(/[.,;:!?)\]}»“”‘’]+$/, "");
    return /^www\./i.test(clean) ? `https://${clean}` : clean;
  });
  return [...new Set(urls)].slice(0, 5);
}

/** "https://www.example.com/a/b?x" → "example.com/a/b" for display. */
export function shortLink(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return u.hostname.replace(/^www\./, "") + path;
  } catch {
    return url;
  }
}
