import { Mp3Encoder } from "@breezystack/lamejs";
import { audioBlobFromChunks } from "./files";
import { audioRequest, streamChat, type ChatMessage, type Usage } from "./openrouter";
import { HOST, SYSTEM, type Participant, type Room } from "./rooms";
import { NATURAL_VOICES, PCM_RATE, speakable, synthesize } from "./speech";

/**
 * A room as an audio play to keep: an opening by a narrator, every turn in its character's voice,
 * and the judge's evaluation read by the narrator at the end. Optionally with music from the music model
 * (Lyria) that steps back whenever someone speaks. Mixed and encoded to MP3 in the browser.
 */

export interface AudioPart {
  voice: string;
  text: string;
  /** Who speaks, for the progress display. */
  label: string;
  kind: "intro" | "turn" | "review";
  /** Turns: the room round, for short musical breaks between rounds. */
  round?: number;
}

/** Calm, clear voices for the narrator, in order of preference; one no character uses. */
const NARRATOR_VOICES = ["Charon", "Kore", "Iapetus", "Erinome", "Sadaltager"];

function freeVoice(taken: Set<string>, preferred: string[]) {
  return preferred.find((v) => !taken.has(v)) ?? NATURAL_VOICES.find((v) => !taken.has(v.id))?.id ?? preferred[0];
}

function joinNames(names: string[]) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

/** The turns that will be spoken, in order. */
function spokenTurns(room: Room) {
  return room.messages.filter((m) => m.authorId !== SYSTEM && m.content.trim() && !m.error);
}

/** Everything that will be spoken, in order. */
export function audioScript(room: Room, review: string): AudioPart[] {
  const taken = new Set(room.participants.map((p) => p.voice).filter((v): v is string => !!v));
  const narrator = freeVoice(taken, NARRATOR_VOICES);
  taken.add(narrator);
  // The human (and the host stepping in) get a voice of their own, so they stand out from the narrator.
  const human = room.participants.find((p) => p.human);
  const humanVoice = human?.voice ?? freeVoice(taken, ["Achird", "Leda", "Puck", "Aoede"]);
  const byId = new Map<string, Participant>(room.participants.map((p) => [p.id, p]));

  const cast = joinNames(room.participants.map((p) => `${p.name}${p.roleName ? ` als ${p.roleName}` : ""}`));
  const parts: AudioPart[] = [
    {
      voice: narrator,
      label: "Ansage",
      kind: "intro",
      text: `${room.title}. Es sprechen ${cast}.\n\n${room.topic}${room.goal ? `\n\nDas Ziel: ${room.goal}` : ""}`,
    },
  ];
  for (const m of spokenTurns(room)) {
    const p = byId.get(m.authorId);
    if (m.authorId === HOST) parts.push({ voice: humanVoice, label: "Gesprächsleitung", kind: "turn", round: m.round, text: m.content });
    else if (p)
      parts.push({ voice: p.human ? humanVoice : (p.voice ?? narrator), label: p.name, kind: "turn", round: m.round, text: m.content });
  }
  // Headings become their own short sentence, so the narrator pauses after "Ergebnis" instead of running on.
  const spokenReview = review.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*$/gm, (_, h: string) => `${h.replace(/[.:!?]$/, "")}.`);
  parts.push({ voice: narrator, label: "Auswertung", kind: "review", text: `Und nun die Auswertung.\n\n${spokenReview}` });
  return parts;
}

/** Rough length: about 140 spoken words per minute in German. */
export function estimateMinutes(parts: AudioPart[]) {
  const words = parts.reduce((n, p) => n + speakable(p.text).split(/\s+/).filter(Boolean).length, 0);
  return Math.max(1, Math.round(words / 140));
}

/** About a cent per minute for the natural voice. */
export const USD_PER_MINUTE = 0.01;

// ---- music: described from the conversation, composed by the music model ---------------------

const DEFAULT_MUSIC = "calm warm acoustic instrumental, soft piano and strings, gentle, medium tempo";

