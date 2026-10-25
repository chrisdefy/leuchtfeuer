import { useEffect, useMemo, useRef, useState } from "react";
import type { Scores } from "../lib/benchmarks";
import { formatCost } from "../lib/format";
import { shortName, type Model, type VideoModel } from "../lib/openrouter";
import {
  DIFFICULTY_NOTE,
  askQuestions,
  suggestModels,
  workbenchModels,
  writeBrief,
  type Brief,
  type Question,
} from "../lib/workbench";
import { DictateButton } from "./DictateButton";
import { Icon } from "./Icon";

export interface PreparedChat {
  title: string;
  kind: Brief["kind"];
  task: string;
  system: string;
  role: string;
  approach: string;
  model: string;
  web: boolean;
  /** Send the task right away, or leave it in the input field to edit first. */
  send: boolean;
}

interface Props {
  apiKey: string;
  models: Model[];
  videos: VideoModel[];
  scores: Map<string, Scores> | null;
  bestFree: { id: string; score?: number };
  pricePerSecond: (v: VideoModel) => number | null;
  /** Draft text from the input field, used as a starting point. */
  initialIdea: string;
  onStart: (chat: PreparedChat) => void;
  onClose: () => void;
}

type Stage = "idea" | "asking" | "questions" | "writing" | "brief";

