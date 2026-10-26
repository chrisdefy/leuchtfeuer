import { useEffect, useRef, useState } from "react";
import { NATURAL_VOICES, PREVIEW_TEXT, browserVoices, onVoicesReady, stopSpeaking, toggleSpeaking, useSpeechState } from "../lib/speech";
import type { Settings } from "../lib/storage";
import { CREDITS_URL } from "../lib/auth";
import { ApiKeyField } from "./ApiKeyField";
import { OpenRouterLogin } from "./OpenRouterLogin";
import { Icon } from "./Icon";
import { shortName, type Model } from "../lib/openrouter";
import { TIER_INFO, formatAnswerCost, typicalAnswerUsd, type TierId } from "../lib/tiers";

interface Props {
  /** For the level settings: the catalog and the automatic choice per level. */
  models: Model[] | null;
  autoTiers: Record<TierId, string | undefined>;
  settings: Settings;
  onSave: (patch: Partial<Settings>) => void;
  /** Download everything as one file. */
  onBackup: () => Promise<void>;
  /** Read a backup file back in (adds what is missing). */
  onRestore: (file: File) => void;
  onClose: () => void;
  /** Show the guided tour again. */
  onTour: () => void;
  /** Show the chatroom tour. */
  onRoomTour: () => void;
  /** Open the profile editor. */
  onProfiles: () => void;
}

