import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Attachment } from "../lib/files";
import { formatCost } from "../lib/format";
import type { VideoModel } from "../lib/openrouter";
import { DEFAULT_ASPECTS, canMakeSound, type VideoOptions } from "./VideoDialog";
import { AttachmentChip } from "./Attachments";
import { DictateButton } from "./DictateButton";
import { Icon } from "./Icon";

export interface ComposerHandle {
  focus: () => void;
}

export const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];

interface Props {
  /** First item in the tool row, e.g. the level menu. */
  leading?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  /** Why sending is blocked right now, if it is (shown instead of sending). */
  blocked: boolean;
  placeholder: string;
  attachments: Attachment[];
  attaching: boolean;
  onFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  /** Documents: show the converted text and what the model gets. */
  onOpenAttachment: (id: string) => void;
  webSearch: boolean;
  onToggleWebSearch: () => void;
  /** Thinking effort; shown only when a model in the chat can think. */
  reasoning?: "low" | "high";
  onReasoning?: (v: "low" | "high" | undefined) => void;
  /** Charts and sketches in answers; hidden where it makes no sense (video). */
  visualize?: boolean;
  onToggleVisualize?: () => void;
  /** Set when the model generates images: the chosen aspect ratio. */
  aspectRatio: string | null;
  onAspectRatio: (r: string) => void;
  /** Only for video models: the full video dialog (photos as start or end frame, cheap draft). */
  onVideo?: () => void;
  /** Only for video models: duration, resolution, format, sound and the expected price, right in the bar. */
  video?: { model: VideoModel; options: VideoOptions; onChange: (o: VideoOptions) => void; cost: number | null };
  /** Web search makes no sense for video models. */
  showWebSearch: boolean;
  /** Image models only: rewrite the draft into a stronger image prompt. */
  onEnhance?: () => void;
  enhancing: boolean;
  /** Empty text chats: prepare the task on the workbench first. */
  onPrepare?: () => void;
  apiKey: string;
  /** Spoken text, ready to go into the draft. */
  onDictated: (text: string) => void;
  onError: (message: string) => void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(props, ref) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }));

  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [props.value]);

  const hasContent = props.value.trim().length > 0 || props.attachments.length > 0;
  const canSend = !props.disabled && !props.blocked && !props.attaching && hasContent;

  function submit() {
    if (canSend && !props.streaming) props.onSend();
  }

  // While typing, a slow light runs along the capsule's edge; it fades out a moment after the last key.
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef(0);
  useEffect(() => () => clearTimeout(typingTimer.current), []);
  function noteTyping() {
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(false), 1500);
  }

  return (
    <form
      className={`composer${typing ? " typing" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {(props.attachments.length > 0 || props.attaching) && (
        <div className="composer-files">
          {props.attachments.map((a) => (
            <AttachmentChip
              key={a.id}
              attachment={a}
              onRemove={() => props.onRemoveAttachment(a.id)}
              onOpen={() => props.onOpenAttachment(a.id)}
            />
          ))}
          {props.attaching && !props.attachments.some((a) => a.status === "converting") && (
            <span className="file-loading">Wird vorbereitet …</span>
          )}
        </div>
      )}

      <textarea
        ref={textarea}
        rows={1}
        value={props.value}
        placeholder={props.placeholder}
        aria-label="Nachricht"
        disabled={props.disabled}
        readOnly={props.enhancing}
        onChange={(e) => {
          props.onChange(e.target.value);
          noteTyping();
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) {
            e.preventDefault();
            props.onFiles(files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />

      <div className="composer-bar">
        <div className="composer-tools">
          {props.leading}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,.docx,.xlsx,.xlsm,.pptx,.csv,.tsv,.txt,.md,.json,.xml,.html,.doc,.xls,.ppt"
            multiple
            hidden
            onChange={(e) => {
              props.onFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="tool"
            onClick={() => fileInput.current?.click()}
            disabled={props.disabled}
            title="Bild, Screenshot, PDF, Word, Excel, PowerPoint oder Textdatei anhängen. Dokumente werden in Text umgewandelt, das spart Tokens."
          >
            <Icon name="paperclip" size={17} />
            <span className="tool-label">Anhang</span>
          </button>
          {props.showWebSearch && (
          <button
            type="button"
            className="tool"
            aria-pressed={props.webSearch}
            onClick={props.onToggleWebSearch}
            disabled={props.disabled}
            title={props.webSearch ? "Websuche ist an. Klicken zum Ausschalten." : "Das Modell darf im Internet suchen."}
          >
            <Icon name="globe" size={17} />
            <span className="tool-label">Websuche</span>
          </button>
          )}
          {props.onToggleVisualize && (
            <button
              type="button"
              className="tool"
              aria-pressed={!!props.visualize}
              onClick={props.onToggleVisualize}
              disabled={props.disabled}
              title={
                props.visualize
                  ? "Visualisieren ist an: Das Modell zeichnet Diagramme und Skizzen, wo sie helfen. Klicken zum Ausschalten."
                  : "Das Modell darf Antworten mit Diagrammen und Skizzen veranschaulichen."
              }
            >
              <Icon name="chart" size={17} />
              <span className="tool-label">Visualisieren</span>
            </button>
          )}
          {props.onEnhance && (
            <button
              type="button"
              className="tool"
              onClick={props.onEnhance}
              disabled={props.disabled || props.enhancing || !props.value.trim()}
              aria-busy={!!props.enhancing}
              title="Ergänzt Motiv, Bildaufbau, Licht und Stil, damit das Bildmodell dich besser versteht"
            >
              <Icon name="sparkle" size={17} />
              <span className="tool-label">{props.enhancing ? "Wird verbessert …" : "Verbessern"}</span>
            </button>
          )}
          {props.onPrepare && (
            <button
              type="button"
              className="tool"
              onClick={props.onPrepare}
              disabled={props.disabled}
              title="Aus einer groben Idee eine klare Aufgabe machen, mit passender Rolle, Vorgehen und Modellempfehlung"
            >
              <Icon name="sparkle" size={17} />
              <span className="tool-label">Vorbereiten</span>
            </button>
          )}
          {props.onReasoning && (
            <label
              className="tool tool-select"
              title="Wie gründlich das Modell nachdenkt. Kurz ist schneller und günstiger, gründlich besser bei schwierigen Aufgaben."
            >
              <Icon name="think" size={17} />
              <span className="visually-hidden">Nachdenken</span>
              <select
                value={props.reasoning ?? ""}
                onChange={(e) => props.onReasoning!((e.target.value || undefined) as "low" | "high" | undefined)}
              >
                <option value="">Nachdenken: normal</option>
                <option value="low">Nachdenken: kurz</option>
                <option value="high">Nachdenken: gründlich</option>
              </select>
            </label>
          )}
          {props.aspectRatio && (
            <label className="tool tool-select" title="Format des erzeugten Bildes">
              <Icon name="image" size={17} />
              <span className="visually-hidden">Bildformat</span>
              <select value={props.aspectRatio} onChange={(e) => props.onAspectRatio(e.target.value)}>
                {ASPECT_RATIOS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}
          {props.video && <VideoTools {...props.video} disabled={props.disabled} />}
          {props.onVideo && (
            <button
              type="button"
              className="tool"
              onClick={props.onVideo}
              disabled={props.disabled}
              title="Fotos als Start- oder Endbild, günstiger Entwurf, Beschreibung verbessern"
            >
              <Icon name="film" size={17} />
              <span className="tool-label">Mehr Optionen</span>
            </button>
          )}
        </div>

        <div className="composer-send">
          {!props.streaming && (
            <DictateButton
              apiKey={props.apiKey}
              disabled={props.disabled}
              onText={props.onDictated}
              onError={props.onError}
            />
          )}
          {props.streaming ? (
            <button type="button" className="send stop" onClick={props.onStop} aria-label="Antwort stoppen" title="Antwort abbrechen">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button type="submit" className="send" disabled={!canSend} aria-label="Senden" title="Nachricht senden (Enter)">
              <Icon name="send" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
});

/** What the chosen video model can do, as small selects; anything the model cannot do is left out. */
function VideoTools(props: {
  model: VideoModel;
  options: VideoOptions;
  onChange: (o: VideoOptions) => void;
  cost: number | null;
  disabled: boolean;
}) {
  const { model: m, options: o } = props;
  const set = (patch: Partial<VideoOptions>) => props.onChange({ ...o, ...patch });
  const durations = m.supported_durations ?? [];
  const resolutions = m.supported_resolutions ?? [];
  const aspects = m.supported_aspect_ratios ?? DEFAULT_ASPECTS;
  return (
    <>
      {durations.length > 1 && (
        <label className="tool tool-select" title="Wie lang das Video wird. Längere Videos kosten mehr.">
          <span className="visually-hidden">Dauer</span>
          <select value={o.duration ?? ""} onChange={(e) => set({ duration: Number(e.target.value) })} disabled={props.disabled}>
            {durations.map((d) => (
              <option key={d} value={d}>
                {d} Sek.
              </option>
            ))}
          </select>
        </label>
      )}
      {resolutions.length > 1 && (
        <label className="tool tool-select" title="Bildschärfe. Höhere Auflösung kostet meist mehr.">
          <span className="visually-hidden">Auflösung</span>
          <select value={o.resolution ?? ""} onChange={(e) => set({ resolution: e.target.value })} disabled={props.disabled}>
            {resolutions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      )}
      {aspects.length > 1 && (
        <label className="tool tool-select" title="Seitenverhältnis: 16:9 quer wie Fernsehen, 9:16 hochkant wie am Handy, 1:1 quadratisch">
          <span className="visually-hidden">Format</span>
          <select value={o.aspectRatio} onChange={(e) => set({ aspectRatio: e.target.value })} disabled={props.disabled}>
            {aspects.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      )}
      {canMakeSound(m) && (
        <button
          type="button"
          className="tool"
          aria-pressed={o.audio}
          onClick={() => set({ audio: !o.audio })}
          disabled={props.disabled}
          title={o.audio ? "Mit Ton: Geräusche, Musik, Sprache. Klicken für ein Video ohne Ton (oft günstiger)." : "Ohne Ton. Klicken für ein Video mit Ton."}
        >
          <Icon name="speaker" size={17} />
          <span className="tool-label">{o.audio ? "Mit Ton" : "Ohne Ton"}</span>
        </button>
      )}
      <span className="video-cost" title="Geschätzte Kosten dieses Videos bei OpenRouter">
        {props.cost !== null ? `≈ ${formatCost(props.cost)}` : "Preis nach Länge des Ergebnisses"}
      </span>
    </>
  );
}
