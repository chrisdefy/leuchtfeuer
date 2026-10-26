import { useSyncExternalStore } from "react";
import { wavFromPcm16 } from "./files";
import { newestOf } from "./helpers";

/**
 * Reading answers aloud. The browser's own voice is free and instant; the natural voice
 * goes through OpenRouter's speech endpoint and costs about a cent per minute.
 * Only one message plays at a time, so this is a small module-wide player.
 */

export type VoiceMode = "browser" | "natural";

/** Gemini TTS: good German, cheap, returns 24 kHz 16-bit mono PCM. */
/** The voices are Gemini's, so the newest Gemini speech model; this one while the catalog does not list any. */
const NATURAL_FALLBACK = "google/gemini-3.8-flash-lite-tts";
const naturalModel = () => newestOf((m) => m.id.startsWith("google/") && /tts/i.test(m.id), NATURAL_FALLBACK);
const NATURAL_VOICE = "Kore";

/** Gemini's prebuilt voices with Google's own character description, translated. */
export const NATURAL_VOICES: { id: string; gender: "w" | "m"; character: string }[] = [
  { id: "Kore", gender: "w", character: "bestimmt" },
  { id: "Sulafat", gender: "w", character: "warm" },
  { id: "Vindemiatrix", gender: "w", character: "sanft" },
  { id: "Achernar", gender: "w", character: "weich" },
  { id: "Aoede", gender: "w", character: "luftig" },
  { id: "Leda", gender: "w", character: "jugendlich" },
  { id: "Zephyr", gender: "w", character: "hell" },
  { id: "Gacrux", gender: "w", character: "reif" },
  { id: "Erinome", gender: "w", character: "klar" },
  { id: "Despina", gender: "w", character: "geschmeidig" },
  { id: "Charon", gender: "m", character: "sachlich" },
  { id: "Sadaltager", gender: "m", character: "kundig" },
  { id: "Achird", gender: "m", character: "freundlich" },
  { id: "Iapetus", gender: "m", character: "klar" },
  { id: "Algieba", gender: "m", character: "geschmeidig" },
  { id: "Orus", gender: "m", character: "bestimmt" },
  { id: "Puck", gender: "m", character: "munter" },
  { id: "Umbriel", gender: "m", character: "locker" },
  { id: "Algenib", gender: "m", character: "rau" },
  { id: "Fenrir", gender: "m", character: "lebhaft" },
];

export const PREVIEW_TEXT = "Hallo, so klinge ich. Ich lese dir die Antworten vor, wann immer du möchtest.";

/** German (or the user's language) system voices, best first. Empty until the browser has loaded them. */
export function browserVoices() {
  if (typeof speechSynthesis === "undefined") return [];
  const lang = (navigator.language || "de").slice(0, 2).toLowerCase();
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  const good = (v: SpeechSynthesisVoice) => (/premium|enhanced|natural|neural|google/i.test(v.name) ? 0 : 1);
  return voices.sort((a, b) => good(a) - good(b) || a.name.localeCompare(b.name));
}

/** Browsers load system voices lazily; call back once they are there. */
export function onVoicesReady(cb: () => void) {
  if (typeof speechSynthesis === "undefined") return () => {};
  speechSynthesis.addEventListener("voiceschanged", cb);
  return () => speechSynthesis.removeEventListener("voiceschanged", cb);
}

export type SpeechPhase = "loading" | "playing" | "paused";

/** What is being read right now; `label` names it in the player bar (e.g. the model). */
export interface NowSpeaking {
  id: string;
  label?: string;
  phase: SpeechPhase;
  /** The phone would not start the voice on its own; it plays on the next tap ("Abspielen"). */
  waiting?: boolean;
}

let current: NowSpeaking | null = null;
/** Bumped on every start and stop, so callbacks of an old reading do nothing. */
let session = 0;
let audio: HTMLAudioElement | null = null;
/**
 * The one element every natural voice plays through. Phones only let audio start in the tap itself,
 * but the voice arrives seconds later from OpenRouter; an element that played once inside a tap
 * stays allowed, so the tap that starts reading plays a moment of silence on it first.
 */
let player: HTMLAudioElement | null = null;
let silence = "";
let abort: AbortController | null = null;
/** Continues a paused browser reading from the sentence it stopped in. */
let resumeBrowser: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: NowSpeaking | null) {
  current = next;
  listeners.forEach((l) => l());
}