export function SettingsDialog({ settings, onSave, onBackup, onRestore, onClose, onTour, onRoomTour, onProfiles, models, autoTiers }: Props) {
  const [backingUp, setBackingUp] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [temperature, setTemperature] = useState<number | undefined>(settings.temperature);
  const [defaultMode, setDefaultMode] = useState(settings.defaultMode ?? "best-free");
  const [dictateSend, setDictateSend] = useState(!!settings.dictateSend);
  const [zdr, setZdr] = useState(!!settings.zdr);
  const [backupReminder, setBackupReminder] = useState(!settings.noBackupReminder);
  const [unrestricted, setUnrestricted] = useState(!!settings.unrestricted);
  const [tiers, setTiers] = useState(settings.tiers ?? {});
  const [voiceMode, setVoiceMode] = useState(settings.voiceMode ?? "browser");
  const [webResults, setWebResults] = useState(settings.webResults ?? 10);
  const [naturalVoice, setNaturalVoice] = useState(settings.naturalVoice ?? "Kore");
  const [browserVoice, setBrowserVoice] = useState(settings.browserVoice ?? "");
  const [systemVoices, setSystemVoices] = useState(browserVoices);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const preview = useSpeechState("settings-preview");
  // The simple view shows the everyday settings; the rest is one click away.
  const simple = settings.view === "simple";
  const [showAll, setShowAll] = useState(false);
  const full = !simple || showAll;

  useEffect(() => onVoicesReady(() => setSystemVoices(browserVoices())), []);
  useEffect(() => () => stopSpeaking(), []);

  function playPreview() {
    setPreviewError(null);
    toggleSpeaking("settings-preview", PREVIEW_TEXT, { mode: voiceMode, apiKey: apiKey.trim(), naturalVoice, browserVoice }).catch((e) =>
      setPreviewError((e as Error).message),
    );
  }
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The dialog itself, so Escape works without highlighting a button at random.
    dialog.current?.focus();
  }, []);

  function save() {
    onSave({ apiKey: apiKey.trim(), systemPrompt, temperature, defaultMode, dictateSend, zdr, unrestricted, tiers, voiceMode, webResults, naturalVoice, browserVoice: browserVoice || undefined, noBackupReminder: !backupReminder || undefined });
    onClose();
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header className="dialog-head">
          <h2 id="settings-title">Einstellungen</h2>
          <button className="ghost icon-only" onClick={onClose} aria-label="Schließen" title="Schließen ohne zu speichern">
            <Icon name="close" />
          </button>
        </header>

        <div className="field-grid look">
          <fieldset className="field">
            <legend>Erscheinungsbild</legend>
            <Segmented
              name="theme"
              value={settings.theme ?? "dark"}
              options={[
                ["dark", "Dunkel"],
                ["light", "Hell"],
                ["system", "Wie das Gerät"],
              ]}
              onChange={(theme) => onSave({ theme })}
            />
          </fieldset>
          <fieldset className="field">
            <legend>Schriftgröße</legend>
            <Segmented
              name="text-size"
              value={settings.textSize ?? "normal"}
              options={[
                ["normal", "Normal"],
                ["large", "Groß"],
                ["xlarge", "Sehr groß"],
              ]}
              onChange={(textSize) => onSave({ textSize })}
            />
          </fieldset>
        </div>
        <fieldset className="field view-field" title="Einfach zeigt nur das Wichtigste. Nichts geht verloren.">
          <legend>Ansicht</legend>
          <Segmented
            name="view"
            value={settings.view ?? "full"}
            options={[
              ["simple", "Einfach: nur das Wichtigste"],
              ["full", "Alles"],
            ]}
            onChange={(view) => onSave({ view })}
          />
          <p className="hint">Alle drei gelten sofort, ohne Speichern.</p>
        </fieldset>

        <div className="field">
          <span className="field-label">Einführung</span>
          <div className="tour-row">
            <p className="hint">Kurze Touren zeigen dir an einem Beispiel, wo alles ist. Sie kosten nichts.</p>
            <div className="tour-buttons">
              <button className="button small" onClick={onTour}>
                <Icon name="help" size={15} />
                Chats
              </button>
              {!simple && (
                <button className="button small" onClick={onRoomTour}>
                  <Icon name="help" size={15} />
                  Chatrooms
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="field">
          <span className="field-label">OpenRouter-Konto</span>
          {apiKey.trim() ? (
            <div className="account">
              <p className="account-state">
                <Icon name="check" size={16} />
                Verbunden
                <span className="account-key">Key …{apiKey.trim().slice(-4)}</span>
              </p>
              <div className="account-actions">
                <a className="button small" href={CREDITS_URL} target="_blank" rel="noreferrer" title="Öffnet die Guthaben-Seite von OpenRouter in einem neuen Tab">
                  <Icon name="wallet" size={15} />
                  Guthaben aufladen
                </a>
                <button className="button small" onClick={() => setApiKey("")} title="Key aus diesem Browser entfernen. Wird erst mit „Speichern“ wirksam.">
                  Abmelden
                </button>
              </div>
            </div>
          ) : (
            <>
              <OpenRouterLogin
                primary
                onKey={(key) => {
                  setApiKey(key);
                  onSave({ apiKey: key });
                }}
              />
              <p className="hint">Noch kein Konto? Bei der Anmeldung kannst du eins anlegen, zum Beispiel mit deinem Google-Konto.</p>
            </>
          )}
          <p className="hint">
            Tipp: Auf der Guthaben-Seite von OpenRouter lässt sich automatisches Aufladen einrichten. Dann lädt
            OpenRouter selbst nach, sobald das Guthaben unter einen Betrag fällt.
          </p>
          <details className="manual-key" open={false}>
            <summary>API-Key selbst eingeben</summary>
            <ApiKeyField id="api-key" value={apiKey} onChange={setApiKey} />
            <p className="hint">
              Wird nur in diesem Browser gespeichert und direkt an OpenRouter gesendet.{" "}
              <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
                Key erstellen
              </a>
            </p>
          </details>
        </div>

        {full && (
        <>
        <fieldset className="field radio-group">
          <legend>Modell für neue Chats</legend>
          <label className="check">
            <input type="radio" name="default-mode" checked={defaultMode === "best-free"} onChange={() => setDefaultMode("best-free")} />
            Stufe „Kostenlos“: das beste kostenlose Modell nach unabhängigen Benchmarks
          </label>
          <label className="check">
            <input type="radio" name="default-mode" checked={defaultMode === "last"} onChange={() => setDefaultMode("last")} />
            Das zuletzt gewählte Modell
          </label>
        </fieldset>

        <div className="field">
          <span className="field-label">Profile</span>
          <div className="tour-row">
            <p className="hint">
              {settings.profiles?.length
                ? `${settings.profiles.length === 1 ? "1 Profil" : `${settings.profiles.length} Profile`}: ${settings.profiles.map((p) => p.name).join(", ")}.`
                : "Gespeicherte Arbeitsweisen: Anweisung, Stufe und Schalter, im Eingabefeld mit einem Klick gewählt."}
            </p>
            <div className="tour-buttons">
              <button className="button small" onClick={onProfiles}>
                <Icon name="profile" size={15} />
                {settings.profiles?.length ? "Bearbeiten" : "Anlegen"}
              </button>
            </div>
          </div>
        </div>

        <TierSettings models={models} auto={autoTiers} value={tiers} onChange={setTiers} favorites={settings.favorites} recents={settings.recents} />

        <fieldset className="field radio-group">
          <legend>Datenschutz</legend>
          <label className="check">
            <input type="checkbox" checked={zdr} onChange={(e) => setZdr(e.target.checked)} />
            Nur Server nutzen, die nichts speichern und nichts zum Training verwenden
          </label>
          <p className="hint">
            Gut für persönliche Themen wie Gesundheit, Geld oder Briefe. Manche Modelle, vor allem kostenlose, sind dann
            nicht verfügbar; Leuchtfeuer sagt es dir, wenn das passiert. Websuche und geöffnete Links laufen über eigene Dienste und
            sind davon nicht abgedeckt.
          </p>
        </fieldset>

        <fieldset className="field radio-group">
          <legend>Modelle mit wenigen Einschränkungen</legend>
          <label className="check">
            <input type="checkbox" checked={unrestricted} onChange={(e) => setUnrestricted(e.target.checked)} />
            Ich bin mindestens 18 Jahre alt und möchte solche Modelle in der Auswahl sehen
          </label>
          <p className="hint">
            Diese Modelle lehnen fast nichts ab, auch bei heiklen Themen. Sie sind nicht klüger, meist älter und können
            Anstößiges schreiben. Im Chat steht dann ein Hinweis. OpenRouter verlangt für alle Nutzer ein Mindestalter von
            18 Jahren; Verbotenes bleibt verboten.
          </p>
        </fieldset>

        <fieldset className="field radio-group">
          <legend>Sprechen statt tippen</legend>
          <label className="check">
            <input type="checkbox" checked={dictateSend} onChange={(e) => setDictateSend(e.target.checked)} />
            Nach dem Diktieren sofort senden, ohne den Text vorher zu prüfen
          </label>
          <p className="hint">Die Spracherkennung kostet etwa 0,05 Cent pro Minute.</p>
        </fieldset>

        <fieldset className="field radio-group">
          <legend>Websuche: Quellen pro Suche</legend>
          <label className="check">
            <input type="radio" name="web-results" checked={webResults === 5} onChange={() => setWebResults(5)} />
            5: knapp, das Modell liest am wenigsten
          </label>
          <label className="check">
            <input type="radio" name="web-results" checked={webResults === 10} onChange={() => setWebResults(10)} />
            10: empfohlen, im Preis einer Suche enthalten
          </label>
          <label className="check">
            <input type="radio" name="web-results" checked={webResults === 20} onChange={() => setWebResults(20)} />
            20: gründlich, etwa 1 Cent mehr pro Suche plus mehr Lesestoff fürs Modell
          </label>
          <p className="hint">
            Gilt für Modelle, die über Exa suchen. Claude, GPT, Gemini und Grok nutzen ihre eigene Suche und bestimmen die
            Anzahl selbst.
          </p>
        </fieldset>
        </>
        )}

        <fieldset className="field radio-group">
          <legend>Vorlesen</legend>
          <label className="check">
            <input type="radio" name="voice" checked={voiceMode === "browser"} onChange={() => {
                stopSpeaking();
                setVoiceMode("browser");
              }} />
            Stimme des Browsers: kostenlos, startet sofort
          </label>
          <label className="check">
            <input type="radio" name="voice" checked={voiceMode === "natural"} onChange={() => {
                stopSpeaking();
                setVoiceMode("natural");
              }} />
            Natürliche KI-Stimme: klingt menschlicher, etwa 1 Cent pro Minute
          </label>
          <div className="voice-pick">
            {voiceMode === "natural" ? (
              <select className="select" value={naturalVoice} onChange={(e) => setNaturalVoice(e.target.value)} aria-label="KI-Stimme">
                <optgroup label="Weibliche Stimmen">
                  {NATURAL_VOICES.filter((v) => v.gender === "w").map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}: {v.character}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Männliche Stimmen">
                  {NATURAL_VOICES.filter((v) => v.gender === "m").map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}: {v.character}
                    </option>
                  ))}
                </optgroup>
              </select>
            ) : (
              <select className="select" value={browserVoice} onChange={(e) => setBrowserVoice(e.target.value)} aria-label="Browser-Stimme">
                <option value="">Automatisch die beste deutsche Stimme</option>
                {systemVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="button small"
              onClick={playPreview}
              disabled={voiceMode === "natural" && !apiKey.trim()}
              title="Einen kurzen Beispielsatz mit dieser Stimme hören"
            >
              {preview === "playing" ? "Stopp" : preview === "loading" ? "Lädt …" : "Probe anhören"}
            </button>
          </div>
          {voiceMode === "browser" && systemVoices.length === 0 && (
            <p className="hint">Auf diesem Gerät sind keine deutschen Systemstimmen gefunden worden. Der Browser nimmt dann seine Standardstimme.</p>
          )}
          {previewError && <p className="hint error-text">{previewError}</p>}
        </fieldset>

        {full && (
        <>
        <div className="field">
          <label htmlFor="system-prompt">Systemanweisung</label>
          <textarea
            id="system-prompt"
            rows={4}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Zum Beispiel: Antworte knapp und auf Deutsch."
          />
          <p className="hint">Wird jedem neuen Chat vorangestellt.</p>
        </div>

        <div className="field">
          <div className="field-row">
            <label htmlFor="temperature">Temperatur</label>
            <span className="field-value">
              {temperature === undefined ? "Standard des Modells" : temperature.toFixed(1).replace(".", ",")}
            </span>
          </div>
          <input
            id="temperature"
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={temperature ?? 1}
            onChange={(e) => setTemperature(Number(e.target.value))}
          />
          <div className="field-row">
            <span className="hint">Niedrig ist präziser, hoch ist kreativer.</span>
            {temperature !== undefined && (
              <button className="link-button" onClick={() => setTemperature(undefined)}>
                Zurücksetzen
              </button>
            )}
          </div>
        </div>
        </>
        )}

        <fieldset className="field radio-group">
          <legend>Sicherung</legend>
          <p className="hint backup-hint">
            Chats liegen nur in diesem Browser auf diesem Computer. Eine Sicherung enthält alle Chats, Chatrooms,
            Ordner, eigenen Rollen und Bilder, aber nicht den API-Key. Damit kannst du Chats auf einen anderen Computer
            mitnehmen oder nach dem Löschen der Browserdaten zurückholen.
          </p>
          <div className="backup-actions">
            <button
              className="button small"
              disabled={backingUp}
              aria-busy={backingUp}
              onClick={() => {
                setBackingUp(true);
                onBackup().finally(() => setBackingUp(false));
              }}
            >
              <Icon name="download" size={15} />
              {backingUp ? "Wird erstellt …" : "Sicherung herunterladen"}
            </button>
            <button className="button small" onClick={() => restoreInput.current?.click()} title="Fehlende Chats aus einer Sicherungsdatei hinzufügen. Vorhandene bleiben unverändert.">
              <Icon name="refresh" size={15} />
              Sicherung einlesen
            </button>
            <input
              ref={restoreInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onRestore(file);
              }}
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={backupReminder} onChange={(e) => setBackupReminder(e.target.checked)} />
            An eine Sicherung erinnern, wenn die letzte über 4 Wochen her ist
          </label>
        </fieldset>

        {!full && (
          <button
            className="link-button show-all-settings"
            onClick={() => setShowAll(true)}
            title="Modelle hinter den Stufen, Datenschutz, Profile, Systemanweisung und mehr"
          >
            Alle Einstellungen zeigen
          </button>
        )}

        <footer className="dialog-foot">
          <button className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button className="button primary" onClick={save}>
            Speichern
          </button>
        </footer>
      </div>
    </div>
  );
}

