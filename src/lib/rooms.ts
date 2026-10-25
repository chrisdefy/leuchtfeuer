import { useEffect, useRef, useState } from "react";
import { CAP, smartest } from "./helpers";
import { estimateTokens } from "./context";
import { perMillion, type ChatMessage, type Model, type Usage } from "./openrouter";
import { NATURAL_VOICES } from "./speech";

// ---- data -------------------------------------------------------------------

export type Length = "short" | "medium" | "long";
export type Order = "round" | "random" | "manual";
export type Pace = "step" | "slow" | "normal" | "fast";
export type Tier = "cheap" | "balanced" | "top";

export interface Participant {
  id: string;
  name: string;
  roleId: string;
  roleName: string;
  /** The hidden instruction that defines how this participant behaves. */
  rolePrompt: string;
  model: string;
  /** Index into the participant palette. */
  color: number;
  length: Length;
  temperature?: number;
  paused?: boolean;
  /** Speaks only in the final round (e.g. a jury). */
  finalOnly?: boolean;
  /** Leads the conversation: everyone else follows their directions on the process. */
  leads?: boolean;
  /** The human user taking part with a role. */
  human?: boolean;
  /** For picking a fitting voice: w(eiblich), m(ännlich), or unknown. */
  gender?: "w" | "m";
  /** Gemini voice for reading this participant's turns aloud. */
  voice?: string;
}

export interface RoomMessage {
  id: string;
  /** Participant id, or "system" for notes such as role changes and limits. */
  authorId: string;
  content: string;
  model?: string;
  usage?: Usage;
  error?: string;
  durationMs?: number;
  round: number;
  /** System note: the goal check found the goal reached. */
  goal?: boolean;
  createdAt: number;
}

export interface Room {
  id: string;
  title: string;
  scenarioId?: string;
  titleSource?: "auto" | "user";
  /** Folder in the sidebar, if sorted into one. */
  folderId?: string;
  topic: string;
  goal?: string;
  /** Who is who and how they relate to each other, one line per character; every participant sees it. */
  cast?: string;
  language: string;
  participants: Participant[];
  order: Order;
  pace: Pace;
  maxRounds: number;
  /** USD. */
  budget: number;
  /** Participants know they are AI models talking to other AI models. */
  aiAware: boolean;
  messages: RoomMessage[];
  /** 1-based; a round ends when every active AI participant has spoken once. */
  round: number;
  /** Participant ids that already spoke in the current round. */
  spoken: string[];
  /** Addressed by the leader or via @Name; speaks next. */
  nextUp?: string;
  /** The goal check confirmed the goal (or the user went on past it); no more checks. */
  goalMet?: boolean;
  /** Summary of messages before index `upTo`; turns then send only what follows verbatim. */
  memory?: { text: string; upTo: number };
  /** Each finished turn is read aloud in the participant's own voice before the next one starts. */
  readAloud?: boolean;
  /** Judge model chosen by hand; missing = picked automatically from another maker than the participants. */
  judge?: string;
  /** The judge's evaluation, conclusion and lessons, plus the conversation about it afterwards. */
  review?: Review;
  createdAt: number;
  updatedAt: number;
}

export interface Review {
  model: string;
  text: string;
  /** The judge's advice: talk on, or the conversation has done its job. */
  verdict?: "continue" | "done";
  /** Follow-up questions to the judge and its answers. */
  talk: { role: "user" | "assistant"; content: string }[];
  cost: number;
  /** Contributions in the room when the review was written (see `contributions`); newer ones make it outdated. */
  atMessages: number;
}

export const SYSTEM = "system";

/** Spoken contributions, without notes; a review is outdated once there are more than it saw. */
export function contributions(room: Pick<Room, "messages">) {
  return room.messages.filter((m) => m.authorId !== SYSTEM && m.content).length;
}
/** The user stepping in without a role of their own. */
export const HOST = "host";

export const LENGTHS: Record<Length, { label: string; words: string; tokens: number; cap: number }> = {
  short: { label: "Kurz", words: "höchstens 2 bis 3 Sätze", tokens: 150, cap: 700 },
  medium: { label: "Mittel", words: "höchstens ein kurzer Absatz, etwa 60 bis 120 Wörter", tokens: 400, cap: 1500 },
  long: { label: "Lang", words: "höchstens etwa 250 Wörter", tokens: 1000, cap: 3000 },
};

export const PACES: Record<Pace, { label: string; delayMs: number | null; hint: string }> = {
  step: { label: "Schritt für Schritt", delayMs: null, hint: "Jeder Zug muss freigegeben werden" },
  slow: { label: "Langsam", delayMs: 20_000, hint: "20 s Pause zum Mitlesen" },
  normal: { label: "Normal", delayMs: 5_000, hint: "5 s Pause" },
  fast: { label: "Schnell", delayMs: 0, hint: "Ohne Pause" },
};

export const ORDERS: Record<Order, string> = {
  round: "Reihum",
  random: "Zufällig",
  manual: "Manuell (du wählst, wer spricht)",
};

/** Accessible, distinct hues that work on light and dark backgrounds. */
export const PALETTE = ["#2447F0", "#0E7C72", "#B4462A", "#7A3FC4", "#A86A00", "#1F7A3A"];

// ---- models -----------------------------------------------------------------

