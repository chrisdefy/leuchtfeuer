import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMPLETE_MARK,
  checkPrompt,
  contextUsage,
  estimateCost,
  estimateTokens,
  mainHistory,
  pickChecker,
  summaryBudget,
  summaryPrompt,
} from "../lib/context";
import { formatCost, formatTokens } from "../lib/format";
import { complete, shortName, type ChatMessage, type Model } from "../lib/openrouter";
import type { Chat, Message } from "../lib/storage";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

interface Props {
  chat: Chat;
  modelId: string;
  models: Model[];
  apiKey: string;
  /** Turns history into API messages for a target model (system prompt, attribution, seed). */
  buildMessages: (history: Message[], target: string) => Promise<ChatMessage[]>;
  onStart: (summary: string) => void;
  onClose: () => void;
  /** Summarize only up to an answer ("Bis hier zusammenfassen"); missing = the whole chat. */
  history?: Message[];
}

type Stage = "intro" | "writing" | "review";

export function SummaryDialog({ chat, modelId, models, apiKey, buildMessages, onStart, onClose, ...props }: Props) {
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const model = byId.get(modelId);
  const name = model ? shortName(model) : modelId;
  const history = useMemo(() => props.history ?? mainHistory(chat), [props.history, chat]);
  const usage = props.history
    ? { tokens: history.reduce((n, m) => n + estimateTokens(m.content), 0), measured: false }
    : contextUsage(chat, model);
  const budget = summaryBudget(usage.tokens);
  const checkerId = pickChecker(models, usage.tokens + budget.tokens, modelId);
  const checker = byId.get(checkerId);

  const [stage, setStage] = useState<Stage>("intro");
  const [summary, setSummary] = useState("");
  const [cost, setCost] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [gaps, setGaps] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

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

  async function write() {
    setStage("writing");
    setSummary("");
    setGaps(null);
    const result = await run(async (signal) =>
      complete(
        {
          apiKey,
          model: modelId,
          signal,
          messages: [
            ...(await buildMessages(history, modelId)),
            { role: "user", content: summaryPrompt(budget.words) },
          ],
        },
        setSummary,
      ),
    );
    if (result) {
      setSummary(result.text.trim());
      setCost((c) => c + (result.usage?.cost ?? 0));
    }
    setStage("review");
  }

  async function check() {
    setChecking(true);
    setGaps(null);
    const result = await run(async (signal) =>
      complete({
        apiKey,
        model: checkerId,
        signal,
        messages: [...(await buildMessages(history, checkerId)), { role: "user", content: checkPrompt(summary) }],
      }),
    );
    if (result) {
      setGaps(result.text.trim());
      setCost((c) => c + (result.usage?.cost ?? 0));
    }
    setChecking(false);
  }

  function applyGaps() {
    if (!gaps) return;
    setSummary((s) => `${s.trimEnd()}\n\n## Ergänzungen aus der Prüfung\n\n${gaps}`);
    setGaps(null);
  }

  const complete_ = gaps?.toUpperCase().startsWith(COMPLETE_MARK);
  const summaryEstimate = estimateCost(model, usage.tokens, budget.tokens);
  const checkEstimate = estimateCost(checker, usage.tokens + estimateTokens(summary || "x".repeat(budget.tokens * 3)), 600);
  const busy = stage === "writing" || checking;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="summary-title"
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <header className="dialog-head">
          <h2 id="summary-title">{props.history ? "Bis hier zusammenfassen" : "Zusammenfassen und neu starten"}</h2>
          <button className="ghost icon-only" onClick={onClose} aria-label="Schließen" disabled={busy}>
            <Icon name="close" />
          </button>
        </header>

        {stage === "intro" && (
          <>
            <p className="dialog-lead">
              <strong>{name}</strong> fasst {props.history ? "den Verlauf bis zu dieser Antwort" : "diesen Chat"} zusammen. Du
              prüfst und bearbeitest das Ergebnis, dann startet ein neuer Chat mit der Zusammenfassung als Ausgangspunkt, oder
              du kopierst sie. Dieser Chat bleibt unverändert erhalten.
            </p>
            <dl className="summary-facts">
              <div>
                <dt>Verlauf</dt>
                <dd>
                  {usage.measured ? "" : "ca. "}
                  {formatTokens(usage.tokens)} Tokens
                </dd>
              </div>
              <div>
                <dt>Zusammenfassung</dt>
                <dd>höchstens ca. {budget.words.toLocaleString("de-DE")} Wörter</dd>
              </div>
              <div>
                <dt>Kosten</dt>
                <dd>{summaryEstimate !== undefined ? `ca. ${formatCost(summaryEstimate)}` : "unbekannt"}</dd>
              </div>
            </dl>
            <p className="hint">
              Die Zusammenfassung folgt einer festen Gliederung: Ziel, Ergebnisse, Fakten und Zahlen, deine Vorgaben,
              wörtlich übernommene Inhalte und offene Fragen. Zahlen, Namen und Code werden exakt übernommen.
            </p>
            <footer className="dialog-foot">
              <button className="button" onClick={onClose} title="Schließen, ohne etwas zu erstellen">
                Abbrechen
              </button>
              <button className="button primary" onClick={write} title="Ein Modell schreibt eine Zusammenfassung des bisherigen Chats">
                Zusammenfassung erstellen
              </button>
            </footer>
          </>
        )}

        {stage !== "intro" && (
          <>
            <div className="field">
              <div className="field-row">
                <label htmlFor="summary-text">
                  {stage === "writing" ? `${name} schreibt die Zusammenfassung …` : "Zusammenfassung prüfen und bearbeiten"}
                </label>
                <span className="field-value">
                  {formatTokens(estimateTokens(summary))} Tokens
                  {cost > 0 && <>, bisher {formatCost(cost)}</>}
                </span>
              </div>
              <textarea
                id="summary-text"
                className="summary-text"
                rows={14}
                value={summary}
                readOnly={stage === "writing"}
                onChange={(e) => {
                  setSummary(e.target.value);
                  setCopied(false);
                }}
              />
            </div>

            {error && (
              <div className="msg-error" role="alert">
                {error}
              </div>
            )}

            {stage === "review" && (
              <section className="gap-check" aria-live="polite">
                {gaps === null ? (
                  <div className="field-row">
                    <p className="hint">
                      {checker ? shortName(checker) : checkerId} vergleicht die Zusammenfassung mit dem ganzen Verlauf und
                      listet, was fehlt.
                      {checkEstimate !== undefined && <> Kosten ca. {formatCost(checkEstimate)}.</>}
                    </p>
                    <button
                      className="button small"
                      onClick={check}
                      disabled={checking || !summary.trim()}
                      aria-busy={checking}
                      title="Ein zweites Modell prüft, ob in der Zusammenfassung etwas Wichtiges fehlt"
                    >
                      <Icon name="search" size={15} />
                      {checking ? "Prüft …" : "Auf Lücken prüfen"}
                    </button>
                  </div>
                ) : complete_ ? (
                  <p className="gap-ok">
                    <Icon name="check" size={16} />
                    Keine wesentlichen Lücken gefunden.
                  </p>
                ) : (
                  <>
                    <h3>Gefundene Lücken</h3>
                    <Markdown text={gaps} />
                    <div className="gap-actions">
                      <button className="button small" onClick={applyGaps} title="Die gefundenen Punkte in die Zusammenfassung aufnehmen">
                        Ergänzungen übernehmen
                      </button>
                      <button className="link-button" onClick={() => setGaps(null)} title="Die Zusammenfassung so lassen, wie sie ist">
                        Verwerfen
                      </button>
                    </div>
                  </>
                )}
              </section>
            )}

            <footer className="dialog-foot">
              {stage === "writing" ? (
                <button className="button" onClick={() => abort.current?.abort()} title="Das Schreiben abbrechen">
                  Stoppen
                </button>
              ) : (
                <>
                  <button className="button" onClick={write} disabled={checking} title="Die Zusammenfassung noch einmal schreiben lassen">
                    <Icon name="refresh" size={15} />
                    Neu erzeugen
                  </button>
                  <button
                    className="button"
                    onClick={() => navigator.clipboard.writeText(summary.trim()).then(() => setCopied(true))}
                    disabled={busy || !summary.trim()}
                    title="Zusammenfassung in die Zwischenablage, z. B. für ein anderes Programm"
                  >
                    <Icon name={copied ? "check" : "copy"} size={15} />
                    {copied ? "Kopiert" : "Kopieren"}
                  </button>
                  <button
                    className="button primary"
                    onClick={() => onStart(summary.trim())}
                    disabled={busy || !summary.trim()}
                    title="Mit dieser Zusammenfassung einen neuen Chat beginnen; der alte bleibt erhalten"
                  >
                    Neuen Chat starten
                  </button>
                </>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
