import { useEffect, useRef, useState } from "react";
import { transcribe } from "../lib/transcribe";
import { Icon } from "./Icon";

/** Longer recordings risk provider timeouts; five minutes is plenty for a message. */
const MAX_MS = 5 * 60 * 1000;

type State = "idle" | "recording" | "working";

interface Props {
  apiKey: string;
  disabled?: boolean;
  /** Called with the recognized text. */
  onText: (text: string) => void;
  onError: (message: string) => void;
}

/** Tap to speak, tap again to turn speech into text. */
export function DictateButton({ apiKey, disabled, onText, onError }: Props) {
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const started = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
    },
    [],
  );

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("Dieser Browser kann keine Sprache aufnehmen. Versuche es mit Chrome, Edge oder Safari.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("Kein Zugriff aufs Mikrofon. Erlaube den Zugriff im Browser (Schloss-Symbol neben der Adresse) und versuche es erneut.");
      return;
    }
    const rec = new MediaRecorder(stream);
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      const audio = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      if (audio.size < 2000) {
        setState("idle");
        onError("Es wurde nichts aufgenommen. Halte den Knopf nicht gedrückt, sondern tippe einmal, sprich und tippe dann erneut.");
        return;
      }
      setState("working");
      try {
        const { text } = await transcribe(apiKey, audio);
        if (text) onText(text);
        else onError("Es wurde keine Sprache erkannt. Sprich etwas lauter oder näher am Mikrofon.");
      } catch (e) {
        onError(e instanceof TypeError ? "OpenRouter ist nicht erreichbar." : (e as Error).message);
      } finally {
        setState("idle");
      }
    };
    recorder.current = rec;
    rec.start();
    started.current = Date.now();
    setElapsed(0);
    setState("recording");
    timer.current = window.setInterval(() => {
      const ms = Date.now() - started.current;
      setElapsed(ms);
      if (ms >= MAX_MS) rec.stop();
    }, 250);
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  const secs = Math.floor(elapsed / 1000);
  const label =
    state === "recording" ? "Aufnahme beenden und in Text umwandeln" : state === "working" ? "Wird in Text umgewandelt" : "Sprechen statt tippen";

  return (
    <button
      type="button"
      className={`dictate ${state}`}
      onClick={state === "recording" ? stop : start}
      disabled={disabled || state === "working"}
      aria-label={label}
      title={label}
    >
      {state === "recording" ? (
        <>
          <span className="rec-dot" aria-hidden="true" />
          <span className="rec-time">
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          </span>
        </>
      ) : state === "working" ? (
        <span className="spinner small" aria-hidden="true" />
      ) : (
        <Icon name="mic" size={18} />
      )}
    </button>
  );
}