/** A row of radio buttons drawn as one switch; arrow keys move between them like any radio group. */
function Segmented<T extends string>(props: { name: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map(([v, label]) => (
        <label key={v} className={v === props.value ? "on" : undefined}>
          <input type="radio" name={props.name} checked={v === props.value} onChange={() => props.onChange(v)} />
          {label}
        </label>
      ))}
    </div>
  );
}

/**
 * The models behind the levels in the input bar. "Automatisch" follows the benchmarks and prices;
 * a fixed choice stays until changed. Choices come from favorites and recents, so the list stays short.
 */
function TierSettings(props: {
  models: Model[] | null;
  auto: Record<TierId, string | undefined>;
  value: Partial<Record<TierId, string>>;
  onChange: (v: Partial<Record<TierId, string>>) => void;
  favorites: string[];
  recents: string[];
}) {
  const byId = new Map((props.models ?? []).map((m) => [m.id, m]));
  const isText = (m?: Model) => !!m && (m.architecture?.output_modalities ?? ["text"]).every((o) => o === "text");
  const list = (ids: string[]) => [...new Set(ids)].map((id) => byId.get(id)).filter(isText) as Model[];
  const favs = list(props.favorites);
  const recent = list(props.recents).filter((m) => !props.favorites.includes(m.id));
  const autos = list(Object.values(props.auto).filter((x): x is string => !!x));
  const option = (m: Model) => (
    <option key={m.id} value={m.id}>
      {shortName(m)} ({formatAnswerCost(typicalAnswerUsd(m))})
    </option>
  );
  return (
    <fieldset className="field tier-settings">
      <legend>Stufen in der Eingabeleiste</legend>
      <p className="hint">
        Hinter jeder Stufe steckt ein Modell. Automatisch heißt: Leuchtfeuer wählt bei jedem Start das klügste Modell im
        Preisrahmen der Stufe, neue Modelle rücken von selbst nach. Weitere Modelle erscheinen hier, wenn du sie im
        Modell-Picker mit Stern markierst.
      </p>
      {TIER_INFO.map((t) => {
        const auto = props.auto[t.id] ? byId.get(props.auto[t.id]!) : undefined;
        return (
          <label key={t.id} className="tier-setting">
            <span className="tier-setting-name">
              <span className={`tier-dot ${t.id}`} aria-hidden="true" />
              {t.label}
            </span>
            <select
              className="select"
              value={props.value[t.id] ?? ""}
              onChange={(e) => props.onChange({ ...props.value, [t.id]: e.target.value || undefined })}
            >
              <option value="">Automatisch{auto ? `: ${shortName(auto)}` : ""}</option>
              {favs.length > 0 && <optgroup label="Favoriten">{favs.map(option)}</optgroup>}
              {recent.length > 0 && <optgroup label="Zuletzt genutzt">{recent.map(option)}</optgroup>}
              <optgroup label="Automatische Wahl der Stufen">{autos.map(option)}</optgroup>
            </select>
          </label>
        );
      })}
    </fieldset>
  );
}
