/**
 * "Visualisieren": models send charts as small code blocks and Leuchtfeuer draws them itself.
 * ```chart → JSON drawn by components/Chart.tsx; ```mermaid flowchart → components/Flowchart.tsx;
 * ```svg → a sketch shown as an image (no scripts run).
 */

/** A message that asks for a picture of something: diagram, chart, sketch, flow (parts of words count: "Kreisdiagramm"). */
const VISUAL_ASK = /diagramm|grafik|graphik|schaubild|chart|skizz|zeichne|zeichnung|visualisier|veranschaulich|ablauf|abläufe|flowchart|mindmap|svg|diagram|graph\b|draw|sketch|visuali[sz]/i;

export const asksForVisual = (text: string) => VISUAL_ASK.test(text);

/** Added to the system prompt when the message asks for a picture, or always in chats whose profile wants it. */
export const VISUAL_GUIDE = `Du kannst Grafiken in deine Antworten einbauen. Wenn eine Grafik beim Verstehen hilft (Vergleiche, Anteile, Entwicklungen, Abläufe, einfache Skizzen), füge sie direkt in die Antwort ein und sag im Text in einem Satz, was sie zeigt. Erfinde keine Zahlen: nutze nur Werte, die du sicher kennst oder die im Gespräch stehen, und kennzeichne Schätzungen.

Diagramm: ein Codeblock mit der Sprache chart, darin nur JSON in dieser Form:
{"type":"bar","title":"Kurzer Titel","unit":"€","labels":["A","B","C"],"series":[{"name":"Reihe 1","values":[12,30,18]}]}
type ist "bar" (Vergleich), "line" (Entwicklung über Zeit) oder "pie" (Anteile an einem Ganzen). Höchstens 4 Reihen und 12 Beschriftungen; bei "pie" genau eine Reihe mit höchstens 6 Werten. Werte als reine Zahlen, ohne Einheit und ohne Tausenderpunkte; die Einheit gehört in "unit".

Ablauf, Prozess, Workflow oder Entscheidungsbaum: ein Codeblock mit der Sprache mermaid im flowchart-Format. Leuchtfeuer zeichnet ihn selbst und passt die Kästen an den Text an. Beispiel:
flowchart TD
  A([Start]) --> B[Schritt]
  B --> C{Frage?}
  C -->|Ja| D[Nächster Schritt]
  C -->|Nein| B
  D --> E([Ende])
Formen: [Schritt], {Entscheidung}, ([Start/Ende]), [(Daten/Archiv)]. Pfeile mit -->, Beschriftung mit -->|Text|, gestrichelt mit -.->. Kurze, klare Beschriftungen, höchstens etwa 25 Kästen, keine Farben oder style-Zeilen. Nur flowchart, keine anderen Mermaid-Diagrammarten.

Skizze oder Symbolbild (kein Ablauf, keine Zahlen): ein Codeblock mit der Sprache svg, darin ein vollständiges <svg> mit viewBox (höchstens etwa 800 × 500), weißer Hintergrund, klare Farben, Schrift sans-serif, keine Skripte, keine Links, keine eingebetteten Bilder. Lass um jeden Text reichlich Platz, denn Textbreiten kannst du nur schätzen.

Für Zahlen nimm chart, für Abläufe mermaid, nicht svg. Emojis und Symbole nur sparsam, wo sie Orientierung geben, außer eine andere Anweisung in diesem Gespräch wünscht sie ausdrücklich. Nicht jede Antwort braucht eine Grafik.`;

export type ChartType = "bar" | "line" | "pie";

export interface ChartSpec {
  type: ChartType;
  title?: string;
  unit?: string;
  labels: string[];
  series: { name: string; values: number[] }[];
}

/** Parses a ```chart block; null if it is not (yet) a usable chart. Tolerant of the shapes models tend to send. */
export function parseChart(code: string): ChartSpec | null {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type: ChartType = r.type === "line" || r.type === "pie" ? r.type : "bar";
  let labels = Array.isArray(r.labels) ? r.labels.map(String) : [];
  let series: ChartSpec["series"] = [];
  if (Array.isArray(r.series)) {
    series = r.series
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s, i) => ({ name: String(s.name ?? `Reihe ${i + 1}`), values: Array.isArray(s.values) ? s.values.map(Number) : [] }));
  } else if (Array.isArray(r.data)) {
    // Shorthand: [{label, value}]
    const rows = r.data.filter((d): d is Record<string, unknown> => !!d && typeof d === "object");
    labels = rows.map((d) => String(d.label ?? d.name ?? ""));
    series = [{ name: String(r.title ?? "Wert"), values: rows.map((d) => Number(d.value)) }];
  }
  series = series.filter((s) => s.values.length > 0 && s.values.every(Number.isFinite));
  if (!series.length) return null;
  const n = Math.max(...series.map((s) => s.values.length));
  if (labels.length < n) labels = [...labels, ...Array.from({ length: n - labels.length }, (_, i) => String(labels.length + i + 1))];
  return {
    type,
    title: typeof r.title === "string" ? r.title : undefined,
    unit: typeof r.unit === "string" ? r.unit : undefined,
    labels: labels.slice(0, n),
    series: type === "pie" ? series.slice(0, 1) : series,
  };
}

/** What a code block of this language shows, in words ("Diagramm: Umsatz"); null for text and code. */
export function visualLabel(lang: string, code: string): string | null {
  switch (lang.toLowerCase()) {
    case "chart": {
      let title = "";
      try {
        title = String(JSON.parse(code)?.title ?? "");
      } catch {
        /* half a chart */
      }
      return title ? `Diagramm: ${title}` : "Diagramm";
    }
    case "svg":
      return "Grafik";
    case "mermaid":
    case "flow":
      return "Ablaufdiagramm";
    default:
      return null;
  }
}

/** An SVG sketch is shown only if it really is one; as an <img> nothing inside it can run. */
export function svgSource(code: string): string | null {
  const svg = code.trim();
  if (!(/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg) && /<\/svg>\s*$/i.test(svg))) return null;
  // As an image, an SVG without its namespace stays blank; models often leave it out.
  return /<svg[^>]*\sxmlns\s*=/i.test(svg) ? svg : svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}
