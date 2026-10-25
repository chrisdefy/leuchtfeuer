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
}

let current: NowSpeaking | null = null;
/** Bumped on every start and stop, so callbacks of an old reading do nothing. */
let session = 0;
let audio: HTMLAudioElement | null = null;
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

/** "playing" | "loading" | "paused" | null for one message. */
export function useSpeechState(id: string) {
  return useSyncExternalStore(subscribe, () => (current?.id === id ? current.phase : null));
}

/** The reading in progress anywhere in the app, for the player bar. */
export function useNowSpeaking() {
  return useSyncExternalStore(subscribe, () => current);
}

/** Markdown to speakable text: no symbols, code is announced instead of spelled out. */
export function speakable(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " (Codebeispiel ausgelassen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[*_~]{1,3}/g, "")
    // Paragraph breaks become a pause, without doubling a full stop that is already there.
    .replace(/([.!?:;])?\s*\n{2,}\s*/g, (_, p: string | undefined) => (p ? `${p} ` : ". "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentence-sized pieces: long single utterances get cut off in some browsers. */
function chunks(text: string, max: number) {
  const sentences = text.match(/[^.!?]+[.!?]+["“”)]*\s*|[^.!?]+$/g) ?? [text];
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

export function stopSpeaking() {
  session++;
  abort?.abort();
  abort = null;
  resumeBrowser = null;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  if (audio) {
    audio.pause();
    URL.revokeObjectURL(audio.src);
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
  setPhase("playing");
  if (audio) void audio.play();
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
  abort = new AbortController();
  const mine = ++session;
  set({ id, label, phase: "loading" });
  const signal = abort.signal;
  for (const part of chunks(text, 1500)) {
    const pcm = await fetchPcm(part, apiKey, voiceName, signal);
    if (signal.aborted || mine !== session) return;
    const el = new Audio(URL.createObjectURL(wavFromPcm16(pcm, PCM_RATE)));
    audio = el;
    // Paused while this piece loaded: it waits until "Weiter".
    if (current?.phase !== "paused") {
      setPhase("playing");
      await el.play();
    }
    await new Promise<void>((resolve) => {
      el.onended = () => resolve();
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    if (signal.aborted || mine !== session) return;
    URL.revokeObjectURL(el.src);
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
  stopSpeaking();
  if (wasThis) return;
  const text = speakable(markdown);
  if (!text) return;
  try {
    if (opts.mode === "natural" && opts.apiKey) await speakNatural(id, text, opts.apiKey, opts.naturalVoice, opts.label);
    else speakBrowser(id, text, opts.browserVoice, opts.label);
  } catch (e) {
    stopSpeaking();
    if ((e as Error).name !== "AbortError") throw e;
  }
}
