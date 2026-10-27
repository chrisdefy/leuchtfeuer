import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatCost, formatTokens } from "../lib/format";
import type { FusionAnswer, Message } from "../lib/storage";
import { toggleSpeaking, useSpeechState, type VoiceMode } from "../lib/speech";
import { AttachmentChip, AudioPlayer, GeneratedImage, SourceList, VideoPlayer } from "./Attachments";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { shortLink } from "../lib/links";
import { plainWords } from "../lib/textwork";

interface Props {
  message: Message;
  modelName: (id: string) => string;
  streaming: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onEdit?: () => void;
  /** Comparison only: continue the chat with this answer's model. */
  onChoose?: () => void;
  /** Comparison only: e.g. "am schnellsten", "am günstigsten". */
  highlights?: string[];
  /** How to read answers aloud. */
  voice?: { mode: VoiceMode; apiKey: string; naturalVoice?: string; browserVoice?: string; onError: (message: string) => void };
  /** Documents on a user message: show the converted text and what the model gets. */
  onOpenAttachment?: (id: string) => void;
  /** Start a new chat that continues from this answer. */
  onFork?: () => void;
  /** Summarize the chat up to this answer and copy it. */
  onSummarize?: () => void;
  /** Rewrite only the marked passage; resolves with the new passage. */
  onEditPassage?: (marked: string, instruction: string) => Promise<string>;
  /** Undo the last passage edit. */
  onUndoEdit?: () => void;
  /** Simple view: no costs, and "Neu erzeugen" as a button instead of the "Mehr" menu. */
  simple?: boolean;
}

