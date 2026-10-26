import { useEffect, useMemo, useRef, useState } from "react";
import {
  USD_PER_MINUTE,
  audioScript,
  composeMusic,
  encodeMp3,
  estimateMinutes,
  mixAudioPlay,
  musicBriefMessages,
  parseMusicBrief,
  speakParts,
  type Extras,
} from "../../lib/audiobook";
import { fileName } from "../../lib/exporting";
import { formatCost } from "../../lib/format";
import { complete } from "../../lib/openrouter";
import { contributions, parseReview, reviewMessages, type Review, type Room } from "../../lib/rooms";
import { Icon } from "../Icon";

interface Props {
  room: Room;
  judge: string;
  apiKey: string;
  /** Gives every character a voice first; resolves with the room as it is then. */
  ensureVoices: () => Promise<Room>;
  onReview: (review: Review) => void;
  onSpent: () => void;
  onClose: () => void;
  /** Cheap model that reads the conversation and describes fitting music. */
  director: string;
  /** Music model for intro, breaks and outro; missing = the play is made without music. */
  musicModel?: string;
}

type Stage =
  | { kind: "intro" }
  | { kind: "review" }
  | { kind: "voices" }
  | { kind: "music" }
  | { kind: "speaking"; done: number; total: number }
  | { kind: "mixing" }
  | { kind: "done"; url: string; size: number; note?: string };

/** About what one music clip costs (Lyria, 30 seconds). */
const MUSIC_USD = 0.04;