export const TIERS: Record<Tier, { label: string; models: string[] }> = {
  cheap: { label: "Günstig", models: ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna", "z-ai/glm-5.3-flash"] },
  balanced: { label: "Ausgewogen", models: ["mistralai/mistral-large-4-0", "deepseek/deepseek-v4-pro-0813"] },
  top: {
    label: "Spitze",
    models: ["anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol", "google/gemini-4-argon", "x-ai/grok-4.7"],
  },
};

/** Price ceiling per room level; the smartest models below it are handed out. */
const TIER_CAP: Record<Tier, number> = { cheap: CAP.cheap, balanced: CAP.balanced, top: CAP.judge };

/**
 * Models of a tier: the four smartest up to the tier's price, one per maker, so different vendors meet
 * when they are handed out in turn. The fixed lists above serve while there are no benchmark scores.
 */
export function tierModels(tier: Tier, models: Model[] | null) {
  const auto = smartest(models, TIER_CAP[tier], { count: 4 });
  if (auto.length) return auto;
  const ids = new Set((models ?? []).map((m) => m.id));
  const listed = TIERS[tier].models.filter((id) => !models || ids.has(id));
  return listed.length ? listed : TIERS.cheap.models;
}

// ---- roles ------------------------------------------------------------------

export interface Role {
  id: string;
  name: string;
  summary: string;
  prompt: string;
  finalOnly?: boolean;
  /** Leading roles take over the conversation's process when they join. */
  leads?: boolean;
}

export const ROLES: Role[] = [
  {
    id: "moderator",
    name: "Moderator",
    summary: "Leitet: lenkt, fasst zusammen, hält das Ziel im Blick",
    leads: true,
    prompt:
      "Du leitest das Gespräch. Du bringst es voran, statt selbst Inhalte zu liefern. Fasse in ein, zwei Sätzen den Stand zusammen, wenn es unübersichtlich wird. Stelle gezielte Fragen an einzelne Teilnehmer und sprich sie mit Namen an. Wenn sich das Gespräch im Kreis dreht oder alle sich nur zustimmen, benenne das und lenke auf offene Punkte. Behalte das Ziel im Blick und sage, wann es erreicht scheint.",
  },
  {
    id: "ideas",
    name: "Ideengeber",
    summary: "Viele, auch ungewöhnliche Ideen, baut auf anderen auf",
    prompt:
      "Du bringst Ideen ein: mehrere, konkrete, auch ungewöhnliche. Baue auf Vorschlägen der anderen auf und führe sie weiter („Und wenn wir das mit … verbinden?“). Bewerte deine eigenen Ideen nicht sofort, das übernehmen andere. Vermeide Allgemeinplätze. Nenne lieber ein greifbares Beispiel als drei vage Richtungen.",
  },
  {
    id: "critic",
    name: "Kritiker",
    summary: "Sucht Schwächen, Risiken und Gegenbeispiele",
    prompt:
      "Du prüfst kritisch. Suche bei jedem Vorschlag die schwächste Stelle: Risiken, falsche Annahmen, Gegenbeispiele, Kosten. Bleib sachlich und konkret, nie abwertend. Begründe jeden Einwand in einem Satz. Gibt es keinen ernsthaften Einwand, sage das ehrlich, statt einen zu erfinden. Wenn möglich, nenne, was den Vorschlag retten würde.",
  },
  {
    id: "pragmatist",
    name: "Pragmatiker",
    summary: "Prüft Machbarkeit, Aufwand und nächste Schritte",
    prompt:
      "Du denkst an die Umsetzung. Frage, was etwas kostet, wie lange es dauert, wer es macht und was der erste Schritt ist. Mache aus Ideen konkrete Schritte. Wenn etwas nicht machbar ist, schlage eine kleinere Version vor, die es ist. Kurze Sätze, keine Theorie.",
  },
  {
    id: "visionary",
    name: "Visionär",
    summary: "Denkt zehn Jahre voraus, stellt Annahmen infrage",
    prompt:
      "Du denkst weit voraus. Frage, wie das Thema in zehn Jahren aussieht und welche Annahmen dann nicht mehr gelten. Stelle Selbstverständlichkeiten infrage. Bringe überraschende Perspektiven ein, aber bleib nachvollziehbar und begründe kurz, warum eine Entwicklung plausibel ist.",
  },
  {
    id: "provocateur",
    name: "Provokateur",
    summary: "Spitzt zu, reagiert emotional, provoziert ohne zu beleidigen",
    prompt:
      "Du spitzt zu. Du vertrittst deine Sicht emotional und mit Nachdruck, übertreibst gern und reagierst gereizt auf Widerspruch. Du darfst unbequem und laut sein. Grenze: keine Beleidigungen, keine Herabwürdigung von Menschen oder Gruppen, keine Drohungen. Bleib in der Rolle, auch wenn andere beschwichtigen. Lenke nur ein, wenn dein Gegenüber dein eigentliches Anliegen wirklich verstanden hat.",
  },
  {
    id: "nvc",
    name: "Mediator (GFK)",
    summary: "Leitet: vermittelt mit gewaltfreier Kommunikation",
    leads: true,
    prompt:
      "Du vermittelst nach der gewaltfreien Kommunikation. Du benennst Beobachtungen ohne Bewertung, fragst nach Gefühlen und den Bedürfnissen dahinter und formulierst konkrete, erfüllbare Bitten. Du ergreifst keine Partei. Du übersetzt Vorwürfe in Bedürfnisse („Ich höre, dass dir Verlässlichkeit wichtig ist“). Bleib ruhig und warm, auch bei Angriffen, und frage nach, ob du richtig verstanden hast.",
  },
  {
    id: "interviewer",
    name: "Interviewer",
    summary: "Leitet: fragt nach, hakt ein, eine Frage nach der anderen",
    leads: true,
    prompt:
      "Du führst ein Interview. Stelle jeweils genau eine klare Frage an eine bestimmte Person und sprich sie mit Namen an. Hake nach, wenn eine Antwort ausweicht, vage bleibt oder sich widerspricht. Fasse Antworten gelegentlich in einem Satz zusammen, bevor du weiterfragst. Gib keine eigenen Meinungen ab und bewerte nicht. Ziel ist, dass die Gesprächspartner ihre Sicht so klar und konkret wie möglich darlegen.",
  },
  {
    id: "pro",
    name: "Pro",
    summary: "Vertritt eine Position überzeugt und mit Argumenten",
    prompt:
      "Du vertrittst die Pro-Seite zum Thema. Bringe pro Beitrag ein starkes Argument mit Begründung oder Beispiel. Gehe auf das stärkste Gegenargument direkt ein und entkräfte es. Bleib bei deiner Position, auch wenn Gegenargumente gut sind, aber räume berechtigte Punkte fair ein.",
  },
  {
    id: "contra",
    name: "Contra",
    summary: "Vertritt die Gegenposition überzeugt und mit Argumenten",
    prompt:
      "Du vertrittst die Contra-Seite zum Thema. Bringe pro Beitrag ein starkes Argument mit Begründung oder Beispiel. Gehe auf das stärkste Argument der Gegenseite direkt ein und entkräfte es. Bleib bei deiner Position, auch wenn Gegenargumente gut sind, aber räume berechtigte Punkte fair ein.",
  },
  {
    id: "jury",
    name: "Jury",
    summary: "Wägt ab und urteilt begründet, spricht erst am Ende",
    finalOnly: true,
    prompt:
      "Du bist die Jury. Du hast bisher nur zugehört. Wäge jetzt die vorgebrachten Argumente beider Seiten ab, nenne die zwei bis drei stärksten und schwächsten Punkte und fälle ein klares, begründetes Urteil. Bewerte Argumente, nicht Personen. Bleib unparteiisch.",
  },
  {
    id: "factcheck",
    name: "Faktenprüfer",
    summary: "Prüft Behauptungen, kennzeichnet Unsicheres",
    prompt:
      "Du prüfst Behauptungen. Greife konkrete Aussagen der anderen auf und sage, ob sie stimmen, zweifelhaft oder nicht überprüfbar sind, mit kurzer Begründung. Kennzeichne Unsicherheit ausdrücklich („Ich bin mir nicht sicher, ob …“). Erfinde keine Quellen oder Zahlen. Wenn alles stimmt, sage das knapp.",
  },
  {
    id: "layperson",
    name: "Laie",
    summary: "Stellt einfache Fragen, verlangt Verständlichkeit",
    prompt:
      "Du bist interessiert, aber kein Fachmann. Frage nach, wenn etwas unverständlich ist oder Fachbegriffe fallen. Fasse in eigenen Worten zusammen, was du verstanden hast, und frage, ob das stimmt. Sage ehrlich, was dich überzeugt und was nicht. Deine Fragen sind einfach, aber nicht dumm.",
  },
];

export const CUSTOM_ROLE = "custom";

export function roleById(id: string) {
  return ROLES.find((r) => r.id === id);
}

// ---- scenarios --------------------------------------------------------------

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  roles: string[];
  order: Order;
  goal: string;
  topicHint: string;
  maxRounds: number;
  budget: number;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "ideas",
    name: "Ideenfindung",
    summary: "Mehrere Ideengeber, ein Kritiker, ein Moderator",
    roles: ["moderator", "ideas", "ideas", "critic"],
    order: "round",
    goal: "Fünf Ideen, bewertet nach Nutzen und Aufwand",
    topicHint: "Zum Beispiel: Wie gewinnt ein kleines Café mehr Stammgäste?",
    maxRounds: 6,
    budget: 0.5,
  },
  {
    id: "conflict",
    name: "Streitgespräch mit Schlichtung",
    summary: "Provokateur und Gegenpart, ein Vermittler mit gewaltfreier Kommunikation",
    roles: ["provocateur", "contra", "nvc"],
    order: "round",
    goal: "Beide Seiten benennen ihr Bedürfnis und eine konkrete Bitte",
    topicHint: "Zum Beispiel: Streit unter Nachbarn über laute Musik am Wochenende",
    maxRounds: 8,
    budget: 0.5,
  },
  {
    id: "review",
    name: "Prüfrunde",
    summary: "Ein Autor, ein Kritiker, ein Faktenprüfer",
    roles: ["ideas", "critic", "factcheck"],
    order: "round",
    goal: "Eine überarbeitete Fassung, gegen die der Kritiker keine Einwände mehr hat",
    topicHint: "Zum Beispiel: Ein Werbetext für eine Yoga-Schule",
    maxRounds: 4,
    budget: 0.5,
  },
  {
    id: "debate",
    name: "Debatte",
    summary: "Pro gegen Contra, eine Jury urteilt am Ende",
    roles: ["pro", "contra", "jury"],
    order: "round",
    goal: "Ein begründetes Urteil der Jury",
    topicHint: "Zum Beispiel: Sollte die Vier-Tage-Woche Standard werden?",
    maxRounds: 4,
    budget: 0.3,
  },
  {
    id: "experts",
    name: "Expertenrunde",
    summary: "Moderator, Visionär, Pragmatiker und ein Laie",
    roles: ["moderator", "visionary", "pragmatist", "layperson"],
    order: "round",
    goal: "Eine Empfehlung mit Vor- und Nachteilen",
    topicHint: "Zum Beispiel: Lohnt sich eine Solaranlage auf dem Mietshaus?",
    maxRounds: 5,
    budget: 0.5,
  },
];