export function Workbench(props: Props) {
  const [stage, setStage] = useState<Stage>("idea");
  const [idea, setIdea] = useState(props.initialIdea);
  const [withQuestions, setWithQuestions] = useState(true);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [model, setModel] = useState("");
  const [web, setWeb] = useState(false);
  const [cost, setCost] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const ideaField = useRef<HTMLTextAreaElement>(null);

  const helpers = useMemo(() => workbenchModels(props.models, props.bestFree.id), [props.models, props.bestFree.id]);
  const helperName = useMemo(() => {
    const m = props.models.find((x) => x.id === helpers[0]);
    return m ? shortName(m) : helpers[0];
  }, [props.models, helpers]);

  const suggestions = useMemo(
    () =>
      brief
        ? suggestModels({
            brief,
            models: props.models,
            scores: props.scores,
            bestFree: props.bestFree,
            videos: props.videos,
            pricePerSecond: props.pricePerSecond,
          })
        : [],
    [brief, props.models, props.scores, props.bestFree, props.videos, props.pricePerSecond],
  );

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const el = ideaField.current;
    if (stage === "idea" && el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [stage]);

  // Escape closes, but not while a request runs: that would throw away a paid answer.
  const busy = stage === "asking" || stage === "writing";
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, props]);

  async function run<T>(fn: (signal: AbortSignal) => Promise<T>) {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    try {
      return await fn(ctrl.signal);
    } catch (e) {
      const err = e as Error;
      if (err.name !== "AbortError") {
        setError(err instanceof TypeError ? "OpenRouter ist nicht erreichbar. Prüfe deine Internetverbindung." : err.message);
      }
      return undefined;
    }
  }

  async function start() {
    if (!idea.trim()) return;
    if (!withQuestions) return write([]);
    setStage("asking");
    const res = await run((signal) => askQuestions({ apiKey: props.apiKey, models: helpers, signal }, idea.trim()));
    if (!res) return setStage("idea");
    setCost((c) => c + (res.usage?.cost ?? 0));
    if (!res.questions.length) return write([]);
    setQuestions(res.questions);
    setAnswers(res.questions.map(() => ""));
    setStage("questions");
  }

  async function write(given: string[]) {
    setStage("writing");
    const pairs = questions.map((q, i) => ({ q: q.q, a: given[i] ?? "" }));
    const res = await run((signal) => writeBrief({ apiKey: props.apiKey, models: helpers, signal }, idea.trim(), pairs));
    if (!res) return setStage(given.length ? "questions" : "idea");
    setCost((c) => c + (res.usage?.cost ?? 0));
    setBrief(res.brief);
    setWeb(res.brief.web);
    setModel("");
    setStage("brief");
  }

  // Preselect the first suggestion once the brief is in.
  useEffect(() => {
    if (stage === "brief" && !model && suggestions[0]) setModel(suggestions[0].id);
  }, [stage, model, suggestions]);

  function finish(send: boolean) {
    if (!brief || !model) return;
    props.onStart({
      title: brief.title,
      kind: brief.kind,
      task: brief.task.trim(),
      system: brief.system.trim(),
      role: brief.role,
      approach: brief.approach,
      model,
      web: brief.kind === "text" && web,
      send,
    });
  }

  function toggleOption(i: number, option: string) {
    setAnswers((all) =>
      all.map((a, j) => {
        if (j !== i) return a;
        const parts = a.split(/,\s*/).filter(Boolean);
        return parts.includes(option) ? parts.filter((p) => p !== option).join(", ") : [...parts, option].join(", ");
      }),
    );
  }

  const patch = (p: Partial<Brief>) => setBrief((b) => (b ? { ...b, ...p } : b));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && props.onClose()}>
      <div className="dialog wide workbench" role="dialog" aria-modal="true" aria-labelledby="workbench-title">
        <header className="dialog-head">
          <h2 id="workbench-title">Aufgabe vorbereiten</h2>
          <button className="ghost icon-only" onClick={props.onClose} aria-label="Schließen" disabled={busy}>
            <Icon name="close" />
          </button>
        </header>

        <ol className="wb-steps" aria-label="Schritte">
          <li aria-current={stage === "idea" || stage === "asking" ? "step" : undefined}>Idee</li>
          <li aria-current={stage === "questions" ? "step" : undefined}>Rückfragen</li>
          <li aria-current={stage === "writing" || stage === "brief" ? "step" : undefined}>Ergebnis</li>
        </ol>

        {(stage === "idea" || stage === "asking") && (
          <>
            <p className="dialog-lead">
              Schreib oder sprich einfach drauflos, was du vorhast, gern ungeordnet. Daraus entstehen eine klar
              formulierte Aufgabe, eine passende Rolle mit Vorgehen für das Modell und eine Modellempfehlung. Vor dem
              Start kannst du alles ändern.
            </p>
            <div className="field">
              <div className="field-row">
                <label htmlFor="wb-idea">Deine Idee</label>
                <DictateButton
                  apiKey={props.apiKey}
                  disabled={busy}
                  onText={(t) => setIdea((v) => (v.trim() ? `${v.trimEnd()} ${t}` : t))}
                  onError={setError}
                />
              </div>
              <textarea
                id="wb-idea"
                ref={ideaField}
                rows={8}
                value={idea}
                readOnly={busy}
                placeholder="Zum Beispiel: Ich will ein kleines Café eröffnen und brauche einen Businessplan für die Bank. Ich habe 30.000 € Eigenkapital, Erfahrung in der Gastro, aber keine Ahnung, wie man so einen Plan aufbaut …"
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void start();
                }}
              />
            </div>
            <label className="check">
              <input type="checkbox" checked={withQuestions} disabled={busy} onChange={(e) => setWithQuestions(e.target.checked)} />
              Rückfragen stellen, wenn etwas Wichtiges fehlt
            </label>
            {error && (
              <div className="msg-error" role="alert">
                {error}
              </div>
            )}
            <footer className="dialog-foot spread">
              <p className="hint">{helperName} bereitet vor, meist für weniger als einen Cent.</p>
              <div className="dialog-buttons">
                {stage === "asking" ? (
                  <>
                    <span className="wb-working" role="status">
                      <span className="spinner small" aria-hidden="true" />
                      Liest deine Idee …
                    </span>
                    <button className="button" onClick={() => abort.current?.abort()}>
                      Stoppen
                    </button>
                  </>
                ) : (
                  <>
                    <button className="button" onClick={props.onClose}>
                      Abbrechen
                    </button>
                    <button className="button primary" onClick={() => void start()} disabled={!idea.trim()}>
                      <Icon name="sparkle" size={15} />
                      Weiterdenken
                    </button>
                  </>
                )}
              </div>
            </footer>
          </>
        )}

        {stage === "questions" && (
          <>
            <p className="dialog-lead">
              Ein paar Rückfragen, damit das Ergebnis zu dir passt. Beantworte, was du weißt. Leer lassen ist auch in
              Ordnung, dann bleibt der Punkt offen.
            </p>
            {questions.map((q, i) => (
              <div className="field wb-question" key={i}>
                <label htmlFor={`wb-q${i}`}>{q.q}</label>
                {q.options.length > 0 && (
                  <div className="chips">
                    {q.options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        className="chip"
                        aria-pressed={answers[i].split(/,\s*/).includes(o)}
                        onClick={() => toggleOption(i, o)}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  id={`wb-q${i}`}
                  rows={1}
                  value={answers[i]}
                  placeholder={q.options.length ? "Antippen oder selbst schreiben" : "Deine Antwort"}
                  onChange={(e) => setAnswers((all) => all.map((a, j) => (j === i ? e.target.value : a)))}
                />
              </div>
            ))}
            {error && (
              <div className="msg-error" role="alert">
                {error}
              </div>
            )}
            <footer className="dialog-foot">
              <button className="button" onClick={() => setStage("idea")}>
                Zurück
              </button>
              <button className="button" onClick={() => void write([])}>
                Überspringen
              </button>
              <button className="button primary" onClick={() => void write(answers)}>
                Weiter
              </button>
            </footer>
          </>
        )}

        {stage === "writing" && (
          <div className="wb-writing" role="status">
            <span className="spinner" aria-hidden="true" />
            <p>Formuliert die Aufgabe aus und sucht Rolle, Vorgehen und Modell …</p>
            <button className="button" onClick={() => abort.current?.abort()}>
              Stoppen
            </button>
          </div>
        )}

        {stage === "brief" && brief && (
          <>
            <section className="wb-section">
              <div className="field">
                <label htmlFor="wb-title">Titel</label>
                <input id="wb-title" className="input" value={brief.title} onChange={(e) => patch({ title: e.target.value })} />
              </div>
              <div className="field">
                <div className="field-row">
                  <label htmlFor="wb-task">
                    {brief.kind === "text" ? "Die Aufgabe" : brief.kind === "image" ? "Bildbeschreibung" : "Videobeschreibung"}
                  </label>
                  <span className="field-value">geht als erste Nachricht ans Modell</span>
                </div>
                <textarea
                  id="wb-task"
                  rows={brief.kind === "text" ? 12 : 6}
                  value={brief.task}
                  onChange={(e) => patch({ task: e.target.value })}
                />
              </div>
            </section>

            {brief.kind === "text" && (
              <section className="wb-section">
                <h3>Rolle und Vorgehen</h3>
                {(brief.role || brief.approach) && (
                  <p className="wb-role">
                    <strong>{brief.role}</strong>
                    {brief.role && brief.approach && ", "}
                    {brief.approach}
                  </p>
                )}
                {brief.why && <p className="hint">{brief.why}</p>}
                <details className="wb-system">
                  <summary>Anweisung an das Modell ansehen und bearbeiten</summary>
                  <textarea
                    aria-label="Anweisung an das Modell"
                    rows={9}
                    value={brief.system}
                    onChange={(e) => patch({ system: e.target.value })}
                  />
                  <p className="hint">Gilt nur für diesen Chat, zusätzlich zu deiner allgemeinen Anweisung in den Einstellungen.</p>
                </details>
              </section>
            )}

            <section className="wb-section">
              <h3>Modell</h3>
              {brief.kind === "text" && <p className="hint wb-difficulty">{DIFFICULTY_NOTE[brief.difficulty]}</p>}
              {suggestions.length ? (
                <div className="wb-models" role="radiogroup" aria-label="Modell">
                  {suggestions.map((s) => (
                    <label key={s.id} className={`wb-model${model === s.id ? " selected" : ""}`}>
                      <input type="radio" name="wb-model" checked={model === s.id} onChange={() => setModel(s.id)} />
                      <span className="wb-model-text">
                        <span className="wb-model-head">
                          <span className="wb-model-name">{s.name}</span>
                          <span className="wb-badge">{s.badge}</span>
                        </span>
                        {s.reason && <span className="wb-model-reason">{s.reason}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="hint">Für diese Art Aufgabe ist gerade kein passendes Modell verfügbar.</p>
              )}
              {brief.kind === "text" && (
                <label className="check">
                  <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} />
                  Websuche einschalten{brief.web ? ", empfohlen, weil aktuelle Informationen gebraucht werden" : ""}
                </label>
              )}
              <p className="hint">Das Modell lässt sich im Chat jederzeit wechseln.</p>
            </section>

            {error && (
              <div className="msg-error" role="alert">
                {error}
              </div>
            )}
            <footer className="dialog-foot spread">
              <p className="hint">{cost > 0 ? `Vorbereitung hat ${formatCost(cost)} gekostet.` : ""}</p>
              <div className="dialog-buttons">
                <button className="button" onClick={() => setStage("idea")}>
                  Zurück
                </button>
                {brief.kind !== "video" && (
                  <button className="button" onClick={() => finish(false)} disabled={!model || !brief.task.trim()}>
                    Erst bearbeiten
                  </button>
                )}
                <button className="button primary" onClick={() => finish(brief.kind !== "video")} disabled={!model || !brief.task.trim()}>
                  {brief.kind === "video" ? "Weiter zum Video" : "Chat starten"}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
