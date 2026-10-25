import { pickChecker } from "./context";
import { complete, type Model } from "./openrouter";

/** Short, specific title for a conversation; uses a cheap model. */
export async function makeTitle(opts: { apiKey: string; models: Model[]; fallbackModel: string; text: string }) {
  const model = pickChecker(opts.models, 2000, opts.fallbackModel);
  const { text } = await complete({
    apiKey: opts.apiKey,
    model,
    signal: new AbortController().signal,
    maxTokens: 40,
    messages: [
      {
        role: "system",
        content:
          "Gib dem folgenden Gespräch einen kurzen, treffenden Titel: 2 bis 6 Wörter in der Sprache des Gesprächs. " +
          "Nenne das konkrete Thema, nicht die Art des Gesprächs (also nicht „Frage zu …“, „Chat über …“, „Hilfe bei …“). " +
          "Ohne Anführungszeichen, ohne Punkt am Ende. Antworte nur mit dem Titel.",
      },
      { role: "user", content: opts.text.slice(0, 4000) },
    ],
  });
  const title = text
    .trim()
    .split("\n")[0]
    .replace(/^(titel|title)\s*:\s*/i, "")
    .replace(/^["„“'*#\s]+|["“”'*.\s]+$/g, "")
    .trim();
  return title && title.length <= 80 ? title : null;
}