export function MessageView(props: Props) {
  const { message: m, modelName, streaming, canRegenerate, onRegenerate, onEdit, onChoose, highlights } = props;
  const [copied, setCopied] = useState(false);
  const speech = useSpeechState(m.id);

  async function copy() {
    await navigator.clipboard.writeText(m.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (m.role === "user") {
    return (
      <article className="msg user">
        {m.attachments && m.attachments.length > 0 && (
          <div className="user-files">
            {m.attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} onOpen={props.onOpenAttachment && (() => props.onOpenAttachment!(a.id))} />
            ))}
          </div>
        )}
        {m.content && <div className="user-text">{m.content}</div>}
        {onEdit && (
          <div className="msg-actions">
            <button className="ghost small" onClick={onEdit} title="Nachricht zurück ins Eingabefeld holen, ändern und neu senden">
              <Icon name="edit" size={14} />
              Bearbeiten
            </button>
          </div>
        )}
      </article>
    );
  }

  const waiting = streaming && !m.content && !m.reasoning;
  const images = (m.attachments ?? []).filter((a) => a.kind === "image");
  const videos = (m.attachments ?? []).filter((a) => a.kind === "video");
  const videoRunning = m.video && (m.video.status === "pending" || m.video.status === "in_progress");

  return (
    <article className="msg assistant" aria-busy={streaming}>
      <header className="byline">
        {m.fusion ? (
          <span className="by-model" title={m.model ? `Zusammengeführt von ${modelName(m.model)}` : undefined}>
            <span className="tier-dot best" aria-hidden="true" />
            Beste Antwort
          </span>
        ) : (
          <span className="by-model">{m.modelLabel ?? (m.model ? modelName(m.model) : "Modell")}</span>
        )}
        {m.usage && !props.simple && (
          <span
            className="by-usage"
            title={m.video ? undefined : `${formatTokens(m.usage.promptTokens)} Tokens gelesen, ${formatTokens(m.usage.completionTokens)} geschrieben`}
          >
            {m.usage.cost !== undefined && <span className="by-cost">{formatCost(m.usage.cost)}</span>}
            {m.durationMs !== undefined && (
              <span title="Dauer bis zur fertigen Antwort">{formatSeconds(m.durationMs)}</span>
            )}
          </span>
        )}
        {highlights?.map((h) => (
          <span key={h} className="badge">
            {h}
          </span>
        ))}
      </header>

      {m.reasoning && (
        <details className="reasoning" open={streaming && !m.content}>
          <summary title="Aufklappen: wie das Modell über die Antwort nachgedacht hat">{streaming && !m.content ? "Denkt nach …" : "Gedankengang"}</summary>
          <div className="reasoning-text">{m.reasoning}</div>
        </details>
      )}

      {waiting && m.fusion && <FusionProgress answers={m.fusion.answers} modelName={modelName} />}
      {waiting && !m.fusion && (
        <div className="pending" role="status">
          <span className="visually-hidden">Antwort wird erzeugt</span>
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      )}

      {m.content &&
        (props.onEditPassage && !streaming ? (
          <PassageEditor onEdit={props.onEditPassage}>
            <Markdown text={m.content} />
          </PassageEditor>
        ) : (
          <Markdown text={m.content} live={streaming} />
        ))}
      {streaming && m.content && <span className="caret" aria-hidden="true" />}

      {images.length > 0 && (
        <div className="generated-images">
          {images.map((a) => (
            <GeneratedImage key={a.id} attachment={a} />
          ))}
        </div>
      )}
      {videoRunning && <VideoProgress startedAt={m.video!.startedAt} status={m.video!.status} />}
      {videos.map((a) => (
        <VideoPlayer key={a.id} attachment={a} />
      ))}
      {(m.attachments ?? [])
        .filter((a) => a.kind === "audio")
        .map((a) => (
          <AudioPlayer key={a.id} attachment={a} />
        ))}
      {m.fusion && !streaming && <FusionAnswers answers={m.fusion.answers} merger={m.model} modelName={modelName} />}
      {m.sources && m.sources.length > 0 && !streaming && <SourceList sources={m.sources} />}
      {m.links && !streaming && <LinkNote links={m.links} />}
      {m.notice && !streaming && (
        <p className="link-note warn">
          <Icon name={/Web|Internet/.test(m.notice) ? "globe" : "refresh"} size={14} />
          <span>{m.notice}</span>
        </p>
      )}

      {m.error && (
        <div className="msg-error" role="alert">
          {m.error}
        </div>
      )}

      {!streaming && !videoRunning && (m.content || m.error || images.length > 0) && (
        <div className="msg-actions">
          {m.content && (
            <button className="ghost small" onClick={copy} title="Antwort in die Zwischenablage kopieren">
              <Icon name={copied ? "check" : "copy"} size={14} />
              {copied ? "Kopiert" : "Kopieren"}
            </button>
          )}
          {m.content && props.voice && (
            <button
              className={`ghost small${speech ? " speaking" : ""}`}
              onClick={() =>
                toggleSpeaking(m.id, m.content, { ...props.voice!, label: m.modelLabel ?? (m.model ? modelName(m.model) : "Antwort") }).catch(
                  (e) => props.voice!.onError((e as Error).message),
                )
              }
              aria-pressed={!!speech}
              title={speech === "waiting" ? "Die Stimme ist bereit: tippen zum Abspielen" : speech ? "Vorlesen beenden" : "Antwort laut vorlesen lassen"}
            >
              <Icon name={speech === "waiting" ? "play" : speech && speech !== "loading" ? "stop" : "speaker"} size={14} />
              {speech === "loading" ? "Lädt …" : speech === "waiting" ? "Abspielen" : speech ? "Stopp" : "Vorlesen"}
            </button>
          )}
          {props.simple && canRegenerate && !m.video && (
            <button className="ghost small" onClick={onRegenerate} title="Diese Antwort neu schreiben lassen">
              <Icon name="refresh" size={14} />
              Neu erzeugen
            </button>
          )}
          {!props.simple && (props.onSummarize || props.onFork || (canRegenerate && !m.video)) && (
            <MoreMenu>
              {props.onSummarize && (
                <button
                  role="menuitem"
                  onClick={props.onSummarize}
                  title="Verlauf bis hierher zusammenfassen: in einem neuen Chat weitermachen oder kopieren"
                >
                  <Icon name="summary" size={16} />
                  Bis hier zusammenfassen
                </button>
              )}
              {props.onFork && (
                <button role="menuitem" onClick={props.onFork} title="Neuen Chat mit dem Verlauf bis hierher starten. Dieser Chat bleibt unverändert.">
                  <Icon name="fork" size={16} />
                  Ab hier neuer Chat
                </button>
              )}
              {canRegenerate && !m.video && (
                <button role="menuitem" onClick={onRegenerate} title="Diese Antwort mit dem aktuellen Modell neu schreiben lassen">
                  <Icon name="refresh" size={16} />
                  Neu erzeugen
                </button>
              )}
            </MoreMenu>
          )}
          {props.onUndoEdit && (
            <button className="ghost small" onClick={props.onUndoEdit} title="Die letzte Änderung an einer Stelle zurücknehmen">
              <Icon name="undo" size={14} />
              Änderung zurück
            </button>
          )}
          {onChoose && (
            <button className="ghost small choose" onClick={onChoose} title="Vergleich beenden und mit diesem Modell normal weiterchatten">
              <Icon name="check" size={14} />
              Hiermit weiter
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Mark a passage in an answer → "Stelle ändern" → say what should change. Only that passage is rewritten;
 * the new text is highlighted for a moment so it is clear what changed.
 */
function PassageEditor({ children, onEdit }: { children: ReactNode; onEdit: (marked: string, instruction: string) => Promise<string> }) {
  const box = useRef<HTMLDivElement>(null);
  const [marked, setMarked] = useState<{ text: string; x: number; y: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clicks on the button or the question field must not re-read (and lose) the selection.
  const isControl = (t: EventTarget) => t instanceof Element && !!t.closest(".passage-trigger, .passage-ask");

  function readSelection() {
    if (asking) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!sel || sel.isCollapsed || text.length < 2 || !box.current?.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      setMarked(null);
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const b = box.current.getBoundingClientRect();
    // Below the marked text: above it, the button could slide under the top bar.
    setMarked({ text, x: Math.min(Math.max(r.left - b.left + r.width / 2, 80), b.width - 80), y: r.bottom - b.top });
  }

  function close() {
    setMarked(null);
    setAsking(false);
    setInstruction("");
    setError(null);
  }

  async function submit() {
    if (!marked || !instruction.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await onEdit(marked.text, instruction.trim());
      close();
      window.getSelection()?.removeAllRanges();
      // Wait for the new text to render, then mark it briefly.
      requestAnimationFrame(() => box.current && flashPassage(box.current, next));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="passage"
      ref={box}
      onMouseUp={(e) => !isControl(e.target) && setTimeout(readSelection)}
      onTouchEnd={(e) => !isControl(e.target) && setTimeout(readSelection, 300)}
    >
      {children}
      {marked && !asking && (
        <button
          className="passage-trigger"
          title="Nur die markierte Stelle neu schreiben lassen"
          style={{ left: marked.x, top: marked.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setAsking(true)}
        >
          <Icon name="edit" size={14} />
          Stelle ändern
        </button>
      )}
      {marked && asking && (
        <div className="passage-ask" style={{ left: marked.x, top: marked.y }} role="dialog" aria-label="Stelle ändern">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              autoFocus
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && close()}
              placeholder="Was soll anders werden? z. B. freundlicher, kürzer"
              aria-label="Was soll an der markierten Stelle anders werden?"
              disabled={busy}
            />
            <button className="button primary small" type="submit" disabled={busy || !instruction.trim()} aria-busy={busy} title="Die markierte Stelle so neu schreiben lassen">
              {busy ? "Wird geändert …" : "Ändern"}
            </button>
            <button type="button" className="ghost icon-only" onClick={close} aria-label="Abbrechen">
              <Icon name="close" size={14} />
            </button>
          </form>
          {error && <p className="passage-error">{error}</p>}
          {!error && <p className="passage-hint">Nur diese Stelle wird neu geschrieben, der Rest bleibt, wie er ist.</p>}
        </div>
      )}
    </div>
  );
}

/** Highlights the rewritten passage for a few seconds (CSS Custom Highlight API; skipped where unsupported). */
function flashPassage(root: HTMLElement, passage: string) {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  const words = plainWords(passage);
  if (!registry || !HighlightCtor || !words.length) return;
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const full = nodes.map((n) => n.data).join("");
  const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(words.map(escape).join("[^\\p{L}\\p{N}]{1,40}"), "u").exec(full);
  if (!m) return;
  const at = (offset: number): [Text, number] => {
    for (const n of nodes) {
      if (offset <= n.data.length) return [n, offset];
      offset -= n.data.length;
    }
    const last = nodes[nodes.length - 1];
    return [last, last.data.length];
  };
  const range = document.createRange();
  range.setStart(...at(m.index));
  range.setEnd(...at(m.index + m[0].length));
  registry.set("passage-edited", new HighlightCtor(range));
  setTimeout(() => registry.delete("passage-edited"), 4000);
}

/** Whether the links in the question were opened: only claims "gelesen" when OpenRouter reports a fetch. */
function LinkNote({ links }: { links: NonNullable<Message["links"]> }) {
  const label = links.unsupported
    ? "Dieses Modell kann keine Links öffnen, die Antwort beruht nicht auf der Seite:"
    : links.opened === undefined
      ? "Zum Öffnen freigegeben:"
      : links.opened > 0
        ? "Gelesen:"
        : "Nicht geöffnet:";
  return (
    <p className={`link-note${links.unsupported || links.opened === 0 ? " warn" : ""}`}>
      <Icon name={links.unsupported || links.opened === 0 ? "globe" : "check"} size={14} />
      <span>
        {label}{" "}
        {links.urls.map((u, i) => (
          <span key={u}>
            {i > 0 && ", "}
            <a href={u} target="_blank" rel="noreferrer">
              {shortLink(u)}
            </a>
          </span>
        ))}
      </span>
    </p>
  );
}

/** "Beste Antwort" on its way: which models are done, then the merge. */
function FusionProgress({ answers, modelName }: { answers: FusionAnswer[]; modelName: (id: string) => string }) {
  const done = answers.filter((a) => a.done).length;
  return (
    <div className="fusion-progress" role="status">
      <p>
        <span className="spinner" aria-hidden="true" />
        {done < answers.length
          ? `${answers.length} Modelle antworten, ${done} von ${answers.length} fertig …`
          : "Die Antworten werden zur besten zusammengeführt …"}
      </p>
      <ul>
        {answers.map((a) => (
          <li key={a.model} className={a.error ? "failed" : a.done ? "done" : undefined}>
            <Icon name={a.error ? "close" : a.done ? "check" : "more"} size={13} />
            {modelName(a.model)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The answers a "Beste Antwort" was merged from, folded away. */
function FusionAnswers(props: { answers: FusionAnswer[]; merger?: string; modelName: (id: string) => string }) {
  const used = props.answers.filter((a) => a.content.trim()).length;
  return (
    <details className="fusion">
      <summary title="Aufklappen: die einzelnen Antworten, aus denen diese zusammengeführt wurde">
        Aus {used} Antworten zusammengeführt{props.merger ? ` von ${props.modelName(props.merger)}` : ""}
      </summary>
      <div className="fusion-list">
        {props.answers.map((a) => (
          <details key={a.model} className="fusion-answer">
            <summary title="Aufklappen: die Antwort dieses Modells">
              <span className="fusion-model">{props.modelName(a.model)}</span>
              {a.cost !== undefined && <span className="by-cost">{formatCost(a.cost)}</span>}
              {a.error && <span className="fusion-error">nicht geantwortet</span>}
            </summary>
            {a.error && <p className="msg-error">{a.error}</p>}
            {a.content && <Markdown text={a.content} />}
          </details>
        ))}
      </div>
      <p className="hint">Die Kosten oben enthalten alle Antworten und das Zusammenführen.</p>
    </details>
  );
}

/** Rarely used answer actions behind one button, so each answer shows only what people need most. */
function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="more" ref={box}>
      <button
        className="ghost small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Weitere Aktionen für diese Antwort"
      >
        <Icon name="more" size={14} />
        Mehr
      </button>
      {open && (
        <div className="more-menu" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

function VideoProgress({ startedAt, status }: { startedAt: number; status: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - startedAt) / 1000));
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div className="video-progress" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>
        {status === "pending" ? "Video ist in der Warteschlange" : "Video wird erstellt"}, {elapsed} min.
        <span className="hint"> Das dauert meist einige Minuten. Du kannst weiterchatten.</span>
      </span>
    </div>
  );
}
