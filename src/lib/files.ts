import { useEffect, useState } from "react";
import { docTypeOf, isLegacyOffice } from "./convert";

/**
 * Binary attachments (uploads, generated images, videos) live in IndexedDB:
 * localStorage holds only ~5 MB of text, a few screenshots would fill it.
 */

export interface Attachment {
  id: string;
  /** "doc": Word, Excel, PowerPoint, CSV or a text file; the model always gets it as text. */
  kind: "image" | "pdf" | "video" | "audio" | "doc";
  name: string;
  mime: string;
  size: number;
  /** Documents: the content as Markdown, stored as its own blob so it is converted only once. */
  text?: DocText;
  /** Documents: an optional summary, clearly marked as such for the model. */
  summary?: DocText;
  /** What the model gets. Missing: the text if there is one, else the original PDF. */
  send?: "text" | "summary" | "original";
  /** Documents: converting right now, or why it did not work. */
  status?: "converting" | "failed";
  error?: string;
  /** PDFs with hardly any text layer are probably scans; OCR helps there. */
  scanned?: boolean;
}

export interface DocText {
  id: string;
  tokens: number;
  /** Who produced it: the browser, OpenRouter's free PDF converter, OCR, or a summarizing model. */
  by: "browser" | "cloudflare-ai" | "mistral-ocr" | "summary";
  cost?: number;
}

const DB = "router-files";
const STORE = "files";

let dbPromise: Promise<IDBDatabase> | null = null;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const putBlob = (id: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, id));
export const getBlob = (id: string) => tx<Blob | undefined>("readonly", (s) => s.get(id));
export async function blobText(id: string) {
  const blob = await getBlob(id);
  if (!blob) throw new Error("Der umgewandelte Text ist im Browser-Speicher nicht mehr vorhanden.");
  return blob.text();
}

/** All stored blobs that belong to an attachment: the file itself, its text and summary. */
export const blobIdsOf = (a: Attachment) => [a.id, a.text?.id, a.summary?.id].filter((x): x is string => !!x);

export const deleteBlob = (id: string) => tx("readwrite", (s) => s.delete(id));

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}

const dataUrlCache = new Map<string, string>();

/** Data URL for sending an attachment to the API (cached; uploads are immutable). */
export async function attachmentDataUrl(id: string) {
  const cached = dataUrlCache.get(id);
  if (cached) return cached;
  const blob = await getBlob(id);
  if (!blob) throw new Error("Ein Anhang fehlt im Browser-Speicher und kann nicht mitgeschickt werden.");
  const url = await blobToDataUrl(blob);
  dataUrlCache.set(id, url);
  return url;
}

/** Object URL for showing an attachment; revoked when the component unmounts. */
export function useAttachmentUrl(id: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    getBlob(id)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) return setMissing(true);
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return { url, missing };
}

const MAX_IMAGE_EDGE = 2048;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export class AttachmentError extends Error {}

/**
 * Turn a picked, pasted or dropped file into a stored attachment.
 * Large images are scaled down: models see at most ~2K pixels anyway, and it saves tokens.
 */
