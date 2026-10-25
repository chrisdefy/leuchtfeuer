import { useEffect, useMemo, useRef, useState } from "react";
import { formatCost } from "../../lib/format";
import { QUICK_STALL_MS, complete, type Model } from "../../lib/openrouter";
import { estimateCost, pickChecker } from "../../lib/context";
import { attachmentTokens, convertAttachment, documentBlock, ocrAttachment, summarizeAttachment } from "../../lib/documents";
import { bestFreeModel, cachedScores } from "../../lib/benchmarks";
import { blobIdsOf, deleteBlob, storeFile, type Attachment } from "../../lib/files";
import { docTypeOf } from "../../lib/convert";
import { formatTokens } from "../../lib/format";
import { AttachmentChip } from "../Attachments";
import { downloadText, fileName } from "../../lib/exporting";
import {
  deleteTemplate,
  importTemplates,
  loadTemplates,
  participantsOf,
  readTemplateFile,
  templateFile,
  type RoomTemplate,
} from "../../lib/roomTemplates";
import {
  ORDERS,
  SCENARIOS,
  TIERS,
  estimateRoundCost,
  castText,
  draftedNames,
  elaborateMessages,
  lacksModel,
  makeParticipant,
  parseElaboration,
  parseScenario,
  scenarioMessages,
  tierModels,
  withLeader,
  withModels,
  type GeneratedScenario,
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

/** Shown while the roles are drafted: since when, and what has arrived so far. */
interface Drafting {
  since: number;
  names: string[];
  thinking: boolean;
}

/** After this long the wait is explained, and cancelling is suggested. */
const SLOW_MS = 25_000;

/** Plain words for a failed helper request. */
function failure(e: unknown) {
  return e instanceof TypeError ? "OpenRouter ist nicht erreichbar. Prüfe die Internetverbindung." : (e as Error).message;
}

/** Documents for drafting: about 100 pages together. More is summarized first, or left out. */
const DOC_LIMIT = 60_000;

/** A role instruction for a character the user handed back to a model and that has none yet. */
const PLAIN_ROLE = "Du spielst diese Rolle glaubwürdig: Vertritt die Sicht und die Interessen, die zu ihr passen, und reagiere auf das, was die anderen sagen.";

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
  const [templates, setTemplates] = useState(loadTemplates);
  const [templateError, setTemplateError] = useState<string | null>(null);
  /** Settings a template brings that the setup does not ask for. */
  const [extras, setExtras] = useState<Pick<Room, "pace" | "readAloud" | "judge">>({ pace: "normal" });
  const importInput = useRef<HTMLInputElement>(null);
  /** Documents that inform the drafts; used only for drafting and deleted when the dialog closes. */
  const [docs, setDocs] = useState<Attachment[]>([]);
  const [docWork, setDocWork] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const docsRef = useRef(docs);
  docsRef.current = docs;
  /** Characters left out of this room; they stay in the list and can be taken back in. */
  const [left, setLeft] = useState<string[]>([]);
  const [elaborateError, setElaborateError] = useState<string | null>(null);
  /** The idea as typed, so "Ausformulieren" can be undone. */
  const [before, setBefore] = useState<{ topic: string; goal: string; cast: string; participants: Participant[] } | null>(null);
  const [drafting, setDrafting] = useState<Drafting | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const draftCtrl = useRef<AbortController | null>(null);
  const elaborateCtrl = useRef<AbortController | null>(null);

  // Closing the dialog cancels whatever is still being drafted; nothing keeps running unseen.
  // The documents served the drafts only and are not kept.
  useEffect(
    () => () => {
      draftCtrl.current?.abort();
      elaborateCtrl.current?.abort();
      for (const id of docsRef.current.flatMap(blobIdsOf)) void deleteBlob(id).catch(() => {});
    },
    [],
  );

  useEffect(() => {
    if (!drafting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [drafting]);

  const byId = useMemo(() => new Map((models ?? []).map((m) => [m.id, m])), [models]);
  const joining = participants.filter((p) => !left.includes(p.id));
  const ai = joining.filter((p) => !p.human);
  const human = participants.find((p) => p.human);
  const missing = ai.filter((p) => lacksModel(p, models));

  /** A saved room setup: everything as it was, still editable before the room starts. */
  function chooseTemplate(t: RoomTemplate) {
    cancelDraft();
    setLeft([]);
    setScenario({ ...BLANK, id: "template", name: t.name });
    // Models that have left the catalog since are replaced, so nobody is left without one.
    setParticipants(withModels(participantsOf(t), models, tierModels(tier, models)));
    setTitle(t.name);
    setTopic(t.topic);
    setGoal(t.goal ?? "");
    setCast(t.cast ?? "");
    setOrder(t.order);
    setMaxRounds(t.maxRounds);
    setBudget(t.budget);
    setAiAware(t.aiAware);
    setExtras({ pace: t.pace, readAloud: t.readAloud, judge: t.judge });
    setStep(2);
  }

  async function importFile(file: File) {
    setTemplateError(null);
    try {
      const added = importTemplates(await readTemplateFile(file));
      setTemplates(loadTemplates());
      if (!added) setTemplateError("Diese Vorlage gibt es hier schon (gleicher Name).");
    } catch (e) {
      setTemplateError((e as Error).message);
    }
  }

  function chooseScenario(s: Scenario) {
    cancelDraft();
    setLeft([]);
    setExtras({ pace: "normal" });
    setScenario(s);
    const pool = tierModels(tier, models);
    setParticipants(s.roles.map((r, i) => makeParticipant(r, i, pool[i % pool.length])));
    setGoal(s.goal);
    setOrder(s.order);
    setMaxRounds(s.maxRounds);
    setBudget(s.budget);
    setStep(2);
  }

  const docTokens = docs.reduce((n, a) => n + (attachmentTokens(a) ?? 0), 0);
  const docsTooLong = docTokens > DOC_LIMIT;
  const docsBusy = !!docWork || docs.some((a) => a.status === "converting");
  const readable = docs.filter((a) => attachmentTokens(a));

  async function addDocs(files: File[]) {
    if (!models) return;
    setDocError(null);
    const bestFree = bestFreeModel(models, cachedScores()).id;
    for (const file of files) {
      if (!docTypeOf(file) && !/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        setDocError(`„${file.name}“ geht hier nicht. Möglich sind PDF, Word (.docx) und Textdateien.`);
        continue;
      }
      try {
        const stored = await storeFile(file);
        setDocs((d) => [...d, stored]);
        const done = await convertAttachment(stored, { apiKey, models, bestFree });
        setDocs((d) => d.map((x) => (x.id === stored.id ? done : x)));
      } catch (e) {
        setDocError(failure(e));
      }
    }
  }

  function removeDoc(a: Attachment) {
    setDocs((d) => d.filter((x) => x.id !== a.id));
    for (const id of blobIdsOf(a)) void deleteBlob(id).catch(() => {});
  }

  /** Scans need text recognition, documents that are too long a summary; both run once, on request. */
  async function improveDoc(a: Attachment, how: "ocr" | "summary") {
    if (!models) return;
    setDocWork(a.id);
    setDocError(null);
    try {
      const done =
        how === "ocr"
          ? await ocrAttachment(a, { apiKey, models, bestFree: bestFreeModel(models, cachedScores()).id })
          : await summarizeAttachment(a, { apiKey, models, fallback: tierModels("cheap", models)[0] });
      setDocs((d) => d.map((x) => (x.id === a.id ? done : x)));
    } catch (e) {
      setDocError(failure(e));
    } finally {
      setDocWork(null);
    }
  }

  /** Describe the situation, get roles, topic, goal and rounds; everything stays editable afterwards. */
  async function draftScenario() {
    const text = situation.trim() || (readable.length ? "Entwirf eine passende Gesprächssimulation zu den beigefügten Unterlagen." : "");
    if (!text || !models || drafting || docsBusy || docsTooLong) return;
    const ctrl = new AbortController();
    draftCtrl.current = ctrl;
    setDrafting({ since: Date.now(), names: [], thinking: false });
    setNow(Date.now());
    setDraftError(null);
    try {
      const documents = await Promise.all(readable.map(documentBlock));
      const model = pickChecker(models, 8_000 + docTokens, tierModels("cheap", models)[0]);
      // Drafting roles needs no long deliberation; low effort keeps a thinking model quick.
      const thinks = !!byId.get(model)?.supported_parameters?.includes("reasoning");
      let gen: GeneratedScenario | null = null;
      // An answer in the wrong format is asked for once more before the user hears about it.
      for (let attempt = 0; attempt < 2 && !gen; attempt++) {
        const res = await complete(
          {
            apiKey,
            model,
            messages: scenarioMessages(text, documents),
            signal: ctrl.signal,
            maxTokens: 6_000,
            reasoningEffort: thinks ? "low" : undefined,
            stallMs: QUICK_STALL_MS,
          },
          (partial) => setDrafting((d) => d && { ...d, names: draftedNames(partial), thinking: false }),
          () => setDrafting((d) => (d && !d.thinking && !d.names.length ? { ...d, thinking: true } : d)),
        );
        gen = parseScenario(res.text);
      }
      if (!gen) throw new Error("Der Vorschlag kam zweimal nicht im erwarteten Format. Versuch es noch einmal oder beschreibe die Situation etwas genauer.");
      const pool = tierModels(tier, models);
      let i = 0;
      const people = gen.participants.map((g, n) => {
        const base = makeParticipant("ideas", n, g.human ? "" : pool[i++ % pool.length]);
        return {
          ...base,
          name: g.name,
          roleId: g.human ? "human" : "custom",
          roleName: g.roleName,
          // Kept for the user's own character too, so it can be handed to a model later.
          rolePrompt: g.rolePrompt,
          leads: g.leads,
          finalOnly: g.finalOnly,
          human: g.human || undefined,
          gender: g.gender,
        };
      });
      const lead = people.find((p) => p.leads);
      setParticipants(withModels(lead ? withLeader(people, lead.id) : people, models, pool));
      setLeft([]);
      setScenario({ ...BLANK, id: "assistant", name: "Eigene Situation" });
      setTitle(gen.title);
      setCast(castText(gen.participants.map((g) => ({ name: g.name, roleName: g.roleName, relation: g.relation }))));
      setTopic(gen.topic || text);
      setGoal(gen.goal);
      setOrder(gen.order);
      setMaxRounds(gen.maxRounds);
      setStep(2);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setDraftError(failure(e));
    } finally {
      // Every way out ends the busy state, so the next attempt can start right away.
      if (draftCtrl.current === ctrl) {
        draftCtrl.current = null;
        setDrafting(null);
      }
    }
  }

  function cancelDraft() {
    draftCtrl.current?.abort();
    draftCtrl.current = null;
    setDrafting(null);
  }

  /** Step 3: work out the idea, and settle who is who and how they relate to each other. */
  async function elaborate() {
    if (!topic.trim() || !models || elaborating) return;
    const ctrl = new AbortController();
    elaborateCtrl.current = ctrl;
    setElaborating(true);
    setElaborateError(null);
    try {
      const documents = docsTooLong ? [] : await Promise.all(readable.map(documentBlock));
      const model = pickChecker(models, 8_000 + (documents.length ? docTokens : 0), tierModels("cheap", models)[0]);
      const thinks = !!byId.get(model)?.supported_parameters?.includes("reasoning");
      const res = await complete({
        apiKey,
        model,
        messages: elaborateMessages(topic.trim(), goal.trim(), joining, documents),
        signal: ctrl.signal,
        maxTokens: 4_000,
        reasoningEffort: thinks ? "low" : undefined,
        stallMs: QUICK_STALL_MS,
      });
      const out = parseElaboration(res.text, joining);
      if (!out) throw new Error("Der Vorschlag kam nicht im erwarteten Format. Versuch es noch einmal.");
      setBefore({ topic, goal, cast, participants });
      setParticipants((ps) => ps.map((p) => (out.roles[p.id] ? { ...p, roleName: out.roles[p.id] } : p)));
      setTopic(out.topic);
      if (out.goal) setGoal(out.goal);
      setCast(out.cast);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setElaborateError(failure(e));
    } finally {
      if (elaborateCtrl.current === ctrl) {
        elaborateCtrl.current = null;
        setElaborating(false);
      }
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

  /** Who plays a character: a model, or the user. Only one character can be the user. */
  function playedBy(id: string, byUser: boolean) {
    const pool = tierModels(tier, models);
    setParticipants((ps) =>
      withModels(
        ps.map((p) => {
          if (p.id === id && byUser) return { ...p, human: true, roleId: "human", leads: p.leads, finalOnly: false };
          if (p.id === id || (byUser && p.human)) {
            return { ...p, human: undefined, roleId: p.roleId === "human" ? "custom" : p.roleId, rolePrompt: p.rolePrompt || PLAIN_ROLE };
          }
          return p;
        }),
        models,
        pool,
      ),
    );
    if (byUser) setLeft((l) => l.filter((x) => x !== id));
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
    } else if (human?.rolePrompt) {
      // A drafted character stays in the play; a model takes it over.
      playedBy(human.id, false);
    } else {
      setParticipants((ps) => ps.filter((p) => !p.human));
    }
  }

  const draftRoom: Room = {
    id: "",
    title: "",
    topic: topic || "Thema",
    language: "Deutsch",
    participants: joining,
    order,
    ...extras,
    pace: extras.pace,
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
    if (missing.length || tooFew || tooMany) return;
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
      participants: joining.map((p) => (p.human && !p.roleName.trim() ? { ...p, roleName: "Teilnehmer" } : p)),
      createdAt: now,
      updatedAt: now,
    });
  }

  const tooFew = ai.length < 2;
  const tooMany = ai.length > 6;
  const waited = drafting ? Math.max(0, Math.round((now - drafting.since) / 1000)) : 0;

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
              disabled={!!drafting}
            />
            <div className="draft-docs">
              <button
                type="button"
                className="ghost small"
                onClick={() => docInput.current?.click()}
                disabled={!!drafting || !models}
                aria-busy={docsBusy}
                title="PDF, Word oder Text: Die KI berücksichtigt den Inhalt beim Entwerfen. Die Dateien werden nur dafür genutzt und nicht im Raum gespeichert."
              >
                <Icon name="paperclip" size={14} />
                Unterlagen anhängen
              </button>
              <input
                ref={docInput}
                type="file"
                multiple
                hidden
                accept=".pdf,.docx,.txt,.md,.markdown,.csv,application/pdf,text/plain"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  void addDocs(files);
                }}
              />
              {docs.map((a) => (
                <span key={a.id} className="draft-doc">
                  <AttachmentChip attachment={a} onRemove={drafting ? undefined : () => removeDoc(a)} />
                  {a.scanned && !a.summary && (
                    <button type="button" className="link-button" onClick={() => void improveDoc(a, "ocr")} disabled={docsBusy}>
                      {docWork === a.id ? "Liest …" : "Eingescannt: mit Texterkennung lesen (ca. 0,2 Cent pro Seite)"}
                    </button>
                  )}
                  {a.status === "failed" && <span className="error-text">{a.error}</span>}
                </span>
              ))}
            </div>
            {readable.length > 0 && !docsTooLong && (
              <p className="hint">
                Die KI liest beim Entwerfen {readable.length === 1 ? "die Unterlage" : `${readable.length} Unterlagen`} mit (ca.{" "}
                {formatTokens(docTokens)} Tokens
                {models &&
                  `, etwa ${formatCost(estimateCost(byId.get(pickChecker(models, 8_000 + docTokens, tierModels("cheap", models)[0])), docTokens + 2_000, 3_000) ?? 0)} pro Entwurf`}
                ). Sie werden nur dafür genutzt, nicht im Raum gespeichert und beim Schließen gelöscht.
              </p>
            )}
            {docsTooLong && (
              <p className="hint error-text">
                Die Unterlagen sind zusammen zu lang ({formatTokens(docTokens)} Tokens, höchstens {formatTokens(DOC_LIMIT)}, etwa 100
                Seiten). Lass das längste Dokument zusammenfassen oder entferne eins.{" "}
                <button
                  type="button"
                  className="link-button"
                  disabled={docsBusy}
                  onClick={() => {
                    const longest = [...docs].filter((a) => a.text && !a.summary).sort((x, y) => (y.text?.tokens ?? 0) - (x.text?.tokens ?? 0))[0];
                    if (longest) void improveDoc(longest, "summary");
                  }}
                >
                  {docWork ? "Fasst zusammen …" : "Längstes zusammenfassen"}
                </button>
              </p>
            )}
            {docError && <p className="hint error-text">{docError}</p>}
            <div className="situation-foot">
              {drafting ? (
                <p className="hint draft-progress" role="status">
                  {drafting.names.length
                    ? `Figuren bisher: ${drafting.names.join(", ")}`
                    : drafting.thinking
                      ? "Die KI denkt über die Situation nach …"
                      : "Die Anfrage ist unterwegs …"}
                  {waited * 1000 >= SLOW_MS &&
                    " Das dauert heute länger als üblich. Du kannst warten oder abbrechen; nach einer Minute ohne Lebenszeichen bricht Leuchtfeuer von selbst ab."}
                </p>
              ) : (
                <p className="hint">
                  Eine KI entwirft daraus Rollen mit Persönlichkeit, Thema, Ziel und Rundenzahl. Willst du selbst üben, schreib
                  es dazu: Dann bekommst du eine eigene Rolle. Alles bleibt danach änderbar.
                </p>
              )}
              <div className="situation-buttons">
                {drafting && (
                  <button type="button" className="button" onClick={cancelDraft}>
                    Abbrechen
                  </button>
                )}
                <button
                  type="submit"
                  className="button primary"
                  disabled={(!situation.trim() && !readable.length) || !!drafting || !models || docsBusy || docsTooLong}
                  aria-busy={!!drafting}
                >
                  <Icon name="sparkle" size={15} />
                  {drafting ? `Entwirft Rollen … ${waited} s` : "Rollen entwerfen"}
                </button>
              </div>
            </div>
            {draftError && (
              <p className="hint error-text">
                {draftError}{" "}
                <button type="button" className="link-button" onClick={() => void draftScenario()}>
                  Erneut versuchen
                </button>
              </p>
            )}
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

        {step === 1 && (
          <section className="my-templates" aria-labelledby="my-templates">
            <div className="field-row">
              <h3 id="my-templates" className="scenarios-or">
                Meine Vorlagen
              </h3>
              <button type="button" className="ghost small" onClick={() => importInput.current?.click()}>
                <Icon name="upload" size={14} />
                Aus Datei laden
              </button>
              <input
                ref={importInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void importFile(f);
                }}
              />
            </div>
            {templates.length === 0 ? (
              <p className="hint">
                Noch keine. Speichere einen Raum unter „Einstellungen“ als Vorlage, um ihn später neu zu starten.
              </p>
            ) : (
              <ul className="template-list">
                {templates.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="scenario" onClick={() => chooseTemplate(t)}>
                      <strong>{t.name}</strong>
                      <span>
                        {t.participants.map((p) => p.name).join(", ")} · gespeichert am{" "}
                        {new Date(t.savedAt).toLocaleDateString("de-DE")}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ghost icon-only"
                      aria-label={`„${t.name}“ als Datei herunterladen`}
                      title="Als Datei herunterladen, zum Weitergeben"
                      onClick={() => downloadText(fileName(t.name).replace(/\.md$/, ".vorlage.json"), templateFile([t]), "application/json")}
                    >
                      <Icon name="download" size={16} />
                    </button>
                    <button
                      type="button"
                      className="ghost icon-only"
                      aria-label={`„${t.name}“ löschen`}
                      onClick={() => {
                        deleteTemplate(t.id);
                        setTemplates(loadTemplates());
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {templateError && <p className="hint error-text">{templateError}</p>}
          </section>
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
              {participants.map((p) => {
                const out = left.includes(p.id);
                const noModel = !out && lacksModel(p, models);
                return (
                  <li key={p.id} className={[p.human && "human", out && "left", noModel && "missing"].filter(Boolean).join(" ") || undefined}>
                    <div className="setup-person">
                      <ParticipantFields
                        participant={p}
                        models={models}
                        compact
                        apiKey={apiKey}
                        onChange={(c) => patch(p.id, c)}
                        onPickModel={() => setPicking(p.id)}
                      />
                      <div className="setup-flags">
                        <label className="check inline" title="Abgewählte Figuren bleiben in der Liste und lassen sich wieder dazunehmen">
                          <input
                            type="checkbox"
                            checked={!out}
                            onChange={(e) => setLeft((l) => (e.target.checked ? l.filter((x) => x !== p.id) : [...l, p.id]))}
                          />
                          Dabei
                        </label>
                        <span className="chips" role="group" aria-label={`Wer spielt ${p.name}`}>
                          <button type="button" className="chip" aria-pressed={!p.human} onClick={() => p.human && playedBy(p.id, false)}>
                            KI spielt
                          </button>
                          <button type="button" className="chip" aria-pressed={!!p.human} onClick={() => !p.human && playedBy(p.id, true)}>
                            Ich spiele
                          </button>
                        </span>
                        <label className="check inline">
                          <input type="checkbox" checked={!!p.leads} onChange={(e) => patch(p.id, { leads: e.target.checked })} />
                          Leitet
                        </label>
                        {!p.human && (
                          <label className="check inline" title="Hört zu und spricht nur in der letzten Runde, zum Beispiel eine Jury">
                            <input type="checkbox" checked={!!p.finalOnly} onChange={(e) => patch(p.id, { finalOnly: e.target.checked })} />
                            Spricht erst am Ende
                          </label>
                        )}
                        {noModel && <span className="error-text">Kein Modell: Bitte eins wählen.</span>}
                      </div>
                    </div>
                    <button
                      className="ghost icon-only"
                      onClick={() => {
                        setParticipants((ps) => ps.filter((x) => x.id !== p.id));
                        setLeft((l) => l.filter((x) => x !== p.id));
                      }}
                      aria-label={`${p.name} entfernen`}
                      disabled={!p.human && !out && ai.length <= 2}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </li>
                );
              })}
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
            {(tooFew || tooMany) && <p className="hint error-text">Ein Raum braucht 2 bis 6 KI-Teilnehmer, die dabei sind.</p>}
            {missing.length > 0 && (
              <p className="hint error-text">
                {missing.map((p) => p.name).join(", ")} {missing.length === 1 ? "hat" : "haben"} noch kein Modell. Wähle eins
                aus, sonst kann {missing.length === 1 ? "die Figur" : "keine dieser Figuren"} nicht mitreden.
              </p>
            )}

            <footer className="dialog-foot spread">
              <button className="button" onClick={() => setStep(1)}>
                Zurück
              </button>
              <button className="button primary" onClick={() => setStep(3)} disabled={tooFew || tooMany || missing.length > 0}>
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
                  aria-busy={elaborating}
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
                placeholder={joining
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
              <button type="submit" className="button primary" disabled={!topic.trim() || missing.length > 0 || tooFew || tooMany}>
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
