import { pauseSpeaking, resumeSpeaking, stopSpeaking, useNowSpeaking } from "../lib/speech";
import { Icon } from "./Icon";

/** Always-visible controls while something is read aloud, wherever the message has scrolled to. */
export function SpeechBar() {
  const now = useNowSpeaking();
  if (!now?.label) return null;
  const paused = now.phase === "paused";
  return (
    <div className="speech-bar" role="region" aria-label="Vorlesen">
      <span className={`speech-wave${now.phase === "playing" ? " on" : ""}`} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="speech-label" role="status">
        {now.phase === "loading" ? "Stimme wird geladen …" : paused ? "Pausiert" : "Liest vor"}
        <span className="speech-source">: {now.label}</span>
      </span>
      <button
        className="button small"
        onClick={paused ? resumeSpeaking : pauseSpeaking}
        disabled={now.phase === "loading"}
        title={paused ? "Vorlesen fortsetzen" : "Vorlesen anhalten"}
      >
        <Icon name={paused ? "play" : "pause"} size={13} />
        {paused ? "Weiter" : "Pause"}
      </button>
      <button className="button small" onClick={stopSpeaking} title="Vorlesen beenden">
        <Icon name="stop" size={12} />
        Stopp
      </button>
    </div>
  );
}
