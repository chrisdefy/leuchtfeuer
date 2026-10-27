/** Web addresses in a message (http(s) or www.), without trailing punctuation; at most five. */
export function findLinks(text: string): string[] {
  const found = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi) ?? [];
  const urls = found.map((u) => {
    const clean = u.replace(/[.,;:!?)\]}»“”‘’]+$/, "");
    return /^www\./i.test(clean) ? `https://${clean}` : clean;
  });
  return [...new Set(urls)].slice(0, 5);
}

/**
 * Told to the model when web search is on. Models that are not told often answer from memory or say
 * they cannot go online, although the search tool is right there.
 */
export const WEB_NOTE =
  "Du hast in diesem Chat Zugriff auf eine Websuche. Nutze sie bei allem, was aktuell sein muss oder sich ändert: Wetter, Nachrichten, Preise, Öffnungszeiten, Termine, Ergebnisse, neue Versionen. Sag nie, du hättest keinen Internetzugang. Nenne die Quellen, auf die du dich stützt.";

/** The answer claims the model cannot go online (German or English), which with web search on is wrong. */
export function deniesWebAccess(text: string) {
  return /(keinen?|nicht über einen?|ohne) (direkten |aktuellen |Echtzeit-?)?(Zugriff|Zugang) (auf|zum|ins) (das |die )?(Internet|Web|aktuelle|Echtzeit)|keine Echtzeit|(nicht|kann ich nicht) (im Internet|online|im Web) (suchen|nachsehen|nachschauen|abrufen|recherchieren)|keine (aktuellen|Live-?)(daten|informationen|wetterdaten)|(can't|cannot|can not|unable to|don't have the ability to) (browse|access the internet|search the (web|internet)|access real-time)|(no|don't have|do not have) (access to )?(the )?(internet|real-time (data|information))/i.test(
    text,
  );
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