/** "Als Hörspiel speichern": the whole conversation in the characters' voices, then the evaluation, as one MP3. */
export function AudioPlayDialog({ room, judge, apiKey, ensureVoices, onReview, onSpent, onClose, director, musicModel }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "intro" });
  /** Music from the music model; off gives just the voices. */
  const [music, setMusic] = useState(!!musicModel);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const reviewFresh = !!room.review && contributions(room) <= room.review.atMessages;
  // The estimate uses the evaluation if there is one; otherwise about the length of a typical one.
  const minutes = useMemo(() => estimateMinutes(audioScript(room, room.review?.text ?? "x ".repeat(450))), [room]);
  const title = fileName(room.title).replace(/\.md$/, ".mp3");
  const busy = stage.kind !== "intro" && stage.kind !== "done";

  useEffect(
    () => () => {
      abort.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  function download(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = title;
    a.click();
  }

  async function start() {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    try {
      let review = reviewFresh ? room.review!.text : "";
      if (!review) {
        setStage({ kind: "review" });
        const res = await complete({ apiKey, model: judge, messages: reviewMessages(room), signal: ctrl.signal });
        const parsed = parseReview(res.text);
        if (!parsed.text) throw new Error("Der Bewerter hat keine Bewertung geliefert.");
        review = parsed.text;
        onReview({ model: judge, text: parsed.text, verdict: parsed.verdict, talk: [], cost: res.usage?.cost ?? 0, atMessages: contributions(room) });
        onSpent();
      }
      setStage({ kind: "voices" });
      const withVoices = await ensureVoices();
      const parts = audioScript(withVoices, review);

      let extras: Extras | undefined;
      let note: string | undefined;
      if (music && musicModel) {
        setStage({ kind: "music" });
        try {
          let brief = parseMusicBrief("");
          try {
            const res = await complete({ apiKey, model: director, messages: musicBriefMessages(withVoices), signal: ctrl.signal });
            brief = parseMusicBrief(res.text);
          } catch (e) {
            if ((e as Error).name === "AbortError") throw e;
            /* a calm default piece still fits */
          }
          extras = { music: (await composeMusic(apiKey, musicModel, brief, ctrl.signal)).samples };
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          note = `Die Musik konnte nicht erstellt werden (${(e as Error).message}); das Hörspiel ist ohne Musik.`;
        }
        onSpent();
      }

      setStage({ kind: "speaking", done: 0, total: parts.length });
      const speech = await speakParts(parts, apiKey, (done) => setStage({ kind: "speaking", done, total: parts.length }), ctrl.signal);
      setStage({ kind: "mixing" });
      // Let the screen show "mixing" before the work blocks it for a moment.
      await new Promise((r) => setTimeout(r, 30));
      const blob = encodeMp3(mixAudioPlay(parts, speech, extras));
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      setStage({ kind: "done", url, size: blob.size, note });
      download(url);
    } catch (e) {
      if ((e as Error).name === "AbortError") setStage({ kind: "intro" });
      else {
        setError((e as Error).message);
        setStage({ kind: "intro" });
      }
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="audio-title" onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
        <header className="dialog-head">
          <h2 id="audio-title">Als Hörspiel speichern</h2>
          <button className="ghost icon-only" onClick={onClose} aria-label="Schließen" disabled={busy}>
            <Icon name="close" />
          </button>
        </header>

        {stage.kind === "intro" && (
          <>
            <p className="dialog-lead">
              Das ganze Gespräch als MP3 zum Ablegen: Ein Sprecher stellt Thema und Figuren vor, dann spricht jede Figur
              mit ihrer eigenen Stimme, und zum Schluss liest der Sprecher Bewertung und Fazit vor
              {reviewFresh ? "" : " (die Bewertung wird vorher erstellt)"}.
            </p>
            <dl className="summary-facts">
              <div>
                <dt>Länge</dt>
                <dd>ca. {minutes} Minuten</dd>
              </div>
              <div>
                <dt>Kosten</dt>
                <dd>
                  ca. {formatCost(minutes * USD_PER_MINUTE + (music && musicModel ? MUSIC_USD : 0))}
                  {reviewFresh ? "" : " plus Bewertung"}
                </dd>
              </div>
              <div>
                <dt>Datei</dt>
                <dd>MP3, ca. {Math.max(1, Math.round(minutes * 0.5))} MB</dd>
              </div>
            </dl>
            {musicModel && (
              <>
                <label className="check">
                  <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} />
                  Mit Musik
                </label>
                <p className="hint">
                  Passende Musik zu Beginn, kurz zwischen den Runden und rund um die Auswertung. Sobald jemand spricht, tritt
                  sie deutlich in den Hintergrund, damit jedes Wort klar zu verstehen bleibt.
                </p>
              </>
            )}
          </>
        )}

        {busy && (
          <div className="audio-progress" role="status" aria-live="polite">
            <p>
              {stage.kind === "review"
                ? "Der Bewerter schreibt die Auswertung …"
                : stage.kind === "voices"
                  ? "Stimmen werden verteilt …"
                  : stage.kind === "music"
                    ? "Die Musik wird komponiert …"
                    : stage.kind === "mixing"
                      ? "Alles wird zusammengemischt …"
                      : stage.kind === "speaking"
                        ? `Spricht Beitrag ${Math.min(stage.done + 1, stage.total)} von ${stage.total} …`
                        : ""}
            </p>
            <div className="tour-progress">
              <span
                style={{
                  width:
                    stage.kind === "speaking"
                      ? `${10 + (stage.done / stage.total) * 85}%`
                      : stage.kind === "mixing"
                        ? "97%"
                        : stage.kind === "music"
                          ? "7%"
                          : "3%",
                }}
              />
            </div>
          </div>
        )}

        {stage.kind === "done" && (
          <div className="audio-done">
            <p className="gap-ok">
              <Icon name="check" size={16} />
              Fertig. Die Datei wird heruntergeladen (
              {stage.size < 1_000_000
                ? `${Math.max(1, Math.round(stage.size / 1000))} KB`
                : `${(stage.size / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`}
              ).
            </p>
            {stage.note && <p className="hint">{stage.note}</p>}
            <audio controls src={stage.url} />
          </div>
        )}

        {error && (
          <div className="msg-error" role="alert">
            {error}
          </div>
        )}

        <footer className="dialog-foot">
          {stage.kind === "intro" && (
            <>
              <button className="button" onClick={onClose} title="Schließen, ohne ein Hörspiel zu erstellen">
                Abbrechen
              </button>
              <button className="button primary" onClick={() => void start()} title="Das Gespräch mit eigenen Stimmen und Musik als MP3-Datei vertonen">
                <Icon name="speaker" size={15} />
                Hörspiel erstellen
              </button>
            </>
          )}
          {busy && (
            <button className="button" onClick={() => abort.current?.abort()} title="Das Erstellen abbrechen">
              Abbrechen
            </button>
          )}
          {stage.kind === "done" && (
            <>
              <button className="button" onClick={() => download(stage.url)} title="Die MP3-Datei noch einmal herunterladen">
                <Icon name="download" size={15} />
                Nochmal herunterladen
              </button>
              <button className="button primary" onClick={onClose} title="Fenster schließen">
                Fertig
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