function setPhase(phase: SpeechPhase) {
  if (current) set({ ...current, phase });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** "playing" | "loading" | "paused" | "waiting" (ready, needs a tap) | null for one message. */
export function useSpeechState(id: string): SpeechPhase | "waiting" | null {
  return useSyncExternalStore(subscribe, () => (current?.id === id ? (current.waiting ? "waiting" : current.phase) : null));
}

/** The reading in progress anywhere in the app, for the player bar. */
export function useNowSpeaking() {
  return useSyncExternalStore(subscribe, () => current);
}

/** What a code block becomes when read: text cards are read, pictures and code are only named. */
function spokenBlock(lang: string, body: string) {
  switch (lang.toLowerCase()) {
    case "text":
    case "txt":
      return `\n\n${body}\n\n`;
    case "chart": {
      let title = "";
      try {
        title = String(JSON.parse(body)?.title ?? "");
      } catch {
        /* half a chart */
      }
      return title ? `\n\n(Diagramm: ${title})\n\n` : "\n\n(Diagramm)\n\n";
    }
    case "svg":
      return "\n\n(Grafik)\n\n";
    case "mermaid":
    case "flow":
      return "\n\n(Ablaufdiagramm)\n\n";
    default:
      return "\n\n(Codebeispiel ausgelassen)\n\n";
  }
}

/** A Markdown table, read row by row: "Löwe, Größe 2 m, Gewicht 190 kg." instead of pipes and dashes. */
function tablesToSentences(markdown: string) {
  const lines = markdown.split("\n");
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const isRule = (line: string) => line.includes("|") && line.includes("-") && /^[\s|:-]+$/.test(line);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!(lines[i].includes("|") && isRule(lines[i + 1] ?? ""))) {
      out.push(lines[i]);
      continue;
    }
    const head = cells(lines[i]);
    const rows: string[] = [];
    for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) {
      const row = cells(lines[i]);
      const rest = row.slice(1).map((c, j) => (c && head[j + 1] ? `${head[j + 1]} ${c}` : c)).filter(Boolean);
      const sentence = [row[0], ...rest].filter(Boolean).join(", ");
      if (sentence) rows.push(/[.!?:]$/.test(sentence) ? sentence : `${sentence}.`);
    }
    i--;
    out.push("", rows.join("\n"), "");
  }
  return out.join("\n");
}

