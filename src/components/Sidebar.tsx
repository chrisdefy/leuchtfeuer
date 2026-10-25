import { CREDITS_URL } from "../lib/auth";
import { useEffect, useRef, useState } from "react";
import type { Folder } from "../lib/folders";
import { formatCost, formatRelativeDay } from "../lib/format";
import type { Chat } from "../lib/storage";
import { Icon } from "./Icon";

export type Mode = "chats" | "rooms";

export interface ListItem {
  id: string;
  title: string;
  updatedAt: number;
  cost: number;
  folderId?: string;
}

interface Props {
  mode: Mode;
  onMode: (mode: Mode) => void;
  items: ListItem[];
  /** Folders of the current list (chats or rooms). */
  folders: Folder[];
  activeId: string | null;
  credits: { remaining: number; total: number } | null;
  freeQuota: { used: number; limit: number; remaining: number } | null;
  hasKey: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onOpenSettings: () => void;
  /** Start the guided tour through the interface. */
  onTour?: () => void;
}

export function chatCost(chat: Chat) {
  return chat.messages.reduce((sum, m) => sum + (m.usage?.cost ?? 0), 0);
}

const DRAG_TYPE = "application/x-router-item";
/** Drop target id for "no folder". */
const LOOSE = "__loose";

/** Below this (in USD) the balance is shown as running low. */
const LOW_CREDIT = 0.5;

