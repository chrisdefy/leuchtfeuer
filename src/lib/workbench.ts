import { isClassifier, scoreOf, type Scores } from "./benchmarks";
import { estimateCost, pickChecker } from "./context";
import { formatCost } from "./format";
import {
  OpenRouterError,
  complete,
  isFree,
  isFreeModelId,
  makesImages,
  shortName,
  type Model,
  type Usage,
  type VideoModel,
} from "./openrouter";
import { blendedPrice, frontierModels, USE_CASES } from "./recommend";

/**
 * The workbench turns a rough brainstorm into a prepared chat: a clear task, a fitting
 * role and way of working for the model, and a model that suits the task.
 * Models fill gaps in vague requests with average assumptions; the questions and the
 * explicit goal, context and output format are what make answers specific.
 */

export interface Question {
  q: string;
  /** Quick answers to tap. */
  options: string[];
}

export type TaskKind = "text" | "image" | "video";
export type Difficulty = "einfach" | "mittel" | "anspruchsvoll";

export interface Brief {
  title: string;
  kind: TaskKind;
  /** USE_CASES id or "general". */
  area: string;
  difficulty: Difficulty;
  web: boolean;
  role: string;
  approach: string;
  why: string;
  /** Instruction for the model (system prompt). Empty for image and video tasks. */
  system: string;
  /** The task as the chat's first message. */
  task: string;
}

export interface Suggestion {
  id: string;
  name: string;
  badge: string;
  reason: string;
}

const AREAS = [...USE_CASES.map((u) => `${u.id} (${u.label})`), "general (alles andere)"].join(", ");

const QUESTIONS_SYSTEM = `Du hilfst einem Nutzer, eine Aufgabe für einen KI-Chat vorzubereiten. Er hat seine Idee grob notiert, oft diktiert und ungeordnet.

Entscheide, ob Angaben fehlen, ohne die ein KI-Modell nur raten könnte und das Ergebnis deutlich schlechter würde. Typisch sind: wofür das Ergebnis gebraucht wird, für wen es ist, was am Ende vorliegen soll, wichtige Rahmenbedingungen wie Budget, Umfang, Zeit oder Vorwissen.

Regeln:
- Höchstens 3 Fragen, nur zu wirklich Wichtigem. Nichts fragen, was schon im Text steht oder sich daraus ergibt.
- Ist die Aufgabe einfach oder schon klar genug, stelle keine Fragen.
- Kurze, freundliche Fragen in Alltagssprache, in der Sprache des Nutzers, mit „du“.
- Zu jeder Frage 2 bis 4 kurze Antwortvorschläge zum Antippen, wenn sinnvoll (sonst leere Liste).

Antworte nur mit JSON, ohne Erklärung:
{"questions":[{"q":"Frage","options":["Vorschlag","Vorschlag"]}]}`;