const NAMES = ["Mara", "Jonas", "Lea", "Tarik", "Ines", "Ben"];

export function makeParticipant(roleId: string, index: number, model: string): Participant {
  const role = roleById(roleId) ?? ROLES[1];
  return {
    id: crypto.randomUUID(),
    name: NAMES[index % NAMES.length],
    roleId: role.id,
    roleName: role.name,
    rolePrompt: role.prompt,
    model,
    color: index % PALETTE.length,
    length: "medium",
    finalOnly: role.finalOnly,
    leads: role.leads,
  };
}

export function leaderOf(room: Pick<Room, "participants">) {
  return room.participants.find((p) => p.leads && !p.paused);
}

/** At most one leader: giving `id` the lead takes it from everyone else. */
export function withLeader(participants: Participant[], id: string | null) {
  return participants.map((p) => ({ ...p, leads: p.id === id }));
}

// ---- turn order -------------------------------------------------------------

/** Who takes part in this round: everyone not paused; final-only roles wait for the last round. */
export function eligible(room: Room) {
  return room.participants.filter((p) => !p.paused && (!p.finalOnly || room.round >= room.maxRounds));
}

export function lastSpeaker(room: Room) {
  for (let i = room.messages.length - 1; i >= 0; i--) {
    const a = room.messages[i].authorId;
    if (a !== SYSTEM && a !== HOST) return a;
  }
  return undefined;
}

