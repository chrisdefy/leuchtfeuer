import { useEffect, useMemo, useRef, useState } from "react";
import { formatCost } from "../../lib/format";
import { pickChecker } from "../../lib/context";
import { complete, shortName, streamChat, type Model, type Usage } from "../../lib/openrouter";
import {
  HOST,
  LENGTHS,
  ORDERS,
  PACES,
  PALETTE,
  SYSTEM,
  addressee,
  afterTurn,
  estimateRoundCost,
  fallbackVoices,
  goalCheckMessages,
  parseVoices,
  voiceLabel,
  voiceMessages,
  goalCheckerOf,
  judgeOf,
  lacksModel,
  leaderOf,
  memoryRequest,
  needsMemory,
  makeParticipant,
  parseGoalCheck,
  protocolMessages,
  tierModels,
  withLeader,
  estimateTurnCost,
  nextSpeaker,
  participantCost,
  roomCost,
  roundsDone,
  turnMessages,
  type Order,
  type Pace,
  type Participant,
  type Room,
  type RoomMessage,
} from "../../lib/rooms";
import { downloadText, fileName, roomToMarkdown } from "../../lib/exporting";
import { saveTemplate, templateFile, templateOf } from "../../lib/roomTemplates";
import { RoomSettings, type RoomRules } from "./RoomSettings";
import { DictateButton } from "../DictateButton";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";
import { ModelPicker } from "../ModelPicker";
import { ParticipantFields } from "./ParticipantFields";
import { ReviewDialog } from "./ReviewDialog";
import { AudioPlayDialog } from "./AudioPlayDialog";
import { usePopover } from "../usePopover";
import { musicLevels } from "../../lib/media";
import { SpeechBar } from "../SpeechBar";
import { NATURAL_VOICES, stopSpeaking, toggleSpeaking, useSpeechState } from "../../lib/speech";

interface Props {
  room: Room;
  models: Model[] | null;
  apiKey: string;
  favorites: string[];
  recents: string[];
  onToggleFavorite: (id: string) => void;
  /** Replace the stored room. */
  onSave: (room: Room) => void;
  onSpent: () => void;
  onOpenMenu: () => void;
}

/**
 * Why the room stopped. With a `fix` it is a planned stop (goal, rounds, budget) that offers the way on.
 * With `retry` a participant could not answer; `resume` says whether the room was running at the time.
 */
type Halt = { title?: string; reason: string; fix?: "rounds" | "budget"; retry?: string; resume?: boolean };

/** A turn that delivers nothing for this long is given up and reported, instead of waiting forever. */
const TURN_STALL_MS = 90_000;

/** Extra tokens for thinking models, on top of the answer length. */
const THINKING_ALLOWANCE = 2_500;