/** Markdown to speakable text: no symbols; tables become sentences, pictures and code are named instead of spelled out. */
export function speakable(markdown: string) {
  return tablesToSentences(
    markdown
      .replace(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, lang: string, body: string) => spokenBlock(lang, body))
      .replace(/<svg[\s\S]*?(<\/svg>|$)/gi, "\n\n(Grafik)\n\n"),
  )
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[*_~]{1,3}/g, "")
    // Paragraph breaks become a pause, without doubling a full stop that is already there.
    .replace(/([.!?:;,])?\s*\n{2,}\s*/g, (_, p: string | undefined) => (p ? `${p} ` : ". "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentence-sized pieces: long single utterances get cut off in some browsers. */
function chunks(text: string, max: number) {
  const sentences = (text.match(/[^.!?]+[.!?]+["“”)]*\s*|[^.!?]+$/g) ?? [text]).flatMap((s) => splitLong(s, max));
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A sentence longer than a piece (long lists without full stops) is cut after a comma, else between words. */
function splitLong(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const cut = sentence.lastIndexOf(", ", max) > max / 3 ? sentence.lastIndexOf(", ", max) + 2 : sentence.lastIndexOf(" ", max) + 1 || max;
  return [sentence.slice(0, cut), ...splitLong(sentence.slice(cut), max)];
}

/** Called in the tap that starts reading, before anything is awaited. */
function unlockPlayer() {
  if (typeof Audio === "undefined") return null;
  player ??= new Audio();
  silence ||= URL.createObjectURL(wavFromPcm16(new Uint8Array(PCM_RATE / 10), PCM_RATE));
  player.src = silence;
  // Outside a tap (rooms reading on their own) this is refused, which is fine: an earlier tap unlocked it.
  player.play().catch(() => {});
  return player;
}

export function stopSpeaking() {
  session++;
  abort?.abort();
  abort = null;
  resumeBrowser = null;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  if (audio) {
    audio.pause();
    if (audio.src !== silence) URL.revokeObjectURL(audio.src);
    audio = null;
  }
  set(null);
}

export function pauseSpeaking() {
  if (current?.phase !== "playing") return;
  setPhase("paused");
  if (audio) audio.pause();
  // Browser voices pause unreliably (Chrome's online voices ignore it); stop and resume per sentence instead.
  else if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

export function resumeSpeaking() {
  if (current?.phase !== "paused") return;
  set({ ...current, phase: "playing", waiting: false });
  if (audio) void audio.play().catch(() => setPhase("paused"));
  // Chrome sometimes drops a speak() right after cancel(); a short pause avoids that.
  else setTimeout(() => resumeBrowser?.(), 60);
}

function pickVoice(lang: string) {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  // Higher-quality system voices carry these words in their names on macOS, iOS, Chrome and Edge.
  return voices.find((v) => /premium|enhanced|natural|neural|google/i.test(v.name)) ?? voices[0];
}

function speakBrowser(id: string, text: string, voiceURI?: string, label?: string) {
  if (typeof speechSynthesis === "undefined") throw new Error("Dieser Browser kann nicht vorlesen.");
  const lang = (navigator.language || "de").slice(0, 2).toLowerCase();
  const voice = (voiceURI && speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI)) || pickVoice(lang);
  const parts = chunks(text, 220);
  const mine = ++session;
  let index = 0;
  const live = () => mine === session && current?.phase === "playing";

  // One sentence group at a time, so a pause can pick up where it stopped.
  const next = () => {
    if (!live()) return;
    if (index >= parts.length) {
      resumeBrowser = null;
      set(null);
      return;
    }
    const u = new SpeechSynthesisUtterance(parts[index]);
    u.lang = voice?.lang ?? navigator.language;
    if (voice) u.voice = voice;
    u.rate = 1;
    const done = () => {
      // Ending because of pause or stop: stay on this piece.
      if (!live()) return;
      index++;
      next();
    };
    u.onend = done;
    u.onerror = (e) => {
      if (e.error !== "interrupted" && e.error !== "canceled") done();
    };
    speechSynthesis.speak(u);
  };
  resumeBrowser = next;
  set({ id, label, phase: "playing" });
  next();
}

/** Sample rate of the natural voice's raw PCM (16-bit mono). */
export const PCM_RATE = 24_000;

/** One piece of text (up to ~1500 characters) as raw 16-bit PCM in the given Gemini voice. */
async function fetchPcm(text: string, apiKey: string, voice: string, signal?: AbortSignal) {
  const res = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: naturalModel(), input: text, voice, response_format: "pcm" }),
  });
  if (!res.ok) {
    let message = `Vorlesen fehlgeschlagen (HTTP ${res.status}).`;
    try {
      message = (await res.json())?.error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Markdown read in a voice, as raw PCM pieces in order (for recordings rather than playback). */
export async function synthesize(markdown: string, apiKey: string, voice: string, signal?: AbortSignal) {
  const out: Uint8Array[] = [];
  for (const part of chunks(speakable(markdown), 1500)) out.push(await fetchPcm(part, apiKey, voice, signal));
  return out;
}

async function speakNatural(id: string, text: string, apiKey: string, voiceName = NATURAL_VOICE, label?: string) {
  const el = unlockPlayer();
  if (!el) throw new Error("Dieser Browser kann nicht vorlesen.");
  abort = new AbortController();
  const mine = ++session;
  set({ id, label, phase: "loading" });
  const signal = abort.signal;
  for (const part of chunks(text, 1500)) {
    const pcm = await fetchPcm(part, apiKey, voiceName, signal);
    if (signal.aborted || mine !== session) return;
    const url = URL.createObjectURL(wavFromPcm16(pcm, PCM_RATE));
    el.src = url;
    audio = el;
    // Paused while this piece loaded: it waits until "Weiter".
    if (current?.phase !== "paused") {
      setPhase("playing");
      try {
        await el.play();
      } catch (e) {
        if ((e as Error).name !== "NotAllowedError") throw e;
        // The phone still refuses to start on its own: the voice is ready and plays on the next tap.
        if (current) set({ ...current, phase: "paused", waiting: true });
      }
    }
    await new Promise<void>((resolve, reject) => {
      el.onended = () => resolve();
      el.onerror = () => reject(new Error("Die Stimme ließ sich auf diesem Gerät nicht abspielen."));
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    el.onended = el.onerror = null;
    if (signal.aborted || mine !== session) return;
    URL.revokeObjectURL(url);
    audio = null;
  }
  if (mine === session) set(null);
}

/** Toggle reading a message; starting one stops any other. */
export async function toggleSpeaking(
  id: string,
  markdown: string,
  opts: { mode: VoiceMode; apiKey: string; naturalVoice?: string; browserVoice?: string; label?: string },
) {
  const wasThis = current?.id === id;
  // The voice is ready but was waiting for a tap: this is the tap.
  if (wasThis && current?.waiting) return resumeSpeaking();
  stopSpeaking();
  if (wasThis) return;
  const text = speakable(markdown);
  if (!text) return;
  try {
    if (opts.mode === "natural" && opts.apiKey) await speakNatural(id, text, opts.apiKey, opts.naturalVoice, opts.label);
    else speakBrowser(id, text, opts.browserVoice, opts.label);
  } catch (e) {
    // Only end this reading; another one may have started in the meantime.
    if (current?.id === id) stopSpeaking();
    if ((e as Error).name === "AbortError") return;
    if ((e as Error).name === "NotAllowedError") throw new Error("Das Gerät hat das Vorlesen blockiert. Tippe noch einmal auf „Vorlesen“.");
    throw e;
  }
}
