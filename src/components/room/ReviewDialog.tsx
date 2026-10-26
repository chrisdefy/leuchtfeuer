import { useEffect, useRef, useState } from "react";
import { formatCost } from "../../lib/format";
import { complete, shortName, type Model } from "../../lib/openrouter";
import { contributions as countContributions, parseReview, reviewMessages, reviewTalkMessages, type Review, type Room } from "../../lib/rooms";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

interface Props {
  room: Room;
  judge: string;
  models: Model[] | null;
  apiKey: string;
  onSave: (review: Review) => void;
  /** Play more rounds, as the judge suggested. */
  onContinue: () => void;
  onPickJudge: () => void;
  onSpent: () => void;
  onClose: () => void;
}

/**
 * The independent judge: result, course, conclusion and what to learn from it.
 * Afterwards the user can ask the judge about it, e.g. how to behave in such a situation.
 */
export function ReviewDialog({ room, judge, models, apiKey, onSave, onContinue, onPickJudge, onSpent, onClose }: Props) {
  const review = room.review;
  const [writing, setWriting] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const judgeModel = models?.find((m) => m.id === judge);
  const judgeName = judgeModel ? shortName(judgeModel) : judge;
  const contributions = countContributions(room);
  const outdated = !!review && contributions > review.atMessages;

  useEffect(() => () => abort.current?.abort(), []);
  // A room without a review gets one right away; that is why the dialog was opened.
  // Started a tick later, so React's development double mount does not send it twice.
  useEffect(() => {
    if (review || contributions === 0) return;
    const t = setTimeout(() => void write(), 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [review?.talk.length, asking]);

  async function write() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setWriting("");
    try {
      const res = await complete({ apiKey, model: judge, messages: reviewMessages(room), signal: ctrl.signal }, setWriting);
      const parsed = parseReview(res.text);
      if (!parsed.text) throw new Error("Der Bewerter hat keine Bewertung geliefert.");
      onSave({ model: judge, text: parsed.text, verdict: parsed.verdict, talk: [], cost: res.usage?.cost ?? 0, atMessages: contributions });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setWriting(null);
      onSpent();
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || !review) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setQuestion("");
    setAsking("");
    try {
      const res = await complete(
        { apiKey, model: review.model, messages: reviewTalkMessages(room, review, q), signal: ctrl.signal },
        setAsking,
      );
      onSave({
        ...review,
        talk: [...review.talk, { role: "user", content: q }, { role: "assistant", content: res.text.trim() }],
        cost: review.cost + (res.usage?.cost ?? 0),
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
      setQuestion(q);
    } finally {
      setAsking(null);
      onSpent();
    }
  }

  const busy = writing !== null || asking !== null;
  const shown = writing !== null ? parseReview(writing).text : review?.text;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog wide review" role="dialog" aria-modal="true" aria-labelledby="review-title" onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
        <header className="dialog-head">
          <h2 id="review-title">Bewertung und Fazit</h2>
          <button className="ghost icon-only" onClick={onClose} aria-label="Schließen" disabled={busy}>
            <Icon name="close" />
          </button>
        </header>

        <p className="review-judge">
          Unabhängiger Bewerter: <strong>{review && writing === null ? (models?.find((m) => m.id === review.model) ? shortName(models.find((m) => m.id === review.model)!) : review.model) : judgeName}</strong>
          , ein anderes Modell als die Teilnehmer.{" "}
          <button className="link-button" onClick={onPickJudge} disabled={busy} title="Ein anderes Modell als Bewerter aussuchen">
            Anderen Bewerter wählen
          </button>
        </p>

        {contributions === 0 ? (
          <p className="hint">Es gibt noch keine Beiträge zum Bewerten. Starte das Gespräch zuerst.</p>
        ) : (
          <div className="review-body">
            {shown ? <Markdown text={shown} /> : <p className="hint">{judgeName} liest das Gespräch …</p>}
            {review && writing === null && review.verdict && (
              <div className={`review-verdict ${review.verdict}`}>
                <Icon name={review.verdict === "continue" ? "play" : "check"} size={15} />
                {review.verdict === "continue" ? "Der Bewerter empfiehlt, weiterzumachen." : "Der Bewerter hält das Gespräch für abgeschlossen."}
                {review.verdict === "continue" && (
                  <button className="button small" onClick={onContinue} title="Das Gespräch zwei weitere Runden laufen lassen">
                    2 Runden weiter
                  </button>
                )}
              </div>
            )}
            {review && writing === null && (
              <section className="review-talk" aria-label="Gespräch mit dem Bewerter">
                {review.talk.map((t, i) => (
                  <div key={i} className={`review-turn ${t.role}`}>
                    {t.role === "user" ? <p>{t.content}</p> : <Markdown text={t.content} />}
                  </div>
                ))}
                {asking !== null && (
                  <div className="review-turn assistant">{asking ? <Markdown text={asking} /> : <p className="hint">Denkt nach …</p>}</div>
                )}
                <div ref={end} />
              </section>
            )}
          </div>
        )}

        {error && (
          <div className="msg-error" role="alert">
            {error}
          </div>
        )}

        {review && writing === null && (
          <form
            className="review-ask"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <input
              className="input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Frag den Bewerter, z. B. „Wie hätte ich an der Stelle reagieren sollen?“"
              aria-label="Frage an den Bewerter"
              disabled={busy}
            />
            <button className="send" type="submit" disabled={!question.trim() || busy} aria-label="Frage senden">
              <Icon name="send" />
            </button>
          </form>
        )}

        <footer className="dialog-foot spread">
          <p className="hint">
            {review && `Kosten bisher ${formatCost(review.cost) || "$0"}.`}
            {outdated && " Seit der Bewertung ging das Gespräch weiter."}
          </p>
          <div className="dialog-buttons">
            {review && (
              <button className="button" onClick={() => navigator.clipboard.writeText(review.text)} disabled={busy} title="Die Bewertung in die Zwischenablage kopieren">
                <Icon name="copy" size={15} />
                Kopieren
              </button>
            )}
            {contributions > 0 && (
              <button className="button" onClick={() => void write()} disabled={busy} title={review ? "Das Gespräch noch einmal bewerten lassen, mit dem aktuellen Stand" : "Ein unabhängiges Modell bewertet das Gespräch und zieht ein Fazit"}>
                <Icon name="refresh" size={15} />
                {review ? "Neu bewerten" : "Bewerten"}
              </button>
            )}
            <button className="button primary" onClick={onClose} disabled={busy} title="Fenster schließen; die Bewertung bleibt gespeichert">
              Schließen
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
