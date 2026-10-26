import { attachmentTokens, sendMode } from "../lib/documents";
import { formatBytes, useAttachmentUrl, type Attachment } from "../lib/files";
import { formatTokens } from "../lib/format";
import type { Source } from "../lib/openrouter";
import { Icon } from "./Icon";

/** Small preview in the composer and on user messages. Documents open their text on click. */
export function AttachmentChip({
  attachment: a,
  onRemove,
  onOpen,
}: {
  attachment: Attachment;
  onRemove?: () => void;
  onOpen?: () => void;
}) {
  const { url, missing } = useAttachmentUrl(a.id);
  const isDoc = a.kind === "pdf" || a.kind === "doc";
  const meta = missing ? "nicht mehr gespeichert" : isDoc ? docMeta(a) : formatBytes(a.size);
  const body = (
    <>
      <span className="file-icon">
        <Icon name={isDoc ? "file" : a.kind === "video" ? "film" : "image"} size={18} />
      </span>
      <span className="file-meta">
        <span className="file-name">{a.name}</span>
        <span className={`file-size${a.status === "failed" ? " failed" : ""}`}>{meta}</span>
      </span>
    </>
  );
  return (
    <span className={`file-chip ${a.kind}${a.status === "converting" ? " converting" : ""}`} title={`${a.name}, ${formatBytes(a.size)}`}>
      {a.kind === "image" && url ? (
        <a href={url} target="_blank" rel="noreferrer" className="file-thumb">
          <img src={url} alt={a.name} />
        </a>
      ) : isDoc && onOpen && a.status !== "converting" ? (
        <button type="button" className="file-open" onClick={onOpen} title="Umgewandelten Text ansehen und wählen, was das Modell bekommt">
          {body}
        </button>
      ) : a.kind !== "image" ? (
        body
      ) : (
        <span className="file-icon">
          <Icon name="image" size={18} />
        </span>
      )}
      {onRemove && (
        <button type="button" className="file-remove" onClick={onRemove} aria-label={`${a.name} entfernen`}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}

function docMeta(a: Attachment) {
  if (a.status === "converting") return "Wird in Text umgewandelt …";
  const mode = sendMode(a);
  const tokens = attachmentTokens(a);
  const size = tokens !== undefined ? `≈ ${formatTokens(tokens)} Tokens` : "";
  if (mode === "summary") return `Zusammenfassung, ${size}`;
  if (mode === "original") return a.status === "failed" ? "als PDF (Umwandlung fehlgeschlagen)" : a.scanned ? "als PDF (eingescannt)" : "als Original-PDF";
  if (a.status === "failed") return "nicht lesbar";
  return `als Text, ${size}`;
}

/** A generated image, shown large with a download link. */
export function GeneratedImage({ attachment: a }: { attachment: Attachment }) {
  const { url, missing } = useAttachmentUrl(a.id);
  if (missing) return <p className="hint">Dieses Bild ist im Browser-Speicher nicht mehr vorhanden.</p>;
  if (!url) return <div className="generated-image placeholder" />;
  return (
    <figure className="generated-image">
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={a.name} />
      </a>
      <figcaption>
        <a className="ghost small" href={url} download={a.name}>
          <Icon name="download" size={14} />
          Herunterladen
        </a>
      </figcaption>
    </figure>
  );
}

export function VideoPlayer({ attachment: a }: { attachment: Attachment }) {
  const { url, missing } = useAttachmentUrl(a.id);
  if (missing) return <p className="hint">Dieses Video ist im Browser-Speicher nicht mehr vorhanden.</p>;
  if (!url) return <div className="generated-video placeholder" />;
  return (
    <figure className="generated-video">
      <video src={url} controls playsInline preload="metadata" />
      <figcaption>
        <a className="ghost small" href={url} download={a.name}>
          <Icon name="download" size={14} />
          Herunterladen ({formatBytes(a.size)})
        </a>
      </figcaption>
    </figure>
  );
}

export function AudioPlayer({ attachment: a }: { attachment: Attachment }) {
  const { url, missing } = useAttachmentUrl(a.id);
  if (missing) return <p className="hint">Dieses Audio ist im Browser-Speicher nicht mehr vorhanden.</p>;
  if (!url) return null;
  return (
    <figure className="generated-audio">
      <audio src={url} controls preload="metadata" />
      <figcaption>
        <a className="ghost small" href={url} download={a.name}>
          <Icon name="download" size={14} />
          Herunterladen ({formatBytes(a.size)})
        </a>
      </figcaption>
    </figure>
  );
}

export function SourceList({ sources }: { sources: Source[] }) {
  return (
    <details className="sources">
      <summary title="Aufklappen: die Webseiten, aus denen die Antwort stammt">
        <Icon name="globe" size={14} />
        {sources.length === 1 ? "1 Quelle" : `${sources.length} Quellen`}
      </summary>
      <ol>
        {sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title || hostOf(s.url)}
            </a>
            <span className="source-host">{hostOf(s.url)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
