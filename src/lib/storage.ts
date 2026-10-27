import { useEffect, useRef, useState } from "react";
import type { Attachment } from "./files";
import type { Source, Usage } from "./openrouter";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  /** Model that produced an assistant message (as reported by OpenRouter). */
  model?: string;
  /** Display name for models outside the chat model list (video models). */
  modelLabel?: string;
  /** Model the app asked for; differs from `model` e.g. with the auto router. */
  requested?: string;
  usage?: Usage;
  error?: string;
  /** Uploads on user messages; generated images or videos on assistant messages. */
  attachments?: Attachment[];
  /** Web pages the answer cites. */
  sources?: Source[];
  /** Earlier versions after passage edits, newest last ("Rückgängig"). */
  revisions?: string[];
  /** Links from the question the model was allowed to open; `opened` = pages fetched, if OpenRouter reports it. */
  links?: { urls: string[]; opened?: number; unsupported?: boolean };
  /** Plain note under the answer, e.g. that another model stepped in or that the web was not searched. */
  notice?: string;
  /** Set while (and after) a video is generated for this message. */
  video?: {
    jobId: string;
    status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
    startedAt: number;
    error?: string;
  };
  /** Wall-clock time from request to last token. */
  durationMs?: number;
  /**
   * Comparison column this answer belongs to (index into Chat.lanes; missing = 0).
   * Negative = the lane was removed from the comparison; kept for display only.
   */
  lane?: number;
  /** "Beste Antwort": the answers of several models this one was merged from. */
  fusion?: { answers: FusionAnswer[] };
  createdAt: number;
}

/** One model's answer inside a merged "Beste Antwort". */
export interface FusionAnswer {
  model: string;
  content: string;
  cost?: number;
  error?: string;
  done?: boolean;
}

/** A saved way of working: instruction, level and switches, chosen per chat in one go. */
export interface Profile {
  id: string;
  name: string;
  /** Instruction for the model, added to the chat's system prompt. */
  instruction: string;
  /** Level the chat switches to; "best" = Beste Antwort; missing = the level stays as it is. */
  level?: "free" | "light" | "standard" | "strong" | "best";
  web: boolean;
  visualize: boolean;
  reasoning?: "low" | "high";
}

export interface Chat {
  id: string;
  title: string;
  /** Primary model; equals lanes[0]. */
  model: string;
  /** Models answering in parallel. Missing or one entry = a normal chat. */
  lanes?: string[];
  /** Models may search the web in this chat. */
  webSearch?: boolean;
  /** Models are asked for charts and sketches where they help ("Visualisieren"). */
  visualize?: boolean;
  /** How much thinking models may do; undefined = the model's default. */
  reasoning?: "low" | "high";
  /** "user" once renamed by hand; automatic titles never overwrite that. */
  titleSource?: "auto" | "user";
  /** Number of answers the automatic title was based on. */
  titledAt?: number;
  /** Folder in the sidebar, if sorted into one. */
  folderId?: string;
  /** Set when this chat branched off another one at a given answer. */
  forkOf?: { chatId: string; title: string; messageId: string };
  /** Set when this chat continues an earlier one from its summary. */
  seed?: { summary: string; fromChatId: string; fromTitle: string };
  /** Set when the chat was prepared on the workbench: role, way of working and the instruction built from them. */
  prep?: { role: string; approach: string; system: string };
  /** Profile the chat works with; the instruction is kept as it was when chosen. */
  profile?: { id: string; name: string; system: string };
  /** "Beste Antwort": several models answer and the strongest merges their answers; "open" = with open models. */
  fusion?: boolean | "open";
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  apiKey: string;
  /** Answer with web search on by default in new chats. */
  webSearch?: boolean;
  /** Results per web search. */
  webResults?: 5 | 10 | 20;
  /** Read answers with the browser's voice (free) or a natural AI voice. */
  voiceMode?: "browser" | "natural";
  /** Gemini voice name for the natural voice. */
  naturalVoice?: string;
  /** voiceURI of the chosen system voice. */
  browserVoice?: string;
  /** Send right after dictating, without a second tap. */
  dictateSend?: boolean;
  /** New chats start with the best free model, or with the model chosen last. */
  defaultMode?: "best-free" | "last";
  defaultModel: string;
  /** Color scheme; dark unless chosen otherwise. "system" follows the device. */
  theme?: "dark" | "light" | "system";
  /** The guided tour was shown (or skipped) once. */
  tourDone?: boolean;
  /** The chatroom tour was shown (or skipped) once. */
  roomTourDone?: boolean;
  /** Only providers that store nothing (Zero Data Retention). */
  zdr?: boolean;
  /** Levels pinned to a fixed model; missing levels are chosen automatically. */
  tiers?: Partial<Record<"free" | "light" | "standard" | "strong", string>>;
  /** Opt-in (18+): offer models with few restrictions in the model picker. */
  unrestricted?: boolean;
  /** Saved profiles, offered in the input bar. */
  profiles?: Profile[];
  /** Profile every new chat starts with. */
  defaultProfile?: string;
  /** When the last backup file was downloaded. */
  lastBackup?: number;
  /** When the backup reminder was put off with "Später". */
  backupLater?: number;
  /** "Nicht mehr erinnern": no backup reminders; can be switched back on in the settings. */
  noBackupReminder?: boolean;
  /** Text size for the whole app. */
  textSize?: "normal" | "large" | "xlarge";
  /** "simple" shows only what a beginner needs; everything else keeps working out of sight. */
  view?: "simple" | "full";
  systemPrompt: string;
  /** undefined = provider default */
  temperature?: number;
  favorites: string[];
  recents: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  defaultModel: "openrouter/auto",
  systemPrompt: "",
  favorites: [],
  recents: [],
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — state stays in memory */
  }
}

