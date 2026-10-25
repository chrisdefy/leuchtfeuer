const API = "https://openrouter.ai/api/v1";

export interface Model {
  id: string;
  /** Stable id including the release date, e.g. "google/gemma-4-31b-it-20260402". */
  canonical_slug?: string;
  name: string;
  created: number;
  description?: string;
  context_length: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing: {
    prompt: string;
    completion: string;
    request?: string;
    image?: string;
  };
  top_provider?: {
    context_length?: number | null;
    max_completion_tokens?: number | null;
    /** The provider runs an extra content filter on requests. */
    is_moderated?: boolean;
  };
  supported_parameters?: string[];
  /** Set for open-weight models published on Hugging Face. */
  hugging_face_id?: string | null;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cost?: number;
  /** Pages OpenRouter fetched for the model, if it reports them. */
  webFetches?: number;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface Source {
  url: string;
  title?: string;
}

export class OpenRouterError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

function headers(apiKey?: string): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Title": "Leuchtfeuer",
  };
  // Opened as a file from the desktop there is no web address to attribute the app to.
  if (location.protocol.startsWith("http")) h["HTTP-Referer"] = location.origin;
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

async function readError(res: Response): Promise<OpenRouterError> {
  let message = `Anfrage fehlgeschlagen (HTTP ${res.status}).`;
  try {
    const body = await res.json();
    if (body?.error?.message) message = body.error.message;
  } catch {
    /* body was not JSON */
  }
  if (res.status === 401) message = "Der API-Key wurde abgelehnt. Prüfe ihn in den Einstellungen.";
  if (zeroRetention && (res.status === 404 || /endpoint|provider|zdr|data polic/i.test(message)))
    message =
      "Für dieses Modell gibt es keinen Server, der garantiert nichts speichert. Wähle ein anderes Modell oder schalte den Datenschutz-Modus in den Einstellungen aus.";
  if (res.status === 402)
    message =
      "Dein OpenRouter-Guthaben reicht für diese Anfrage nicht aus. Lade es über „Aufladen“ unten in der Seitenleiste auf, oder wähle ein kostenloses Modell.";
  return new OpenRouterError(message, res.status);
}

export async function fetchModels(signal?: AbortSignal): Promise<Model[]> {
  const res = await fetch(`${API}/models`, { signal });
  if (!res.ok) throw await readError(res);
  const body = await res.json();
  return usableModels(body.data as Model[]);
}

/** `:batch` variants belong to the Batch API (results within 24 hours) and cannot answer a chat. */
export function usableModels(models: Model[]) {
  return models.filter((m) => !m.id.endsWith(":batch"));
}

