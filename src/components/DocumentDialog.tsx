import { useEffect, useState } from "react";
import {
  OCR_PER_PAGE,
  ocrAttachment,
  pdfPages,
  sendMode,
  summarizeAttachment,
  summaryEstimate,
} from "../lib/documents";
import { blobText, type Attachment, type DocText } from "../lib/files";
import { formatCost, formatTokens } from "../lib/format";
import { shortName, type Model } from "../lib/openrouter";
import { Icon } from "./Icon";

interface Props {
  attachment: Attachment;
  models: Model[] | null;
  apiKey: string;
  bestFree: string;
  /** Model of the chat; fallback for summarizing. */
  chatModel: string;
  /** Set when the attachment already went out with a message. */
  sent: boolean;
  onChange: (a: Attachment) => void;
  onClose: () => void;
}

const BY: Record<DocText["by"], string> = {
  browser: "direkt im Browser umgewandelt",
  "cloudflare-ai": "von OpenRouter umgewandelt (kostenlos)",
  "mistral-ocr": "per Texterkennung gelesen",
  summary: "zusammengefasst",
};

const cents = (usd: number) =>
  usd < 0.01 ? `${(usd * 100).toFixed(usd < 0.001 ? 3 : 2).replace(".", ",")} Cent` : formatCost(usd);

