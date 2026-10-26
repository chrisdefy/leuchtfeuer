import { useEffect, useRef, useState } from "react";
import type { Profile } from "../lib/storage";
import { LEVEL_OPTIONS, PROFILE_TEMPLATES, newProfile, profileSummary } from "../lib/profiles";
import { Icon } from "./Icon";

interface Props {
  profiles: Profile[];
  defaultProfile?: string;
  onSave: (profiles: Profile[], defaultProfile: string | undefined) => void;
  onClose: () => void;
}

/** Create, edit and delete profiles. Nothing changes until "Speichern". */
export function ProfileDialog(props: Props) {
  const [list, setList] = useState(props.profiles);
  const [selected, setSelected] = useState<string | undefined>(props.profiles[0]?.id);
  const [defaultProfile, setDefaultProfile] = useState(props.defaultProfile);
  const dialog = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => dialog.current?.focus(), []);

  const current = list.find((p) => p.id === selected);
  const unusedTemplates = PROFILE_TEMPLATES.filter((t) => !list.some((p) => p.name === t.name));

  function add(from?: Omit<Profile, "id">) {
    const p = newProfile(from);
    setList((l) => [...l, p]);
    setSelected(p.id);
    // A blank profile starts with its name, the first thing to change.
    if (!from) requestAnimationFrame(() => nameInput.current?.select());
  }

  function update(change: Partial<Profile>) {
    setList((l) => l.map((p) => (p.id === selected ? { ...p, ...change } : p)));
  }

  function remove() {
    const rest = list.filter((p) => p.id !== selected);
    setList(rest);
    if (defaultProfile === selected) setDefaultProfile(undefined);
    setSelected(rest[0]?.id);
  }

  function save() {
    const cleaned = list.map((p) => ({ ...p, name: p.name.trim() || "Ohne Namen" }));
    props.onSave(cleaned, cleaned.some((p) => p.id === defaultProfile) ? defaultProfile : undefined);
    props.onClose();
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        ref={dialog}
        className="dialog profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profiles-title"
        tabIndex={-1}
        onKeyDown={(e) => e.key === "Escape" && props.onClose()}
      >
        <header className="dialog-head">
          <h2 id="profiles-title">Profile</h2>
          <button className="ghost icon-only" onClick={props.onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </header>

        <p className="hint">
          Ein Profil legt fest, wie das Modell arbeitet: eine Anweisung, die Stufe und die Schalter. Im Eingabefeld unter
          „Profil“ wählst du es mit einem Klick, für den neuen oder den laufenden Chat.
        </p>

        {list.length > 0 && (
          <div className="profile-tabs" role="tablist" aria-label="Deine Profile">
            {list.map((p) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={p.id === selected}
                className="chip"
                onClick={() => setSelected(p.id)}
                title="Dieses Profil bearbeiten"
              >
                {p.name.trim() || "Ohne Namen"}
                {p.id === defaultProfile && <span className="chip-flag">Start</span>}
              </button>
            ))}
            <button className="chip" onClick={() => add()} title="Leeres Profil anlegen">
              <Icon name="plus" size={14} />
              Neu
            </button>
          </div>
        )}

        {current ? (
          <div className="profile-form" role="tabpanel">
            <div className="field">
              <label htmlFor="profile-name">Name</label>
              <input
                ref={nameInput}
                id="profile-name"
                className="input"
                value={current.name}
                onChange={(e) => update({ name: e.target.value })}
                maxLength={40}
              />
            </div>
            <div className="field">
              <label htmlFor="profile-instruction">Anweisung an das Modell</label>
              <textarea
                id="profile-instruction"
                rows={5}
                value={current.instruction}
                onChange={(e) => update({ instruction: e.target.value })}
                placeholder="Zum Beispiel: Erkläre alles in einfachen Worten und frag nach, wenn etwas unklar ist."
              />
              <p className="hint">Gilt zusätzlich zur Systemanweisung aus den Einstellungen.</p>
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="profile-level">Stufe</label>
                <select
                  id="profile-level"
                  className="select"
                  title="Mit welcher Stufe ein Chat in diesem Profil antwortet"
                  value={current.level ?? ""}
                  onChange={(e) => update({ level: (e.target.value || undefined) as Profile["level"] })}
                >
                  <option value="">Nicht ändern</option>
                  {LEVEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="profile-reasoning">Nachdenken</label>
                <select
                  id="profile-reasoning"
                  className="select"
                  title="Wie gründlich das Modell in diesem Profil nachdenkt"
                  value={current.reasoning ?? ""}
                  onChange={(e) => update({ reasoning: (e.target.value || undefined) as Profile["reasoning"] })}
                >
                  <option value="">Normal</option>
                  <option value="low">Kurz</option>
                  <option value="high">Gründlich</option>
                </select>
              </div>
            </div>
            <fieldset className="field radio-group">
              <legend>Schalter</legend>
              <label className="check">
                <input type="checkbox" checked={current.web} onChange={(e) => update({ web: e.target.checked })} />
                Websuche an
              </label>
              <label className="check">
                <input type="checkbox" checked={current.visualize} onChange={(e) => update({ visualize: e.target.checked })} />
                Diagramme immer anbieten (sonst nur, wenn du danach fragst)
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={defaultProfile === current.id}
                  onChange={(e) => setDefaultProfile(e.target.checked ? current.id : undefined)}
                />
                Jeder neue Chat startet mit diesem Profil
              </label>
            </fieldset>
            <div className="profile-row">
              <span className="hint">{profileSummary(current)}</span>
              <button className="button small danger" onClick={remove} title="Dieses Profil löschen; Chats, die damit begonnen haben, bleiben unverändert">
                <Icon name="trash" size={15} />
                Profil löschen
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-empty">
            <button className="button" onClick={() => add()} title="Ein neues Profil ohne Vorgaben anlegen">
              <Icon name="plus" size={15} />
              Leeres Profil anlegen
            </button>
          </div>
        )}

        {unusedTemplates.length > 0 && (
          <div className="field">
            <span className="field-label">Vorlagen</span>
            <div className="profile-templates">
              {unusedTemplates.map((t) => (
                <button key={t.name} className="profile-template" onClick={() => add(t)} title="Diese Vorlage als neues Profil übernehmen und anpassen">
                  <span className="profile-template-name">
                    <Icon name="plus" size={14} />
                    {t.name}
                  </span>
                  <span className="hint">{profileSummary({ ...t, id: "" })}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <footer className="dialog-foot">
          <button className="button" onClick={props.onClose} title="Schließen, ohne die Änderungen zu übernehmen">
            Abbrechen
          </button>
          <button className="button primary" onClick={save} title="Die Profile speichern">
            Speichern
          </button>
        </footer>
      </div>
    </div>
  );
}
