import { isFreeModelId, type Model } from "./openrouter";

/**
 * Independent quality scores from Artificial Analysis, served through OpenRouter's
 * benchmark endpoint. They let the app call a model "the best" with evidence instead of guessing.
 */

export interface Scores {
  intelligence?: number;
  coding?: number;
  agentic?: number;
}

const API = "https://openrouter.ai/api/v1";
const CACHE = "router.scores.v1";
const TTL = 24 * 60 * 60 * 1000;

/** Same model regardless of variant suffix or release date ("…-20260604", ":free"). */
export const baseSlug = (s: string) => s.replace(/:.*$/, "").replace(/-\d{8}$/, "");

function toMap(rows: { model_permaslug?: string; intelligence_index?: number; coding_index?: number; agentic_index?: number }[]) {
  const map = new Map<string, Scores>();
  for (const r of rows) {
    if (!r.model_permaslug) continue;
    map.set(baseSlug(r.model_permaslug), {
      intelligence: r.intelligence_index ?? undefined,
      coding: r.coding_index ?? undefined,
      agentic: r.agentic_index ?? undefined,
    });
  }
  return map;
}

export function cachedScores(): Map<string, Scores> | null {
  try {
    const raw = localStorage.getItem(CACHE);
    if (!raw) return null;
    const { at, rows } = JSON.parse(raw);
    return Date.now() - at < TTL ? toMap(rows) : null;
  } catch {
    return null;
  }
}

export async function fetchScores(apiKey: string, signal?: AbortSignal) {
  const res = await fetch(`${API}/benchmarks?source=artificial-analysis`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!res.ok) throw new Error(`Benchmarks nicht verfügbar (HTTP ${res.status}).`);
  const rows = (await res.json()).data ?? [];
  try {
    localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    /* cache is optional */
  }
  return toMap(rows);
}

export function scoreOf(m: Model, scores: Map<string, Scores> | null) {
  if (!scores) return undefined;
  return scores.get(baseSlug(m.canonical_slug ?? m.id)) ?? scores.get(baseSlug(m.id));
}

export const FREE_ROUTER = "openrouter/free";

/** Safety and guard models classify content; they do not hold a conversation. */
export const isClassifier = (id: string) => /safety|guard/i.test(id);

/**
 * The highest-scoring free chat model. Classifiers (safety, guard) are not chat models.
 * Without scores the free router is the safe choice: it always picks something available.
 */
export function bestFreeModel(models: Model[] | null, scores: Map<string, Scores> | null): { id: string; score?: number } {
  if (!models) return { id: FREE_ROUTER };
  const candidates = models.filter(
    (m) =>
      isFreeModelId(m.id) &&
      m.id !== FREE_ROUTER &&
      !isClassifier(m.id) &&
      (m.architecture?.output_modalities ?? ["text"]).every((o) => o === "text"),
  );
  let best: { id: string; score: number } | null = null;
  for (const m of candidates) {
    const score = scoreOf(m, scores)?.intelligence;
    if (score !== undefined && (!best || score > best.score)) best = { id: m.id, score };
  }
  return best ?? { id: models.some((m) => m.id === FREE_ROUTER) ? FREE_ROUTER : (candidates[0]?.id ?? FREE_ROUTER) };
}
