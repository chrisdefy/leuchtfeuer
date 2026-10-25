import type { Attachment } from "./files";
import type { Chat, Message } from "./storage";

export const MAX_LANES = 4;

export function lanesOf(chat: Chat): string[] {
  return chat.lanes?.length ? chat.lanes : [chat.model];
}

export function laneOf(m: Message) {
  return m.lane ?? 0;
}

/** A user message and the answers to it (one per comparison lane). */
export interface Turn {
  user?: Message;
  answers: Message[];
}

export function toTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === "user" || turns.length === 0) {
      turns.push(m.role === "user" ? { user: m, answers: [] } : { answers: [m] });
    } else {
      turns[turns.length - 1].answers.push(m);
    }
  }
  return turns;
}

/**
 * What one lane's model sees: every user message plus, per turn, its own answer.
 * Turns from before the lane joined fall back to the first active lane's answer,
 * so a model added mid-chat continues the conversation instead of starting blind.
 */
export function laneHistory(messages: Message[], lane: number): Message[] {
  const out: Message[] = [];
  for (const turn of toTurns(messages)) {
    if (turn.user) out.push(turn.user);
    const answer =
      turn.answers.find((a) => laneOf(a) === lane) ?? turn.answers.find((a) => laneOf(a) >= 0);
    if (answer) out.push(answer);
  }
  return out;
}

/** Keep lane `keep` as the only model; its answers become lane 0. */
export function chooseLane(chat: Chat, keep: number): Chat {
  const lanes = lanesOf(chat);
  const model = lanes[keep];
  const messages = chat.messages.map((m) => {
    if (m.role !== "assistant") return m;
    const lane = laneOf(m);
    if (lane === keep) return { ...m, lane: 0 };
    if (lane === 0) return { ...m, lane: keep };
    return m;
  });
  return { ...chat, model, lanes: [model], messages };
}

/** Drop lane `index`; later lanes shift down, its answers stay visible but retired. */
export function removeLane(chat: Chat, index: number): Chat {
  const lanes = lanesOf(chat).filter((_, i) => i !== index);
  const messages = chat.messages.map((m) => {
    if (m.role !== "assistant") return m;
    const lane = laneOf(m);
    if (lane === index) return { ...m, lane: -1 - index };
    if (lane > index) return { ...m, lane: lane - 1 };
    return m;
  });
  return { ...chat, model: lanes[0], lanes, messages };
}

/** Same model, ignoring date suffixes and variants ("…-20260915", ":free"). */
export function sameModel(a: string, b: string) {
  const norm = (id: string) => id.replace(/:.*$/, "").replace(/-\d{6,8}$/, "");
  return norm(a) === norm(b);
}

/** The model the app asked to answer (stable even when the auto router picks another). */
export function answeredBy(m: Message) {
  return m.requested ?? m.model;
}

/**
 * Prepare history for `target`: answers written by other models are labelled with their
 * author, and a note tells the model those turns are not its own. Without this, a model
 * picks up foreign answers as if it had written them and tends to defend them.
 */
export function attributeHistory(
  history: Message[],
  target: string,
  name: (id: string) => string,
): { note: string | null; messages: { role: "user" | "assistant"; content: string; attachments?: Attachment[] }[] } {
  let foreign = false;
  const messages = history
    .filter((m) => m.content || (m.role === "user" && m.attachments?.length))
    .map((m) => {
      const author = answeredBy(m);
      // A merged "Beste Antwort" counts as the chat's own answer for every model that helps write the next one.
      if (m.role === "assistant" && author && !m.fusion && !sameModel(author, target)) {
        foreign = true;
        return { role: m.role, content: `[Antwort von ${name(m.model ?? author)}]\n\n${m.content}` };
      }
      return { role: m.role, content: m.content, attachments: m.role === "user" ? m.attachments : undefined };
    });
  if (!foreign) return { note: null, messages };
  const identity = target === "openrouter/auto" ? "" : `Du bist ${name(target)}. `;
  const note =
    `Hinweis zum Gesprächsverlauf: ${identity}Dieses Gespräch wurde zuvor ganz oder teilweise mit anderen KI-Modellen geführt. ` +
    "Antworten, die mit „[Antwort von …]“ beginnen, stammen von dem genannten Modell, nicht von dir. " +
    "Behandle sie als Beiträge Dritter: Du darfst darauf aufbauen, sie prüfen, korrigieren oder ihnen widersprechen. " +
    "Beginne deine eigene Antwort ohne ein solches Präfix.";
  return { note, messages };
}

/** Images the model generated most recently, so an image model can edit its last picture. */
export function lastGeneratedImages(history: Message[]): Attachment[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const images = m.role === "assistant" ? (m.attachments ?? []).filter((a) => a.kind === "image") : [];
    if (images.length) return images;
  }
  return [];
}
