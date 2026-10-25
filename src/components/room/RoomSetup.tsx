import { useMemo, useState } from "react";
import { formatCost } from "../../lib/format";
import { complete, type Model } from "../../lib/openrouter";
import { pickChecker } from "../../lib/context";
import {
  ORDERS,
  SCENARIOS,
  TIERS,
  estimateRoundCost,
  castText,
  elaborateMessages,
  makeParticipant,
  parseElaboration,
  parseScenario,
  scenarioMessages,
  tierModels,
  withLeader,
  type Order,
  type Participant,
  type Room,
  type Scenario,
  type Tier,
} from "../../lib/rooms";
import { Icon } from "../Icon";
import { ModelPicker } from "../ModelPicker";
import { ParticipantFields } from "./ParticipantFields";

interface Props {
  models: Model[] | null;
  apiKey: string;
  favorites: string[];
  recents: string[];
  onToggleFavorite: (id: string) => void;
  onCreate: (room: Room) => void;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

const BLANK: Scenario = {
  id: "blank",
  name: "Leerer Raum",
  summary: "Zwei Teilnehmer, alles frei einstellbar",
  roles: ["ideas", "critic"],
  order: "round",
  goal: "",
  topicHint: "Worüber sollen die Teilnehmer sprechen?",
  maxRounds: 6,
  budget: 0.5,
};

export function RoomSetup({ models, apiKey, favorites, recents, onToggleFavorite, onCreate, onClose }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);
  const [tier, setTier] = useState<Tier>("cheap");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("");
  const [order, setOrder] = useState<Order>("round");
  const [maxRounds, setMaxRounds] = useState(6);
  const [budget, setBudget] = useState(0.5);
  const [aiAware, setAiAware] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  /** Scenario assistant: the situation in the user's words, and the title it suggested. */
  const [situation, setSituation] = useState("");
  const [title, setTitle] = useState("");
  /** Who is who and how they relate; every participant gets it. */
  const [cast, setCast] = useState("");
  const [elaborating, setElaborating] = useState(false);
  const [elaborateError, setElaborateError] = useState<string | null>(null);
  /** The idea as typed, so "Ausformulieren" can be undone. */
  const [before, setBefore] = useState<{ topic: string; goal: string; cast: string; participants: Participant[] } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const byId = useMemo(() => new Map((models ?? []).map((m) => [m.id, m])), [models]);
  const ai = participants.filter((p) => !p.human);
  const human = participants.find((p) => p.human);

  function chooseScenario(s: Scenario) {
    setScenario(s);
    const pool = tierModels(tier, models);
    setParticipants(s.roles.map((r, i) => makeParticipant(r, i, pool[i % pool.length])));
    setGoal(s.goal);
    setOrder(s.order);
    setMaxRounds(s.maxRounds);
    setBudget(s.budget);
    setStep(2);
  }