/** Next speaker (AI or the human participant) for automatic orders. */
export function nextSpeaker(room: Room): Participant | undefined {
  // Whoever was addressed answers next, even if they already spoke this round.
  const addressed = room.nextUp && eligible(room).find((p) => p.id === room.nextUp);
  if (addressed) return addressed;
  const waiting = eligible(room).filter((p) => !room.spoken.includes(p.id));
  if (!waiting.length) return undefined;
  // The leader opens every round so it can steer before the others speak.
  const leader = waiting.find((p) => p.leads);
  if (leader) return leader;
  if (room.order === "random") {
    const last = lastSpeaker(room);
    const pool = waiting.length > 1 ? waiting.filter((p) => p.id !== last) : waiting;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return waiting[0];
}

/** Record that `id` spoke; closes the round once everyone eligible has. */
export function afterTurn(room: Room, id: string): Pick<Room, "round" | "spoken" | "nextUp"> {
  const spoken = room.spoken.includes(id) ? room.spoken : [...room.spoken, id];
  const nextUp = room.nextUp === id ? undefined : room.nextUp;
  const done = eligible(room).every((p) => spoken.includes(p.id));
  return done ? { round: room.round + 1, spoken: [], nextUp } : { round: room.round, spoken, nextUp };
}

/**
 * Who a message hands the word to: an explicit @Name wins, otherwise (for the leader)
 * the participant named last, which is usually the one the closing question goes to.
 */
export function addressee(room: Room, authorId: string, text: string, byName: boolean): string | undefined {
  const others = room.participants.filter((p) => p.id !== authorId && !p.paused && p.name.trim());
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const m of [...text.matchAll(/@([\p{L}\p{N}_-]+)/gu)].reverse()) {
    const hit = others.find((p) => p.name.toLowerCase() === m[1].toLowerCase());
    if (hit) return hit.id;
  }
  if (!byName) return undefined;
  let best: { id: string; at: number } | undefined;
  for (const p of others) {
    const re = new RegExp(`(^|[^\\p{L}])${esc(p.name)}(?![\\p{L}])`, "gu");
    for (const m of text.matchAll(re)) {
      if (!best || (m.index ?? 0) > best.at) best = { id: p.id, at: m.index ?? 0 };
    }
  }
  return best?.id;
}

export function roomCost(room: Room) {
  return room.messages.reduce((n, m) => n + (m.usage?.cost ?? 0), 0);
}

export function participantCost(room: Room, id: string) {
  return room.messages.filter((m) => m.authorId === id).reduce((n, m) => n + (m.usage?.cost ?? 0), 0);
}

/** The run is over once the last round has been completed. */
export function roundsDone(room: Room) {
  return room.round > room.maxRounds;
}

// ---- prompts ----------------------------------------------------------------

const MAX_HISTORY_TOKENS = 48_000;

function describe(p: Participant) {
  return `${p.name}, ${p.roleName}${p.human ? ", ein Mensch" : ""}`;
}

/**
 * What one participant sees: its role, the room rules, and the conversation so far.
 * Its own turns are its answers; everyone else's arrive as named user messages.
 * Without the names, models start writing other people's lines.
 */
export function turnMessages(room: Room, me: Participant, model?: Model): ChatMessage[] {
  const others = room.participants.filter((p) => p.id !== me.id);
  const human = room.participants.find((p) => p.human);
  const awareness = room.aiAware
    ? `Du bist ein KI-Modell. ${human ? `Alle anderen außer ${human.name} sind ebenfalls KI-Modelle.` : "Alle anderen Teilnehmer sind ebenfalls KI-Modelle."} Ihr dürft das offen ansprechen.`
    : "Bleib vollständig in deiner Rolle und sprich die anderen als Menschen an. Erwähne nicht, dass du eine KI bist.";

  const leader = leaderOf(room);
  const authority = !leader
    ? ""
    : leader.id === me.id
      ? `Du leitest dieses Gespräch. Alle anderen folgen deinen Anweisungen zum Ablauf. Nutze das: Bestimme, worüber gesprochen wird, fasse zusammen, wenn es unübersichtlich wird, und lenke auf das Ziel. Beende jeden Beitrag mit einer Frage oder Aufgabe an genau eine Person und nenne sie dabei mit Namen, diese Person spricht als Nächstes. Meinungen anderer kannst du nicht anordnen, nur den Ablauf.`
      : `${leader.name} (${leader.roleName}${leader.human ? ", ein Mensch" : ""}) leitet dieses Gespräch. Folge den Anweisungen von ${leader.name} zum Ablauf sofort: Beantworte Fragen von ${leader.name} direkt und als Erstes, halte dich an Themenvorgaben und Redezeiten. Deine Haltung, Meinung und Gefühle in deiner Rolle behältst du aber, bis du wirklich überzeugt bist. Gib nicht nach, nur weil ${leader.name} die Leitung hat.`;

  const system = [
    `Du nimmst an einem Gespräch mit mehreren Teilnehmern teil. Dein Name ist ${me.name}, deine Rolle: ${me.roleName}.`,
    me.rolePrompt,
    authority,
    `Thema: ${room.topic}`,
    room.goal ? `Ziel des Gesprächs: ${room.goal}` : "",
    `Weitere Teilnehmer: ${others.map(describe).join(", ")}.`,
    room.cast ? `Wer ist wer und wie ihr zueinander steht (handle danach, auch wenn es niemand ausspricht):\n${room.cast}` : "",
    awareness,
    [
      "Regeln:",
      "- Sprich nur für dich selbst. Schreibe nie Beiträge, Antworten oder Reaktionen anderer Teilnehmer und kein Drehbuch.",
      "- Beginne ohne deinen Namen, ohne Präfix und ohne Regieanweisungen in Klammern.",
      `- Länge: ${LENGTHS[me.length].words}. Es ist ein Gespräch, kein Aufsatz.`,
      "- Beziehe dich auf das zuletzt Gesagte und sprich andere mit Namen an. Wiederhole nichts, was schon gesagt wurde.",
      `- Sprache: ${room.language}.`,
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  // Newest turns first until the budget is used; long rooms drop their oldest turns.
  const limit = Math.min(MAX_HISTORY_TOKENS, Math.floor((model?.context_length ?? 128_000) * 0.5));
  const byId = new Map(room.participants.map((p) => [p.id, p]));
  const kept: { role: "user" | "assistant"; content: string }[] = [];
  let used = estimateTokens(system) + (room.memory ? estimateTokens(room.memory.text) : 0);
  let dropped = false;
  const start = room.memory?.upTo ?? 0;
  for (let i = room.messages.length - 1; i >= start; i--) {
    const m = room.messages[i];
    if (m.authorId === SYSTEM || !m.content) continue;
    const author = byId.get(m.authorId);
    const label = m.authorId === HOST ? "Gesprächsleitung, ein Mensch" : author ? describe(author) : "Teilnehmer";
    const entry =
      m.authorId === me.id
        ? { role: "assistant" as const, content: m.content }
        : { role: "user" as const, content: `[${label}]: ${m.content}` };
    used += estimateTokens(entry.content);
    if (used > limit) {
      dropped = true;
      break;
    }
    kept.unshift(entry);
  }

  const opening = room.memory
    ? `[Gesprächsleitung]: Thema: ${room.topic}\n\nZusammenfassung des bisherigen Gesprächs:\n${room.memory.text}\n\nEs folgen die letzten Beiträge im Wortlaut.${dropped ? " Einige ältere davon sind ausgelassen." : ""}`
    : `[Gesprächsleitung]: Das Gespräch beginnt. Thema: ${room.topic}${dropped ? "\n(Ältere Beiträge sind ausgelassen, weil das Gespräch sehr lang ist.)" : ""}`;
  const cue = `[Gesprächsleitung]: ${me.name}, du bist dran.`;
  const turns = [{ role: "user" as const, content: opening }, ...kept, { role: "user" as const, content: cue }];

  // Several providers require alternating roles; merge neighbours of the same role.
  const merged: { role: "user" | "assistant"; content: string }[] = [];
  for (const t of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === t.role) prev.content += `\n\n${t.content}`;
    else merged.push({ ...t });
  }
  return [{ role: "system", content: system }, ...merged];
}

/** Rough USD for one turn of `p` given the room so far. */
export function estimateTurnCost(room: Room, p: Participant, model?: Model) {
  if (!model) return 0;
  const inP = perMillion(model.pricing.prompt) ?? 0;
  const outP = perMillion(model.pricing.completion) ?? 0;
  const input = 600 + Math.min(MAX_HISTORY_TOKENS, room.messages.reduce((n, m) => n + estimateTokens(m.content), 0));
  return (input * inP + LENGTHS[p.length].tokens * outP) / 1_000_000;
}

export function estimateRoundCost(room: Room, byId: Map<string, Model>) {
  return eligible(room)
    .filter((p) => !p.human)
    .reduce((n, p) => n + estimateTurnCost(room, p, byId.get(p.model)), 0);
}

// ---- persistence ------------------------------------------------------------

const KEY = "router.rooms.v1";

export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(rooms));
      } catch {
        /* storage full; rooms stay in memory */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [rooms]);
  return [rooms, setRooms] as const;
}

