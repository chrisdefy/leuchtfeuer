import type { Profile } from "./storage";
import { uid } from "./storage";
import { TIER_INFO } from "./tiers";
import { FUSION_INFO } from "./fusion";

/**
 * Profiles, after OpenRouter's presets: a named way of working (instruction, level, switches) that a chat
 * takes on with one tap. Useful for recurring kinds of questions, and for setting up Leuchtfeuer for someone else.
 */

export const LEVEL_OPTIONS: { value: NonNullable<Profile["level"]>; label: string }[] = [
  ...TIER_INFO.map((t) => ({ value: t.id, label: t.label })),
  { value: "best", label: FUSION_INFO.label },
];

/** "Standard · Websuche · Nachdenken gründlich" */
export function profileSummary(p: Profile) {
  const parts = [
    p.level && LEVEL_OPTIONS.find((o) => o.value === p.level)?.label,
    p.web && "Websuche",
    p.visualize && "Visualisieren",
    p.reasoning && `Nachdenken ${p.reasoning === "high" ? "gründlich" : "kurz"}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "nur Anweisung";
}

export function newProfile(from?: Omit<Profile, "id">): Profile {
  return { id: uid(), ...(from ?? { name: "Neues Profil", instruction: "", web: false, visualize: false }) };
}

/** Starting points, so nobody has to write an instruction from scratch. */
export const PROFILE_TEMPLATES: Omit<Profile, "id">[] = [
  {
    name: "Einfach erklärt",
    instruction:
      "Erkläre alles in einfachen, kurzen Sätzen ohne Fachbegriffe. Ist ein Fachwort nötig, erkläre es gleich mit. Anleitungen gibst du als nummerierte Schritte, ein Schritt pro Zeile. Ist etwas an der Frage unklar, frag kurz nach.",
    web: false,
    visualize: false,
  },
  {
    name: "Kurz und knapp",
    instruction:
      "Antworte so kurz wie möglich: zuerst die Antwort in einem Satz, dann höchstens drei Stichpunkte. Keine Einleitung, keine Wiederholung der Frage.",
    level: "light",
    web: false,
    visualize: false,
  },
  {
    name: "Recherche",
    instruction:
      "Suche aktuelle Informationen im Internet und stütze dich darauf. Nenne zu wichtigen Aussagen die Quelle. Trenne klar, was gesichert ist und was Einschätzung. Schließe mit einer Zusammenfassung in drei Sätzen.",
    level: "standard",
    web: true,
    visualize: false,
  },
  {
    name: "Wichtige Frage",
    instruction:
      "Es geht um etwas Wichtiges, etwa Gesundheit, Geld, Verträge oder Behörden. Sei gründlich und vorsichtig: Nenne Risiken und Alternativen, kennzeichne Unsicheres und sag deutlich, wann eine Fachperson wie Ärztin, Anwalt oder Steuerberaterin gefragt werden sollte.",
    level: "best",
    web: false,
    visualize: false,
    reasoning: "high",
  },
];