export async function storeFile(file: File): Promise<Attachment> {
  const id = crypto.randomUUID();
  if (isLegacyOffice(file)) {
    throw new AttachmentError(
      `„${file.name}“ ist ein altes Office-Format. Speichere es in Word, Excel oder PowerPoint als .docx, .xlsx oder .pptx (oder als PDF) und hänge es dann an.`,
    );
  }
  if (docTypeOf(file) && file.type !== "application/pdf") {
    if (file.size > MAX_PDF_BYTES) throw new AttachmentError(`„${file.name}“ ist größer als 30 MB.`);
    await putBlob(id, file);
    return { id, kind: "doc", name: file.name, mime: file.type || "application/octet-stream", size: file.size, status: "converting" };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF_BYTES) throw new AttachmentError(`„${file.name}“ ist größer als 30 MB.`);
    await putBlob(id, file);
    return { id, kind: "pdf", name: file.name, mime: "application/pdf", size: file.size, status: "converting" };
  }
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new AttachmentError(`„${file.name}“ wird nicht unterstützt. Möglich sind Bilder (PNG, JPEG, WebP, GIF), PDF, Word, Excel, PowerPoint, CSV und Textdateien.`);
  }
  if (file.size > MAX_IMAGE_BYTES) throw new AttachmentError(`„${file.name}“ ist größer als 25 MB.`);
  const blob = file.type === "image/gif" ? file : await downscale(file);
  await putBlob(id, blob);
  const name = file.name && file.name !== "image.png" ? file.name : `Screenshot ${new Date().toLocaleTimeString("de-DE")}`;
  return { id, kind: "image", name, mime: blob.type, size: blob.size };
}

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Screenshots stay sharp as PNG; photos compress far better as WebP.
  const type = file.type === "image/png" && file.size < 4 * 1024 * 1024 ? "image/png" : "image/webp";
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), type, 0.88));
}

/** Store a generated image (data or https URL). */
export async function storeGeneratedImage(url: string, index: number): Promise<Attachment> {
  const blob = await dataUrlToBlob(url);
  const id = crypto.randomUUID();
  await putBlob(id, blob);
  const ext = blob.type.split("/")[1] ?? "png";
  return { id, kind: "image", name: `Bild ${index + 1}.${ext}`, mime: blob.type, size: blob.size };
}

export async function storeVideo(blob: Blob, name: string): Promise<Attachment> {
  const id = crypto.randomUUID();
  await putBlob(id, blob);
  return { id, kind: "video", name, mime: blob.type || "video/mp4", size: blob.size };
}

/**
 * Assemble streamed audio chunks into a playable file. Containers (WAV, MP3, OGG, FLAC)
 * are kept as they are; headerless PCM16 (OpenAI streaming, 24 kHz mono) gets a WAV header.
 */
/** Base64 audio pieces from a stream as one playable file; raw PCM (no known header) is wrapped as WAV. */
export function audioBlobFromChunks(chunks: string[]): Blob {
  const parts = chunks.map((c) => Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0)));
  const size = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  const head = String.fromCharCode(...bytes.slice(0, 4));
  const isMp3 = head.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  const type =
    head === "RIFF" ? "audio/wav" : isMp3 ? "audio/mpeg" : head === "OggS" ? "audio/ogg" : head === "fLaC" ? "audio/flac" : null;
  return type ? new Blob([bytes], { type }) : new Blob([wavHeader(size, 24_000), bytes], { type: "audio/wav" });
}

export async function storeAudio(chunks: string[]): Promise<Attachment> {
  const blob = audioBlobFromChunks(chunks);
  const id = crypto.randomUUID();
  await putBlob(id, blob);
  const ext = blob.type.split("/")[1].replace("mpeg", "mp3");
  return { id, kind: "audio", name: `Audio ${new Date().toLocaleTimeString("de-DE")}.${ext}`, mime: blob.type, size: blob.size };
}

/** Wrap raw 16-bit mono PCM into a playable WAV file. */
export function wavFromPcm16(pcm: Uint8Array<ArrayBuffer>, sampleRate: number) {
  return new Blob([wavHeader(pcm.length, sampleRate), pcm], { type: "audio/wav" });
}

function wavHeader(dataBytes: number, sampleRate: number) {
  const h = new DataView(new ArrayBuffer(44));
  const text = (at: number, s: string) => [...s].forEach((c, i) => h.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  h.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); // PCM
  h.setUint16(22, 1, true); // mono
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * 2, true);
  h.setUint16(32, 2, true);
  h.setUint16(34, 16, true);
  text(36, "data");
  h.setUint32(40, dataBytes, true);
  return h.buffer;
}

export function formatBytes(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