  /** Describe the situation, get roles, topic, goal and rounds; everything stays editable afterwards. */
  async function draftScenario() {
    const text = situation.trim();
    if (!text || !models) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const model = pickChecker(models, 8_000, tierModels("cheap", models)[0]);
      const res = await complete({ apiKey, model, messages: scenarioMessages(text), signal: new AbortController().signal });
      const gen = parseScenario(res.text);
      if (!gen) throw new Error("Der Vorschlag kam nicht im erwarteten Format. Versuch es noch einmal oder beschreibe die Situation etwas genauer.");
      const pool = tierModels(tier, models);
      let i = 0;
      const people = gen.participants.map((g, n) => {
        const base = makeParticipant("ideas", n, g.human ? "" : pool[i++ % pool.length]);
        return {
          ...base,
          name: g.name,
          roleId: g.human ? "human" : "custom",
          roleName: g.roleName,
          rolePrompt: g.human ? "" : g.rolePrompt,
          leads: g.leads,
          finalOnly: g.finalOnly,
          human: g.human || undefined,
          gender: g.gender,
        };
      });
      const lead = people.find((p) => p.leads);
      setParticipants(lead ? withLeader(people, lead.id) : people);
      setScenario({ ...BLANK, id: "assistant", name: "Eigene Situation" });
      setTitle(gen.title);
      setCast(castText(gen.participants.map((g) => ({ name: g.name, roleName: g.roleName, relation: g.relation }))));
      setTopic(gen.topic || text);
      setGoal(gen.goal);
      setOrder(gen.order);
      setMaxRounds(gen.maxRounds);
      setStep(2);
    } catch (e) {
      setDraftError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  /** Step 3: work out the idea, and settle who is who and how they relate to each other. */
  async function elaborate() {
    if (!topic.trim() || !models) return;
    setElaborating(true);
    setElaborateError(null);
    try {
      const model = pickChecker(models, 8_000, tierModels("cheap", models)[0]);
      const res = await complete({
        apiKey,
        model,
        messages: elaborateMessages(topic.trim(), goal.trim(), participants),
        signal: new AbortController().signal,
      });
      const out = parseElaboration(res.text, participants);
      if (!out) throw new Error("Der Vorschlag kam nicht im erwarteten Format. Versuch es noch einmal.");
      setBefore({ topic, goal, cast, participants });
      setParticipants((ps) => ps.map((p) => (out.roles[p.id] ? { ...p, roleName: out.roles[p.id] } : p)));
      setTopic(out.topic);
      if (out.goal) setGoal(out.goal);
      setCast(out.cast);
    } catch (e) {
      setElaborateError((e as Error).message);
    } finally {
      setElaborating(false);
    }
  }

  function applyTier(t: Tier) {
    setTier(t);
    const pool = tierModels(t, models);
    let i = 0;
    setParticipants((ps) => ps.map((p) => (p.human ? p : { ...p, model: pool[i++ % pool.length] })));
  }

  function patch(id: string, change: Partial<Participant>) {
    setParticipants((ps) => {
      const next = ps.map((p) => (p.id === id ? { ...p, ...change } : p));
      return change.leads ? withLeader(next, id) : next;
    });
  }

  function addParticipant() {
    const pool = tierModels(tier, models);
    setParticipants((ps) => [...ps, makeParticipant("ideas", ps.length, pool[ps.length % pool.length])]);
  }

  function toggleHuman(on: boolean) {
    if (on) {
      setParticipants((ps) => [
        ...ps,
        { ...makeParticipant("layperson", ps.length, ""), name: "Ich", roleId: "human", roleName: "", rolePrompt: "", human: true },
      ]);
    } else {
      setParticipants((ps) => ps.filter((p) => !p.human));
    }
  }

  const draftRoom: Room = {
    id: "",
    title: "",
    topic: topic || "Thema",
    language: "Deutsch",
    participants,
    order,
    pace: "normal",
    maxRounds,
    budget,
    aiAware,
    messages: [],
    round: 1,
    spoken: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const perRound = estimateRoundCost(draftRoom, byId);

  function create() {
    const now = Date.now();
    onCreate({
      ...draftRoom,
      id: crypto.randomUUID(),
      title: title.trim() || (topic.trim().length > 48 ? `${topic.trim().slice(0, 46)} …` : topic.trim()),
      scenarioId: scenario.id,
      // The assistant's title is already a good name; no automatic retitling.
      titleSource: title.trim() ? "user" : undefined,
      topic: topic.trim(),
      goal: goal.trim() || undefined,
      cast: cast.trim() || undefined,
      participants: participants.map((p) => (p.human && !p.roleName.trim() ? { ...p, roleName: "Teilnehmer" } : p)),
      createdAt: now,
      updatedAt: now,
    });
  }

  const tooFew = ai.length < 2;
  const tooMany = ai.length > 6;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide room-setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <header className="dialog-head">
          <div>
            <h2 id="setup-title">Chatroom erstellen</h2>
            <ol className="steps" aria-label="Schritte">
              <li aria-current={step === 1 ? "step" : undefined}>Szenario</li>
              <li aria-current={step === 2 ? "step" : undefined}>Teilnehmer</li>
              <li aria-current={step === 3 ? "step" : undefined}>Thema und Regeln</li>
            </ol>
          </div>
          <button className="ghost icon-only" onClick={onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </header>

        {step === 1 && (
          <form
            className="situation"
            onSubmit={(e) => {
              e.preventDefault();
              void draftScenario();
            }}
          >
            <label htmlFor="situation">Beschreib einfach die Situation</label>
            <textarea
              id="situation"
              rows={3}
              value={situation}
              autoFocus
              placeholder="Zum Beispiel: Ich will meinem Chef sagen, dass ich mehr Gehalt möchte. Oder: Ein Paar streitet, wer die Kinder vom Sport abholt."
              onChange={(e) => setSituation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void draftScenario();
                }
              }}
              disabled={drafting}
            />
            <div className="situation-foot">
              <p className="hint">
                Eine KI entwirft daraus Rollen mit Persönlichkeit, Thema, Ziel und Rundenzahl. Willst du selbst üben, schreib
                es dazu: Dann bekommst du eine eigene Rolle. Alles bleibt danach änderbar.
              </p>
              <button type="submit" className="button primary" disabled={!situation.trim() || drafting || !models}>
                <Icon name="sparkle" size={15} />
                {drafting ? "Entwirft Rollen …" : "Rollen entwerfen"}
              </button>
            </div>
            {draftError && <p className="hint error-text">{draftError}</p>}
          </form>
        )}

        {step === 1 && <p className="scenarios-or">oder eine Vorlage wählen</p>}

        {step === 1 && (
          <div className="scenarios">
            {[...SCENARIOS, BLANK].map((s) => (
              <button key={s.id} className="scenario" onClick={() => chooseScenario(s)}>
                <strong>{s.name}</strong>
                <span>{s.summary}</span>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <>
            <div className="field-row tier-row">
              <span className="pfield-label">Modelle für alle</span>
              <div className="chips" role="group" aria-label="Preisstufe">
                {(Object.keys(TIERS) as Tier[]).map((t) => (
                  <button key={t} className="chip" aria-pressed={tier === t} onClick={() => applyTier(t)}>
                    {TIERS[t].label}
                  </button>
                ))}
              </div>
            </div>
            <p className="hint tier-hint">
              Verschiedene Hersteller werden gemischt, damit unterschiedliche Denkweisen aufeinandertreffen. Jedes Modell
              lässt sich einzeln ändern.
            </p>

            <ul className="setup-participants">
              {participants.map((p) => (
                <li key={p.id} className={p.human ? "human" : undefined}>
                  <ParticipantFields
                    participant={p}
                    models={models}
                    compact
                    apiKey={apiKey}
                    onChange={(c) => patch(p.id, c)}
                    onPickModel={() => setPicking(p.id)}
                  />
                  <button
                    className="ghost icon-only"
                    onClick={() => setParticipants((ps) => ps.filter((x) => x.id !== p.id))}
                    aria-label={`${p.name} entfernen`}
                    disabled={!p.human && ai.length <= 2}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="setup-actions">
              <button className="ghost small" onClick={addParticipant} disabled={ai.length >= 6}>
                <Icon name="plus" size={14} />
                KI-Teilnehmer hinzufügen
              </button>
              <label className="check inline">
                <input type="checkbox" checked={!!human} onChange={(e) => toggleHuman(e.target.checked)} />
                Ich mache selbst mit einer Rolle mit
              </label>
            </div>
            {(tooFew || tooMany) && <p className="hint error-text">Ein Raum braucht 2 bis 6 KI-Teilnehmer.</p>}

            <footer className="dialog-foot spread">
              <button className="button" onClick={() => setStep(1)}>
                Zurück
              </button>
              <button className="button primary" onClick={() => setStep(3)} disabled={tooFew || tooMany}>
                Weiter
              </button>
            </footer>
          </>
        )}

        {step === 3 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (topic.trim()) create();
            }}
          >
            <div className="field">
              <div className="field-row">
                <label htmlFor="room-topic">Thema oder Ausgangsfrage</label>
                <button
                  type="button"
                  className="ghost small enhance"
                  onClick={() => void elaborate()}
                  disabled={!topic.trim() || elaborating || !models}
                  title="Eine KI arbeitet deine Idee aus und legt fest, wer wer ist und wie die Figuren zueinander stehen"
                >
                  <Icon name="sparkle" size={14} />
                  {elaborating ? "Formuliert aus …" : "Mit KI ausformulieren"}
                </button>
              </div>
              <textarea
                id="room-topic"
                rows={topic.length > 160 ? 5 : 2}
                value={topic}
                autoFocus
                placeholder={scenario.topicHint}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            {elaborateError && <p className="hint error-text">{elaborateError}</p>}
            {before && !elaborating && (
              <p className="hint">
                Ausformuliert. Prüf es und pass es an, wenn etwas nicht stimmt.{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setTopic(before.topic);
                    setGoal(before.goal);
                    setCast(before.cast);
                    setParticipants(before.participants);
                    setBefore(null);
                  }}
                >
                  Meine Fassung wiederherstellen
                </button>
              </p>
            )}
            <div className="field">
              <label htmlFor="room-cast">Wer ist wer (optional)</label>
              <textarea
                id="room-cast"
                rows={Math.min(8, Math.max(2, cast.split("\n").length + 1))}
                value={cast}
                placeholder={participants
                  .slice(0, 2)
                  .map((p) => `- ${p.name} (${p.roleName || "Teilnehmer"}): wer sie oder er ist und wie sie zu den anderen steht`)
                  .join("\n")}
                onChange={(e) => setCast(e.target.value)}
              />
              <p className="hint">Alle Teilnehmer kennen diese Beziehungen und handeln danach.</p>
            </div>
            <div className="field">
              <label htmlFor="room-goal">Ziel (optional)</label>
              <input
                id="room-goal"
                className="input"
                value={goal}
                placeholder="Woran erkennt man, dass das Gespräch fertig ist?"
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="room-order">Reihenfolge</label>
                <select id="room-order" className="select" value={order} onChange={(e) => setOrder(e.target.value as Order)}>
                  {Object.entries(ORDERS).map(([id, l]) => (
                    <option key={id} value={id}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="room-rounds">Höchstens Runden</label>
                <input
                  id="room-rounds"
                  className="input"
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={maxRounds}
                  onChange={(e) => setMaxRounds(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div className="field">
                <label htmlFor="room-budget">Budget in $</label>
                <input
                  id="room-budget"
                  className="input"
                  type="number"
                  min={0.01}
                  step="any"
                  value={budget}
                  onChange={(e) => setBudget(Math.max(0.01, Number(e.target.value) || 0.01))}
                />
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={aiAware} onChange={(e) => setAiAware(e.target.checked)} />
              Die Teilnehmer wissen, dass sie KI-Modelle sind (für Simulationen besser aus)
            </label>

            <p className="hint setup-cost">
              Eine Runde kostet anfangs ca. <strong>{formatCost(perRound)}</strong> und wird mit wachsendem Verlauf teurer.
              Das Budget von {formatCost(budget)} ist eine harte Grenze: Danach hält der Raum an. Das Tempo stellst du
              im Raum ein.
            </p>

            <footer className="dialog-foot spread">
              <button type="button" className="button" onClick={() => setStep(2)}>
                Zurück
              </button>
              <button type="submit" className="button primary" disabled={!topic.trim()}>
                Raum erstellen
              </button>
            </footer>
          </form>
        )}
      </div>

      {picking && (
        <ModelPicker
          models={models}
          error={null}
          current={participants.find((p) => p.id === picking)?.model ?? ""}
          favorites={favorites}
          recents={recents}
          onSelect={(id) => {
            patch(picking, { model: id });
            setPicking(null);
          }}
          onToggleFavorite={onToggleFavorite}
          onRetry={() => {}}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