/** Model ids ranked by usage for a use-case category, most used first. */
export async function fetchCategory(category: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${API}/models?category=${encodeURIComponent(category)}`, { signal });
  if (!res.ok) throw await readError(res);
  const body = await res.json();
  return (body.data as Model[]).map((m) => m.id);
}

export async function fetchCredits(apiKey: string, signal?: AbortSignal) {
  const res = await fetch(`${API}/credits`, { headers: headers(apiKey), signal });
  if (!res.ok) throw await readError(res);
  const body = await res.json();
  const { total_credits, total_usage } = body.data as { total_credits: number; total_usage: number };
  return { total: total_credits, used: total_usage, remaining: total_credits - total_usage };
}

export interface FreeQuota {
  used: number;
  limit: number;
  remaining: number;
}

/** Today's free-model allowance (resets at 00:00 UTC); null if OpenRouter does not report it. */
export async function fetchFreeQuota(apiKey: string, signal?: AbortSignal): Promise<FreeQuota | null> {
  const res = await fetch(`${API}/key`, { headers: headers(apiKey), signal });
  if (!res.ok) throw await readError(res);
  const q = (await res.json()).data?.free_model_daily_requests;
  return q && typeof q.limit === "number" ? { used: q.used, limit: q.limit, remaining: q.remaining } : null;
}

/** `:free` variants and the free router share the daily free-model allowance. */
export function isFreeModelId(id: string) {
  return id.endsWith(":free") || id === "openrouter/free";
}

/** When the free allowance resets, in the user's local time. */
export function freeResetTime() {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return next.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export interface StreamCallbacks {
  onContent: (text: string) => void;
  onReasoning: (text: string) => void;
  onUsage: (usage: Usage) => void;
  onModel: (model: string) => void;
  /** Generated images as data or https URLs. */
  onImages?: (urls: string[]) => void;
  /** Web sources cited in the answer. */
  onSources?: (sources: Source[]) => void;
  /** Base64 audio chunks from audio-output models. */
  onAudio?: (base64: string) => void;
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  signal: AbortSignal;
  /** Let the model search the web. Server tool when the model can call tools, else the web plugin. */
  webSearch?: "tool" | "plugin";
  /** Results per search (Exa and similar engines; native search of OpenAI, Anthropic, Google and xAI decides itself). */
  webResults?: number;
  /** Let the model open web pages (links in the message). Needs a model that can call tools. */
  webFetch?: boolean;
  /** Ask an image-output model for images, optionally in a given aspect ratio. */
  image?: { aspectRatio?: string };
  /** Hard cap on output tokens (reasoning included for most providers). */
  maxTokens?: number;
  /** Keep thinking short, e.g. for brief conversational turns. */
  reasoningEffort?: "low" | "medium" | "high";
  /** Which provider serving the model to prefer; defaults to the cheapest. */
  providerSort?: "throughput" | "price";
  /** Ask an audio-output model for sound. */
  audio?: { format: string; voice?: string };
  /**
   * Give up when the model delivers neither text nor thinking for this long (ms). Keep-alive pings
   * do not count: a request stuck at the provider would otherwise wait forever.
   */
  stallMs?: number;
}

/** A request given up by the stall guard; the message says so in plain words. */
export class StallError extends OpenRouterError {
  constructor(seconds: number) {
    super(`Die KI hat ${seconds} Sekunden lang nichts geliefert, die Anfrage wurde abgebrochen. Versuch es noch einmal, meist klappt es dann.`);
  }
}

/** Data protection mode: only providers that keep nothing (Zero Data Retention). Set from the settings. */
let zeroRetention = false;
export function setZeroRetention(on: boolean) {
  zeroRetention = on;
}

function requestBody(opts: ChatOptions) {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    usage: { include: true },
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
  // Many models are hosted by several providers; the same model is used, only price and speed differ.
  // The app always prefers the cheapest one.
  body.provider = { sort: opts.providerSort ?? "price", ...(zeroRetention ? { zdr: true } : {}) };
  // Claude caches the conversation so far only when asked; re-reading it then costs a tenth.
  // OpenAI, Gemini, DeepSeek and others cache on their own.
  if (opts.model.startsWith("anthropic/")) body.cache_control = { type: "ephemeral" };
  if (opts.audio) {
    body.modalities = ["text", "audio"];
    body.audio = opts.audio;
  }
  // Exa bills a flat rate per search with up to 10 results included, so 10 is the sensible default.
  const results = opts.webResults ?? 10;
  const tools: unknown[] = [];
  if (opts.webSearch === "tool") tools.push({ type: "openrouter:web_search", parameters: { max_results: results } });
  if (opts.webSearch === "plugin") body.plugins = [{ id: "web", max_results: results }];
  // OpenRouter opens the page and hands the model its text. The cap keeps a huge page from costing a fortune.
  if (opts.webFetch) tools.push({ type: "openrouter:web_fetch", parameters: { max_uses: 5, max_content_tokens: 15000 } });
  if (tools.length) body.tools = tools;
  if (opts.image) {
    body.modalities = ["image", "text"];
    if (opts.image.aspectRatio) body.image_config = { aspect_ratio: opts.image.aspectRatio };
  }
  return body;
}

function parseSources(annotations: unknown): Source[] {
  if (!Array.isArray(annotations)) return [];
  return annotations
    .filter((a) => a?.type === "url_citation" && a.url_citation?.url)
    .map((a) => ({ url: a.url_citation.url as string, title: a.url_citation.title as string | undefined }));
}

/**
 * Fetch counter in `usage.server_tool_use`. The key is not documented, so any "…fetch…" count is taken;
 * without one the answer is unknown (undefined), never "not opened".
 */
function fetchCount(serverTools: unknown): number | undefined {
  if (!serverTools || typeof serverTools !== "object") return undefined;
  const entry = Object.entries(serverTools).find(([k, v]) => /fetch/i.test(k) && typeof v === "number");
  return entry ? (entry[1] as number) : undefined;
}

export async function streamChat(opts: ChatOptions, cb: StreamCallbacks): Promise<void> {
  if (!opts.stallMs) return streamOnce(opts, cb);
  // The guard aborts its own controller, so a stall can be told apart from the user stopping.
  const ctrl = new AbortController();
  const forward = () => ctrl.abort();
  if (opts.signal.aborted) ctrl.abort();
  opts.signal.addEventListener("abort", forward);
  let stalled = false;
  let timer = 0;
  const alive = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      stalled = true;
      ctrl.abort();
    }, opts.stallMs);
  };
  const watch = <T extends unknown[]>(fn?: (...a: T) => void) => fn && ((...a: T) => (alive(), fn(...a)));
  alive();
  try {
    await streamOnce(
      { ...opts, signal: ctrl.signal },
      {
        ...cb,
        onContent: watch(cb.onContent)!,
        onReasoning: watch(cb.onReasoning)!,
        onAudio: watch(cb.onAudio),
        onImages: watch(cb.onImages),
      },
    );
  } catch (e) {
    if (stalled) throw new StallError(Math.round(opts.stallMs / 1000));
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener("abort", forward);
  }
}

async function streamOnce(opts: ChatOptions, cb: StreamCallbacks): Promise<void> {
  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: headers(opts.apiKey),
    signal: opts.signal,
    body: JSON.stringify(requestBody(opts)),
  });
  if (!res.ok || !res.body) throw await readError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reportedModel = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      // SSE comments (": OPENROUTER PROCESSING") keep the connection alive.
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new OpenRouterError(chunk.error.message ?? "Das Modell hat einen Fehler gemeldet.");
      if (!reportedModel && chunk.model) {
        reportedModel = true;
        cb.onModel(chunk.model);
      }
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.reasoning) cb.onReasoning(delta.reasoning);
      if (delta?.content) cb.onContent(delta.content);
      if (delta?.audio?.data) cb.onAudio?.(delta.audio.data);
      // Audio models send their words as a transcript instead of content.
      if (delta?.audio?.transcript && !delta.content) cb.onContent(delta.audio.transcript);
      // Images and citations may arrive on the delta or on a final full message.
      for (const part of [delta, choice?.message]) {
        if (!part) continue;
        if (Array.isArray(part.images) && part.images.length) {
          cb.onImages?.(part.images.map((i: { image_url?: { url?: string } }) => i.image_url?.url).filter(Boolean));
        }
        const sources = parseSources(part.annotations);
        if (sources.length) cb.onSources?.(sources);
      }
      if (chunk.usage) {
        cb.onUsage({
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          cost: chunk.usage.cost,
          webFetches: fetchCount(chunk.usage.server_tool_use),
        });
      }
    }
  }
}

/** Price per token as string → USD per million tokens. Negative means variable (e.g. auto router). */
export function perMillion(price: string | undefined): number | null {
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return null;
  return n * 1_000_000;
}

/**
 * Only `:free` variants and the free router are free. A token price of 0 alone is not enough:
 * music models (Lyria) list 0 per token and bill per song instead.
 */
export function isFree(m: Model) {
  return isFreeModelId(m.id) && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0;
}

/**
 * Price per piece for models billed per song or clip. The catalog has no field for it;
 * the description says it ("Full-length songs are priced at $0.08 per song").
 */
export function itemPrice(m: Pick<Model, "description">): { usd: number; unit: string } | null {
  const hit = /\$(\d+(?:\.\d+)?) per (song|clip)/i.exec(m.description ?? "");
  if (!hit) return null;
  return { usd: Number(hit[1]), unit: hit[2].toLowerCase() === "song" ? "Song" : "Clip" };
}

/** Music models write songs; other audio models speak their answers. */
export function makesMusic(m?: Pick<Model, "id" | "name" | "description">) {
  return !!m && /\b(music|song)s?\b|lyria/i.test(`${m.id} ${m.name} ${m.description ?? ""}`);
}

export function providerOf(id: string) {
  return id.split("/")[0];
}

/** "Anthropic: Claude Sonnet 4.5" → "Claude Sonnet 4.5" */
export function shortName(m: Pick<Model, "name">) {
  const i = m.name.indexOf(": ");
  return i === -1 ? m.name : m.name.slice(i + 2);
}

export function providerLabel(m: Pick<Model, "name" | "id">) {
  const i = m.name.indexOf(": ");
  return i === -1 ? providerOf(m.id) : m.name.slice(0, i);
}

/**
 * Background jobs give up after this long without any sign of life from the model. Generous, because some
 * thinking models show nothing while they think; quick jobs the user waits for set a shorter `stallMs`.
 */
export const HELPER_STALL_MS = 120_000;

/** For jobs the user watches and that need no long thought, such as drafting roles. */
export const QUICK_STALL_MS = 60_000;

/**
 * Non-interactive request: collects the streamed answer. `onText` sees the text as it grows.
 * Without a signal it cannot be cancelled, but the stall guard still ends it, so no busy state hangs.
 */
export async function complete(
  opts: Omit<ChatOptions, "signal"> & { signal?: AbortSignal },
  onText?: (text: string) => void,
  onThinking?: () => void,
): Promise<{ text: string; usage?: Usage }> {
  let text = "";
  let usage: Usage | undefined;
  await streamChat({ stallMs: HELPER_STALL_MS, ...opts, signal: opts.signal ?? new AbortController().signal }, {
    onContent: (t) => {
      text += t;
      onText?.(text);
    },
    onReasoning: () => onThinking?.(),
    onModel: () => {},
    onUsage: (u) => (usage = u),
  });
  return { text, usage };
}

// ---- PDF to Markdown ------------------------------------------------------------

export type PdfEngine = "cloudflare-ai" | "mistral-ocr";

/**
 * Let OpenRouter's file parser turn a PDF into Markdown once and keep the result.
 * The parsed text comes back as a file annotation; the model's own reply is not needed,
 * so it is capped at a few tokens. If the model fails after parsing, the annotation is
 * in the error instead.
 */
export async function parsePdf(opts: {
  apiKey: string;
  model: string;
  name: string;
  dataUrl: string;
  engine: PdfEngine;
  signal?: AbortSignal;
}): Promise<{ text: string; cost?: number }> {
  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: headers(opts.apiKey),
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      max_tokens: 16,
      usage: { include: true },
      provider: { sort: "price" },
      plugins: [{ id: "file-parser", pdf: { engine: opts.engine } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Antworte nur mit OK." },
            { type: "file", file: { filename: opts.name, file_data: opts.dataUrl } },
          ],
        },
      ],
    }),
  });
  const body = await res.json().catch(() => null);
  type Part = { type: string; text?: string };
  type Ann = { type?: string; file?: { hash?: string; content?: Part[] } };
  const annotations: Ann[] = [...(body?.choices?.[0]?.message?.annotations ?? []), ...(body?.error?.metadata?.file_annotations ?? [])];
  const seen = new Set<string>();
  const text = annotations
    .filter((a) => a?.type === "file" && !seen.has(a.file?.hash ?? "") && seen.add(a.file?.hash ?? ""))
    .flatMap((a) => a.file?.content ?? [])
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!.trim())
    .join("\n\n");
  if (!text && !res.ok) {
    if (res.status === 401) throw new OpenRouterError("Der API-Key wurde abgelehnt.", 401);
    throw new OpenRouterError(body?.error?.message ?? `Umwandlung fehlgeschlagen (HTTP ${res.status}).`, res.status);
  }
  return { text, cost: body?.usage?.cost };
}

// ---- video generation (asynchronous jobs) -----------------------------------

export interface VideoModel {
  id: string;
  name: string;
  created?: number;
  description?: string;
  supported_frame_images?: ("first_frame" | "last_frame")[] | null;
  supported_durations?: number[] | null;
  supported_resolutions?: string[] | null;
  supported_aspect_ratios?: string[] | null;
  /** true: can add sound; false or null: no sound, or unknown. */
  generate_audio?: boolean | null;
  pricing_skus?: Record<string, string>;
}

export interface VideoJob {
  id: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  unsigned_urls?: string[];
  error?: string;
  usage?: { cost?: number };
}

export async function fetchVideoModels(signal?: AbortSignal): Promise<VideoModel[]> {
  const res = await fetch(`${API}/videos/models`, { signal });
  if (!res.ok) throw await readError(res);
  return (await res.json()).data as VideoModel[];
}

export async function submitVideo(
  apiKey: string,
  req: {
    model: string;
    prompt: string;
    duration?: number;
    resolution?: string;
    aspect_ratio?: string;
    generate_audio?: boolean;
    frame_images?: { type: "image_url"; image_url: { url: string }; frame_type: "first_frame" | "last_frame" }[];
    input_references?: { type: "image_url"; image_url: { url: string } }[];
  },
): Promise<VideoJob> {
  const res = await fetch(`${API}/videos`, { method: "POST", headers: headers(apiKey), body: JSON.stringify(req) });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function pollVideo(apiKey: string, jobId: string, signal?: AbortSignal): Promise<VideoJob> {
  const res = await fetch(`${API}/videos/${encodeURIComponent(jobId)}`, { headers: headers(apiKey), signal });
  if (!res.ok) throw await readError(res);
  return res.json();
}

/** Downloads a finished video; the content URLs need the API key. */
export async function downloadVideo(apiKey: string, url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  if (!res.ok) throw await readError(res);
  return res.blob();
}

export function acceptsImages(m?: Model) {
  return !!m?.architecture?.input_modalities?.includes("image");
}

/** Routers list every modality they might route to; they are chat models, not generators. */
const isRouter = (m?: Model) => !!m?.id.startsWith("openrouter/");

export function makesImages(m?: Model) {
  return !isRouter(m) && !!m?.architecture?.output_modalities?.includes("image");
}

export function makesAudio(m?: Model) {
  return !isRouter(m) && !!m?.architecture?.output_modalities?.includes("audio");
}

/** Streaming audio: OpenAI only streams raw PCM16; others are asked for WAV. */
export function audioRequest(id: string) {
  return id.startsWith("openai/") ? { format: "pcm16", voice: "alloy" } : { format: "wav" };
}

export function canCallTools(m?: Model) {
  return !!m?.supported_parameters?.includes("tools");
}
