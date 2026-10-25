import type { Folder } from "./folders";
import { blobIdsOf, blobToDataUrl, dataUrlToBlob, getBlob, putBlob, type Attachment } from "./files";
import type { SavedRole } from "./roleTemplate";
import type { Room } from "./rooms";
import type { Chat, Settings } from "./storage";

/**
 * One file with everything this browser holds: chats, chatrooms, folders, own roles,
 * settings and the pictures, videos and recordings in them. The API key stays out:
 * a backup file gets copied around, a key should not.
 */

const APP = "router-backup";
const VERSION = 1;

export interface Backup {
  app: typeof APP;
  version: number;
  createdAt: number;
  chats: Chat[];
  rooms: Room[];
  folders: Folder[];
  roles: SavedRole[];
  settings: Omit<Settings, "apiKey">;
  /** Attachment id → data URL. */
  files: Record<string, string>;
}

/** Every attachment referenced anywhere in the data, wherever it is nested. */
function attachmentsIn(value: unknown, out = new Map<string, Attachment>()) {
  if (Array.isArray(value)) value.forEach((v) => attachmentsIn(v, out));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.id === "string" && typeof o.kind === "string" && typeof o.mime === "string" && typeof o.size === "number") {
      out.set(o.id, o as unknown as Attachment);
    } else Object.values(o).forEach((v) => attachmentsIn(v, out));
  }
  return out;
}

export async function makeBackup(data: Omit<Backup, "app" | "version" | "createdAt" | "files">) {
  const files: Record<string, string> = {};
  let missing = 0;
  // Documents keep their converted text and summary as blobs of their own.
  const ids = [...attachmentsIn([data.chats, data.rooms]).values()].flatMap(blobIdsOf);
  for (const id of new Set(ids)) {
    const blob = await getBlob(id).catch(() => undefined);
    if (blob) files[id] = await blobToDataUrl(blob);
    else missing++;
  }
  const backup: Backup = { app: APP, version: VERSION, createdAt: Date.now(), ...data, files };
  return { blob: new Blob([JSON.stringify(backup)], { type: "application/json" }), files: Object.keys(files).length, missing };
}

export function backupFileName() {
  return `Leuchtfeuer-Sicherung-${new Date().toISOString().slice(0, 10)}.json`;
}

/** Read a backup file and store its pictures and recordings; the lists are merged by the caller. */
export async function readBackup(file: File): Promise<Backup> {
  let parsed: Partial<Backup>;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("Diese Datei ist keine Leuchtfeuer-Sicherung.");
  }
  if (parsed?.app !== APP) throw new Error("Diese Datei ist keine Leuchtfeuer-Sicherung.");
  if ((parsed.version ?? 0) > VERSION) throw new Error("Diese Sicherung stammt aus einer neueren Version von Leuchtfeuer. Bitte aktualisiere die App.");
  for (const [id, url] of Object.entries(parsed.files ?? {})) {
    if (!(await getBlob(id).catch(() => undefined))) await putBlob(id, await dataUrlToBlob(url));
  }
  const list = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
  return {
    app: APP,
    version: parsed.version ?? VERSION,
    createdAt: parsed.createdAt ?? 0,
    chats: list<Chat>(parsed.chats),
    rooms: list<Room>(parsed.rooms),
    folders: list<Folder>(parsed.folders),
    roles: list<SavedRole>(parsed.roles),
    settings: (parsed.settings ?? {}) as Backup["settings"],
    files: {},
  };
}

/** Adds what is not there yet; existing entries (same id) are kept as they are. */
export function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const have = new Set(current.map((x) => x.id));
  const added = incoming.filter((x) => !have.has(x.id));
  return { merged: [...current, ...added], added: added.length };
}