// ---- goal check & protocol ----------------------------------------------------

/** Transcript as plain text for checks and protocols. */
export function transcript(room: Room, maxTokens = 60_000) {
  const byId = new Map(room.participants.map((p) => [p.id, p]));
  const lines: string[] = [];
  let used = 0;
  for (let i = room.messages.length - 1; i >= 0; i--) {
    const m = room.messages[i];
    if (m.authorId === SYSTEM || !m.content) continue;
    const who = m.authorId === HOST ? "Gesprächsleitung (Mensch)" : byId.get(m.authorId) ? describe(byId.get(m.authorId)!) : "Teilnehmer";
    const line = `${who}: ${m.content}`;
    used += estimateTokens(line);
    if (used > maxTokens) break;
    lines.unshift(line);
  }
  return lines.join("\n\n");
}

export function goalCheckMessages(room: Room): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        'Du prüfst neutral, ob ein Gespräch sein Ziel erreicht hat. Antworte ausschließlich mit JSON: {"erreicht": true|false, "begruendung": "ein Satz auf Deutsch"}. Erreicht heißt: Das Ziel ist im Gespräch tatsächlich und konkret erfüllt, nicht nur angekündigt oder teilweise.',
    },
    { role: "user", content: `Thema: ${room.topic}\nZiel: ${room.goal}\n\nGespräch:\n${transcript(room)}` },
  ];
}

export function parseGoalCheck(text: string): { reached: boolean; reason: string } | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return { reached: v.erreicht === true, reason: String(v.begruendung ?? "").trim() };
  } catch {
    return null;
  }
}

export function protocolMessages(room: Room): ChatMessage[] {
  return [
    {
      role: "system",
      content: `Du schreibst ein knappes Ergebnisprotokoll eines Gesprächs auf Deutsch, in Markdown mit diesen Abschnitten:
## Kernpunkte
## Einigungen
## Offene Punkte
${room.goal ? "## Ziel\nWurde das Ziel erreicht? Ein bis zwei Sätze, und wenn nicht: woran es gehangen hat." : ""}
## Empfehlung
Was jetzt als Nächstes sinnvoll ist, in zwei bis vier konkreten Schritten: ${room.goal ? "Ist das Ziel nicht erreicht, wie man es noch erreichen kann (z. B. welche Frage zuerst geklärt werden muss, welcher Kompromiss naheliegt, wer auf wen zugehen sollte). Ist es erreicht, was jetzt umzusetzen oder festzuhalten ist." : "Was aus dem Gespräch umzusetzen ist und welche offenen Punkte zuerst geklärt werden sollten."} Ist das Gespräch die Probe für eine echte Situation, schließe mit einem Rat, wie man sie angehen sollte.
In den ersten Abschnitten Stichpunkte, jeder Punkt ein Satz, mit Namen, wer was vertreten hat; dort nichts hinzufügen, was nicht gesagt wurde. Die Empfehlung ist deine eigene Einschätzung und darf darüber hinausgehen.`,
    },
    {
      role: "user",
      content: `Thema: ${room.topic}${room.goal ? `\nZiel: ${room.goal}` : ""}${room.cast ? `\nWer ist wer:\n${room.cast}` : ""}\n\nGespräch:\n${transcript(room)}`,
    },
  ];
}

// ---- memory for long rooms (F10) ---------------------------------------------------

