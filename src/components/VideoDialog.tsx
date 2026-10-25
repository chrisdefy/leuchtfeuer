import { useEffect, useMemo, useRef, useState } from "react";
import type { Attachment } from "../lib/files";
import { formatCost } from "../lib/format";
import { enhancePrompt } from "../lib/enhance";
import { fetchVideoModels, shortName, type Model, type VideoModel } from "../lib/openrouter";
import { videoLevels } from "../lib/media";
import { AttachmentChip } from "./Attachments";
import { Icon } from "./Icon";

export interface VideoRequest {
  model: string;
  modelName: string;
  prompt: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  audio: boolean;
  firstFrame?: Attachment;
  lastFrame?: Attachment;
  references: Attachment[];
}

export type ImageRole = "none" | "first" | "last" | "reference";

/** Duration, resolution, format and sound for one video; set in the input bar or in this dialog. */
export interface VideoOptions {
  duration?: number;
  resolution?: string;
  aspectRatio: string;
  audio: boolean;
}

/** Only `generate_audio: true` is a promise; false and unknown (null) mean no sound switch. */
export const canMakeSound = (m?: VideoModel) => m?.generate_audio === true;

/** Sensible start: about 5 seconds, 720p, 16:9, with sound where the model can. Keeps what still fits. */
export function videoDefaults(m: VideoModel, keep?: Partial<VideoOptions>): VideoOptions {
  const durations = m.supported_durations ?? [];
  const resolutions = m.supported_resolutions ?? [];
  const aspects = m.supported_aspect_ratios ?? DEFAULT_ASPECTS;
  return {
    duration: keep?.duration && durations.includes(keep.duration) ? keep.duration : (durations.find((x) => x >= 5) ?? durations[0]),
    resolution:
      keep?.resolution && resolutions.includes(keep.resolution)
        ? keep.resolution
        : (resolutions.find((x) => x === "720p") ?? resolutions[0]),
    aspectRatio: keep?.aspectRatio && aspects.includes(keep.aspectRatio) ? keep.aspectRatio : aspects.includes("16:9") ? "16:9" : aspects[0],
    audio: canMakeSound(m) && (keep?.audio ?? true),
  };
}

/** No structured flag exists for reference support; the model descriptions say it. */
export function supportsReferences(m?: VideoModel) {
  return !!m?.description && /\breferen/i.test(m.description);
}

interface Props {
  apiKey: string;
  /** Chat models, to pick a cheap one for improving the description. */
  chatModels: Model[];
  fallbackModel: string;
  initialPrompt: string;
  /** Preselected model, e.g. picked in the model picker. */
  initialModel?: string;
  /** Options already chosen in the input bar. */
  initialOptions?: VideoOptions;
  /** Images attached in the composer; each can become start frame, end frame or reference. */
  images: Attachment[];
  onAddFiles: (files: File[]) => void;
  onSubmit: (req: VideoRequest) => void;
  onClose: () => void;
}

export const DEFAULT_ASPECTS = ["16:9", "9:16", "1:1"];
const RESOLUTION_ORDER = ["480p", "720p", "768p", "1080p", "1K", "2K", "4K"];

/** Cheapest USD per second of output across a model's SKUs; null when it bills by video tokens. */
export function minPricePerSecond(m: VideoModel): number | null {
  let best: number | null = null;
  for (const [key, raw] of Object.entries(m.pricing_skus ?? {})) {
    // Surcharges for inputs (images, references, video continuation) are not a base price.
    if (/image|reference|continuation|video_input|megapixel|minimum/.test(key)) continue;
    const v = Number(raw);
    const perSecond = key.startsWith("cents_per") ? v / 100 : /^(duration_seconds|text_to_video)/.test(key) ? v : null;
    if (perSecond !== null && Number.isFinite(perSecond) && (best === null || perSecond < best)) best = perSecond;
  }
  return best;
}

