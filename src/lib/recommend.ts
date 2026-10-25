import { formatPrice } from "./format";
import { isFree, itemPrice, perMillion, providerLabel, type Model } from "./openrouter";

export interface UseCase {
  id: string;
  label: string;
  /** OpenRouter ranking category (`/models?category=…`). */
  category: string;
}

export const USE_CASES: UseCase[] = [
  { id: "code", label: "Programmieren", category: "programming" },
  { id: "write", label: "Marketing", category: "marketing" },
  { id: "translate", label: "Übersetzen", category: "translation" },
  { id: "science", label: "Wissenschaft", category: "science" },
  { id: "tech", label: "Technik", category: "technology" },
  { id: "legal", label: "Recht", category: "legal" },
  { id: "finance", label: "Finanzen", category: "finance" },
  { id: "health", label: "Gesundheit", category: "health" },
  { id: "stories", label: "Geschichten", category: "roleplay" },
  { id: "trivia", label: "Allgemeinwissen", category: "trivia" },
  { id: "seo", label: "SEO", category: "marketing/seo" },
];

export interface Recommendation {
  model: Model;
  badge: string;
  reason: string;
}

/** Vendors whose newest premium model counts as top tier. Order = preference on ties. */
const FRONTIER_VENDORS = ["anthropic/", "openai/", "google/", "x-ai/"];
const FRONTIER_MIN_INPUT = 1.5; // USD per 1M input tokens

/** Blended USD per 1M tokens, weighted 3:1 input to output like typical chat traffic. */
/**
 * Models with few restrictions. No catalog field marks these; their makers say so in name or description.
 * Matching on that text means new models of the same kind show up by themselves.
 */
export const isUncensored = (m: Model) =>
  m.id.startsWith("nousresearch/hermes") ||
  /uncensor|unfilter|abliterat|dolphin|venice|neutrally aligned|cydonia/i.test(`${m.id} ${m.name} ${m.description ?? ""}`);

export function blendedPrice(m: Model) {
  // Billed per song or clip: a token price of 0 would make it look like the cheapest model.
  if (itemPrice(m)) return Infinity;
  const p = perMillion(m.pricing.prompt);
  const c = perMillion(m.pricing.completion);
  return p === null || c === null ? Infinity : (3 * p + c) / 4;
}

function isPlainVariant(m: Model) {
  // Skip ":free", ":batch", ":thinking" etc. and image/audio-only models.
  return !m.id.includes(":") && (m.architecture?.output_modalities ?? ["text"]).includes("text");
}

export function frontierModels(models: Model[]) {
  const out: Model[] = [];
  for (const vendor of FRONTIER_VENDORS) {
    const newest = models
      .filter((m) => m.id.startsWith(vendor) && isPlainVariant(m))
      .filter((m) => (perMillion(m.pricing.prompt) ?? 0) >= FRONTIER_MIN_INPUT)
      .sort((a, b) => b.created - a.created)[0];
    if (newest) out.push(newest);
  }
  return out;
}

/**
 * Three picks for a use case: top tier, best value, cheapest.
 * `ranked` is OpenRouter's usage ranking for the category (most used first).
 * Popularity is a usage signal, not a quality score — the reasons say so.
 */
export function recommend(models: Model[], ranked: string[], useCase: UseCase): Recommendation[] {
  const byId = new Map(models.map((m) => [m.id, m]));
  const rankOf = new Map(ranked.map((id, i) => [id, i + 1]));
  const pool = ranked
    .map((id) => byId.get(id))
    .filter((m): m is Model => !!m && !isFree(m) && Number.isFinite(blendedPrice(m)) && isPlainVariant(m));

  const picks: Recommendation[] = [];
  const taken = new Set<string>();

  const frontier = frontierModels(models);
  const top =
    frontier.filter((m) => rankOf.has(m.id)).sort((a, b) => rankOf.get(a.id)! - rankOf.get(b.id)!)[0] ?? frontier[0];
  if (top) {
    const rank = rankOf.get(top.id);
    picks.push({
      model: top,
      badge: "Spitzenklasse",
      reason: rank
        ? `Aktuelles Spitzenmodell von ${providerLabel(top)}, Platz ${rank} der Nutzung für ${useCase.label}.`
        : `Aktuelles Spitzenmodell von ${providerLabel(top)}. Teuer, aber für anspruchsvolle Aufgaben gemacht.`,
    });
    taken.add(top.id);
  }

  const topTen = pool.slice(0, 10);
  const cheapest = [...topTen].sort((a, b) => blendedPrice(a) - blendedPrice(b))[0];
  const value = pool.find((m) => !taken.has(m.id) && m.id !== cheapest?.id);

  if (value) {
    const rank = rankOf.get(value.id)!;
    picks.push({
      model: value,
      badge: "Preis-Leistung",
      reason:
        rank === 1
          ? `Meistgenutztes Modell für ${useCase.label} auf OpenRouter, ${formatPrice(perMillion(value.pricing.completion))} pro 1M Ausgabe-Tokens.`
          : `Platz ${rank} der Nutzung für ${useCase.label}, ${formatPrice(perMillion(value.pricing.completion))} pro 1M Ausgabe-Tokens.`,
    });
    taken.add(value.id);
  }

  if (cheapest && !taken.has(cheapest.id)) {
    picks.push({
      model: cheapest,
      badge: "Am günstigsten",
      reason: `Günstigstes der zehn meistgenutzten Modelle für ${useCase.label}.`,
    });
  }

  return picks;
}