/** Above this, older turns are summarized so every participant keeps the overview. */
const MEMORY_AT_TOKENS = 24_000;
/** The newest turns always stay verbatim. */
const KEEP_VERBATIM = 8;

export function needsMemory(room: Room) {
  const start = room.memory?.upTo ?? 0;
  const pending = room.messages.slice(start).filter((m) => m.authorId !== SYSTEM && m.content);
  return pending.length > KEEP_VERBATIM + 4 && pending.reduce((n, m) => n + estimateTokens(m.content), 0) > MEMORY_AT_TOKENS;
}

/** Messages that fold everything before the last few turns into one summary. */
export function memoryRequest(room: Room): { messages: ChatMessage[]; upTo: number } {
  const byId = new Map(room.participants.map((p) => [p.id, p]));
  let kept = 0;
  let upTo = room.messages.length;
  for (let i = room.messages.length - 1; i >= 0 && kept < KEEP_VERBATIM; i--) {
    if (room.messages[i].authorId !== SYSTEM && room.messages[i].content) kept++;
    upTo = i;
  }
  const start = room.memory?.upTo ?? 0;
  const text = room.messages
    .slice(start, upTo)
    .filter((m) => m.authorId !== SYSTEM && m.content)
    .map((m) => {
      const p = byId.get(m.authorId);
      return `${m.authorId === HOST ? "Gesprächsleitung (Mensch)" : p ? describe(p) : "Teilnehmer"}: ${m.content}`;
    })
    .join("\n\n");
  return {
    upTo,
    messages: [
      {
        role: "system",
        content:
          "Du fasst ein laufendes Gespräch mehrerer Teilnehmer zusammen, damit es nahtlos weitergehen kann. Halte fest, mit Namen: wer welche Position vertritt und wie sie sich entwickelt hat, worauf man sich geeinigt hat, welche Fragen offen sind und welche Anweisungen der Gesprächsleitung noch gelten. Zahlen, Namen und Zusagen exakt übernehmen. Nichts hinzufügen. Stichpunkte, höchstens 350 Wörter, auf Deutsch.",
      },
      {
        role: "user",
        content: `Thema: ${room.topic}${room.goal ? `\nZiel: ${room.goal}` : ""}${room.memory ? `\n\nBisherige Zusammenfassung:\n${room.memory.text}` : ""}\n\nNeue Beiträge seitdem:\n${text}`,
      },
    ],
  };
}

// ---- judge: evaluation, conclusion, lessons ---------------------------------------

/**
 * Judges in order of preference: strong models that weigh arguments well, for the evaluation, the follow-up
 * questions and the result protocol. They run once per conversation, so quality matters more than price.
 * The first one from a maker no participant uses is taken, so it does not just confirm its own patterns.
 */
const JUDGES = [
  "anthropic/claude-sonnet-5.5",
  "openai/gpt-6.1-sol",
  "google/gemini-4-argon",
  "x-ai/grok-4.7",
  "google/gemini-3.8-flash",
  "deepseek/deepseek-v4.1-flash",
];

/** The goal check runs after every round; a cheap, quick model is enough for a yes or no. */
const GOAL_CHECKERS = [
  "google/gemini-3.8-flash",
  "deepseek/deepseek-v4.1-flash",
  "anthropic/claude-haiku-5.5",
  "openai/gpt-6-luna",
];

const maker = (id: string) => id.split("/")[0];

/** First model of `list` that exists and comes from a maker none of the participants uses. */
function outsider(list: string[], room: Pick<Room, "participants">, models: Model[] | null) {
  const ids = new Set((models ?? []).map((m) => m.id));
  const used = new Set(room.participants.filter((p) => !p.human).map((p) => maker(p.model)));
  const available = list.filter((id) => !models || ids.has(id));
  return available.find((id) => !used.has(maker(id))) ?? available[0] ?? room.participants.find((p) => !p.human)?.model ?? list[0];
}

const usedMakers = (room: Pick<Room, "participants">) => new Set(room.participants.filter((p) => !p.human).map((p) => maker(p.model)));

/** The judge: chosen by hand, else the smartest model up to the judge's price from another maker. */
export function judgeOf(room: Pick<Room, "judge" | "participants">, models: Model[] | null): string {
  const ids = new Set((models ?? []).map((m) => m.id));
  if (room.judge && (!models || ids.has(room.judge))) return room.judge;
  return smartest(models, CAP.judge, { avoidMakers: usedMakers(room) })[0] ?? outsider(JUDGES, room, models);
}

/** The goal check: the smartest affordable model with room for the whole conversation, from another maker. */
export function goalCheckerOf(room: Pick<Room, "participants">, models: Model[] | null): string {
  return smartest(models, CAP.helper, { avoidMakers: usedMakers(room), minContext: 80_000 })[0] ?? outsider(GOAL_CHECKERS, room, models);
}

const VERDICT = /\n?\s*EMPFEHLUNG:\s*(WEITER|FERTIG)\s*$/i;

/** The review text without the closing marker, and the advice it carried. */
export function parseReview(text: string): { text: string; verdict?: "continue" | "done" } {
  const hit = VERDICT.exec(text.trim());
  if (!hit) return { text: text.trim() };
  return { text: text.trim().replace(VERDICT, "").trim(), verdict: hit[1].toUpperCase() === "WEITER" ? "continue" : "done" };
}

function reviewSystem(room: Room) {
  const human = room.participants.find((p) => p.human);
  return `Du bist ein unabhängiger, erfahrener Beobachter. Du hast an dem folgenden Gespräch nicht teilgenommen und bewertest es fair, nur nach dem, was gesagt wurde. Schreib auf Deutsch, in Markdown, mit genau diesen Abschnitten:

## Ergebnis
Ist das Gespräch zu einem Ergebnis gekommen${room.goal ? " und ist das Ziel erreicht" : ""}? Reichen die gespielten Runden, oder würde es sich lohnen weiterzumachen, und worauf sollte es dann hinauslaufen?

## Verlauf
Wer hat überzeugender argumentiert und warum? Wo ist das Gespräch gekippt oder hat sich gedreht? Nenne Namen und gib die entscheidenden Aussagen kurz wieder.

## Fazit
Zwei bis drei Sätze.

## Was du daraus lernen kannst
Drei bis fünf übertragbare Erkenntnisse für eine echte Situation dieser Art: wie man sich verhält, was man sagt und was man besser vermeidet. Konkret, mit je einem Beispielsatz.${human ? ` ${human.name} ist ein Mensch, der hier geübt hat: Sprich ihn oder sie direkt mit „du“ an und gib auch Rückmeldung zu den eigenen Beiträgen.` : ""}

Die letzte Zeile lautet genau „EMPFEHLUNG: WEITER“, wenn sich weitere Runden lohnen, sonst „EMPFEHLUNG: FERTIG“.`;
}