/** A cheap model describes music that fits the conversation's subject and mood. */
export function musicBriefMessages(room: Room): ChatMessage[] {
  const byId = new Map(room.participants.map((p) => [p.id, p]));
  const turns = spokenTurns(room)
    .slice(0, 40)
    .map((m) => `${m.authorId === HOST ? "Gesprächsleitung" : (byId.get(m.authorId)?.name ?? "?")}: ${m.content.slice(0, 300)}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "Du wählst die Musik für Intro und Outro eines kurzen Hörspiels. Beschreibe sie auf Englisch in einem Satz für ein Musikmodell: Stil, Instrumente, Stimmung, Tempo. Instrumental, ohne Gesang, eher dezent, passend zu Thema und Stimmung des Gesprächs. Antworte nur mit dieser Beschreibung.",
    },
    { role: "user", content: `Thema: ${room.topic}\n\nGespräch (Auszug):\n${turns}` },
  ];
}

export function parseMusicBrief(text: string) {
  const line = text.trim().replace(/^["'„]|["'“]$/g, "").split("\n")[0].trim();
  return line.length >= 10 ? line.slice(0, 400) : DEFAULT_MUSIC;
}

/** A short instrumental clip from the music model, as mono samples at the voice's rate. */
export async function composeMusic(apiKey: string, model: string, description: string, signal: AbortSignal) {
  const chunks: string[] = [];
  let usage: Usage | undefined;
  await streamChat(
    {
      apiKey,
      model,
      signal,
      messages: [{ role: "user", content: `${description}. Instrumental only, no vocals. A short piece that works as intro and outro of a radio play.` }],
      audio: audioRequest(model),
    },
    { onContent: () => {}, onReasoning: () => {}, onModel: () => {}, onUsage: (u) => (usage = u), onAudio: (c) => chunks.push(c) },
  );
  if (!chunks.length) throw new Error("Das Musikmodell hat keine Musik geliefert.");
  return { samples: await decodeMono(await audioBlobFromChunks(chunks).arrayBuffer()), cost: usage?.cost };
}

/** Any audio file to mono samples at the voice's rate; the browser decodes and resamples. */
async function decodeMono(bytes: ArrayBuffer) {
  const ctx = new OfflineAudioContext(1, 1, PCM_RATE);
  const buffer = await ctx.decodeAudioData(bytes);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

// ---- recording -------------------------------------------------------------------------------

export interface Extras {
  /** Intro, round breaks and outro; mono samples at the voice's rate. */
  music: Float32Array;
}

/** Speaks every part, a few at a time, kept in order. `onProgress` gets the number of finished parts. */
export async function speakParts(parts: AudioPart[], apiKey: string, onProgress: (done: number) => void, signal: AbortSignal) {
  const results: Float32Array[] = new Array(parts.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < parts.length) {
      const i = next++;
      const pieces = await synthesize(parts[i].text, apiKey, parts[i].voice, signal);
      results[i] = pcmToFloat(pieces);
      onProgress(++done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return results;
}

/** Raw little-endian 16-bit PCM pieces to one float signal. */
function pcmToFloat(pieces: Uint8Array[]) {
  const total = pieces.reduce((n, p) => n + Math.floor(p.byteLength / 2), 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of pieces) {
    const view = new DataView(p.buffer, p.byteOffset, p.byteLength - (p.byteLength % 2));
    for (let i = 0; i < view.byteLength; i += 2) out[at++] = view.getInt16(i, true) / 32768;
  }
  return out;
}

const sec = (s: number) => Math.round(s * PCM_RATE);

/** Adds `src` into `dst` at `at`, with a gain that may change over the clip's own time (seconds). */
function place(dst: Float32Array, src: Float32Array, at: number, gain: number | ((t: number) => number) = 1) {
  for (let i = 0; i < src.length; i++) {
    const j = at + i;
    if (j < 0) continue;
    if (j >= dst.length) break;
    dst[j] += src[i] * (typeof gain === "number" ? gain : gain(i / PCM_RATE));
  }
}

/** Piecewise linear envelope through [time, level] points. */
function envelope(points: [number, number][]) {
  return (t: number) => {
    if (t <= points[0][0]) return points[0][1];
    for (let k = 1; k < points.length; k++) {
      const [t1, v1] = points[k];
      const [t0, v0] = points[k - 1];
      if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
    }
    return points[points.length - 1][1];
  };
}

/** How far the music steps back while someone speaks (about -20 dB), so every word stays clear. */
const DUCKED = 0.1;

/**
 * Music gain over time from the voice track: low wherever someone speaks, full in between.
 * It starts going down a moment before the first word and comes back slowly after the last one,
 * so short breaths between sentences do not make the music jump up.
 */
function duckingGain(voice: Float32Array): Float32Array {
  const block = sec(0.02);
  const blocks = Math.ceil(voice.length / block);
  const speaking = new Uint8Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let sum = 0;
    const end = Math.min(voice.length, (b + 1) * block);
    for (let i = b * block; i < end; i++) sum += voice[i] * voice[i];
    speaking[b] = Math.sqrt(sum / Math.max(1, end - b * block)) > 0.004 ? 1 : 0;
  }
  // Hold through pauses shorter than 0.8 s and look ahead 0.3 s.
  const hold = Math.round(0.8 / 0.02);
  const ahead = Math.round(0.3 / 0.02);
  const target = new Float32Array(blocks).fill(1);
  let last = -Infinity;
  for (let b = 0; b < blocks; b++) {
    if (speaking[b]) last = b;
    if (b - last <= hold) target[b] = DUCKED;
  }
  for (let b = 0; b < blocks; b++) if (speaking[b]) for (let k = Math.max(0, b - ahead); k < b; k++) target[k] = DUCKED;
  // Smooth per sample: down in about 0.15 s, up in about 0.8 s.
  const gain = new Float32Array(voice.length);
  const down = 1 / sec(0.15);
  const up = 1 / sec(0.8);
  let g = 1;
  for (let i = 0; i < voice.length; i++) {
    const t = target[Math.floor(i / block)];
    g = t < g ? Math.max(t, g - down) : Math.min(t, g + up);
    gain[i] = g;
  }
  return gain;
}

/**
 * Lays everything out on one time line. With music: it opens the play, gives a short break between rounds
 * (at most every 45 seconds), rises before the evaluation and closes the play; wherever a voice speaks
 * it steps back. Without music: just the voices with pauses.
 */
export function mixAudioPlay(parts: AudioPart[], speech: Float32Array[], extras?: Extras): Float32Array {
  const music = extras?.music;
  const sting = music ? music.subarray(sec(1), sec(4)) : undefined;

  // Where each part starts.
  const starts: number[] = [];
  let cursor = music ? sec(4) : 0;
  let convoStart = 0;
  const stingAt: number[] = [];
  parts.forEach((p, i) => {
    if (p.kind === "turn") {
      const prev = parts[i - 1];
      if (prev?.kind !== "turn") convoStart = cursor;
      // A break when a new round begins, but not more often than every 45 seconds, so it stays a breath.
      if (sting && prev?.kind === "turn" && prev.round !== p.round && cursor - (stingAt.at(-1) ?? convoStart) > sec(45)) {
        stingAt.push(cursor);
        cursor += sting.length + sec(0.4);
      }
    }
    if (p.kind === "review") cursor += music ? sec(4.5) : sec(0.6);
    starts[i] = cursor;
    cursor += speech[i].length + sec(p.kind === "intro" ? 1.2 : 0.7);
  });
  const total = cursor + (music ? sec(7) : sec(0.5));

  const voice = new Float32Array(total);
  parts.forEach((_, i) => place(voice, speech[i], starts[i]));
  if (!music) return limit(voice);

  const bed = new Float32Array(total);
  const m = music.length / PCM_RATE;
  const fadeEnd = (t: number) => Math.min(1, Math.max(0, (m - t) / 2));
  // Opening: music alone for a few seconds, carries on under the narrator, then fades away.
  const introEnd = (starts[0] + speech[0].length) / PCM_RATE;
  const intro = envelope([[0, 0.5], [introEnd + 1, 0.5], [introEnd + 3.5, 0]]);
  place(bed, music, 0, (t) => intro(t) * fadeEnd(t));
  // Short breaks between rounds.
  if (sting) {
    const s = sting.length / PCM_RATE;
    for (const at of stingAt) place(bed, sting, at, envelope([[0, 0], [0.4, 0.4], [s - 0.6, 0.4], [s, 0]]));
  }
  // Around the evaluation: music rises, stays under the narrator for a while, and closes the play.
  const review = parts.findIndex((p) => p.kind === "review");
  if (review >= 0) {
    const lead = starts[review] / PCM_RATE - 4;
    place(bed, music, sec(lead), (t) => envelope([[0, 0], [1.5, 0.5], [12, 0.5], [15, 0]])(t) * fadeEnd(t));
    const outroAt = (starts[review] + speech[review].length) / PCM_RATE + 0.3;
    const tailStart = Math.max(0, m - 7);
    place(bed, music.subarray(sec(tailStart)), sec(outroAt), envelope([[0, 0], [0.8, 0.5], [m - tailStart - 2, 0.5], [m - tailStart, 0]]));
  }

  // Wherever a voice speaks, the music steps back.
  const gain = duckingGain(voice);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) out[i] = voice[i] + bed[i] * gain[i];
  return limit(out);
}

/** Keep peaks below clipping without changing the voices' level more than needed. */
function limit(out: Float32Array) {
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.98) for (let i = 0; i < out.length; i++) out[i] *= 0.98 / peak;
  return out;
}

export function encodeMp3(samples: Float32Array): Blob {
  const encoder = new Mp3Encoder(1, PCM_RATE, 64);
  const mp3: Uint8Array[] = [];
  const BLOCK = 1152 * 20;
  const block = new Int16Array(BLOCK);
  for (let i = 0; i < samples.length; i += BLOCK) {
    const n = Math.min(BLOCK, samples.length - i);
    for (let k = 0; k < n; k++) block[k] = Math.max(-32768, Math.min(32767, Math.round(samples[i + k] * 32767)));
    const out = encoder.encodeBuffer(block.subarray(0, n));
    if (out.length) mp3.push(new Uint8Array(out));
  }
  const tail = encoder.flush();
  if (tail.length) mp3.push(new Uint8Array(tail));
  return new Blob(mp3 as BlobPart[], { type: "audio/mpeg" });
}
