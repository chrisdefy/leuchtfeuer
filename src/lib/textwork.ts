/**
 * Working on texts: finished texts come as ```text blocks (shown as a text card), and a marked passage
 * can be rewritten on its own without regenerating the whole answer.
 */

/** Always part of the system prompt: costs a few dozen tokens, makes finished texts copy-ready. */
export const TEXT_GUIDE =
  "Wenn der Nutzer einen fertigen Text zum Übernehmen möchte (E-Mail, Brief, Nachricht, Beitrag, Bewerbung, Vorlage), setze genau diesen Text ohne Erklärungen in einen Codeblock mit der Sprache text. Erklärungen und Rückfragen gehören davor oder danach.";

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * Finds a passage the user marked in the rendered answer within its Markdown source. Rendered text lacks
 * the Markdown marks (**, list numbers, link targets), so words are matched with anything in between.
 */
export function locate(source: string, marked: string): { start: number; end: number } | null {
  const exact = source.indexOf(marked);
  if (exact !== -1) return { start: exact, end: exact + marked.length };
  const words = marked.match(WORD);
  if (!words?.length) return null;
  const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(words.map(escape).join("[^\\p{L}\\p{N}]{1,40}"), "u");
  const m = pattern.exec(source);
  if (!m) return null;
  // Keep closing punctuation and emphasis that belong to the last word ("Zins**." → include "**.").
  let end = m.index + m[0].length;
  const tail = /^[*_`]*[.,;:!?)"“”»]?/.exec(source.slice(end));
  if (tail) end += tail[0].length;
  let start = m.index;
  const lead = /[*_`(„"«]*$/.exec(source.slice(Math.max(0, start - 3), start));
  if (lead) start -= lead[0].length;
  return { start, end };
}

/** The request for rewriting one passage: the whole text only for context, the answer is the new passage alone. */
export function passagePrompt(text: string, passage: string, instruction: string) {
  return [
    {
      role: "system" as const,
      content:
        "Du überarbeitest eine einzelne Textstelle. Antworte ausschließlich mit der neuen Fassung der markierten Stelle: ohne Anführungszeichen, ohne Einleitung, ohne Erklärung, im gleichen Format (Markdown) und in der gleichen Sprache wie das Original. Ändere nur, was die Anweisung verlangt, und lass alles andere wie es ist. Die neue Fassung muss nahtlos in den umgebenden Text passen.",
    },
    {
      role: "user" as const,
      content: `Gesamter Text, nur zum Verständnis:\n<<<\n${text}\n>>>\n\nMarkierte Stelle:\n<<<\n${passage}\n>>>\n\nÄnderung: ${instruction}`,
    },
  ];
}

/** Models sometimes wrap the new passage in quotes, fences or the markers; take those off. */
export function cleanPassage(reply: string, original: string) {
  let t = reply.trim().replace(/^<<<\s*|\s*>>>$/g, "");
  const fence = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(t);
  if (fence && !original.trim().startsWith("```")) t = fence[1];
  if (/^["„“»]/.test(t) && /["“”«]$/.test(t) && !/^["„“»]/.test(original.trim())) t = t.slice(1, -1);
  // Keep the original's surrounding whitespace so paragraphs stay apart.
  const lead = /^\s*/.exec(original)![0];
  const trail = /\s*$/.exec(original)![0];
  return lead + t.trim() + trail;
}

/** Plain words of a Markdown passage, for finding it again in the rendered answer. */
export function plainWords(markdown: string) {
  return markdown.match(WORD) ?? [];
}
