import { pickChecker } from "./context";
import { complete, type Model } from "./openrouter";

/**
 * Rewrites a short idea into a prompt that image and video models follow well.
 * Rules distilled from the vendors' own guides (Google Nano Banana, Kling, Runway) and
 * community Veo 3.1 guides: one directed shot, concrete visible action, camera language,
 * light and mood, positive phrasing; for images a narrative brief, quoted text, and for
 * edits an explicit "what changes / what stays".
 */

export interface VideoContext {
  kind: "video";
  modelName: string;
  seconds?: number;
  aspectRatio?: string;
  audio: boolean;
  /** A start image fixes the look; the prompt should then describe motion only. */
  startImage: boolean;
  /** Reference images (e.g. a person) the video should keep consistent. */
  references: number;
}

export interface ImageContext {
  kind: "image";
  modelName: string;
  aspectRatio?: string;
  /** The model will edit an existing or attached picture rather than start from scratch. */
  editing: boolean;
}

const SHARED = `Du verbesserst Beschreibungen für KI-Bild- und Videomodelle. Der Nutzer ist meist kein Profi.

Grundregeln:
- Behalte die Absicht des Nutzers genau bei. Alles, was er ausdrücklich nennt, bleibt erhalten, wörtliche Texte und Dialoge unverändert.
- Ergänze nur, was fehlt, damit das Modell eine klare Vorstellung bekommt. Erfinde keine neuen Hauptfiguren, keine neue Handlung, keine Marken.
- Konkret statt vage: sichtbare Details, Materialien, Farben, Tageszeit. Ersetze Wörter wie „schön“, „magisch“ oder „cinematisch“ durch das, was man tatsächlich sieht.
- Formuliere positiv: beschreibe, was zu sehen ist, nicht was fehlen soll („leere Straße“ statt „keine Autos“).
- Schreibe in der Sprache des Nutzers, als zusammenhängenden Text ohne Überschriften, Listen oder Anführungszeichen um das Ganze.
- Antworte ausschließlich mit der verbesserten Beschreibung.`;

function videoInstructions(c: VideoContext) {
  const seconds = c.seconds ? `${c.seconds} Sekunden` : "wenige Sekunden";
  return `${SHARED}

Aufgabe: eine Beschreibung für das Videomodell ${c.modelName}. Das Video dauert ${seconds}${c.aspectRatio ? ` im Format ${c.aspectRatio}` : ""}.

So ist eine gute Videobeschreibung aufgebaut, in dieser Reihenfolge:
1. Einstellung und Kamera: Bildausschnitt und Perspektive (z. B. Nahaufnahme, Totale, Untersicht).
2. Motiv: wer oder was, mit konkretem Aussehen.
3. Eine Haupthandlung mit klaren Verben und Tempo (langsam, ruhig, plötzlich). Pro 4 bis 6 Sekunden höchstens eine Handlung.
4. Ort und Umgebung.
5. Kamerabewegung: z. B. langsame Fahrt auf das Motiv zu, Schwenk nach links, Kamera folgt der Person, statisch.
6. Licht, Farben und Stimmung.
7. Stil: z. B. realistisch, Dokumentarfilm, Animationsfilm, Zeitlupe.
${c.audio ? "8. Ton: Umgebungsgeräusche, Geräusche, Musik. Gesprochenes in Anführungszeichen mit Sprecher." : "Beschreibe keinen Ton, das Video wird ohne Ton erstellt."}
${c.references ? `\nWICHTIG: Es gibt ${c.references === 1 ? "ein Referenzbild" : `${c.references} Referenzbilder`}, zum Beispiel eine Person oder ein Objekt. Die Szene ist neu, aber sage ausdrücklich, dass Person oder Objekt aus ${c.references === 1 ? "dem Referenzbild" : "den Referenzbildern"} gleich aussehen sollen (Gesicht, Frisur, Kleidung, Form, Farben). Beschreibe ihr Aussehen nicht neu, verweise auf das Referenzbild.` : ""}
${c.startImage ? "\nWICHTIG: Es gibt ein Startbild. Es legt Aussehen, Motiv, Farben und Bildaufbau bereits fest. Beschreibe deshalb nur Bewegung, Handlung, Kamerabewegung" + (c.audio ? " und Ton" : "") + ", nicht das Aussehen." : ""}

Schreibe es als eine durchgehende Kameraeinstellung, etwa 50 bis 110 Wörter. Dauer, Auflösung und Format nicht in den Text schreiben, die werden separat eingestellt.`;
}

function imageInstructions(c: ImageContext) {
  if (c.editing) {
    return `${SHARED}

Aufgabe: eine Bearbeitungsanweisung für das Bildmodell ${c.modelName}. Es verändert ein vorhandenes Bild.

So ist eine gute Bearbeitungsanweisung aufgebaut:
- Beginne mit einem klaren Verb, das die Änderung nennt (z. B. „Ersetze“, „Färbe“, „Füge … hinzu“, „Entferne“).
- Beschreibe genau, was sich ändert, mit konkreten Details.
- Sage ausdrücklich, was unverändert bleiben soll (z. B. Person, Bildaufbau, Licht, Stil).
- Text im Bild: die genauen Wörter in Anführungszeichen, dazu Schriftart oder Schriftstil.

Etwa 20 bis 60 Wörter.`;
  }
  return `${SHARED}

Aufgabe: eine Bildbeschreibung für das Bildmodell ${c.modelName}${c.aspectRatio ? `, Format ${c.aspectRatio}` : ""}.

So ist eine gute Bildbeschreibung aufgebaut, erzählend statt als Stichwortliste:
1. Motiv mit konkretem Aussehen, Materialien und Farben.
2. Handlung oder Pose.
3. Ort und Umgebung.
4. Bildaufbau und Kamera: Bildausschnitt, Perspektive, Schärfentiefe (z. B. Nahaufnahme, Untersicht, geringe Schärfentiefe).
5. Licht: z. B. weiches Fensterlicht, goldene Stunde, Studiolicht.
6. Stil oder Medium: z. B. Fotografie auf Analogfilm, Aquarell, 3D-Rendering, flache Illustration.
- Text im Bild: die genauen Wörter in Anführungszeichen, dazu Schriftstil.

Etwa 40 bis 90 Wörter. Das Format nicht in den Text schreiben, es wird separat eingestellt.`;
}

export async function enhancePrompt(opts: {
  apiKey: string;
  models: Model[];
  fallbackModel: string;
  text: string;
  context: VideoContext | ImageContext;
  signal?: AbortSignal;
}) {
  const model = pickChecker(opts.models, 2000, opts.fallbackModel);
  const system = opts.context.kind === "video" ? videoInstructions(opts.context) : imageInstructions(opts.context);
  const { text, usage } = await complete({
    apiKey: opts.apiKey,
    model,
    signal: opts.signal ?? new AbortController().signal,
    messages: [
      { role: "system", content: system },
      { role: "user", content: opts.text },
    ],
  });
  const cleaned = text.trim().replace(/^["„“]|["“”]$/g, "").trim();
  if (!cleaned) throw new Error("Das Modell hat keine verbesserte Beschreibung geliefert.");
  return { text: cleaned, model, cost: usage?.cost };
}
