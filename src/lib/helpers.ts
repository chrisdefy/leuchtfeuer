import { scoreOf, type Scores } from "./benchmarks";
import { providerOf, type Model } from "./openrouter";
import { blendedPrice, isUncensored } from "./recommend";
import { candidate } from "./tiers";

/**
 * Models for the work behind the scenes: judging rooms, checking goals, titles, summaries, voices.
 * Like the levels, they are chosen from the live catalog and the benchmark scores at every start,
 * so newer models take over by themselves. The fixed lists elsewhere only serve while there are
 * no scores yet (first start, no key) or nothing in the catalog fits.
 */

let catalog: Model[] | null = null;
let scores: Map<string, Scores> | null = null;

/** Set by the app whenever the catalog or the scores change. */
export function setHelperData(models: Model[] | null, next: Map<string, Scores> | null) {
  catalog = models;
  scores = next;
}

export function helperCatalog() {
  return catalog;
}

/** Price ceilings in USD per 1M tokens (3:1 input to output), see `blendedPrice`. */
export const CAP = {
  /** Many short jobs: titles, room turns at the cheapest level. */
  cheap: 0.6,
  /** Checks and summaries that read a lot: goal check, gap check, director. */
  helper: 1.5,
  /** Room participants at the middle level. */
  balanced: 2,
  /** Runs once per conversation and should weigh well: judge, result protocol, top room level. */
  judge: 8,
};

/**
 * The smartest ordinary chat models up to `cap`, one per maker, smartest first.
 * Empty without scores, so callers fall back to their fixed lists.
 */
export function smartest(
  models: Model[] | null,
  cap: number,
  opts: { minContext?: number; avoidMakers?: Set<string>; count?: number } = {},
): string[] {
  if (!models || !scores) return [];
  const now = Date.now() / 1000;
  const iq = (m: Model) => scoreOf(m, scores)?.intelligence;
  const pool = models
    .filter(
      (m) =>
        candidate(m, now, isUncensored, models) &&
        iq(m) !== undefined &&
        blendedPrice(m) <= cap &&
        m.context_length >= (opts.minContext ?? 0) &&
        !opts.avoidMakers?.has(providerOf(m.id)),
    )
    .sort((a, b) => iq(b)! - iq(a)! || blendedPrice(a) - blendedPrice(b));
  const out: string[] = [];
  const makers = new Set<string>();
  for (const m of pool) {
    if (makers.has(providerOf(m.id))) continue;
    makers.add(providerOf(m.id));
    out.push(m.id);
    if (out.length === (opts.count ?? 1)) break;
  }
  return out;
}

/**
 * The newest model of a kind (e.g. Gemini voices, transcription), as long as the catalog lists it;
 * among those released close together the cheaper one, so a new "pro" version does not raise the price.
 */
export function newestOf(match: (m: Model) => boolean, fallback: string): string {
  const pool = (catalog ?? []).filter(match).sort((a, b) => b.created - a.created);
  if (!pool.length) return fallback;
  const generation = pool.filter((m) => pool[0].created - m.created < 180 * 86_400);
  return generation.sort((a, b) => blendedPrice(a) - blendedPrice(b))[0].id;
}
