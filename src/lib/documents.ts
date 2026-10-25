import { estimateCost, estimateTokens, pickChecker } from "./context";
import { convertToMarkdown, docTypeOf } from "./convert";
import { attachmentDataUrl, blobText, getBlob, putBlob, type Attachment, type DocText } from "./files";
import { OpenRouterError, complete, isFree, parsePdf, perMillion, type Model, type PdfEngine } from "./openrouter";

/**
 * Documents go to the model as Markdown: converted once, stored, and resent as text.
 * That is far fewer tokens than a PDF read page by page as images, works with every
 * model, and a PDF is not parsed (and billed) again with every message of the chat.
 */

/** Below this many characters per page a PDF has hardly any text layer: probably a scan. */
const SCAN_CHARS_PER_PAGE = 120;
/** OCR through OpenRouter (Mistral): USD per page. */
export const OCR_PER_PAGE = 0.002;

async function storeText(text: string, by: DocText["by"], cost?: number): Promise<DocText> {
  const id = crypto.randomUUID();
  await putBlob(id, new Blob([text], { type: "text/markdown" }));
  return { id, tokens: estimateTokens(text), by, cost };
}

/** Page count from the PDF itself; good enough to judge scans and estimate OCR cost. */
export async function pdfPages(a: Attachment) {
  const blob = await getBlob(a.id);
  if (!blob) return undefined;
  const raw = new TextDecoder("latin1").decode(await blob.arrayBuffer());
  const counts = [...raw.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  const pages = counts.length ? Math.max(...counts) : (raw.match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
  return pages || undefined;
}

/**
 * Models for the parsing request. Its reply is a few tokens, but the parsed text counts as
 * input. The cheapest paid model costs a fraction of a cent and, unlike free endpoints,
 * is not allowed to keep the content for training; accounts without credit fall back to free.
 */
export function parserModels(models: Model[], bestFree: string) {
  const cheapest = models
    .filter((m) => !isFree(m) && !m.id.startsWith("openrouter/") && !m.id.includes(":") && m.context_length >= 128_000)
    .filter((m) => (m.architecture?.output_modalities ?? ["text"]).every((o) => o === "text"))
    .sort((a, b) => (perMillion(a.pricing.prompt) ?? Infinity) - (perMillion(b.pricing.prompt) ?? Infinity))[0];
  return [cheapest?.id, bestFree].filter((x): x is string => !!x);
}

async function parseWith(apiKey: string, candidates: string[], a: Attachment, engine: PdfEngine) {
  const dataUrl = await attachmentDataUrl(a.id);
  let last: unknown;
  for (const model of candidates) {
    try {
      return await parsePdf({ apiKey, model, name: a.name, dataUrl, engine });
    } catch (e) {
      last = e;
      // Free limit or a busy model: try the next one. Anything else is a real problem.
      if (!(e instanceof OpenRouterError) || (e.status !== 429 && e.status !== 402 && (e.status ?? 0) < 500)) throw e;
    }
  }
  throw last;
}

/** Convert a freshly attached document; returns the attachment with its text (or why not). */
export async function convertAttachment(
  a: Attachment,
  opts: { apiKey: string; models: Model[] | null; bestFree: string },
): Promise<Attachment> {
  try {
    if (a.kind === "doc") {
      const blob = await getBlob(a.id);
      const type = docTypeOf(new File([], a.name, { type: a.mime }));
      if (!blob || !type) throw new Error("Die Datei konnte nicht gelesen werden.");
      const md = await convertToMarkdown(blob, type, a.name);
      if (!md) throw new Error("Das Dokument enthält keinen Text.");
      return { ...a, status: undefined, error: undefined, text: await storeText(md, "browser") };
    }
    if (a.kind === "pdf") {
      // Without a key or the model list the PDF simply goes as it is, as before.
      if (!opts.apiKey || !opts.models) return { ...a, status: undefined, send: "original" };
      const [{ text, cost }, pages] = await Promise.all([
        parseWith(opts.apiKey, parserModels(opts.models, opts.bestFree), a, "cloudflare-ai"),
        pdfPages(a),
      ]);
      const scanned = text.replace(/\s+/g, "").length < SCAN_CHARS_PER_PAGE * (pages ?? 1);
      if (!text.trim()) return { ...a, status: undefined, scanned: true, send: "original" };
      // A scan yields next to no text; until OCR reads it, the PDF itself is the better choice.
      return { ...a, status: undefined, error: undefined, scanned, send: scanned ? "original" : undefined, text: await storeText(text, "cloudflare-ai", cost) };
    }
    return a;
  } catch (e) {
    const message = e instanceof TypeError ? "OpenRouter ist nicht erreichbar." : (e as Error).message;
    // A PDF still works as a PDF; other documents have nothing to fall back on.
    return { ...a, status: "failed", error: message, send: a.kind === "pdf" ? "original" : undefined };
  }
}

/** Re-read a scanned PDF with OCR (paid per page, once). */
export async function ocrAttachment(a: Attachment, opts: { apiKey: string; models: Model[]; bestFree: string }) {
  const { text, cost } = await parseWith(opts.apiKey, parserModels(opts.models, opts.bestFree), a, "mistral-ocr");
  if (!text.trim()) throw new Error("Auch die Texterkennung hat in diesem PDF keinen Text gefunden.");
  return { ...a, scanned: false, send: "text" as const, text: await storeText(text, "mistral-ocr", cost) };
}

function summaryPrompt(words: number) {
  return `Fasse das folgende Dokument so zusammen, dass man im Gespräch damit weiterarbeiten kann, ohne das Original zu haben.

Gliederung (leere Abschnitte weglassen):
## Worum es geht
## Kernaussagen
## Zahlen, Beträge, Daten und Fristen
## Pflichten, Bedingungen und Regeln
## Namen, Beteiligte und Begriffe
## Offene oder unklare Punkte

Regeln:
- Zahlen, Beträge, Daten, Namen und Fachbegriffe exakt übernehmen, nichts runden.
- Entscheidende Formulierungen (z. B. Vertragsklauseln) wörtlich in Anführungszeichen.
- Nichts hinzufügen, was nicht im Dokument steht. Nichts bewerten.
- In der Sprache des Dokuments, in Stichpunkten, höchstens etwa ${words} Wörter.

Antworte nur mit der Zusammenfassung.`;
}

/** Words for a summary: about a tenth of the document, between 300 and 1,500. */
export function summaryWords(tokens: number) {
  return Math.round(Math.min(1500, Math.max(300, tokens * 0.7 * 0.1)) / 50) * 50;
}

export function summaryEstimate(models: Model[], tokens: number, fallback: string) {
  const id = pickChecker(models, tokens + 3000, fallback);
  const model = models.find((m) => m.id === id);
  return { model, cost: estimateCost(model, tokens + 400, summaryWords(tokens) * 1.6) };
}

export async function summarizeAttachment(a: Attachment, opts: { apiKey: string; models: Model[]; fallback: string }) {
  if (!a.text) throw new Error("Es gibt noch keinen Text, der zusammengefasst werden kann.");
  const full = await blobText(a.text.id);
  const model = pickChecker(opts.models, a.text.tokens + 3000, opts.fallback);
  const { text, usage } = await complete({
    apiKey: opts.apiKey,
    model,
    signal: new AbortController().signal,
    messages: [
      { role: "system", content: summaryPrompt(summaryWords(a.text.tokens)) },
      { role: "user", content: `<document name="${a.name}">\n${full}\n</document>` },
    ],
  });
  if (!text.trim()) throw new Error("Das Modell hat keine Zusammenfassung geliefert.");
  return { ...a, send: "summary" as const, summary: await storeText(text.trim(), "summary", usage?.cost) };
}

/** What a document attachment sends: "text", "summary" or "original" (PDF only). */
export function sendMode(a: Attachment): "text" | "summary" | "original" {
  if (a.send === "summary" && a.summary) return "summary";
  if (a.send === "original" && a.kind === "pdf") return "original";
  if (a.text) return "text";
  return a.kind === "pdf" ? "original" : "text";
}

/** The document as a text block for the model, clearly delimited and labelled. */
export async function documentBlock(a: Attachment) {
  const mode = sendMode(a);
  const ref = mode === "summary" ? a.summary : a.text;
  if (!ref) return `[Anhang „${a.name}“ konnte nicht gelesen werden${a.error ? `: ${a.error}` : ""}]`;
  const body = await blobText(ref.id).catch(() => null);
  if (body === null) return `[Anhang „${a.name}“ ist im Browser-Speicher nicht mehr vorhanden]`;
  const note =
    mode === "summary"
      ? "Dies ist eine Zusammenfassung des Anhangs, nicht der vollständige Text. Details, die hier fehlen, sind unbekannt."
      : "Vollständiger Inhalt des Anhangs, als Text umgewandelt (Layout und Bilder fehlen).";
  return `<document name="${a.name.replace(/"/g, "'")}">\n${note}\n\n${body}\n</document>`;
}

/** Tokens the attachment adds to every request it is part of. */
export function attachmentTokens(a: Attachment) {
  const mode = sendMode(a);
  if (mode === "summary") return a.summary?.tokens;
  if (mode === "text") return a.text?.tokens;
  return undefined;
}