export function RoomView(props: Props) {
  const { room, models, apiKey } = props;
  const byId = useMemo(() => new Map((models ?? []).map((m) => [m.id, m])), [models]);

  // The engine works on this ref so a running loop always sees the latest room,
  // including edits made while a participant is speaking.
  const roomRef = useRef(room);
  if (roomRef.current.id !== room.id) roomRef.current = room;
  const update = (fn: (r: Room) => Room) => {
    roomRef.current = { ...fn(roomRef.current), updatedAt: Date.now() };
    props.onSave(roomRef.current);
  };

  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [halt, setHalt] = useState<Halt | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(Date.now());
  const [adding, setAdding] = useState<Participant | null>(null);
  const [checking, setChecking] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<{ text: string; loading: boolean; error?: string; cost?: number } | null>(null);

  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const skipWait = useRef<(() => void) | null>(null);
  /** Continue automatically once the human participant has spoken. */
  const resumeAfterHuman = useRef(false);
  /** When set, the run pauses by itself once this round begins. */
  const untilRef = useRef<number | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [batch, setBatch] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);

  const human = room.participants.find((p) => p.human);
  const upcoming = room.order === "manual" ? undefined : nextSpeaker(room);
  const humanTurn = !!upcoming?.human && !speaking;
  const spent = roomCost(room) + (room.review?.cost ?? 0);
  /** Independent judge: writes the evaluation, answers questions about it and writes the protocol. */
  const judge = judgeOf(room, models);
  const perRound = estimateRoundCost(room, byId);

  // Leaving the room stops it: nothing should spend money unseen.
  useEffect(
    () => () => {
      runningRef.current = false;
      abortRef.current?.abort();
      skipWait.current?.();
      stopSpeaking();
    },
    [room.id],
  );

  useEffect(() => {
    if (!templateNotice) return;
    const t = setTimeout(() => setTemplateNotice(null), 8000);
    return () => clearTimeout(t);
  }, [templateNotice]);

  useEffect(() => {
    if (!waitUntil) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [waitUntil]);

  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [room.messages]);

  // A stop always shows where the conversation ends, so it is seen.
  useEffect(() => {
    if (halt) requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }));
  }, [halt]);

  // ---- engine ----------------------------------------------------------------

  function limitFor(r: Room, next?: Participant): Halt | null {
    if (roundsDone(r))
      return {
        title: `Alle ${r.maxRounds} Runden gespielt`,
        reason: "Das Gespräch ist zu Ende. Lass es bewerten, um zu sehen, was herausgekommen ist und was du daraus mitnehmen kannst.",
        fix: "rounds",
      };
    if (next && lacksModel(next, models))
      return {
        title: `${next.name} hat kein Modell`,
        reason: `Ohne Modell kann ${next.name} nicht mitreden. Klick links auf ${next.name} und wähle eins, dann geht es weiter.`,
      };
    const used = roomCost(r);
    if (used >= r.budget)
      return { title: "Budget erreicht", reason: `Das Budget von ${formatCost(r.budget)} ist aufgebraucht.`, fix: "budget" };
    if (next && !next.human && used + estimateTurnCost(r, next, byId.get(next.model)) > r.budget) {
      return {
        title: "Budget erreicht",
        reason: `Der nächste Beitrag würde das Budget von ${formatCost(r.budget)} überschreiten.`,
        fix: "budget",
      };
    }
    return null;
  }

  function wait(ms: number) {
    setWaitUntil(Date.now() + ms);
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        skipWait.current = null;
        setWaitUntil(null);
        resolve();
      };
      const timer = setTimeout(done, ms);
      skipWait.current = done;
    });
  }

  /** Long rooms: fold older turns into a summary before the next turn, instead of dropping them. */
  async function ensureMemory() {
    const r = roomRef.current;
    if (!needsMemory(r) || !models) return;
    setSummarizing(true);
    try {
      const { messages, upTo } = memoryRequest(r);
      const res = await complete({
        apiKey,
        model: pickChecker(models, 40_000, r.participants.find((x) => !x.human)?.model ?? ""),
        messages,
        signal: new AbortController().signal,
      });
      if (res.text.trim()) {
        update((x) => ({ ...x, memory: { text: res.text.trim(), upTo } }));
        note("Ältere Beiträge wurden zusammengefasst, damit alle den Überblick behalten. Die letzten Beiträge bleiben im Wortlaut.", res.usage);
      }
    } catch {
      /* fall back to dropping the oldest turns, as turnMessages does on its own */
    } finally {
      setSummarizing(false);
    }
  }

  /** One participant speaks. Returns false when it failed. */
  async function speak(p: Participant): Promise<boolean> {
    await ensureMemory();
    const model = byId.get(p.model);
    const r = roomRef.current;
    const msg: RoomMessage = {
      id: crypto.randomUUID(),
      authorId: p.id,
      content: "",
      model: p.model,
      round: r.round,
      createdAt: Date.now(),
    };
    const messages = turnMessages(r, p, model);
    update((x) => ({ ...x, messages: [...x.messages, msg] }));
    setSpeaking(p.id);

    const patchMsg = (fn: (m: RoomMessage) => RoomMessage) =>
      update((x) => ({ ...x, messages: x.messages.map((m) => (m.id === msg.id ? fn(m) : m)) }));

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const started = performance.now();
    let content = "";
    let frame = 0;
    const flush = () => {
      frame = 0;
      patchMsg((m) => ({ ...m, content }));
    };
    let ok = true;
    // Thinking models count their thinking against the token limit; with long roles it could use all of it
    // and leave no answer. The limit therefore gets room for thinking on top, and an empty answer is tried once more.
    const thinks = !!model?.supported_parameters?.includes("reasoning");
    let usageSoFar: Usage | undefined;
    try {
      for (let attempt = 0; attempt < 2 && !content.trim(); attempt++) {
        let thought = 0;
        await streamChat(
          {
            apiKey,
            model: p.model,
            messages,
            temperature: p.temperature,
            signal: ctrl.signal,
            maxTokens: LENGTHS[p.length].cap + (thinks ? THINKING_ALLOWANCE * (attempt + 1) : 0),
            reasoningEffort: thinks ? "low" : undefined,
            stallMs: TURN_STALL_MS,
          },
          {
            onContent: (t) => {
              content += t;
              if (!frame) frame = requestAnimationFrame(flush);
            },
            onReasoning: (t) => (thought += t.length),
            onModel: () => {},
            onUsage: (usage) => {
              // Both attempts are paid for; the message shows the sum.
              usageSoFar = usageSoFar
                ? { ...usage, cost: (usageSoFar.cost ?? 0) + (usage.cost ?? 0), promptTokens: usageSoFar.promptTokens + usage.promptTokens, completionTokens: usageSoFar.completionTokens + usage.completionTokens }
                : usage;
              patchMsg((m) => ({ ...m, usage: usageSoFar }));
            },
          },
        );
        if (!content.trim() && attempt === 1)
          throw new Error(
            thought
              ? "Das Modell hat nur nachgedacht und keine Antwort geschrieben. Versuch es noch einmal oder gib der Figur ein anderes Modell."
              : "Das Modell hat nichts gesagt. Versuch es noch einmal oder gib der Figur ein anderes Modell.",
          );
      }
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        ok = false;
      } else {
        ok = false;
        const text = err instanceof TypeError ? "OpenRouter ist nicht erreichbar." : err.message;
        patchMsg((m) => ({ ...m, error: text }));
        setHalt({ title: `${p.name} konnte nicht antworten`, reason: text, retry: p.id, resume: runningRef.current });
      }
    } finally {
      cancelAnimationFrame(frame);
      flush();
      patchMsg((m) => ({ ...m, durationMs: Math.round(performance.now() - started) }));
      abortRef.current = null;
      setSpeaking(null);
      props.onSpent();
    }
    if (ok) {
      // The leader hands the word to whoever it named last; that person answers next.
      const to = p.leads ? addressee(roomRef.current, p.id, content, true) : undefined;
      update((x) => ({ ...x, ...afterTurn(x, p.id), ...(to ? { nextUp: to } : {}) }));
    }
    // Read aloud: the next one waits until this one has finished speaking.
    if (ok && roomRef.current.readAloud && content.trim()) await readTurn(p, msg.id, content);
    return ok;
  }

  /**
   * After a finished round: ask a cheap model whether the goal is met. A reached goal is only noted:
   * the conversation goes on, and the user decides when it has done its job.
   */
  async function checkGoal(roundBefore: number) {
    const r = roomRef.current;
    if (!r.goal || r.goalMet || r.round === roundBefore || !models) return;
    setChecking(true);
    try {
      const res = await complete({ apiKey, model: goalCheckerOf(r, models), messages: goalCheckMessages(r), signal: new AbortController().signal });
      const verdict = parseGoalCheck(res.text);
      if (verdict?.reached) {
        note(`Ziel erreicht nach Runde ${roundBefore}: ${verdict.reason}`, res.usage, { goal: true });
        // Checked once is enough; further rounds would only confirm it again.
        update((x) => ({ ...x, goalMet: true }));
      } else {
        note(
          verdict
            ? `Zielprüfung nach Runde ${roundBefore}: noch nicht erreicht. ${verdict.reason}`
            : `Die Zielprüfung nach Runde ${roundBefore} lieferte kein auswertbares Ergebnis.`,
          res.usage,
        );
      }
    } catch (e) {
      note(`Die Zielprüfung ist fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setChecking(false);
      props.onSpent();
    }
  }

  function stopRunning() {
    runningRef.current = false;
    setRunning(false);
    skipWait.current?.();
  }

  async function loop() {
    while (runningRef.current) {
      const r = roomRef.current;
      const next = nextSpeaker(r);
      const limit = limitFor(r, next);
      if (limit) {
        setHalt(limit);
        clearTarget();
        break;
      }
      if (!next) {
        setHalt({ reason: "Niemand kann sprechen: Alle Teilnehmer sind pausiert." });
        break;
      }
      if (next.human) {
        resumeAfterHuman.current = true;
        break;
      }
      const roundBefore = roomRef.current.round;
      if (!(await speak(next))) break;
      await checkGoal(roundBefore);
      if (!runningRef.current) break;
      if (untilRef.current !== null && roomRef.current.round >= untilRef.current) {
        clearTarget();
        break;
      }
      // Asked-for rounds run through even in step mode; otherwise step mode means one turn per click.
      const paceDelay = PACES[roomRef.current.pace].delayMs;
      const delay = untilRef.current !== null ? (paceDelay ?? 0) : paceDelay;
      if (delay === null) break;
      if (delay > 0) await wait(delay);
    }
    stopRunning();
  }

  function clearTarget() {
    untilRef.current = null;
    setUntil(null);
  }

  /** Run `n` full rounds, then pause. */
  function playRounds(n: number) {
    untilRef.current = roomRef.current.round + n;
    setUntil(untilRef.current);
    play(true);
  }

  function play(keepTarget = false) {
    if (running || speaking || room.order === "manual") return;
    if (!keepTarget) clearTarget();
    const limit = limitFor(roomRef.current, nextSpeaker(roomRef.current));
    if (limit) return setHalt(limit);
    setHalt(null);
    runningRef.current = true;
    setRunning(true);
    void loop();
  }

  function pause() {
    stopRunning();
    clearTarget();
    resumeAfterHuman.current = false;
  }

  function stop() {
    pause();
    abortRef.current?.abort();
    stopSpeaking();
  }

  /** Exactly one turn, also while paused; in manual order for the chosen participant. */
  async function step(p?: Participant) {
    if (speaking) return;
    const r = roomRef.current;
    const next = p ?? nextSpeaker(r);
    const limit = limitFor(r, next);
    if (limit) return setHalt(limit);
    if (!next || next.human) return;
    setHalt(null);
    const roundBefore = r.round;
    if (await speak(next)) await checkGoal(roundBefore);
  }

  /** The failed turn once more: its empty attempt goes, and the room carries on as it was. */
  function retry(h: Halt) {
    const p = roomRef.current.participants.find((x) => x.id === h.retry);
    if (!p) return setHalt(null);
    update((r) => {
      const last = r.messages[r.messages.length - 1];
      const failed = last?.authorId === p.id && last.error && !last.content;
      return failed ? { ...r, messages: r.messages.slice(0, -1) } : r;
    });
    setHalt(null);
    if (h.resume && roomRef.current.order !== "manual") play(true);
    else void step(p);
  }

  function raise(fix: "rounds" | "budget") {
    update((r) => (fix === "rounds" ? { ...r, maxRounds: r.maxRounds + 2 } : { ...r, budget: Math.round((r.budget + 0.5) * 100) / 100 }));
    setHalt(null);
  }

  // ---- user input & edits ------------------------------------------------------

  function send() {
    const text = draft.trim();
    if (!text) return;
    const author = human?.id ?? HOST;
    const r = roomRef.current;
    // @Name always picks the next speaker; a human leader can also just name someone.
    const to = addressee(r, author, text, !!human?.leads);
    update((x) => ({
      ...x,
      messages: [
        ...x.messages,
        { id: crypto.randomUUID(), authorId: author, content: text, round: r.round, createdAt: Date.now() },
      ],
      ...(human && nextSpeaker(x)?.id === human.id ? afterTurn(x, human.id) : {}),
      ...(to ? { nextUp: to } : {}),
    }));
    setDraft("");
    if (resumeAfterHuman.current && humanTurn) {
      resumeAfterHuman.current = false;
      setTimeout(() => play(true));
    }
  }

  /** A fitting voice for every AI participant that has none yet: chosen by a cheap model, by rule if that fails. */
  async function ensureVoices() {
    const r = roomRef.current;
    const missing = r.participants.filter((p) => !p.human && !p.voice);
    if (!missing.length) return;
    let picked: Record<string, string> = {};
    let usage: Usage | undefined;
    if (models) {
      try {
        const res = await complete({
          apiKey,
          model: pickChecker(models, 4_000, missing[0].model),
          messages: voiceMessages(r.participants),
          signal: new AbortController().signal,
        });
        picked = parseVoices(res.text, missing);
        usage = res.usage;
      } catch {
        /* the rule below still gives everyone a voice */
      } finally {
        props.onSpent();
      }
    }
    const taken = [...r.participants.map((p) => p.voice).filter((v): v is string => !!v), ...Object.values(picked)];
    const voices = { ...picked, ...fallbackVoices(r.participants.filter((p) => !picked[p.id]), taken) };
    update((x) => ({ ...x, participants: x.participants.map((p) => (voices[p.id] && !p.voice ? { ...p, voice: voices[p.id] } : p)) }));
    note(
      `Stimmen: ${missing
        .filter((p) => voices[p.id])
        .map((p) => `${p.name} – ${voiceLabel(voices[p.id])}`)
        .join(", ")}. Ändern kannst du sie per Klick auf den Teilnehmer.`,
      usage,
    );
  }

  /** One turn read aloud in the participant's voice; resolves when it has been spoken (or stopped). */
  async function readTurn(p: Participant, messageId: string, text: string) {
    try {
      await toggleSpeaking(`room-${messageId}`, text, { mode: "natural", apiKey, naturalVoice: p.voice, label: p.name });
    } catch (e) {
      update((x) => ({ ...x, readAloud: false }));
      setHalt({ reason: `Vorlesen ist fehlgeschlagen und wurde ausgeschaltet: ${(e as Error).message}` });
    }
  }

  function note(text: string, usage?: Usage, extra?: Pick<RoomMessage, "goal">) {
    const r = roomRef.current;
    update((x) => ({
      ...x,
      messages: [
        ...x.messages,
        { id: crypto.randomUUID(), authorId: SYSTEM, content: text, usage, round: r.round, createdAt: Date.now(), ...extra },
      ],
    }));
  }

  function editParticipant(id: string, change: Partial<Participant>) {
    const before = roomRef.current.participants.find((p) => p.id === id);
    if (!before) return;
    update((r) => {
      const participants = r.participants.map((p) => (p.id === id ? { ...p, ...change } : p));
      return { ...r, participants: change.leads ? withLeader(participants, id) : participants };
    });
    const after = { ...before, ...change };
    const parts: string[] = [];
    if (change.leads !== undefined && !!change.leads !== !!before.leads)
      parts.push(after.leads ? "leitet ab jetzt das Gespräch" : "leitet nicht mehr");
    if (change.roleName !== undefined && change.roleName !== before.roleName) parts.push(`Rolle jetzt ${after.roleName}`);
    if (change.model && change.model !== before.model) parts.push(`antwortet jetzt mit ${modelLabel(after.model)}`);
    if (change.paused !== undefined && change.paused !== before.paused) parts.push(after.paused ? "pausiert" : "macht wieder mit");
    if (parts.length && roomRef.current.messages.length) note(`${after.name}: ${parts.join(", ")}. Gilt ab dem nächsten Zug.`);
  }

  /** Changes from the settings dialog: from the next turn on, with a note in the conversation saying what changed. */
  function applyRules(next: RoomRules) {
    const r = roomRef.current;
    const parts: string[] = [];
    if (next.topic !== r.topic) parts.push("Thema geändert");
    if (next.cast !== (r.cast ?? "")) parts.push("Wer-ist-wer geändert");
    if (next.goal !== (r.goal ?? "")) parts.push(next.goal ? "Ziel geändert" : "Ziel entfernt");
    if (next.order !== r.order) parts.push(`Reihenfolge: ${ORDERS[next.order].split(" (")[0]}`);
    if (next.maxRounds !== r.maxRounds) parts.push(`höchstens ${next.maxRounds} Runden`);
    if (next.budget !== r.budget) parts.push(`Budget ${formatCost(next.budget)}`);
    if (next.aiAware !== r.aiAware) parts.push(next.aiAware ? "die Teilnehmer wissen, dass sie KI sind" : "die Teilnehmer bleiben in ihren Rollen");
    const goalChanged = next.goal !== (r.goal ?? "");
    update((x) => ({
      ...x,
      ...next,
      titleSource: next.title !== x.title ? "user" : x.titleSource,
      goal: next.goal || undefined,
      cast: next.cast || undefined,
      // A new goal is checked afresh.
      goalMet: goalChanged ? undefined : x.goalMet,
    }));
    if (parts.length && r.messages.length) note(`Einstellungen: ${parts.join(", ")}. Gilt ab dem nächsten Beitrag.`);
    // More rounds or budget lift a stop they caused.
    if (halt?.fix && !limitFor(roomRef.current, nextSpeaker(roomRef.current))) setHalt(null);
  }

  function storeTemplate(name: string, download: boolean, rules: RoomRules) {
    try {
      const t = templateOf({ ...roomRef.current, ...rules, goal: rules.goal || undefined, cast: rules.cast || undefined }, name);
      saveTemplate(t);
      if (download) downloadText(fileName(t.name).replace(/\.md$/, ".vorlage.json"), templateFile([t]), "application/json");
      setTemplateNotice(`Vorlage „${t.name}“ gespeichert. Du findest sie beim Erstellen eines Chatrooms unter „Meine Vorlagen“.`);
    } catch (e) {
      setTemplateNotice((e as Error).message);
    }
  }

  function startAdding() {
    const r = roomRef.current;
    const role = leaderOf(r) ? "ideas" : "moderator";
    const used = new Set(r.participants.map((p) => p.color));
    const color = [0, 1, 2, 3, 4, 5].find((c) => !used.has(c)) ?? r.participants.length % 6;
    // Leading needs an overview of the whole conversation; a top model pays off there.
    const model = tierModels(role === "moderator" ? "top" : "cheap", models)[0];
    setAdding({ ...makeParticipant(role, r.participants.length, model), color, name: freshName(r) });
  }

  function freshName(r: Room) {
    const taken = new Set(r.participants.map((p) => p.name));
    return ["Sam", "Noa", "Kim", "Alex", "Robin", "Luca", "Yara"].find((n) => !taken.has(n)) ?? `Gast ${r.participants.length + 1}`;
  }

  function confirmAdd() {
    if (!adding) return;
    const p = adding;
    update((r) => {
      // A leader joins at the front and takes the word right away.
      const participants = p.leads ? withLeader([p, ...r.participants], p.id) : [...r.participants, p];
      return { ...r, participants, ...(p.leads ? { nextUp: p.id } : {}) };
    });
    if (roomRef.current.messages.length) {
      note(`${p.name} (${p.roleName}) ist dazugekommen${p.leads ? " und leitet ab jetzt das Gespräch" : ""}.`);
    }
    setAdding(null);
  }

  async function makeProtocol() {
    if (!models) return;
    setProtocol({ text: "", loading: true });
    try {
      const r = roomRef.current;
      // The protocol ends with a recommendation for the real situation: worth the stronger judge.
      const model = judgeOf(r, models);
      const res = await complete(
        { apiKey, model, messages: protocolMessages(r), signal: new AbortController().signal },
        (text) => setProtocol({ text, loading: true }),
      );
      setProtocol({ text: res.text.trim(), loading: false, cost: res.usage?.cost });
      if (res.usage) note("Ergebnisprotokoll erstellt.", res.usage);
    } catch (e) {
      setProtocol({ text: "", loading: false, error: (e as Error).message });
    } finally {
      props.onSpent();
    }
  }

  function modelLabel(id: string) {
    const m = byId.get(id);
    return m ? shortName(m) : id;
  }

  const setPace = (pace: Pace) => {
    update((r) => ({ ...r, pace }));
    if (pace === "fast") skipWait.current?.();
  };

  // ---- render ----------------------------------------------------------------

  const participantsById = new Map(room.participants.map((p) => [p.id, p]));
  const editingP = room.participants.find((p) => p.id === editing);
  const speakingP = speaking ? participantsById.get(speaking) : undefined;
  const status = summarizing
    ? "Fasse ältere Beiträge zusammen …"
    : checking
    ? "Prüfe, ob das Ziel erreicht ist …"
    : speakingP
    ? `${speakingP.name} spricht …`
    : waitUntil
      ? `Als Nächstes: ${upcoming?.name ?? "…"} in ${Math.max(0, Math.ceil((waitUntil - now) / 1000))} s`
      : humanTurn
        ? `Du bist dran, ${upcoming!.name}. Schreib deinen Beitrag unten.`
        : running
          ? until
            ? `Läuft bis zum Ende von Runde ${until - 1} …`
            : "Läuft bis zum Limit …"
          : room.order === "manual"
            ? "Manuelle Reihenfolge: Klicke bei einem Teilnehmer auf „Sprechen lassen“."
            : room.messages.length
              ? `Pausiert in Runde ${Math.min(room.round, room.maxRounds)}. Weiter mit „Runde abspielen“, „Nächster Zug“ oder Play.`
              : "Bereit. Starte das Gespräch mit Play.";

  return (
    <div className="room" aria-busy={!!speaking || checking || summarizing}>
      <header className="room-head">
        <button className="ghost icon-only menu-button" onClick={props.onOpenMenu} aria-label="Räume anzeigen">
          <Icon name="menu" />
        </button>
        <div className="room-title">
          <h1>{room.title}</h1>
          {room.goal && <p className="room-goal">Ziel: {room.goal}</p>}
        </div>
        <button
          className="button small"
          onClick={() => setSettingsOpen(true)}
          title="Teilnehmer, Thema, Ziel und Regeln ansehen oder ändern; als Vorlage speichern"
        >
          <Icon name="settings" size={15} />
          Einstellungen
        </button>
        <button
          className="button small review-button"
          onClick={() => setReviewOpen(true)}
          disabled={!room.messages.some((m) => m.content && m.authorId !== SYSTEM)}
          title="Ein unabhängiges Modell bewertet das Gespräch: Ergebnis, wer überzeugt hat, Fazit und was du daraus lernen kannst. Danach kannst du mit ihm darüber reden."
        >
          <Icon name="sparkle" size={15} />
          {room.review ? "Bewertung" : "Bewerten"}
        </button>
        <button
          className="button small"
          onClick={makeProtocol}
          disabled={!room.messages.some((m) => m.content && m.authorId !== SYSTEM) || !!protocol?.loading}
          title="Kernpunkte, Einigungen und offene Punkte zusammenfassen"
        >
          <Icon name="file" size={15} />
          Protokoll
        </button>
        <ExportMenu
          disabled={!room.messages.some((m) => m.content && m.authorId !== SYSTEM)}
          onText={() => downloadText(fileName(room.title), roomToMarkdown(room, modelLabel))}
          onAudio={() => setAudioOpen(true)}
        />
        <dl className="room-stats">
          <div>
            <dt>Runde</dt>
            <dd>
              {Math.min(room.round, room.maxRounds)} von {room.maxRounds}
            </dd>
          </div>
          <div>
            <dt>Kosten</dt>
            <dd className={spent >= room.budget * 0.8 ? "warn" : undefined}>
              {formatCost(spent) || "$0"} von {formatCost(room.budget)}
            </dd>
          </div>
          <div className="hide-mobile">
            <dt>Nächste Runde</dt>
            <dd>ca. {formatCost(perRound)}</dd>
          </div>
        </dl>
      </header>

      <div className="room-body">
        <aside className="room-people" aria-label="Teilnehmer">
          {room.participants.map((p) => {
            const isNext = upcoming?.id === p.id && !speaking;
            return (
              <div
                key={p.id}
                className={`person${speaking === p.id ? " speaking" : ""}${p.paused ? " paused" : ""}${isNext ? " next" : ""}`}
                style={{ "--c": p.human ? "var(--ink-2)" : PALETTE[p.color] } as React.CSSProperties}
              >
                <button className="person-main" onClick={() => setEditing(p.id)} title="Bearbeiten">
                  <span className="avatar" aria-hidden="true">
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="person-text">
                    <span className="person-name">
                      {p.name}
                      {speaking === p.id && <span className="person-state">spricht</span>}
                      {p.paused && <span className="person-state">pausiert</span>}
                      {p.leads && <span className="person-state lead">leitet</span>}
                    </span>
                    <span className="person-role">{p.roleName || "Teilnehmer"}</span>
                    <span className="person-model">
                      <span className={lacksModel(p, models) ? "error-text" : undefined}>
                        {p.human ? "Du" : lacksModel(p, models) ? "Kein Modell, bitte wählen" : modelLabel(p.model)}
                      </span>
                      {!p.human && participantCost(room, p.id) > 0 && <span>{formatCost(participantCost(room, p.id))}</span>}
                    </span>
                    {p.finalOnly && <span className="person-role">Spricht erst in der letzten Runde</span>}
                    {room.readAloud && p.voice && !p.human && <span className="person-role">Stimme: {voiceLabel(p.voice)}</span>}
                  </span>
                </button>
                {room.order === "manual" && !p.human && !p.paused && (
                  <button className="button small speak-now" onClick={() => step(p)} disabled={!!speaking}>
                    Sprechen lassen
                  </button>
                )}
              </div>
            );
          })}
          <button
            className="ghost small add-person"
            onClick={startAdding}
            disabled={room.participants.filter((p) => !p.human).length >= 6}
          >
            <Icon name="plus" size={14} />
            Teilnehmer hinzufügen
          </button>
          <p className="hint people-hint">
            Klick auf einen Teilnehmer, um Rolle, Modell oder Länge zu ändern. Moderator, Interviewer und Mediator
            übernehmen beim Hinzufügen die Leitung.
          </p>
        </aside>

        <div className="room-transcript" ref={scroller}>
          <div className="room-topic">
            <span>Thema</span>
            <p>{room.topic}</p>
            {room.cast && (
              <details className="room-cast">
                <summary>Wer ist wer</summary>
                <Markdown text={room.cast} />
              </details>
            )}
          </div>
          {room.messages.map((m) => {
            if (m.authorId === SYSTEM && m.goal) {
              return (
                <GoalCard
                  key={m.id}
                  text={m.content}
                  running={running}
                  onReview={() => {
                    // Ends now, so the evaluation covers everything that was said.
                    stop();
                    setReviewOpen(true);
                  }}
                  onPause={pause}
                />
              );
            }
            if (m.authorId === SYSTEM) {
              return (
                <p key={m.id} className="room-note">
                  {m.content}
                </p>
              );
            }
            const p = participantsById.get(m.authorId);
            const mine = m.authorId === HOST || p?.human;
            return (
              <article
                key={m.id}
                className={`room-msg${mine ? " mine" : ""}${speaking && m.id === room.messages[room.messages.length - 1]?.id && !mine ? " live" : ""}`}
                style={{ "--c": p && !p.human ? PALETTE[p.color] : "var(--ink-2)" } as React.CSSProperties}
              >
                <header className="room-by">
                  <span className="room-by-name">{m.authorId === HOST ? "Du (Gesprächsleitung)" : (p?.name ?? "Teilnehmer")}</span>
                  {p && !p.human && <span>{p.roleName}</span>}
                  {m.model && <span className="room-by-meta">{modelLabel(m.model)}</span>}
                  {m.usage?.cost !== undefined && <span className="room-by-meta">{formatCost(m.usage.cost)}</span>}
                </header>
                {m.content ? (
                  <Markdown text={m.content} />
                ) : !m.error ? (
                  <div className="pending" role="status">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </div>
                ) : null}
                {m.error && <div className="msg-error">{m.error}</div>}
                {p && !p.human && m.content && !(speaking && m.id === room.messages[room.messages.length - 1]?.id) && (
                  <RoomReadButton
                    id={`room-${m.id}`}
                    name={p.name}
                    onRead={async () => {
                      // The voice is chosen the first time someone wants to hear the room.
                      if (!roomRef.current.participants.find((x) => x.id === p.id)?.voice) await ensureVoices();
                      const voice = roomRef.current.participants.find((x) => x.id === p.id)?.voice;
                      await toggleSpeaking(`room-${m.id}`, m.content, { mode: "natural", apiKey, naturalVoice: voice, label: p.name });
                    }}
                    onError={(message) => setHalt({ reason: `Vorlesen ist fehlgeschlagen: ${message}` })}
                  />
                )}
              </article>
            );
          })}
          {halt && (
            <HaltCard
              halt={halt}
              remaining={Math.max(0, room.maxRounds - room.round + 1)}
              onReview={() => setReviewOpen(true)}
              onMoreRounds={() => {
                raise("rounds");
                playRounds(2);
              }}
              onMoreBudget={() => {
                raise("budget");
                play();
              }}
              onRetry={() => retry(halt)}
              onChangeModel={() => {
                setHalt(null);
                setEditing(halt.retry ?? null);
              }}
              onDismiss={() => setHalt(null)}
            />
          )}
        </div>
      </div>

      <footer className="room-controls">
        <SpeechBar />
        <p className="room-status" aria-live="polite">
          {waitUntil && (
            <button className="link-button" onClick={() => skipWait.current?.()}>
              Jetzt
            </button>
          )}
          {status}
        </p>
        <div className="room-bar">
          <div className="room-buttons">
            {running ? (
              <button className="button primary" onClick={pause} title="Hält nach dem laufenden Beitrag an">
                <Icon name="pause" size={15} />
                Pause
              </button>
            ) : (
              <button
                className="button primary"
                onClick={() => play()}
                disabled={!!speaking || room.order === "manual" || humanTurn}
                title={room.order === "manual" ? "In manueller Reihenfolge wählst du, wer spricht" : "Gespräch laufen lassen"}
              >
                <Icon name="play" size={15} />
                Play
              </button>
            )}
            <button className="button" onClick={stop} disabled={!running && !speaking} title="Bricht auch den laufenden Beitrag ab">
              <Icon name="stop" size={12} />
              Stopp
            </button>
            <button
              className="button"
              onClick={() => step()}
              disabled={running || !!speaking || room.order === "manual" || humanTurn}
              title="Genau ein Beitrag"
            >
              Nächster Zug
            </button>
            <span className="rounds-run">
              <label className="visually-hidden" htmlFor="batch">
                Anzahl Runden
              </label>
              <select id="batch" className="select" value={batch} onChange={(e) => setBatch(Number(e.target.value))}>
                {[1, 2, 3, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button
                className="button"
                onClick={() => playRounds(batch)}
                disabled={running || !!speaking || room.order === "manual" || humanTurn}
                title={`Spielt ${batch === 1 ? "eine ganze Runde" : `${batch} ganze Runden`} und pausiert dann. Ca. ${formatCost(perRound * batch)}.`}
              >
                {batch === 1 ? "Runde abspielen" : "Runden abspielen"}
              </button>
            </span>
          </div>

          <fieldset className="pace" aria-label="Aktivität">
            <legend className="visually-hidden">Aktivität</legend>
            {(Object.keys(PACES) as Pace[]).map((id) => (
              <label key={id} title={PACES[id].hint} className={room.pace === id ? "on" : undefined}>
                <input type="radio" name="pace" checked={room.pace === id} onChange={() => setPace(id)} />
                {PACES[id].label}
              </label>
            ))}
          </fieldset>

          <label className="check inline ai-aware" title="Gilt ab dem nächsten Zug">
            <input
              type="checkbox"
              checked={room.aiAware}
              onChange={(e) => {
                update((r) => ({ ...r, aiAware: e.target.checked }));
                if (room.messages.length)
                  note(e.target.checked ? "Die Teilnehmer wissen jetzt, dass sie KI-Modelle sind." : "Die Teilnehmer bleiben in ihren Rollen und wissen nicht, dass sie KI sind.");
              }}
            />
            Wissen, dass sie KI sind
          </label>

          <label
            className="check inline read-aloud"
            title="Jeder Beitrag wird mit einer eigenen, passenden KI-Stimme vorgelesen; der nächste wartet, bis er gesprochen ist. Kostet etwa 1 Cent pro Minute."
          >
            <input
              type="checkbox"
              checked={!!room.readAloud}
              onChange={(e) => {
                const on = e.target.checked;
                update((r) => ({ ...r, readAloud: on }));
                if (on) void ensureVoices();
                else stopSpeaking();
              }}
            />
            Automatisch vorlesen
          </label>

          <label className="room-order">
            <span className="visually-hidden">Reihenfolge</span>
            <select className="select" value={room.order} onChange={(e) => update((r) => ({ ...r, order: e.target.value as Order }))}>
              {Object.entries(ORDERS).map(([id, l]) => (
                <option key={id} value={id}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>

        <form
          className="room-input"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              humanTurn
                ? `Dein Beitrag als ${human?.roleName || human?.name}`
                : human
                  ? `Eingreifen als ${human.name}, mit @Name sprichst du jemanden direkt an`
                  : "Eingreifen: Frage oder Hinweis für alle, mit @Name sprichst du jemanden direkt an"
            }
            aria-label="Eigener Beitrag"
          />
          <DictateButton
            apiKey={apiKey}
            onText={(spoken) => setDraft((d) => (d.trim() ? `${d.trimEnd()} ${spoken}` : spoken))}
            onError={(message) => setHalt({ reason: message })}
          />
          <button className="send" type="submit" disabled={!draft.trim()} aria-label="Beitrag senden">
            <Icon name="send" />
          </button>
        </form>
      </footer>

      {settingsOpen && (
        <RoomSettings
          room={room}
          models={models}
          onApply={applyRules}
          onEditParticipant={setEditing}
          onAddParticipant={startAdding}
          onSaveTemplate={storeTemplate}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {templateNotice && (
        <div className="toast" role="status">
          <span>{templateNotice}</span>
          <button className="link-button" onClick={() => setTemplateNotice(null)}>
            OK
          </button>
        </div>
      )}

      {editingP && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title" onKeyDown={(e) => e.key === "Escape" && setEditing(null)}>
            <header className="dialog-head">
              <h2 id="edit-title">{editingP.name} bearbeiten</h2>
              <button className="ghost icon-only" onClick={() => setEditing(null)} aria-label="Schließen">
                <Icon name="close" />
              </button>
            </header>
            <ParticipantFields
              participant={editingP}
              models={models}
              onChange={(c) => editParticipant(editingP.id, c)}
              apiKey={apiKey}
              onPickModel={() => setPicking(editingP.id)}
            />
            {!editingP.human && (
              <>
                <div className="field">
                  <div className="field-row">
                    <label htmlFor="p-temp">Temperatur</label>
                    <span className="field-value">
                      {editingP.temperature === undefined ? "Standard" : editingP.temperature.toFixed(1).replace(".", ",")}
                    </span>
                  </div>
                  <input
                    id="p-temp"
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={editingP.temperature ?? 1}
                    onChange={(e) => editParticipant(editingP.id, { temperature: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="p-voice">Stimme beim Vorlesen</label>
                  <select
                    id="p-voice"
                    className="select"
                    value={editingP.voice ?? ""}
                    onChange={(e) => editParticipant(editingP.id, { voice: e.target.value || undefined })}
                  >
                    <option value="">Automatisch passend wählen</option>
                    {NATURAL_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {voiceLabel(v.id)}
                      </option>
                    ))}
                  </select>
                </div>
                {editingP.roleId !== "custom" && (
                  <details className="role-text">
                    <summary>Anweisung der Rolle ansehen</summary>
                    <p>{editingP.rolePrompt}</p>
                  </details>
                )}
              </>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={!!editingP.leads}
                onChange={(e) => editParticipant(editingP.id, { leads: e.target.checked })}
              />
              Leitet das Gespräch: Alle anderen folgen den Anweisungen zum Ablauf
            </label>
            <footer className="dialog-foot spread">
              <div className="dialog-buttons">
                <button
                  className="button"
                  onClick={() => editParticipant(editingP.id, { paused: !editingP.paused })}
                  disabled={!editingP.paused && room.participants.filter((p) => !p.human && !p.paused).length <= 1 && !editingP.human}
                >
                  {editingP.paused ? "Wieder mitmachen lassen" : "Pausieren"}
                </button>
              </div>
              <button className="button primary" onClick={() => setEditing(null)}>
                Fertig
              </button>
            </footer>
          </div>
        </div>
      )}

      {adding && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setAdding(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title" onKeyDown={(e) => e.key === "Escape" && setAdding(null)}>
            <header className="dialog-head">
              <h2 id="add-title">Teilnehmer hinzufügen</h2>
              <button className="ghost icon-only" onClick={() => setAdding(null)} aria-label="Schließen">
                <Icon name="close" />
              </button>
            </header>
            <ParticipantFields
              participant={adding}
              models={models}
              onChange={(c) => setAdding((a) => (a ? { ...a, ...c } : a))}
              apiKey={apiKey}
              onPickModel={() => setPicking("__adding")}
            />
            {adding.leads && (
              <p className="hint lead-hint">
                {adding.roleName} übernimmt die Leitung: Alle anderen folgen den Anweisungen zum Ablauf, behalten aber ihre
                Meinung. Für die Leitung lohnt sich ein Spitzenmodell, weil sie das ganze Gespräch überblicken muss.
                {leaderOf(room) && ` ${leaderOf(room)!.name} gibt die Leitung dann ab.`}
              </p>
            )}
            <footer className="dialog-foot">
              <button className="button" onClick={() => setAdding(null)}>
                Abbrechen
              </button>
              <button className="button primary" onClick={confirmAdd} disabled={!adding.name.trim()}>
                Hinzufügen
              </button>
            </footer>
          </div>
        </div>
      )}

      {protocol && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !protocol.loading && setProtocol(null)}>
          <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="protocol-title">
            <header className="dialog-head">
              <h2 id="protocol-title">Ergebnisprotokoll</h2>
              <button className="ghost icon-only" onClick={() => setProtocol(null)} aria-label="Schließen" disabled={protocol.loading}>
                <Icon name="close" />
              </button>
            </header>
            {protocol.error ? (
              <div className="msg-error">Das Protokoll konnte nicht erstellt werden: {protocol.error}</div>
            ) : protocol.text ? (
              <Markdown text={protocol.text} />
            ) : (
              <p className="hint">Wird erstellt …</p>
            )}
            <footer className="dialog-foot spread">
              <p className="hint">{protocol.cost !== undefined && `Kosten ${formatCost(protocol.cost)}.`}</p>
              <div className="dialog-buttons">
                <button
                  className="button"
                  disabled={!protocol.text || protocol.loading}
                  onClick={() => navigator.clipboard.writeText(protocol.text)}
                >
                  <Icon name="copy" size={15} />
                  Kopieren
                </button>
                <button className="button primary" onClick={() => setProtocol(null)} disabled={protocol.loading}>
                  Schließen
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {audioOpen && (
        <AudioPlayDialog
          room={room}
          judge={judge}
          apiKey={apiKey}
          ensureVoices={async () => {
            await ensureVoices();
            return roomRef.current;
          }}
          onReview={(review) => update((r) => ({ ...r, review }))}
          onSpent={props.onSpent}
          onClose={() => setAudioOpen(false)}
          director={models ? pickChecker(models, 30_000, room.participants.find((x) => !x.human)?.model ?? judge) : judge}
          musicModel={musicLevels(models)[0]?.model}
        />
      )}

      {reviewOpen && (
        <ReviewDialog
          room={room}
          judge={judge}
          models={models}
          apiKey={apiKey}
          onSave={(review) => update((r) => ({ ...r, review }))}
          onContinue={() => {
            setReviewOpen(false);
            if (roundsDone(roomRef.current)) raise("rounds");
            update((r) => ({ ...r, goalMet: r.goalMet || !!r.goal }));
            setHalt(null);
            playRounds(2);
          }}
          onPickJudge={() => setPicking("__judge")}
          onSpent={props.onSpent}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {picking && (
        <ModelPicker
          models={models}
          error={null}
          current={
            picking === "__judge"
              ? judge
              : picking === "__adding"
                ? (adding?.model ?? "")
                : (room.participants.find((p) => p.id === picking)?.model ?? "")
          }
          favorites={props.favorites}
          recents={props.recents}
          onSelect={(id) => {
            if (picking === "__judge") update((r) => ({ ...r, judge: id }));
            else if (picking === "__adding") setAdding((a) => (a ? { ...a, model: id } : a));
            else editParticipant(picking, { model: id });
            setPicking(null);
          }}
          onToggleFavorite={props.onToggleFavorite}
          onRetry={() => {}}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}


/** "Vorlesen" under a contribution, as under a chat answer: reads it in the character's voice, or stops. */
function RoomReadButton(props: { id: string; name: string; onRead: () => Promise<void>; onError: (message: string) => void }) {
  const state = useSpeechState(props.id);
  return (
    <div className="room-msg-actions">
      <button
        className={`ghost small${state ? " speaking" : ""}`}
        onClick={() => (state ? stopSpeaking() : void props.onRead().catch((e) => props.onError((e as Error).message)))}
        title={state ? "Vorlesen beenden" : `Mit der Stimme von ${props.name} vorlesen`}
      >
        <Icon name={state && state !== "loading" ? "stop" : "speaker"} size={14} />
        {state === "loading" ? "Lädt …" : state ? "Stopp" : "Vorlesen"}
      </button>
    </div>
  );
}

/** A stop in the conversation, as a card where it happened: what happened, why, and the ways on. */
function HaltCard(props: {
  halt: Halt;
  remaining: number;
  onReview: () => void;
  onMoreRounds: () => void;
  onMoreBudget: () => void;
  onRetry: () => void;
  onChangeModel: () => void;
  onDismiss: () => void;
}) {
  const { halt } = props;
  const kind = halt.fix === "rounds" ? "done" : halt.fix === "budget" ? "budget" : "problem";
  return (
    <section className={`room-halt ${kind}`} role="status" aria-live="polite">
      <span className="room-halt-icon" aria-hidden="true">
        <Icon name={kind === "done" ? "check" : kind === "budget" ? "wallet" : "pause"} size={16} />
      </span>
      <div className="room-halt-text">
        <h3>{halt.title ?? "Angehalten"}</h3>
        <p>{halt.reason}</p>
        <div className="room-halt-actions">
          {halt.fix === "rounds" && (
            <button className="button small primary" onClick={props.onReview}>
              <Icon name="sparkle" size={14} />
              Bewertung und Fazit
            </button>
          )}
          {halt.fix === "rounds" && (
            <button className="button small" onClick={props.onMoreRounds}>
              2 Runden mehr
            </button>
          )}
          {halt.fix === "budget" && (
            <button className="button small primary" onClick={props.onMoreBudget}>
              Budget um 0,50 $ erhöhen
            </button>
          )}
          {halt.retry && (
            <button className="button small primary" onClick={props.onRetry}>
              Erneut versuchen
            </button>
          )}
          {halt.retry && (
            <button className="button small" onClick={props.onChangeModel}>
              Anderes Modell wählen
            </button>
          )}
          {!halt.fix && (
            <button className="button small" onClick={props.onDismiss}>
              Verstanden
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The goal check found the goal reached. Only a note: the conversation keeps going, so the user can still
 * step in or let it run; ending it and getting the evaluation is one click away.
 */
function GoalCard(props: { text: string; running: boolean; onReview: () => void; onPause: () => void }) {
  // "Ziel erreicht nach Runde 2: Begründung" → title and reason.
  const cut = props.text.indexOf(": ");
  const title = cut === -1 ? "Ziel erreicht" : props.text.slice(0, cut);
  const reason = cut === -1 ? props.text : props.text.slice(cut + 2);
  return (
    <section className="room-halt done goal-card" role="status" aria-live="polite">
      <span className="room-halt-icon" aria-hidden="true">
        <Icon name="check" size={16} />
      </span>
      <div className="room-halt-text">
        <h3>{title}</h3>
        <p>
          {reason}
          {props.running && " Das Gespräch läuft weiter, du kannst jederzeit eingreifen oder es beenden."}
        </p>
        <div className="room-halt-actions">
          <button className="button small primary" onClick={props.onReview}>
            <Icon name="sparkle" size={14} />
            {props.running ? "Beenden und bewerten" : "Bewertung und Fazit"}
          </button>
          {props.running && (
            <button className="button small" onClick={props.onPause} title="Hält nach dem laufenden Beitrag an">
              Nur anhalten
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** "Export": the conversation as text, or as an audio play in the characters' voices. */
function ExportMenu(props: { disabled: boolean; onText: () => void; onAudio: () => void }) {
  const { open, setOpen, box } = usePopover();
  return (
    <div className="more" ref={box}>
      <button
        className="button small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={props.disabled}
        title="Gespräch speichern: als Text oder als Hörspiel"
      >
        <Icon name="download" size={15} />
        Export
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="more-menu down" role="menu" onClick={() => setOpen(false)}>
          <button role="menuitem" onClick={props.onText}>
            <Icon name="file" size={16} />
            Als Text (Markdown)
          </button>
          <button role="menuitem" onClick={props.onAudio}>
            <Icon name="speaker" size={16} />
            Als Hörspiel (MP3)
          </button>
        </div>
      )}
    </div>
  );
}