function reviewContext(room: Room) {
  const played = Math.min(room.round - (room.spoken.length ? 0 : 1), room.maxRounds);
  return `Thema: ${room.topic}${room.goal ? `\nZiel: ${room.goal}` : ""}${room.cast ? `\nWer ist wer:\n${room.cast}` : ""}\nGespielte Runden: ${Math.max(played, 1)} von ${room.maxRounds}\nTeilnehmer: ${room.participants.map(describe).join("; ")}\n\nGespräch:\n${transcript(room)}`;
}

export function reviewMessages(room: Room): ChatMessage[] {
  return [
    { role: "system", content: reviewSystem(room) },
    { role: "user", content: reviewContext(room) },
  ];
}

/** Talking to the judge about its review: it keeps the conversation and its own evaluation in view. */
export function reviewTalkMessages(room: Room, review: Review, question: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Du hast das folgende Gespräch als unabhängiger Beobachter bewertet. Jetzt stellt dir der Nutzer Rückfragen dazu: zur Bewertung, zu einzelnen Teilnehmern oder wie er sich selbst in so einer Situation verhalten sollte. Antworte ehrlich, konkret und auf Deutsch, eher kurz. Gib bei Bedarf Formulierungen zum Üben.",
    },
    { role: "user", content: reviewContext(room) },
    { role: "assistant", content: review.text },
    ...review.talk,
    { role: "user", content: question },
  ];
}

// ---- scenario assistant: a situation in, roles out ------------------------------------

export interface GeneratedScenario {
  title: string;
  topic: string;
  goal: string;
  maxRounds: number;
  order: Order;
  participants: {
    name: string;
    roleName: string;
    rolePrompt: string;
    relation?: string;
    leads?: boolean;
    finalOnly?: boolean;
    human?: boolean;
    gender?: "w" | "m";
  }[];
}

/** "- Name (Rolle): relation" per character, the form `Room.cast` uses. */
export function castText(people: { name: string; roleName: string; relation?: string }[]) {
  return people
    .filter((p) => p.relation?.trim())
    .map((p) => `- ${p.name} (${p.roleName}): ${p.relation!.trim()}`)
    .join("\n");
}

export function scenarioMessages(situation: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `Du bereitest eine Gesprächssimulation mit mehreren KI-Teilnehmern vor. Der Nutzer beschreibt nur die Situation. Du entwirfst daraus ein lebendiges, realistisches Szenario. Antworte ausschließlich mit JSON in genau dieser Form:
{
  "titel": "kurzer Titel, höchstens 6 Wörter",
  "thema": "Ausgangslage in zwei bis vier Sätzen: wer, wo, worum es geht, was gerade passiert ist",
  "ziel": "woran man erkennt, dass das Gespräch fertig ist",
  "runden": Zahl zwischen 3 und 10,
  "reihenfolge": "round" oder "random",
  "teilnehmer": [
    {
      "name": "Vorname",
      "rolle": "kurze Rollenbezeichnung, z. B. Vermieterin",
      "anweisung": "Rollenanweisung in Du-Form, 4 bis 7 Sätze: Hintergrund, Haltung und Interessen, Gefühle, typische Sprechweise, was dich überzeugen könnte und wo du hart bleibst",
      "beziehung": "wie diese Figur zu den anderen steht, mit deren Namen: Verwandtschaft, Arbeit, gemeinsame Vorgeschichte, Spannungen. Ein bis zwei Sätze",
      "geschlecht": "w" oder "m",
      "leitet": true nur für eine leitende Rolle wie Richterin, Moderator oder Mediatorin, sonst false,
      "nurAmEnde": true nur für eine Rolle, die erst am Schluss urteilt, sonst false,
      "mensch": true nur für die Rolle, die der Nutzer selbst spielen will, sonst false
    }
  ]
}
Regeln: 2 bis 5 Teilnehmer, unterschiedliche Vornamen. Gegensätzliche Interessen, damit es echt wird, aber niemand ist eine Karikatur. Höchstens eine Rolle leitet. Wenn der Nutzer sagt, dass er selbst teilnehmen oder üben will („ich“, „mein Chef“, „meine Vermieterin“), bekommt er genau eine Rolle mit "mensch": true; seine Gegenüber sind dann die KI-Rollen. Alles auf Deutsch.`,
    },
    { role: "user", content: situation },
  ];
}

export function parseScenario(text: string): GeneratedScenario | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    const people = Array.isArray(v.teilnehmer) ? v.teilnehmer : [];
    const participants = people
      .filter((p: Record<string, unknown>) => typeof p?.name === "string" && p.name.trim())
      .slice(0, 6)
      .map((p: Record<string, unknown>) => ({
        name: String(p.name).trim().slice(0, 30),
        roleName: String(p.rolle ?? "Teilnehmer").trim(),
        rolePrompt: String(p.anweisung ?? "").trim(),
        relation: String(p.beziehung ?? "").trim() || undefined,
        leads: p.leitet === true,
        finalOnly: p.nurAmEnde === true,
        human: p.mensch === true,
        gender: p.geschlecht === "w" || p.geschlecht === "m" ? (p.geschlecht as "w" | "m") : undefined,
      }));
    if (participants.filter((p: { human: boolean }) => !p.human).length < 2) return null;
    return {
      title: String(v.titel ?? "").trim(),
      topic: String(v.thema ?? "").trim(),
      goal: String(v.ziel ?? "").trim(),
      maxRounds: Math.min(20, Math.max(2, Math.round(Number(v.runden) || 6))),
      order: v.reihenfolge === "random" ? "random" : "round",
      participants,
    };
  } catch {
    return null;
  }
}