function perMinute(usdPerSecond: number) {
  return `${(usdPerSecond * 60).toFixed(2).replace(".", ",")} $/min`;
}

const shortVideoName = (m: VideoModel) => m.name.replace(/^[^:]+:\s*/, "");

let cache: VideoModel[] | null = null;

/**
 * Rough USD estimate from a model's pricing SKUs. Providers name SKUs differently;
 * token-priced models (video_tokens) cannot be estimated up front.
 */
export function estimateVideoCost(m: VideoModel, seconds: number, resolution?: string, audio = true) {
  const sku = m.pricing_skus ?? {};
  const res = resolution?.toLowerCase();
  const usdKeys = [
    res && `duration_seconds_${audio ? "with" : "without"}_audio_${res}`,
    `duration_seconds_${audio ? "with" : "without"}_audio`,
    res && `text_to_video_duration_seconds_${res}`,
    res && `duration_seconds_${res}`,
    "duration_seconds",
  ];
  for (const k of usdKeys) if (k && sku[k]) return Number(sku[k]) * seconds;
  const centKeys = [
    res && `cents_per_video_output_second_${res}`,
    res && `cents_per_second_output_${res}`,
    "cents_per_second_output",
  ];
  for (const k of centKeys) if (k && sku[k]) return (Number(sku[k]) / 100) * seconds;
  return null;
}