const BRIEF_SYSTEM = `Du bereitest für einen Nutzer einen Chat mit einem KI-Modell vor. Du bekommst seine grobe Idee, oft diktiert und ungeordnet, und eventuell Antworten auf Rückfragen. Daraus machst du drei Dinge:

1. Die Aufgabe, ausformuliert als erste Nachricht des Nutzers an das Modell (Ich-Form, in seiner Sprache). Sie soll zielführend sein:
   - Ziel: was am Ende erreicht oder vorliegen soll.
   - Hintergrund: alles Relevante, was der Nutzer erzählt hat, mit allen Zahlen, Namen und Details.
   - Vorgaben und Grenzen.
   - Gewünschtes Ergebnis: Form, Umfang, Ton (z. B. Tabelle, Schritt-für-Schritt-Plan, Entwurf zum Weiterbearbeiten).
   - Woran ein gutes Ergebnis zu erkennen ist.
   Gliedere mit kurzen Zeilen wie „Ziel:“ oder „Hintergrund:“ und Spiegelstrichen („- “), wenn die Aufgabe das trägt. Keine Markdown-Überschriften (#), kein Fettdruck: Der Text erscheint unformatiert im Chat. Für einfache Aufgaben reichen zwei, drei Sätze ohne Gliederung.

2. Eine Arbeitsanweisung an das Modell (Systemanweisung, in Du-Form an das Modell gerichtet):
   - Eine passende Rolle mit konkreter Expertise und Haltung, z. B. „Du bist eine erfahrene Gründungsberaterin, die Businesspläne für Bankgespräche erstellt“.
   - Ein Vorgehen, das diese Art Aufgabe gut löst: eine bewährte Methode oder ein Rahmen, wenn es einen gibt (z. B. Business Model Canvas, Pro-und-Contra-Abwägung, Fehlersuche Schritt für Schritt, Lernplan mit Wiederholungen), sonst sinnvolle Arbeitsschritte.
   - Qualitätsregeln: Annahmen als Annahmen kennzeichnen, bei fehlenden wichtigen Angaben erst kurz nachfragen statt zu raten, konkret statt allgemein.
   - Wie die Antworten aufgebaut sein sollen.
   Knapp, höchstens etwa 150 Wörter.

3. Eine Einordnung der Aufgabe, damit die App ein passendes Modell empfehlen kann.

Grundregeln:
- Die Absicht des Nutzers bleibt genau erhalten. Nichts erfinden: keine Zahlen, Namen oder Fakten, die er nicht genannt hat. Was offen ist, bleibt offen oder wird als zu klären markiert.
- Der Umfang passt zur Aufgabe. Eine kleine Frage wird nicht zum Projekt aufgeblasen.
- Bild- oder Videowünsche: Die Aufgabe ist dann eine anschauliche Beschreibung dessen, was zu sehen sein soll (Motiv, Handlung, Ort, Licht, Stil), ohne Gliederung, und die Arbeitsanweisung bleibt leer.

Antworte nur mit JSON, ohne Erklärung, genau in dieser Form:
{
  "title": "Chat-Titel, 2 bis 6 Wörter, nennt das Thema",
  "kind": "text" | "image" | "video",
  "area": eine von: ${AREAS},
  "difficulty": "einfach" | "mittel" | "anspruchsvoll",
  "web": true wenn aktuelle Informationen aus dem Internet nötig sind, sonst false,
  "role": "die Rolle in 2 bis 5 Wörtern",
  "approach": "Name des Vorgehens oder Rahmens in 2 bis 6 Wörtern",
  "why": "ein Satz an den Nutzer, warum diese Rolle und dieses Vorgehen passen",
  "system": "die Arbeitsanweisung",
  "task": "die ausformulierte Aufgabe"
}

„anspruchsvoll“ heißt: mehrere Schritte, Abwägungen, Fachwissen oder viel Text (z. B. Businessplan, Vertrag prüfen, Programm schreiben). „einfach“ heißt: kurze Auskunft, kleine Umformulierung, Ideen sammeln.`;

/** First JSON object in a model answer; tolerates code fences and stray text around it. */
function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

interface CallOpts {
  apiKey: string;
  /** Preferred model, then a free fallback for accounts without credit. */
  models: string[];
  signal: AbortSignal;
}