export function Sidebar(props: Props) {
  const rooms = props.mode === "rooms";
  const folderIds = new Set(props.folders.map((f) => f.id));
  const sorted = [...props.items].sort((a, b) => b.updatedAt - a.updatedAt);
  const loose = sorted.filter((i) => !i.folderId || !folderIds.has(i.folderId));
  const sections: { label: string; items: ListItem[] }[] = [];
  for (const item of loose) {
    const label = formatRelativeDay(item.updatedAt);
    const last = sections[sections.length - 1];
    if (last?.label === label) last.items.push(item);
    else sections.push({ label, items: [item] });
  }

  const [renaming, setRenaming] = useState<{ id: string; value: string; folder?: boolean } | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  function commitRename() {
    if (renaming) {
      if (renaming.folder) props.onRenameFolder(renaming.id, renaming.value);
      else props.onRename(renaming.id, renaming.value);
    }
    setRenaming(null);
  }

  function commitCreate() {
    if (creating?.trim()) props.onCreateFolder(creating.trim());
    setCreating(null);
  }

  /** Drag and drop handlers for a drop zone (a folder, or the list without folder). */
  function dropZone(target: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (dropOver !== target) setDropOver(target);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver((d) => (d === target ? null : d));
      },
      onDrop: (e: React.DragEvent) => {
        const id = e.dataTransfer.getData(DRAG_TYPE);
        setDropOver(null);
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        props.onMove(id, target === LOOSE ? null : target);
      },
    };
  }

  function row(c: ListItem) {
    if (renaming?.id === c.id && !renaming.folder) {
      return (
        <li key={c.id}>
          <input
            className="rename-input"
            value={renaming.value}
            autoFocus
            onFocus={(e) => e.target.select()}
            aria-label="Neuer Titel"
            onChange={(e) => setRenaming({ id: c.id, value: e.target.value })}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(null);
            }}
          />
        </li>
      );
    }
    return (
      <li
        key={c.id}
        className={c.id === props.activeId ? "active" : undefined}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, c.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDropOver(null)}
      >
        <button
          className="chat-link"
          onClick={() => props.onSelect(c.id)}
          onDoubleClick={() => setRenaming({ id: c.id, value: c.title })}
          aria-current={c.id === props.activeId ? "page" : undefined}
          title={`${c.title} (Doppelklick zum Umbenennen, ziehen zum Einsortieren)`}
        >
          <span className="chat-title">{c.title}</span>
          {c.cost > 0 && <span className="chat-cost">{formatCost(c.cost)}</span>}
        </button>
        <span className="row-actions">
          <button
            className="chat-delete chat-move"
            aria-label={`„${c.title}“ in einen Ordner verschieben`}
            aria-expanded={moving === c.id}
            onClick={() => setMoving(moving === c.id ? null : c.id)}
          >
            <Icon name="folder" size={14} />
          </button>
          <button
            className="chat-delete chat-rename"
            aria-label={`„${c.title}“ umbenennen`}
            onClick={() => setRenaming({ id: c.id, value: c.title })}
          >
            <Icon name="edit" size={14} />
          </button>
          <button className="chat-delete" aria-label={`„${c.title}“ löschen`} onClick={() => props.onDelete(c.id)}>
            <Icon name="trash" size={15} />
          </button>
        </span>
        {moving === c.id && (
          <MoveMenu
            folders={props.folders}
            current={c.folderId && folderIds.has(c.folderId) ? c.folderId : null}
            onPick={(folderId) => {
              props.onMove(c.id, folderId);
              setMoving(null);
            }}
            onNewFolder={() => {
              setMoving(null);
              setCreating("");
            }}
            onClose={() => setMoving(null)}
          />
        )}
      </li>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="wordmark" aria-label="Leuchtfeuer">
          {/* A light, its beam and the horizon: the way through in the dark. */}
          <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
            <defs>
              <linearGradient id="wordmark-beam" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="var(--out)" stopOpacity="0.9" />
                <stop offset="1" stopColor="var(--in)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M10 14 29 6.5V21.5Z" fill="url(#wordmark-beam)" />
            <circle cx="10" cy="14" r="3.2" fill="var(--ink)" />
            <circle cx="10" cy="14" r="1.5" fill="var(--out)" />
            <path d="M4 24.5c4-1.6 8-1.6 12 0s8 1.6 12 0" stroke="var(--in)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </svg>
          Leuchtfeuer
        </span>
        <button
          className="button primary small"
          onClick={props.onNew}
          title={rooms ? "Einen Chatroom einrichten, in dem mehrere Modelle miteinander sprechen" : "Neuen, leeren Chat beginnen"}
          aria-label={rooms ? "Neuer Raum" : "Neuer Chat"}
        >
          <Icon name="plus" size={16} />
          {/* Short, so it fits next to the name; the full label is for screen readers. */}
          Neu
        </button>
      </div>

      <div className="mode-switch" role="tablist" aria-label="Bereich">
        <button role="tab" aria-selected={!rooms} onClick={() => props.onMode("chats")} title="Deine Unterhaltungen mit einzelnen Modellen">
          Chats
        </button>
        <button role="tab" aria-selected={rooms} onClick={() => props.onMode("rooms")} title="Räume, in denen mehrere Modelle mit Rollen miteinander sprechen">
          Chatrooms
        </button>
      </div>

      <nav className="chat-list" aria-label={rooms ? "Chatrooms" : "Chats"}>
        <section className="folders">
          <div className="list-head">
            <h2 className="list-label">Ordner</h2>
            <button className="ghost icon-only small-icon" onClick={() => setCreating("")} aria-label="Neuer Ordner" title="Neuer Ordner">
              <Icon name="plus" size={14} />
            </button>
          </div>
          {creating !== null && (
            <input
              className="rename-input folder-input"
              value={creating}
              autoFocus
              placeholder="Name des Ordners"
              aria-label="Name des neuen Ordners"
              onChange={(e) => setCreating(e.target.value)}
              onBlur={commitCreate}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCreate();
                if (e.key === "Escape") setCreating(null);
              }}
            />
          )}
          {props.folders.length === 0 && creating === null && (
            <p className="sidebar-empty folder-empty">Lege Ordner an und ziehe {rooms ? "Räume" : "Chats"} hinein.</p>
          )}
          <ul>
            {props.folders.map((f) => {
              const inside = sorted.filter((i) => i.folderId === f.id);
              return (
                <li key={f.id} className={`folder${dropOver === f.id ? " drop-over" : ""}`} {...dropZone(f.id)}>
                  {renaming?.id === f.id && renaming.folder ? (
                    <input
                      className="rename-input"
                      value={renaming.value}
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      aria-label="Neuer Ordnername"
                      onChange={(e) => setRenaming({ id: f.id, value: e.target.value, folder: true })}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <div className="folder-row">
                      <button
                        className="folder-link"
                        onClick={() => props.onToggleFolder(f.id)}
                        onDoubleClick={() => setRenaming({ id: f.id, value: f.name, folder: true })}
                        aria-expanded={!f.collapsed}
                      >
                        <span className={`fold-caret${f.collapsed ? "" : " open"}`} aria-hidden="true">
                          <Icon name="chevron" size={14} />
                        </span>
                        <Icon name="folder" size={15} />
                        <span className="chat-title">{f.name}</span>
                        <span className="chat-cost">{inside.length}</span>
                      </button>
                      <span className="row-actions">
                        <button
                          className="chat-delete chat-rename"
                          aria-label={`Ordner „${f.name}“ umbenennen`}
                          onClick={() => setRenaming({ id: f.id, value: f.name, folder: true })}
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button
                          className="chat-delete"
                          aria-label={`Ordner „${f.name}“ löschen`}
                          title={`Ordner löschen. Die ${rooms ? "Räume" : "Chats"} darin bleiben erhalten.`}
                          onClick={() => props.onDeleteFolder(f.id)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </span>
                    </div>
                  )}
                  {!f.collapsed && (
                    <ul className="folder-items">
                      {inside.map(row)}
                      {inside.length === 0 && <li className="folder-hint">Hierher ziehen</li>}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <div className={`loose${dropOver === LOOSE ? " drop-over" : ""}`} {...dropZone(LOOSE)}>
          {sorted.length === 0 && (
            <p className="sidebar-empty">
              {rooms ? "Hier erscheinen deine Chatrooms, in denen Modelle miteinander sprechen." : "Deine Chats erscheinen hier."}
            </p>
          )}
          {loose.length === 0 && sorted.length > 0 && <p className="sidebar-empty">Hier ablegen, um aus dem Ordner zu nehmen.</p>}
          {sections.map((s) => (
            <section key={s.label}>
              <h2 className="list-label">{s.label}</h2>
              <ul>{s.items.map(row)}</ul>
            </section>
          ))}
        </div>
      </nav>

      <div className="sidebar-foot">
        <div className="foot-links">
          <button className="ghost settings-link" onClick={props.onOpenSettings} title="API-Key, Standardmodell, Vorlesen, Diktat und Systemanweisung">
            <Icon name="settings" />
            Einstellungen
          </button>
          {props.onTour && (
            <button className="ghost settings-link" onClick={props.onTour} title="Kurze Tour: zeigt dir in einem Beispiel-Chat, wo alles ist. Kostet nichts.">
              <Icon name="help" />
              Einführung
            </button>
          )}
        </div>
        {props.hasKey && (props.credits || props.freeQuota) && (
          <span className="credits">
            {props.credits && (
              <span
                className={props.credits.total > 0 && props.credits.remaining < LOW_CREDIT ? "quota-out" : undefined}
                title={
                  props.credits.total > 0 && props.credits.remaining < LOW_CREDIT
                    ? "Das Guthaben ist fast aufgebraucht. Kostenlose Modelle gehen weiterhin."
                    : "Verbleibendes OpenRouter-Guthaben"
                }
              >
                Guthaben <strong>{formatCost(props.credits.remaining)}</strong>{" "}
                <a className="topup" href={CREDITS_URL} target="_blank" rel="noreferrer" title="Guthaben auf openrouter.ai aufladen (öffnet einen neuen Tab)">
                  Aufladen
                </a>
              </span>
            )}
            {props.freeQuota && (
              <span
                className={props.freeQuota.remaining <= 0 ? "quota-out" : undefined}
                title="Anfragen an kostenlose Modelle heute. Neues Kontingent ab 0 Uhr UTC."
              >
                Kostenlos heute <strong>{props.freeQuota.remaining}</strong> von {props.freeQuota.limit}
              </span>
            )}
          </span>
        )}
      </div>
    </aside>
  );
}

/** "Verschieben nach …" for touch screens and keyboards, where dragging does not work. */
function MoveMenu(props: {
  folders: Folder[];
  current: string | null;
  onPick: (folderId: string | null) => void;
  onNewFolder: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && props.onClose();
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="move-menu" role="menu" ref={ref} onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
      <p className="move-title">Verschieben nach</p>
      {props.folders.map((f) => (
        <button key={f.id} role="menuitem" disabled={props.current === f.id} onClick={() => props.onPick(f.id)}>
          <Icon name="folder" size={14} />
          {f.name}
        </button>
      ))}
      {props.current && (
        <button role="menuitem" onClick={() => props.onPick(null)}>
          Aus dem Ordner nehmen
        </button>
      )}
      <button role="menuitem" onClick={props.onNewFolder}>
        <Icon name="plus" size={14} />
        Neuer Ordner …
      </button>
    </div>
  );
}
