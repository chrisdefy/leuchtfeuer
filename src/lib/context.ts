import { CAP, smartest } from "./helpers";
import { laneHistory, laneOf } from "./conversation";
import { perMillion, type Model } from "./openrouter";
import type { Chat } from "./storage";

/** Above this, long-context quality noticeably drops for demanding tasks, whatever the window. */
export const LONG_CHAT_TOKENS = 100_000;

export type ContextLevel = "ok" | "long" | "full";

export interface ContextUsage {
  tokens: number;
  /** Context window of the chat's model, if known. */
  window?: number;
  level: ContextLevel;
  /** True when `tokens` comes from the API's own count, false when estimated from text length. */
  measured: boolean;
}

/** Rough token count for text we have not sent yet (≈ 3.5 characters per token for German and English). */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 3.5);
}

/**
 * How much of the model's context the next request will use.
 * The last answer's prompt + completion tokens is exactly what the next request resends.
 */
export function contextUsage(chat: Chat, model?: Model): ContextUsage {
  const main = chat.messages.filter((m) => m.role === "user" || laneOf(m) === 0);
  const lastMeasured = [...main].reverse().find((m) => m.usage && !m.video);
  let tokens: number;
  let measured = false;
  if (lastMeasured?.usage) {
    const after = main.slice(main.indexOf(lastMeasured) + 1);
    tokens =
      lastMeasured.usage.promptTokens +
      lastMeasured.usage.completionTokens +
      after.reduce((n, m) => n + estimateTokens(m.content), 0);
    measured = true;
  } else {
    tokens =
      main.reduce((n, m) => n + estimateTokens(m.content), 0) + (chat.seed ? estimateTokens(chat.seed.summary) : 0);
  }
  const window = model?.context_length;
  const level: ContextLevel =
    window && tokens >= window * 0.8 ? "full" : tokens >= LONG_CHAT_TOKENS || (window && tokens >= window * 0.5) ? "long" : "ok";
  return { tokens, window, level, measured };
}

/** Summary budget: about 8 % of the conversation, between ~600 and ~4,000 tokens. */
export function summaryBudget(contextTokens: number) {
  const tokens = Math.round(Math.min(4000, Math.max(600, contextTokens * 0.08)) / 100) * 100;
  return { tokens, words: Math.round((tokens * 0.7) / 50) * 50 };
}

export function summaryPrompt(words: number) {
  return `Fasse das bisherige Gespräch so zusammen, dass ein neuer Chat nahtlos daran anknüpfen kann. Die Zusammenfassung ersetzt den Verlauf vollständig: Was hier fehlt, ist verloren.

Gliedere sie in diese Abschnitte und lass leere weg:
## Ziel und Ausgangslage
## Ergebnisse und Entscheidungen
## Wichtige Fakten, Zahlen und Namen
## Vorgaben und Vorlieben des Nutzers
## Wörtlich übernommene Inhalte
## Offene Fragen und nächste Schritte

Regeln:
- Zahlen, Namen, Daten, Code und Fachbegriffe exakt übernehmen. Nichts runden oder umschreiben.
- Code, Formeln, Definitionen und Formulierungen, auf die es ankommt, unverändert unter „Wörtlich übernommene Inhalte“, Code in Codeblöcken.
- Spätere Entscheidungen haben Vorrang vor früheren. Verworfene Ansätze nur kurz mit Grund nennen.
- Nichts hinzufügen, was nicht im Gespräch steht. Unsicheres als unsicher kennzeichnen.
- Knapp und in Stichpunkten, in der Sprache des Gesprächs.
- Umfang: höchstens etwa ${words} Wörter.

Antworte nur mit der Zusammenfassung, ohne Einleitung.`;
}

export const COMPLETE_MARK = "VOLLSTÄNDIG";

export function checkPrompt(summary: string) {
  return `Unten steht eine Zusammenfassung des Gesprächs oben. Sie soll den Verlauf in einem neuen Chat vollständig ersetzen.

Prüfe sie gegen den Verlauf: Welche wichtigen Punkte fehlen oder sind falsch wiedergegeben? Wichtig ist alles, was man zum Weiterarbeiten braucht: Entscheidungen, Fakten, Zahlen, Vorgaben, Code, offene Fragen. Nebensächliches ignorieren.

Antworte nur mit einer Stichpunktliste, in der Sprache des Gesprächs. Jeder Punkt enthält den fehlenden oder korrigierten Inhalt selbst, so formuliert, dass er direkt in die Zusammenfassung übernommen werden kann. Also „Name des Cafés: Bohne & Buch“, nicht „Der Name des Cafés fehlt“. Bei Korrekturen: „Korrektur: …“. Ist nichts Wesentliches verloren, antworte genau: ${COMPLETE_MARK}

--- Zusammenfassung ---
${summary}`;
}

export function seedNote(summary: string) {
  return `Dieser Chat setzt ein früheres Gespräch fort. Hier ist die Zusammenfassung des bisherigen Stands. Behandle sie als gemeinsamen Kontext, auf den sich der Nutzer beziehen kann:\n\n${summary}`;
}

/** Cheap, long-context models for checks and summaries while there are no benchmark scores, in order of preference. */
const CHECKERS = ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna", "google/gemini-3.8-flash", "deepseek/deepseek-v4.1-flash"];

/**
 * A helper for titles, summaries, gap checks and the like: the smartest affordable model with room for
 * `neededTokens`, preferably from a maker not in `avoidMakers`.
 */
export function pickChecker(models: Model[], neededTokens: number, fallback: string, avoidMakers?: Set<string>) {
  const minContext = neededTokens * 1.2;
  const auto = smartest(models, CAP.helper, { minContext, avoidMakers })[0] ?? smartest(models, CAP.helper, { minContext })[0];
  if (auto) return auto;
  const byId = new Map(models.map((m) => [m.id, m]));
  return CHECKERS.map((id) => byId.get(id)).find((m) => m && m.context_length > minContext)?.id ?? fallback;
}

/** Estimated USD for one request. */
export function estimateCost(model: Model | undefined, inputTokens: number, outputTokens: number) {
  if (!model) return undefined;
  const p = perMillion(model.pricing.prompt);
  const c = perMillion(model.pricing.completion);
  if (p === null || c === null) return undefined;
  return (inputTokens * p + outputTokens * c) / 1_000_000;
}

/** History of the chat's main lane, as the summarizer sees it. */
export function mainHistory(chat: Chat) {
  return laneHistory(chat.messages, 0);
}
