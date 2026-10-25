import { blobToDataUrl } from "./files";
import { newestOf } from "./helpers";

/**
 * Speech to text through OpenRouter's transcription endpoint.
 * Whisper Large v3 handles German well and costs about 0.05 cents per minute of speech.
 */
const TRANSCRIBE_FALLBACK = "openai/whisper-large-v3";
/** The newest Whisper the catalog lists; Whisper Large v3 while it lists none. */
const transcribeModel = () => newestOf((m) => /whisper/i.test(m.id), TRANSCRIBE_FALLBACK);

/** Recording mime type → the format name the endpoint expects. */
function formatOf(mime: string) {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

export async function transcribe(apiKey: string, audio: Blob, signal?: AbortSignal) {
  const dataUrl = await blobToDataUrl(audio);
  const lang = navigator.language?.slice(0, 2).toLowerCase();
  const res = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: transcribeModel(),
      input_audio: { data: dataUrl.slice(dataUrl.indexOf(",") + 1), format: formatOf(audio.type) },
      ...(lang && /^[a-z]{2}$/.test(lang) ? { language: lang } : {}),
    }),
  });
  if (!res.ok) {
    let message = `Die Spracherkennung ist fehlgeschlagen (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* not JSON */
    }
    if (res.status === 402) message = "Für die Spracherkennung reicht das Guthaben nicht. Eine Minute kostet etwa 0,05 Cent.";
    throw new Error(message);
  }
  const body = await res.json();
  return { text: String(body.text ?? "").trim(), cost: body.usage?.cost as number | undefined };
}
