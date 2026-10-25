import { scoreOf, type Scores } from "./benchmarks";
import { perMillion, providerOf, type Model } from "./openrouter";
import { blendedPrice } from "./recommend";
import { FRONTIER, PRICE_CAP, candidate, typicalAnswerUsd } from "./tiers";

/**
 * "Beste Antwort", after OpenRouter's Fusion: several strong models of different makers answer the same
 * question, then the smartest of them writes one answer from all of them. Different makers make different
 * mistakes, so the merge catches what a single model misses. Costs about four normal answers.
 */

export const TEAM_SIZE = 3;

export const FUSION_INFO = {
  label: "Beste Antwort",
  hint: "Drei starke Modelle verschiedener Hersteller antworten, das klügste macht daraus eine Antwort. Für wichtige Fragen.",
};

/**
 * The team: the smartest models up to the "Standard" price, one per maker, smartest first.
 * The first one also merges the answers. Without scores: the newest models of the big makers.
 */
export function fusionTeam(models: Model[] | null, scores: Map<string, Scores> | null, excluded: (m: Model) => boolean = () => false): string[] {
  if (!models) return [];
  const now = Date.now() / 1000;
  const pool = models.filter((m) => candidate(m, now, excluded) && blendedPrice(m) <= PRICE_CAP.standard);
  const iq = (m: Model) => scoreOf(m, scores)?.intelligence;
  const scored = pool.filter((m) => iq(m) !== undefined);
  const ranked = scored.length
    ? scored.sort((a, b) => iq(b)! - iq(a)! || blendedPrice(a) - blendedPrice(b))
    : pool.filter((m) => FRONTIER.some((v) => m.id.startsWith(v))).sort((a, b) => b.created - a.created);
  const team: string[] = [];
  const makers = new Set<string>();
  for (const m of ranked) {
    if (makers.has(providerOf(m.id))) continue;
    makers.add(providerOf(m.id));
    team.push(m.id);
    if (team.length === TEAM_SIZE) break;
  }
  return team.length >= 2 ? team : [];
}

/** Rough cost of one "Beste Antwort": a typical answer from each, plus the merge reading all of them. */
export function fusionAnswerUsd(team: Model[]): number | null {
  if (!team.length) return null;
  let sum = 0;
  for (const m of team) {
    const one = typicalAnswerUsd(m);
    if (one === null) return null;
    sum += one;
  }
  const p = perMillion(team[0].pricing.prompt)!;
  const c = perMillion(team[0].pricing.completion)!;
  // The merge reads the question plus every answer and writes a little more than one answer.
  return sum + ((2000 + 500 * team.length) * p + 600 * c) / 1_000_000;
}

const LETTERS = "ABCDEFGH";

/**
 * Added to the merging model's instruction. The answers come without model names, so it judges them
 * by content and does not favor its own.
 */
export function fusionBrief(answers: string[]): string {
  const blocks = answers.map((a, i) => `<antwort_${LETTERS[i]}>\n${a.trim()}\n</antwort_${LETTERS[i]}>`).join("\n\n");
  return `Zur letzten Nachricht des Nutzers haben ${answers.length} verschiedene KI-Modelle unabhängig voneinander geantwortet (unten, A bis ${LETTERS[answers.length - 1]}). Schreib daraus die beste Antwort an den Nutzer:
- Übernimm, was richtig, hilfreich und gut erklärt ist, egal aus welcher Antwort.
- Widersprechen sich die Antworten, prüfe, was stimmt. Lässt es sich nicht klären, sag das ehrlich und nenne die Sichtweisen.
- Korrigiere Fehler und ergänze Wichtiges, das allen fehlt.
- Schreib eine eigene, zusammenhängende Antwort direkt an den Nutzer, in seiner Sprache und nicht länger als nötig. Erwähne die Antworten A bis ${LETTERS[answers.length - 1]} und die anderen Modelle nicht.
- Diagramme, Code und Textkarten übernimmst du im selben Format, wenn sie helfen. Quellenangaben bleiben erhalten.

${blocks}`;
}
