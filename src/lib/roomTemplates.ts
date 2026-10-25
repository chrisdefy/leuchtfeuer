import type { Participant, Room } from "./rooms";

/**
 * A room's setup without its conversation: who takes part (with models and voices), topic, goal,
 * who is who and the rules. Loaded again, it starts the same conversation afresh or a variation of it.
 */
export interface RoomTemplate {
  id: string;
  name: string;
  savedAt: number;
  topic: string;
  goal?: string;
  cast?: string;
  language: string;
  participants: Participant[];
  order: Room["order"];
  pace: Room["pace"];
  maxRounds: number;
  budget: number;
  aiAware: boolean;
  readAloud?: boolean;
  judge?: string;
}

const KEY = "router.roomTemplates.v1";
/** Marks a template file, so any other JSON is turned away. */
const FILE = "leuchtfeuer-raumvorlage";

export function loadTemplates(): RoomTemplate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function store(all: RoomTemplate[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50)));
  } catch {
    throw new Error("Der Speicher des Browsers ist voll. Lösche alte Vorlagen oder Räume und versuch es noch einmal.");
  }
}

export function templateOf(room: Room, name: string): RoomTemplate {
  return {
    id: `tpl-${crypto.randomUUID()}`,
    name: name.trim() || room.title,
    savedAt: Date.now(),
    topic: room.topic,
    goal: room.goal,
    cast: room.cast,
    language: room.language,
    // Pausing is a moment in one conversation, not part of the setup.
    participants: room.participants.map((p) => ({ ...p, paused: undefined })),
    order: room.order,
    pace: room.pace,
    maxRounds: room.maxRounds,
    budget: room.budget,
    aiAware: room.aiAware,
    readAloud: room.readAloud,
    judge: room.judge,
  };
}

/** Saves `t`; a template of the same name is replaced, so saving again updates it. */
export function saveTemplate(t: RoomTemplate) {
  store([t, ...loadTemplates().filter((x) => x.name !== t.name)]);
}

export function deleteTemplate(id: string) {
  store(loadTemplates().filter((t) => t.id !== id));
}

/** Templates from a backup or a file; one with the same id or name already here wins. */
export function importTemplates(incoming: RoomTemplate[]) {
  const current = loadTemplates();
  const added = incoming.filter((t) => isTemplate(t) && !current.some((c) => c.id === t.id || c.name === t.name));
  store([...current, ...added]);
  return added.length;
}

function isTemplate(t: unknown): t is RoomTemplate {
  const o = t as RoomTemplate;
  return !!o && typeof o.name === "string" && typeof o.topic === "string" && Array.isArray(o.participants);
}

/** Fresh ids, so a room made from the template shares nothing with the one it came from. */
export function participantsOf(t: RoomTemplate): Participant[] {
  return t.participants.map((p) => ({ ...p, id: crypto.randomUUID() }));
}

/** The file to pass a template on: `<date>-<name>.vorlage.json`. */
export function templateFile(templates: RoomTemplate[]) {
  return JSON.stringify({ app: FILE, version: 1, templates }, null, 2);
}

export async function readTemplateFile(file: File): Promise<RoomTemplate[]> {
  let parsed: { app?: string; templates?: unknown };
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("Diese Datei ist keine Raum-Vorlage von Leuchtfeuer.");
  }
  if (parsed?.app !== FILE || !Array.isArray(parsed.templates)) throw new Error("Diese Datei ist keine Raum-Vorlage von Leuchtfeuer.");
  return parsed.templates.filter(isTemplate);
}
