import { useState } from "react";
import { formatCost } from "../../lib/format";
import { shortName, type Model } from "../../lib/openrouter";
import { ORDERS, PALETTE, lacksModel, roomCost, type Order, type Room } from "../../lib/rooms";
import { Icon } from "../Icon";

/** What the settings dialog can change; the participants are edited one by one, as before. */
export type RoomRules = Pick<Room, "title" | "topic" | "goal" | "cast" | "order" | "maxRounds" | "budget" | "aiAware">;

interface Props {
  room: Room;
  models: Model[] | null;
  onApply: (rules: RoomRules) => void;
  onEditParticipant: (id: string) => void;
  onAddParticipant: () => void;
  /** Saves the setup as shown, including changes not applied yet. */
  onSaveTemplate: (name: string, download: boolean, rules: RoomRules) => void;
  onClose: () => void;
}

/**
 * The room's setup while it runs: look it up, or change it. Changes count from the next turn on,
 * like edits to a participant; the conversation so far stays as it was.
 */
export function RoomSettings({ room, models, onApply, onEditParticipant, onAddParticipant, onSaveTemplate, onClose }: Props) {
  const [rules, setRules] = useState<RoomRules>({
    title: room.title,
    topic: room.topic,
    goal: room.goal ?? "",
    cast: room.cast ?? "",
    order: room.order,
    maxRounds: room.maxRounds,
    budget: room.budget,
    aiAware: room.aiAware,
  });
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [download, setDownload] = useState(false);
  const set = (change: Partial<RoomRules>) => setRules((r) => ({ ...r, ...change }));
  const spent = roomCost(room);
  const changed =
    rules.title !== room.title ||
    rules.topic !== room.topic ||
    rules.goal !== (room.goal ?? "") ||
    rules.cast !== (room.cast ?? "") ||
    rules.order !== room.order ||
    rules.maxRounds !== room.maxRounds ||
    rules.budget !== room.budget ||
    rules.aiAware !== room.aiAware;
  const label = (id: string) => {
    const m = models?.find((x) => x.id === id);
    return m ? shortName(m) : id;
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog wide room-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-settings-title"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header className="dialog-head">
          <div>
            <h2 id="room-settings-title">Einstellungen des Raums</h2>
            <p className="hint">Änderungen gelten ab dem nächsten Beitrag. Was bisher gesagt wurde, bleibt.</p>
          </div>
          <button className="ghost icon-only" onClick={onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (changed && rules.topic.trim()) onApply({ ...rules, title: rules.title.trim() || room.title, topic: rules.topic.trim() });
            onClose();
          }}
        >
          <div className="field">
            <label htmlFor="rs-title">Name des Raums</label>
            <input id="rs-title" className="input" value={rules.title} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="rs-topic">Thema oder Ausgangsfrage</label>
            <textarea
              id="rs-topic"
              rows={rules.topic.length > 160 ? 5 : 2}
              value={rules.topic}
              onChange={(e) => set({ topic: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="rs-cast">Wer ist wer</label>
            <textarea
              id="rs-cast"
              rows={Math.min(8, Math.max(2, (rules.cast ?? "").split("\n").length + 1))}
              value={rules.cast}
              placeholder="- Name (Rolle): wer sie oder er ist und wie sie zu den anderen steht"
              onChange={(e) => set({ cast: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="rs-goal">Ziel</label>
            <input
              id="rs-goal"
              className="input"
              value={rules.goal}
              placeholder="Woran erkennt man, dass das Gespräch fertig ist?"
              onChange={(e) => set({ goal: e.target.value })}
            />
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="rs-order">Reihenfolge</label>
              <select id="rs-order" className="select" title="Wer als Nächstes spricht" value={rules.order} onChange={(e) => set({ order: e.target.value as Order })}>
                {Object.entries(ORDERS).map(([id, l]) => (
                  <option key={id} value={id}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rs-rounds">Höchstens Runden</label>
              <input
                id="rs-rounds"
                className="input"
                type="number"
                min={1}
                max={50}
                value={rules.maxRounds}
                onChange={(e) => set({ maxRounds: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
            <div className="field">
              <label htmlFor="rs-budget">Budget in $</label>
              <input
                id="rs-budget"
                className="input"
                type="number"
                min={0.01}
                step="any"
                value={rules.budget}
                onChange={(e) => set({ budget: Math.max(0.01, Number(e.target.value) || 0.01) })}
              />
            </div>
          </div>
          <p className="hint">
            Gerade in Runde {Math.min(room.round, room.maxRounds)}, bisher {formatCost(spent) || "$0"} ausgegeben.
          </p>
          <label className="check">
            <input type="checkbox" checked={rules.aiAware} onChange={(e) => set({ aiAware: e.target.checked })} />
            Die Teilnehmer wissen, dass sie KI-Modelle sind
          </label>

          <h3 className="rs-sub">Teilnehmer</h3>
          <ul className="rs-people">
            {room.participants.map((p) => (
              <li key={p.id}>
                <span className="swatch" style={{ background: p.human ? "var(--ink-2)" : PALETTE[p.color] }} aria-hidden="true" />
                <span className="rs-person">
                  <span>
                    <strong>{p.name}</strong> · {p.roleName || "Teilnehmer"}
                  </span>
                  <span className={lacksModel(p, models) ? "error-text" : "hint"}>
                    {p.human ? "Du" : lacksModel(p, models) ? "Kein Modell" : label(p.model)}
                    {p.leads && " · leitet"}
                    {p.finalOnly && " · spricht erst am Ende"}
                    {p.paused && " · pausiert"}
                  </span>
                </span>
                <button type="button" className="ghost small" onClick={() => onEditParticipant(p.id)} title="Rolle, Modell, Länge oder Stimme dieser Figur ändern">
                  Bearbeiten
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="ghost small"
            title="Eine weitere KI-Figur ins Gespräch holen (höchstens 6)"
            onClick={onAddParticipant}
            disabled={room.participants.filter((p) => !p.human).length >= 6}
          >
            <Icon name="plus" size={14} />
            Teilnehmer hinzufügen
          </button>

          {templateName !== null && (
            <div className="rs-template">
              <label className="pfield">
                <span className="pfield-label">Name der Vorlage</span>
                <input className="input" value={templateName} autoFocus onChange={(e) => setTemplateName(e.target.value)} />
              </label>
              <label className="check inline">
                <input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />
                Zusätzlich als Datei herunterladen, zum Weitergeben
              </label>
              <p className="hint">
                Gespeichert werden Teilnehmer mit Modellen und Stimmen, Thema, Wer-ist-wer, Ziel und Regeln, nicht das
                Gespräch. Du findest die Vorlage beim Erstellen eines Chatrooms unter „Meine Vorlagen“.
              </p>
              <div className="dialog-buttons">
                <button type="button" className="button small" onClick={() => setTemplateName(null)} title="Keine Vorlage speichern">
                  Abbrechen
                </button>
                <button
                  type="button"
                  className="button small primary"
                  title="Diesen Aufbau unter dem Namen als Vorlage speichern"
                  disabled={!templateName.trim()}
                  onClick={() => {
                    onSaveTemplate(templateName, download, rules);
                    setTemplateName(null);
                  }}
                >
                  Vorlage speichern
                </button>
              </div>
            </div>
          )}

          <footer className="dialog-foot spread">
            {templateName === null ? (
              <button type="button" className="button" onClick={() => setTemplateName(room.title)} title="Teilnehmer, Thema und Regeln als Vorlage für neue Räume speichern, ohne das Gespräch">
                Als Vorlage speichern …
              </button>
            ) : (
              <span />
            )}
            <div className="dialog-buttons">
              <button type="button" className="button" onClick={onClose} title={changed ? "Schließen, ohne die Änderungen zu übernehmen" : "Fenster schließen"}>
                {changed ? "Verwerfen" : "Schließen"}
              </button>
              {changed && (
                <button type="submit" className="button primary" disabled={!rules.topic.trim()} title="Die Änderungen gelten ab dem nächsten Beitrag">
                  Übernehmen
                </button>
              )}
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