async function ask(opts: CallOpts, system: string, user: string) {
  let lastError: unknown;
  for (const model of opts.models) {
    try {
      const res = await complete({
        apiKey: opts.apiKey,
        model,
        signal: opts.signal,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      return { ...res, model };
    } catch (e) {
      lastError = e;
      // No credit (402) or a busy free model (429): try the next one.
      if (!(e instanceof OpenRouterError) || (e.status !== 402 && e.status !== 429)) throw e;
    }
  }
  throw lastError;
}

/** The model that prepares tasks: cheap and good at following formats; a free one without credit. */
export function workbenchModels(models: Model[], bestFree: string) {
  const preferred = pickChecker(models, 8000, bestFree);
  return preferred === bestFree ? [bestFree] : [preferred, bestFree];
}

export async function askQuestions(opts: CallOpts, idea: string): Promise<{ questions: Question[]; usage?: Usage }> {
  const res = await ask(opts, QUESTIONS_SYSTEM, idea);
  const raw = parseJson(res.text)?.questions;
  const questions = (Array.isArray(raw) ? raw : [])
    .map((x) => ({
      q: str(x?.q),
      options: (Array.isArray(x?.options) ? x.options : []).map(str).filter(Boolean).slice(0, 4),
    }))
    .filter((x) => x.q)
    .slice(0, 3);
  return { questions, usage: res.usage };
}

export async function writeBrief(
  opts: CallOpts,
  idea: string,
  answers: { q: string; a: string }[],
): Promise<{ brief: Brief; usage?: Usage }> {
  const answered = answers.filter((x) => x.a.trim());
  const input = answered.length
    ? `${idea}\n\nAntworten auf Rückfragen:\n${answered.map((x) => `- ${x.q} ${x.a.trim()}`).join("\n")}`
    : idea;
  const res = await ask(opts, BRIEF_SYSTEM, input);
  const j = parseJson(res.text);
  const task = str(j?.task);
  if (!j || !task) throw new Error("Das Modell hat kein verwertbares Ergebnis geliefert. Versuche es noch einmal.");
  const kind = (["text", "image", "video"] as const).find((k) => k === j.kind) ?? "text";
  const difficulty = (["einfach", "mittel", "anspruchsvoll"] as const).find((d) => d === j.difficulty) ?? "mittel";
  const area = USE_CASES.some((u) => u.id === j.area) ? String(j.area) : "general";
  return {
    brief: {
      title: str(j.title).replace(/^["„“]|["“”.]$/g, "").slice(0, 80) || "Vorbereitete Aufgabe",
      kind,
      area,
      difficulty,
      web: j.web === true,
      role: str(j.role),
      approach: str(j.approach),
      why: str(j.why),
      system: kind === "text" ? str(j.system) : "",
      task,
    },
    usage: res.usage,
  };
}

// ---- model suggestions ------------------------------------------------------------

/** A typical prepared-task exchange: the task plus some history in, a thorough answer out. */
const TYPICAL_IN = 2500;
const TYPICAL_OUT = 1500;

function answerCost(m: Model) {
  const usd = estimateCost(m, TYPICAL_IN, TYPICAL_OUT);
  if (usd === undefined) return "";
  if (usd === 0) return "kostenlos";
  const cents = usd * 100;
  const amount = cents >= 100 ? formatCost(usd) : `${cents >= 10 ? Math.round(cents) : cents.toFixed(cents >= 1 ? 1 : 2).replace(/\.?0+$/, "").replace(".", ",")} Cent`;
  return `eine ausführliche Antwort kostet etwa ${amount}`;
}

function isChatModel(m: Model) {
  const out = m.architecture?.output_modalities ?? ["text"];
  return (
    out.every((o) => o === "text") &&
    !m.id.startsWith("openrouter/") &&
    !isClassifier(m.id) &&
    (!m.id.includes(":") || isFreeModelId(m.id))
  );
}

function textSuggestions(
  models: Model[],
  scores: Map<string, Scores> | null,
  area: string,
  difficulty: Difficulty,
  bestFree: { id: string; score?: number },
): Suggestion[] {
  const metricName = area === "code" ? "Coding Index" : "Intelligence Index";
  const metric = (m: Model) => {
    const s = scoreOf(m, scores);
    return area === "code" ? (s?.coding ?? s?.intelligence) : s?.intelligence;
  };
  const paid = models.filter((m) => isChatModel(m) && !isFree(m) && Number.isFinite(blendedPrice(m)));
  const scored = paid.filter((m) => metric(m) !== undefined);

  let top: Model | undefined;
  let value: Model | undefined;
  if (scored.length) {
    top = [...scored].sort((a, b) => metric(b)! - metric(a)! || blendedPrice(a) - blendedPrice(b))[0];
    const bar = metric(top)! * 0.85;
    value = scored
      .filter((m) => m.id !== top!.id && metric(m)! >= bar)
      .sort((a, b) => blendedPrice(a) - blendedPrice(b))[0];
  } else {
    // Without benchmark scores: newest premium model, and the cheap all-rounder used elsewhere.
    top = frontierModels(models)[0];
    const cheap = models.find((m) => m.id === pickChecker(models, 0, ""));
    value = cheap && cheap.id !== top?.id ? cheap : undefined;
  }
  if (value && blendedPrice(value) >= blendedPrice(top!) * 0.8) value = undefined;

  const byId = new Map(models.map((m) => [m.id, m]));
  const free = byId.get(bestFree.id);
  const scoreText = (m: Model) => {
    const s = metric(m);
    return s !== undefined ? `${metricName} ${Math.round(s)}` : "";
  };
  const line = (...parts: string[]) => {
    const text = parts.filter(Boolean).join(", ");
    return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : "";
  };

  const picks = {
    top: top && {
      id: top.id,
      name: shortName(top),
      badge: "Spitzenklasse",
      reason: line(scoreText(top), answerCost(top)),
    },
    value: value && {
      id: value.id,
      name: shortName(value),
      badge: "Preis-Leistung",
      reason: line(scoreText(value), answerCost(value)),
    },
    free: {
      id: bestFree.id,
      name: free ? shortName(free) : "Kostenloses Modell",
      badge: "Kostenlos",
      reason:
        bestFree.score !== undefined
          ? `${metricName === "Coding Index" ? "Intelligence Index" : metricName} ${Math.round(bestFree.score)}, kostenlos mit Tageslimit.`
          : "Kostenlos mit Tageslimit, wechselt zu einem gerade verfügbaren Modell.",
    },
  };
  const order =
    difficulty === "anspruchsvoll"
      ? [picks.top, picks.value, picks.free]
      : difficulty === "mittel"
        ? [picks.value ?? picks.top, picks.value ? picks.top : undefined, picks.free]
        : [picks.free, picks.value, picks.top];
  return order.filter((s): s is Suggestion => !!s);
}

function imageSuggestions(models: Model[]): Suggestion[] {
  const pool = models.filter((m) => makesImages(m) && !m.id.includes(":"));
  const price = (m: Model) => Number(m.pricing.image ?? 0) + blendedPrice(m) / 1e6;
  const newest = [...pool].sort((a, b) => b.created - a.created);
  const best = newest.find((m) => m.id.startsWith("google/")) ?? newest[0];
  const cheapest = [...pool].sort((a, b) => price(a) - price(b)).find((m) => m.id !== best?.id);
  return [
    best && { id: best.id, name: shortName(best), badge: "Empfohlen", reason: "Aktuelles Bildmodell, versteht lange Beschreibungen und kann Bilder nachbearbeiten." },
    cheapest && { id: cheapest.id, name: shortName(cheapest), badge: "Günstiger", reason: "Günstigeres Bildmodell für Entwürfe." },
  ].filter((s): s is Suggestion => !!s);
}

function videoSuggestions(videos: VideoModel[], pricePerSecond: (v: VideoModel) => number | null): Suggestion[] {
  const priced = videos
    .map((v) => ({ v, p: pricePerSecond(v) }))
    .filter((x): x is { v: VideoModel; p: number } => x.p !== null)
    .sort((a, b) => a.p - b.p);
  const name = (v: VideoModel) => v.name.replace(/^[^:]+:\s*/, "");
  const perMin = (p: number) => `ab ${(p * 60).toFixed(2).replace(".", ",")} $ pro Minute Video`;
  const cheapest = priced[0];
  // A mid-priced model as the quality pick: the most expensive tier is rarely worth it for a first try.
  const middle = priced[Math.floor(priced.length / 2)];
  return [
    cheapest && { id: cheapest.v.id, name: name(cheapest.v), badge: "Günstig zum Ausprobieren", reason: `${perMin(cheapest.p)}.` },
    middle && middle !== cheapest && { id: middle.v.id, name: name(middle.v), badge: "Höhere Qualität", reason: `${perMin(middle.p)}.` },
  ].filter((s): s is Suggestion => !!s);
}

export function suggestModels(opts: {
  brief: Brief;
  models: Model[];
  scores: Map<string, Scores> | null;
  bestFree: { id: string; score?: number };
  videos: VideoModel[];
  pricePerSecond: (v: VideoModel) => number | null;
}): Suggestion[] {
  const { brief } = opts;
  if (brief.kind === "image") return imageSuggestions(opts.models);
  if (brief.kind === "video") return videoSuggestions(opts.videos, opts.pricePerSecond);
  return textSuggestions(opts.models, opts.scores, brief.area, brief.difficulty, opts.bestFree);
}

export const DIFFICULTY_NOTE: Record<Difficulty, string> = {
  einfach: "Eine einfache Aufgabe: ein kostenloses Modell reicht meist.",
  mittel: "Eine mittlere Aufgabe: ein gutes, günstiges Modell ist die beste Wahl.",
  anspruchsvoll: "Eine anspruchsvolle Aufgabe: hier lohnt sich ein Spitzenmodell.",
};