export function VideoDialog(props: Props) {
  const { apiKey, chatModels, fallbackModel, initialPrompt, images, onSubmit, onClose } = props;
  const [models, setModels] = useState<VideoModel[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState(props.initialModel ?? "");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [duration, setDuration] = useState<number | undefined>(props.initialOptions?.duration);
  const [resolution, setResolution] = useState<string | undefined>(props.initialOptions?.resolution);
  const [aspect, setAspect] = useState(props.initialOptions?.aspectRatio ?? "16:9");
  const [audio, setAudio] = useState(props.initialOptions?.audio ?? true);
  const [roles, setRoles] = useState<Record<string, ImageRole>>({});
  /** Roles the user picked by hand; only these survive a model switch. */
  const chosen = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [original, setOriginal] = useState<string | null>(null);
  const [enhanceNote, setEnhanceNote] = useState<string | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);

  // Escape closes the dialog wherever the focus is (it may still sit in the chat input behind it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The description field appears once the models are loaded; put the cursor there.
  useEffect(() => {
    if (models) promptRef.current?.focus();
  }, [models]);

  useEffect(() => {
    if (cache) return;
    const ctrl = new AbortController();
    fetchVideoModels(ctrl.signal)
      .then((data) => {
        // Editing and avatar tools need inputs this dialog does not offer.
        cache = data.filter((m) => m.supported_durations?.length && !/edit|upscale|avatar/.test(m.id));
        setModels(cache);
      })
      .catch((e) => e.name !== "AbortError" && setError(e.message));
    return () => ctrl.abort();
  }, []);

  const model = useMemo(() => models?.find((m) => m.id === modelId), [models, modelId]);

  useEffect(() => {
    // The middle of the current price range, like "Standard" under "Erzeugen".
    if (models && !modelId) setModelId(videoLevels(models).find((l) => l.label === "Standard")?.model ?? videoLevels(models)[0]?.model ?? models[0]?.id ?? "");
  }, [models, modelId]);

  /** Settings the "cheap draft" preset wants once its model is active. */
  const preset = useRef<{ model: string; duration?: number; resolution?: string } | null>(null);

  useEffect(() => {
    if (!model) return;
    const wanted = preset.current?.model === model.id ? preset.current : null;
    preset.current = null;
    const durations = model.supported_durations ?? [];
    setDuration((d) =>
      wanted?.duration ?? (d && durations.includes(d) ? d : (durations.find((x) => x >= 5) ?? durations[0])),
    );
    const resolutions = model.supported_resolutions ?? [];
    setResolution((r) =>
      wanted?.resolution ?? (r && resolutions.includes(r) ? r : (resolutions.find((x) => x === "720p") ?? resolutions[0])),
    );
    const aspects = model.supported_aspect_ratios ?? DEFAULT_ASPECTS;
    setAspect((a) => (aspects.includes(a) ? a : aspects[0]));
  }, [model]);

  const cost = model && duration ? estimateVideoCost(model, duration, resolution, audio && canMakeSound(model)) : null;

  const frames = model?.supported_frame_images ?? [];
  const canRef = supportsReferences(model);
  const allowed = (role: ImageRole) =>
    role === "none" ||
    (role === "first" && frames.includes("first_frame")) ||
    (role === "last" && frames.includes("last_frame")) ||
    (role === "reference" && canRef);

  const imageKey = images.map((i) => i.id).join();

  // Pick sensible roles for new images, and drop roles the chosen model cannot use.
  useEffect(() => {
    if (!model) return;
    setRoles((prev) => {
      const next: Record<string, ImageRole> = {};
      images.forEach((img, i) => {
        const kept = prev[img.id];
        if (kept && chosen.current.has(img.id) && allowed(kept)) return (next[img.id] = kept);
        const wish: ImageRole = images.length > 1 && canRef ? "reference" : i === 0 ? "first" : canRef ? "reference" : "none";
        next[img.id] = allowed(wish) ? wish : canRef ? "reference" : "none";
      });
      return next;
    });
  }, [model, imageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const roleOf = (id: string) => roles[id] ?? "none";
  const firstFrame = images.find((i) => roleOf(i.id) === "first");
  const lastFrame = images.find((i) => roleOf(i.id) === "last");
  const references = images.filter((i) => roleOf(i.id) === "reference");
  const roleProblem =
    images.filter((i) => roleOf(i.id) === "first").length > 1
      ? "Nur ein Foto kann das Startbild sein."
      : images.filter((i) => roleOf(i.id) === "last").length > 1
        ? "Nur ein Foto kann das Endbild sein."
        : (firstFrame || lastFrame) && references.length
          ? "Start- oder Endbild und Referenzen lassen sich nicht kombinieren. Das Modell würde die Referenzen ignorieren."
          : null;

  function setRole(id: string, role: ImageRole) {
    chosen.current.add(id);
    setRoles((r) => ({ ...r, [id]: role }));
  }

  async function enhance() {
    if (!model || !prompt.trim()) return;
    setEnhancing(true);
    setEnhanceError(null);
    try {
      const result = await enhancePrompt({
        apiKey,
        models: chatModels,
        fallbackModel,
        text: prompt.trim(),
        context: {
          kind: "video",
          modelName: model.name.replace(/^[^:]+:\s*/, ""),
          seconds: duration,
          aspectRatio: aspect,
          audio,
          startImage: !!firstFrame,
          references: references.length,
        },
      });
      setOriginal((o) => o ?? prompt);
      setPrompt(result.text);
      const by = chatModels.find((m) => m.id === result.model);
      setEnhanceNote(`Ergänzt von ${by ? shortName(by) : result.model}. Prüfe, ob alles stimmt, und passe es bei Bedarf an.`);
    } catch (e) {
      setEnhanceError((e as Error).message);
    } finally {
      setEnhancing(false);
    }
  }
  // Cheapest first, token-billed models (no per-second price) last.
  const sorted = useMemo(
    () =>
      [...(models ?? [])].sort(
        (a, b) => (minPricePerSecond(a) ?? Infinity) - (minPricePerSecond(b) ?? Infinity) || a.name.localeCompare(b.name),
      ),
    [models],
  );
  const [draftNote, setDraftNote] = useState<string | null>(null);

  /** Cheapest setup that still honours the photo roles: lowest resolution, short clip, no audio. */
  function cheapDraft() {
    const needsRef = references.length > 0;
    const needsFirst = !!firstFrame;
    const needsLast = !!lastFrame;
    const candidate = sorted.find((m) => {
      if (minPricePerSecond(m) === null) return false;
      const f = m.supported_frame_images ?? [];
      return (!needsRef || supportsReferences(m)) && (!needsFirst || f.includes("first_frame")) && (!needsLast || f.includes("last_frame"));
    });
    if (!candidate) return;
    const durations = [...(candidate.supported_durations ?? [])].sort((a, b) => a - b);
    const shortest = durations.find((d) => d >= 4) ?? durations[0];
    const lowest = [...(candidate.supported_resolutions ?? [])].sort(
      (a, b) => RESOLUTION_ORDER.indexOf(a) - RESOLUTION_ORDER.indexOf(b),
    )[0];
    setAudio(false);
    if (candidate.id === modelId) {
      setDuration(shortest);
      if (lowest) setResolution(lowest);
    } else {
      preset.current = { model: candidate.id, duration: shortest, resolution: lowest };
      setModelId(candidate.id);
    }
    const est = shortest ? estimateVideoCost(candidate, shortest, lowest, false) : null;
    setDraftNote(
      `Entwurf: ${shortVideoName(candidate)}, ${lowest ?? "Standardauflösung"}, ${shortest} Sekunden, ohne Ton` +
        (est !== null ? `, ca. ${formatCost(est)}.` : ".") +
        " Gefällt dir das Ergebnis, erstelle die endgültige Fassung mit einem besseren Modell.",
    );
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-title"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header className="dialog-head">
          <h2 id="video-title">Video erstellen</h2>
          <button className="ghost icon-only" onClick={onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </header>

        {error ? (
          <div className="msg-error" role="alert">
            Die Videomodelle konnten nicht geladen werden: {error}
          </div>
        ) : !models ? (
          <p className="hint">Videomodelle werden geladen …</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!model || !prompt.trim()) return;
              onSubmit({
                model: model.id,
                modelName: model.name.replace(/^[^:]+:\s*/, ""),
                prompt: prompt.trim(),
                duration,
                resolution,
                aspectRatio: aspect,
                audio: audio && canMakeSound(model),
                firstFrame,
                lastFrame,
                references,
              });
            }}
          >
            <div className="field">
              <div className="field-row">
                <label htmlFor="video-model">Videomodell</label>
                <button
                  type="button"
                  className="ghost small enhance"
                  onClick={cheapDraft}
                  title="Günstigstes passendes Modell, niedrigste Auflösung, kurz und ohne Ton"
                >
                  <Icon name="sparkle" size={14} />
                  Günstiger Entwurf
                </button>
              </div>
              <select
                id="video-model"
                className="select"
                value={modelId}
                onChange={(e) => {
                  setModelId(e.target.value);
                  setDraftNote(null);
                }}
              >
                {sorted.map((m) => {
                  const p = minPricePerSecond(m);
                  return (
                    <option key={m.id} value={m.id}>
                      {m.name} {p !== null ? `(ab ${perMinute(p)})` : "(Preis nach Video-Tokens)"}
                    </option>
                  );
                })}
              </select>
              {draftNote && <p className="hint">{draftNote}</p>}
            </div>

            <div className="field">
              <div className="field-row">
                <label htmlFor="video-prompt">Was soll zu sehen sein?</label>
                <button
                  type="button"
                  className="ghost small enhance"
                  onClick={enhance}
                  disabled={enhancing || !prompt.trim() || !apiKey}
                  title="Ergänzt Kamera, Licht, Stimmung und Ton, damit das Videomodell dich besser versteht"
                >
                  <Icon name="sparkle" size={14} />
                  {enhancing ? "Wird verbessert …" : "Beschreibung verbessern"}
                </button>
              </div>
              <textarea
                id="video-prompt"
                ref={promptRef}
                rows={6}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Zum Beispiel: Café im Regen am Abend"
                readOnly={enhancing}
              />
              {enhanceError && <p className="hint error-text">{enhanceError}</p>}
              {original !== null && !enhanceError && (
                <p className="hint">
                  {enhanceNote}{" "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setPrompt(original);
                      setOriginal(null);
                      setEnhanceNote(null);
                    }}
                  >
                    Original wiederherstellen
                  </button>
                </p>
              )}
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="video-duration">Dauer</label>
                <select
                  id="video-duration"
                  className="select"
                  value={duration ?? ""}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {(model?.supported_durations ?? []).map((d) => (
                    <option key={d} value={d}>
                      {d} Sekunden
                    </option>
                  ))}
                </select>
              </div>
              {(model?.supported_resolutions?.length ?? 0) > 0 && (
                <div className="field">
                  <label htmlFor="video-resolution">Auflösung</label>
                  <select
                    id="video-resolution"
                    className="select"
                    value={resolution ?? ""}
                    onChange={(e) => setResolution(e.target.value)}
                  >
                    {model!.supported_resolutions!.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="video-aspect">Format</label>
                <select id="video-aspect" className="select" value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  {(model?.supported_aspect_ratios ?? DEFAULT_ASPECTS).map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {canMakeSound(model) && (
              <label className="check">
                <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
                Mit Ton
              </label>
            )}
            <fieldset className="photo-roles">
              <legend>Fotos verwenden</legend>
              {images.length === 0 ? (
                <p className="hint">
                  Optional: Ein Foto kann das Video starten oder beenden, oder als Vorlage für eine Person, ein
                  Objekt oder einen Stil dienen.
                </p>
              ) : (
                <ul>
                  {images.map((img) => (
                    <li key={img.id}>
                      <AttachmentChip attachment={img} />
                      <select
                        className="select"
                        value={roleOf(img.id)}
                        onChange={(e) => setRole(img.id, e.target.value as ImageRole)}
                        aria-label={`Rolle von ${img.name}`}
                      >
                        <option value="none">Nicht verwenden</option>
                        <option value="first" disabled={!allowed("first")}>
                          Startbild: das Video beginnt mit diesem Foto
                        </option>
                        <option value="last" disabled={!allowed("last")}>
                          Endbild: das Video endet mit diesem Foto
                        </option>
                        <option value="reference" disabled={!allowed("reference")}>
                          Referenz: Person, Objekt oder Stil übernehmen, neue Szene
                        </option>
                      </select>
                    </li>
                  ))}
                </ul>
              )}
              {model && images.length > 0 && !canRef && (
                <p className="hint">
                  {model.name.replace(/^[^:]+:\s*/, "")} kann keine Referenzbilder verwenden. Dafür eignen sich zum
                  Beispiel Seedance 2.0 oder Wan 2.7.
                </p>
              )}
              {roleProblem && <p className="hint error-text">{roleProblem}</p>}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  props.onAddFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
              <button type="button" className="ghost small" onClick={() => fileInput.current?.click()}>
                <Icon name="plus" size={14} />
                Foto hinzufügen
              </button>
            </fieldset>

            <footer className="dialog-foot spread">
              <p className="hint">
                {cost !== null && duration ? (
                  <>
                    <strong className="cost-estimate">Ca. {formatCost(cost)}</strong> für dieses Video, entspricht{" "}
                    {perMinute(cost / duration)}.{" "}
                  </>
                ) : (
                  <>Dieses Modell rechnet nach Video-Tokens ab, die Kosten stehen erst danach fest. </>
                )}
                Die Erstellung dauert meist einige Minuten. Du kannst währenddessen weiterchatten.
              </p>
              <div className="dialog-buttons">
                <button type="button" className="button" onClick={onClose}>
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={!model || !prompt.trim() || enhancing || !!roleProblem}
                >
                  Video erstellen
                </button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