// ---- voices: one fitting voice per character ------------------------------------------

/** The default names have a clear gender; other names are left to the model or to chance. */
const NAME_GENDER: Record<string, "w" | "m"> = { Mara: "w", Jonas: "m", Lea: "w", Tarik: "m", Ines: "w", Ben: "m" };

export function voiceLabel(id?: string) {
  const v = NATURAL_VOICES.find((x) => x.id === id);
  return v ? `${v.id} (${v.gender === "w" ? "weiblich" : "männlich"}, ${v.character})` : undefined;
}

export function voiceMessages(participants: Participant[]): ChatMessage[] {
  const people = participants
    .filter((p) => !p.human)
    .map((p) => `- ${p.name}: ${p.roleName}${p.gender ? `, ${p.gender === "w" ? "weiblich" : "männlich"}` : ""}. ${p.rolePrompt.slice(0, 300)}`)
    .join("\n");
  const voices = NATURAL_VOICES.map((v) => `- ${v.id}: ${v.gender === "w" ? "weiblich" : "männlich"}, ${v.character}`).join("\n");
  return [
    {
      role: "system",
      content:
        'Du besetzt Sprechrollen für ein Hörspiel. Wähle für jede Figur genau eine Stimme aus der Liste, die zu Geschlecht (aus Name und Rolle erschließen), Alter und Charakter passt. Jede Stimme höchstens einmal. Antworte nur mit JSON: {"Name": "Stimme", ...}',
    },
    { role: "user", content: `Figuren:\n${people}\n\nStimmen:\n${voices}` },
  ];
}

export function parseVoices(text: string, participants: Participant[]): Record<string, string> {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const ids = new Set(NATURAL_VOICES.map((v) => v.id));
    const out: Record<string, string> = {};
    for (const p of participants) {
      const v = raw[p.name];
      if (typeof v === "string" && ids.has(v) && !Object.values(out).includes(v)) out[p.id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Without the model: by gender where known, leaders get a calm, matter-of-fact voice, no voice twice. */
export function fallbackVoices(participants: Participant[], taken: string[] = []): Record<string, string> {
  const used = new Set(taken);
  const out: Record<string, string> = {};
  const calm = ["sachlich", "bestimmt", "kundig", "klar"];
  let flip = 0;
  for (const p of participants.filter((x) => !x.human && !x.voice)) {
    const gender = p.gender ?? NAME_GENDER[p.name] ?? (flip++ % 2 ? "m" : "w");
    const pool = NATURAL_VOICES.filter((v) => v.gender === gender && !used.has(v.id));
    const pick = (p.leads || p.finalOnly ? pool.find((v) => calm.includes(v.character)) : undefined) ?? pool[0];
    if (pick) {
      out[p.id] = pick.id;
      used.add(pick.id);
    }
  }
  return out;
}

// ---- step 3 helper: work out the idea, who is who, how they relate ---------------------

export function elaborateMessages(idea: string, goal: string, participants: Participant[]): ChatMessage[] {
  const people = participants
    .map((p) =>
      p.human
        ? `- ${p.name}: ${p.roleName || "Teilnehmer"}, wird vom Nutzer selbst gespielt`
        : `- ${p.name}: ${p.roleName}. ${p.rolePrompt.slice(0, 240)}`,
    )
    .join("\n");
  return [
    {
      role: "system",
      content: `Du hilfst, eine Gesprächssimulation vorzubereiten. Der Nutzer hat eine grobe Idee und eine Besetzung. Arbeite die Idee aus, ohne sie zu verändern, und lege fest, wer wer ist und wie die Figuren zueinander stehen. Antworte ausschließlich mit JSON:
{
  "thema": "Ausgangslage in drei bis fünf Sätzen: wer, wo, worum es geht, was gerade passiert ist. Konkret und anschaulich, mit den Namen der Figuren",
  "ziel": "woran man erkennt, dass das Gespräch fertig ist; übernimm das Ziel des Nutzers, wenn er eins genannt hat",
  "besetzung": [ { "name": "genau der Name aus der Besetzung", "rolle": "wer die Figur in dieser Situation ist, ein bis drei Wörter, z. B. Schwester, Vermieter, Schlichterin", "beziehung": "wer diese Figur in dieser Situation ist und wie sie zu den anderen steht, mit deren Namen: Verwandtschaft, Arbeit, Vorgeschichte, Spannungen. Ein bis zwei Sätze" } ]
}
Jede Figur der Besetzung kommt genau einmal vor. Ihre Haltung aus der Besetzung bleibt (wer provoziert, provoziert weiter; wer vermittelt, vermittelt); erfinde keine neuen Figuren. Alles auf Deutsch.`,
    },
    { role: "user", content: `Idee: ${idea}${goal ? `\nZiel: ${goal}` : ""}\n\nBesetzung:\n${people}` },
  ];
}

export function parseElaboration(
  text: string,
  participants: Participant[],
): { topic: string; goal: string; cast: string; roles: Record<string, string> } | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    const rows: { name?: unknown; rolle?: unknown; beziehung?: unknown }[] = Array.isArray(v.besetzung) ? v.besetzung : [];
    const rowOf = (p: Participant) => rows.find((r) => String(r.name ?? "").trim().toLowerCase() === p.name.trim().toLowerCase());
    // Situational role names ("Schwester") replace generic ones ("Contra"); the behaviour stays in the role instruction.
    const roles: Record<string, string> = {};
    for (const p of participants) {
      const role = String(rowOf(p)?.rolle ?? "").trim();
      if (role && role.length <= 40) roles[p.id] = role;
    }
    const people = participants.map((p) => ({
      name: p.name,
      roleName: roles[p.id] ?? (p.roleName || "Teilnehmer"),
      relation: String(rowOf(p)?.beziehung ?? ""),
    }));
    const topic = String(v.thema ?? "").trim();
    if (!topic) return null;
    return { topic, goal: String(v.ziel ?? "").trim(), cast: castText(people), roles };
  } catch {
    return null;
  }
}