/** See what a document turned into and choose what the model gets. */
export function DocumentDialog({ attachment: a, models, apiKey, bestFree, chatModel, sent, onChange, onClose }: Props) {
  const mode = sendMode(a);
  const [view, setView] = useState<"text" | "summary">(mode === "summary" ? "summary" : "text");
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState<"summary" | "ocr" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<number | undefined>();

  const shown = view === "summary" ? a.summary : a.text;
  useEffect(() => {
    setContent(null);
    if (shown) blobText(shown.id).then(setContent, (e: Error) => setContent(`(${e.message})`));
  }, [shown]);
  useEffect(() => {
    if (a.kind === "pdf") void pdfPages(a).then(setPages);
  }, [a]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const estimate = models && a.text ? summaryEstimate(models, a.text.tokens, chatModel) : null;

  async function run(kind: "summary" | "ocr") {
    if (!models) return;
    setBusy(kind);
    setError(null);
    try {
      const next =
        kind === "summary"
          ? await summarizeAttachment(a, { apiKey, models, fallback: chatModel })
          : await ocrAttachment(a, { apiKey, models, bestFree });
      onChange(next);
      setView(kind === "summary" ? "summary" : "text");
    } catch (e) {
      setError(e instanceof TypeError ? "OpenRouter ist nicht erreichbar." : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const choose = (send: Attachment["send"]) => onChange({ ...a, send });

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog wide doc-dialog" role="dialog" aria-modal="true" aria-labelledby="doc-title">
        <header className="dialog-head">
          <h2 id="doc-title">{a.name}</h2>
          <button className="ghost icon-only" onClick={onClose} aria-label="Schließen" disabled={!!busy}>
            <Icon name="close" />
          </button>
        </header>

        {a.status === "failed" && a.error && (
          <p className="composer-note error" role="alert">
            Umwandlung nicht möglich: {a.error}
            {a.kind === "pdf" && " Das Modell bekommt deshalb das Original-PDF."}
          </p>
        )}

        {a.scanned && a.kind === "pdf" && apiKey && (
          <div className="doc-scan" role="status">
            <p>
              <strong>Dieses PDF enthält kaum lesbaren Text, vermutlich ist es eingescannt.</strong> Die Texterkennung
              liest es einmal vollständig, danach arbeitet das Modell mit dem Text.
              {pages ? ` ${pages === 1 ? "1 Seite" : `${pages} Seiten`}, ca. ${cents(pages * OCR_PER_PAGE)}.` : ` Ca. ${cents(OCR_PER_PAGE)} pro Seite.`}
            </p>
            <button
              className="button small"
              onClick={() => void run("ocr")}
              disabled={!!busy}
              aria-busy={busy === "ocr"}
              title="Den Text aus dem gescannten Dokument per Texterkennung herauslesen lassen; kostet ein paar Cent"
            >
              <Icon name="search" size={15} />
              {busy === "ocr" ? "Liest …" : "Mit Texterkennung lesen"}
            </button>
          </div>
        )}

        <fieldset className="field radio-group doc-modes">
          <legend>Was bekommt das Modell?</legend>
          <label className={`check${!a.text ? " disabled" : ""}`}>
            <input type="radio" name="doc-send" checked={mode === "text"} disabled={!a.text} onChange={() => choose("text")} />
            <span>
              Vollständiger Text{a.text && <>, ≈ {formatTokens(a.text.tokens)} Tokens</>}
              <span className="hint">Empfohlen. Inhalt Wort für Wort, nur Layout und Bilder fehlen.</span>
            </span>
          </label>
          <label className={`check${!a.summary ? " disabled" : ""}`}>
            <input type="radio" name="doc-send" checked={mode === "summary"} disabled={!a.summary} onChange={() => choose("summary")} />
            <span>
              Zusammenfassung{a.summary && <>, ≈ {formatTokens(a.summary.tokens)} Tokens</>}
              <span className="hint">
                Spart Tokens bei langen Dokumenten. Details, die nicht darin stehen, kennt das Modell dann nicht.
              </span>
            </span>
          </label>
          {!a.summary && a.text && !a.scanned && (
            <div className="doc-summary-make">
              <button
                className="button small"
                onClick={() => void run("summary")}
                disabled={!!busy || !models}
                aria-busy={busy === "summary"}
                title="Eine Kurzfassung erstellen; das Modell bekommt dann die statt des ganzen Textes, das spart Kosten"
              >
                <Icon name="summary" size={15} />
                {busy === "summary" ? "Fasst zusammen …" : "Zusammenfassung erstellen"}
              </button>
              {estimate?.model && (
                <span className="hint">
                  mit {shortName(estimate.model)}
                  {estimate.cost !== undefined && `, ca. ${cents(estimate.cost)}`}
                </span>
              )}
            </div>
          )}
          {a.kind === "pdf" && (
            <label className="check">
              <input type="radio" name="doc-send" checked={mode === "original"} onChange={() => choose("original")} />
              <span>
                Original-PDF
                <span className="hint">
                  Für Diagramme, Formulare und Layout. Kostet bei jeder Nachricht deutlich mehr Tokens, und Modelle ohne
                  eigene PDF-Unterstützung lassen es jedes Mal neu lesen.
                </span>
              </span>
            </label>
          )}
          {sent && <p className="hint">Die Auswahl gilt ab der nächsten Nachricht in diesem Chat.</p>}
        </fieldset>

        {error && (
          <div className="msg-error" role="alert">
            {error}
          </div>
        )}

        {(a.text || a.summary) && (
          <section className="doc-preview">
            <div className="field-row">
              <div className="chips" role="tablist">
                {a.text && (
                  <button className="chip" role="tab" aria-pressed={view === "text"} onClick={() => setView("text")} title="Den vollständigen Text des Dokuments zeigen">
                    Text
                  </button>
                )}
                {a.summary && (
                  <button className="chip" role="tab" aria-pressed={view === "summary"} onClick={() => setView("summary")} title="Die Kurzfassung zeigen">
                    Zusammenfassung
                  </button>
                )}
              </div>
              {shown && (
                <span className="field-value">
                  {BY[shown.by]}
                  {shown.cost ? `, ${formatCost(shown.cost)}` : ""}
                </span>
              )}
            </div>
            <pre className="doc-text">{content ?? "Lädt …"}</pre>
          </section>
        )}

        <footer className="dialog-foot">
          <button className="button primary" onClick={onClose} disabled={!!busy} title="Fenster schließen">
            Fertig
          </button>
        </footer>
      </div>
    </div>
  );
}