/** State mirrored to localStorage. Writes are debounced so streaming tokens don't hammer storage. */
function usePersisted<T>(key: string, initial: () => T, delay = 300) {
  const [value, setValue] = useState(initial);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => write(key, value), delay);
    return () => clearTimeout(t);
  }, [key, value, delay]);
  return [value, setValue] as const;
}

export function useSettings() {
  return usePersisted<Settings>("router.settings.v1", readSettings, 0);
}

function readSettings(): Settings {
  const stored = read<Partial<Settings>>("router.settings.v1", {});
  // Newcomers start simple; settings saved before the switch existed belong to people who know the full view.
  const view = stored.view ?? (Object.keys(stored).length ? "full" : "simple");
  return { ...DEFAULT_SETTINGS, ...stored, view };
}

export function useChats() {
  return usePersisted<Chat[]>("router.chats.v1", () => readArray<Chat>("router.chats.v1"));
}

/**
 * What the input field holds for one chat: unsent text and files. For the chat that does not exist yet
 * (key NEW_DRAFT) also its options, chosen before the first message: models, web search, Visualisieren, thinking.
 */
export interface Draft {
  text: string;
  files: Attachment[];
  /** Text before "Verbessern", so the user can go back. */
  original?: { text: string; note: string } | null;
  lanes?: string[] | null;
  web?: boolean | null;
  visual?: boolean | null;
  reasoning?: "low" | "high";
  fusion?: boolean | "open" | null;
  /** Profile chosen for the new chat; null = none on purpose. */
  profile?: string | null;
}

/** Draft key of the new chat, which is only created when its first message is sent. */
export const NEW_DRAFT = "new";
const DRAFTS = "router.drafts.v1";

/** Drafts by chat id. Drafts of deleted chats and files still converting when the app closed are dropped. */
export function readDrafts(chatIds: Set<string>): Record<string, Draft> {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFTS) ?? "{}") as Record<string, Draft>;
    const out: Record<string, Draft> = {};
    for (const [key, d] of Object.entries(all)) {
      if (key !== NEW_DRAFT && !chatIds.has(key)) continue;
      out[key] = { ...d, files: (d.files ?? []).filter((f) => f.status !== "converting") };
    }
    return out;
  } catch {
    return {};
  }
}

let draftTimer: ReturnType<typeof setTimeout> | undefined;
export function saveDrafts(drafts: Record<string, Draft>) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => write(DRAFTS, drafts), 400);
}

export function isEmptyDraft(d: Draft) {
  return (
    !d.text.trim() && !d.files.length && !d.lanes && d.web == null && d.visual == null && !d.reasoning && d.fusion == null && d.profile === undefined
  );
}

const ACTIVE = "router.active.v1";
/** How long the chat last on screen is reopened at start; after that the app starts with a new chat. */
const REOPEN_MS = 60 * 60 * 1000;

export function rememberChat(id: string | null) {
  write(ACTIVE, { id, at: Date.now() });
}

/** The chat that was on screen before a reload, if it was used within the last hour. */
export function recentChat(chats: Chat[]): string | null {
  const last = read<{ id?: string | null; at?: number }>(ACTIVE, {});
  const chat = last.id ? chats.find((c) => c.id === last.id) : undefined;
  if (!chat) return null;
  return Date.now() - Math.max(last.at ?? 0, chat.updatedAt) < REOPEN_MS ? chat.id : null;
}

export function uid() {
  return crypto.randomUUID();
}
