import { bestFreeModel, isClassifier, scoreOf, type Scores } from "./benchmarks";
import { isFree, itemPrice, perMillion, type Model } from "./openrouter";
import { blendedPrice, frontierModels } from "./recommend";

/**
 * Levels instead of a model list: the user picks how strong (and how expensive) the answer should be,
 * the app picks the model. Each level is chosen anew from benchmark scores and prices at every start,
 * so new models move in by themselves; the settings can pin a level to a fixed model.
 */
export type TierId = "free" | "light" | "standard" | "strong";

export const TIER_INFO: { id: TierId; label: string; hint: string }[] = [
  { id: "free", label: "Kostenlos", hint: "Kostet nichts, begrenzte Anfragen pro Tag. Für Alltägliches." },
  { id: "light", label: "Leicht", hint: "Schnell und sehr günstig. Für einfache Fragen, Texte und Übersetzungen." },
  { id: "standard", label: "Standard", hint: "Gut für fast alles: Schreiben, Erklären, Planen, Auswerten." },
  { id: "strong", label: "Stark", hint: "Das Beste, was es gibt. Für schwierige und wichtige Aufgaben, kostet mehr." },
];

/** Highest blended price (USD per 1M tokens, 3:1 input to output) a level may cost. */
export const PRICE_CAP: Record<Exclude<TierId, "free">, number> = { light: 0.6, standard: 4, strong: 40 };

const YEAR = 365 * 86_400;

/** Ordinary chat models: text in and out, no variant, no router, no filter, not hidden behind the 18+ opt-in. */
export function candidate(m: Model, now: number, excluded: (m: Model) => boolean) {
  const out = m.architecture?.output_modalities ?? ["text"];
  return (
    out.every((o) => o === "text") &&
    !m.id.includes(":") &&
    !m.id.startsWith("openrouter/") &&
    !isClassifier(m.id) &&
    !/-preview\b|-\d{4}$|-\d{8}$/.test(m.id) &&
    !isFree(m) &&
    !itemPrice(m) &&
    Number.isFinite(blendedPrice(m)) &&
    now - m.created < YEAR &&
    // Web search and opening links need tools.
    !!m.supported_parameters?.includes("tools") &&
    !excluded(m)
  );
}

/** The automatic model per level. */
export function autoTiers(
  models: Model[] | null,
  scores: Map<string, Scores> | null,
  excluded: (m: Model) => boolean = () => false,
): Record<TierId, string | undefined> {
  const free = bestFreeModel(models, scores).id;
  if (!models) return { free, light: undefined, standard: undefined, strong: undefined };
  const now = Date.now() / 1000;
  const pool = models.filter((m) => candidate(m, now, excluded));
  const iq = (m: Model) => scoreOf(m, scores)?.intelligence;
  // Smartest within the budget; on a tie the cheaper one.
  const best = (cap: number): Model | undefined =>
    pool
      .filter((m) => iq(m) !== undefined && blendedPrice(m) <= cap)
      .sort((a, b) => iq(b)! - iq(a)! || blendedPrice(a) - blendedPrice(b))[0];
  // From the top down, each level strictly cheaper than the one above, so the order is never surprising.
  const top = best(PRICE_CAP.strong);
  const mid = top && best(Math.min(PRICE_CAP.standard, blendedPrice(top) - 1e-9));
  const low = mid && best(Math.min(PRICE_CAP.light, blendedPrice(mid) - 1e-9));
  let strong = top?.id;
  let standard = mid?.id;
  let light = low?.id;
  // Without scores: the newest model of a big maker in each price band.
  if (!strong) {
    strong = frontierModels(models).find((m) => !excluded(m))?.id;
    const newest = (lo: number, hi: number) =>
      pool
        .filter((m) => FRONTIER.some((v) => m.id.startsWith(v)) && blendedPrice(m) > lo && blendedPrice(m) <= hi && m.id !== strong)
        .sort((a, b) => b.created - a.created)[0]?.id;
    standard = newest(PRICE_CAP.light, PRICE_CAP.standard);
    light = newest(0, PRICE_CAP.light);
  }
  return { free, light, standard, strong };
}

export const FRONTIER = ["anthropic/", "openai/", "google/", "x-ai/"];

/** Levels with the user's fixed choices from the settings taking precedence. */
export function resolveTiers(
  auto: Record<TierId, string | undefined>,
  fixed: Partial<Record<TierId, string>> | undefined,
  exists: (id: string) => boolean,
): Record<TierId, string | undefined> {
  const out = { ...auto };
  for (const t of TIER_INFO) {
    const id = fixed?.[t.id];
    if (id && exists(id)) out[t.id] = id;
  }
  return out;
}

/** Which level a model is, if it is one of them. */
export function tierOfModel(tiers: Record<TierId, string | undefined>, id: string): TierId | undefined {
  // The free router picks a free model by itself; it counts as the free level too.
  return TIER_INFO.find((t) => tiers[t.id] === id)?.id ?? (id === "openrouter/free" ? "free" : undefined);
}

/** Rough cost of a typical answer: about 2,000 tokens read, 500 written. */
export function typicalAnswerUsd(m: Model): number | null {
  const p = perMillion(m.pricing.prompt);
  const c = perMillion(m.pricing.completion);
  if (p === null || c === null) return null;
  return (2000 * p + 500 * c) / 1_000_000;
}

/** "kostenlos", "< 0,01 Cent", "0,3 Cent", "2,1 Cent" */
export function formatAnswerCost(usd: number | null) {
  if (usd === null) return "Preis variabel";
  if (usd === 0) return "kostenlos";
  const cent = usd * 100;
  return cent < 0.01 ? "< 0,01 Cent" : `${cent.toLocaleString("de-DE", { maximumFractionDigits: cent < 1 ? 2 : 1 })} Cent`;
}
