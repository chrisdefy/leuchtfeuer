import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiKeyField, KeyStatus } from "./components/ApiKeyField";
import { ASPECT_RATIOS, Composer, type ComposerHandle } from "./components/Composer";
import { Icon } from "./components/Icon";
import { Markdown } from "./components/Markdown";
import { MessageView } from "./components/MessageView";
import { ModelPicker, isUncensored, setUnrestricted } from "./components/ModelPicker";
import { SettingsDialog } from "./components/SettingsDialog";
import { SummaryDialog } from "./components/SummaryDialog";
import {
  VideoDialog,
  canMakeSound,
  estimateVideoCost,
  minPricePerSecond,
  videoDefaults,
  type VideoOptions,
  type VideoRequest,
} from "./components/VideoDialog";
import { Sidebar, chatCost, type Mode } from "./components/Sidebar";
import { SignalField } from "./components/SignalField";
import { CHAT_TOUR, ROOM_TOUR, SIMPLE_CHAT_TOUR, Tour } from "./components/Tour";
import { TierMenu } from "./components/TierMenu";
import { CreateButton, MediaModeBar } from "./components/CreateMenu";
import { MEDIA_INFO, mediaLevels, type MediaKind } from "./lib/media";
import { autoTiers, formatAnswerCost, resolveTiers } from "./lib/tiers";
import { setHelperData } from "./lib/helpers";
import { fusionAnswerUsd, fusionBrief, fusionTeam } from "./lib/fusion";
import { ProfileMenu } from "./components/ProfileMenu";
import { ProfileDialog } from "./components/ProfileDialog";
import { Intro, introPending } from "./components/Intro";
import { findLinks } from "./lib/links";
import { VISUAL_GUIDE, asksForVisual } from "./lib/visual";
import { TEXT_GUIDE, cleanPassage, locate, passagePrompt } from "./lib/textwork";
import { SpeechBar } from "./components/SpeechBar";
import { OpenRouterLogin } from "./components/OpenRouterLogin";
import { KEYS_URL, completeLogin } from "./lib/auth";
import { convertAttachment, documentBlock, sendMode } from "./lib/documents";
import { DocumentDialog } from "./components/DocumentDialog";
import { backupDue, backupFileName, makeBackup, makeChatFile, mergeById, readBackup } from "./lib/backup";
import { importRoles, loadRoles } from "./lib/roleTemplate";
import { importTemplates, loadTemplates } from "./lib/roomTemplates";
import { stopSpeaking } from "./lib/speech";
import { Tooltips } from "./components/Tooltips";
import { Workbench, type PreparedChat } from "./components/Workbench";
import { RoomSetup } from "./components/room/RoomSetup";
import { RoomView } from "./components/room/RoomView";
import { makeParticipant, roomCost, tierModels, useRooms, withLeader, type Room } from "./lib/rooms";
import { useFolders } from "./lib/folders";
import {
  MAX_LANES,
  answeredBy,
  attributeHistory,
  chooseLane,
  laneHistory,
  laneOf,
  lanesOf,
  lastGeneratedImages,
  removeLane,
  sameModel,
  toTurns,
  type Turn,
} from "./lib/conversation";
import {
  contextUsage,
  seedNote,
  type ContextUsage,
} from "./lib/context";
import { enhancePrompt } from "./lib/enhance";
import { makeTitle } from "./lib/title";
import { chatToMarkdown, downloadText, fileName, forMessenger } from "./lib/exporting";
import { ShareMenu } from "./components/ShareMenu";
import { bestFreeModel, cachedScores, fetchScores, type Scores } from "./lib/benchmarks";
import {
  AttachmentError,
  attachmentDataUrl,
  blobIdsOf,
  deleteBlob,
  storeFile,
  storeAudio,
  storeGeneratedImage,
  storeVideo,
  type Attachment,
} from "./lib/files";
import { formatCost, formatPrice, formatTokens } from "./lib/format";
import {
  acceptsImages,
  audioRequest,
  canCallTools,
  downloadVideo,
  complete,
  fetchCredits,
  fetchFreeQuota,
  fetchModels,
  fetchVideoModels,
  freeResetTime,
  isFreeModelId,
  itemPrice,
  OpenRouterError,
  type FreeQuota,
  makesAudio,
  makesImages,
  perMillion,
  pollVideo,
  setZeroRetention,
  submitVideo,
  usableModels,
  type ContentPart,
  type VideoModel,
  type Source,
  providerLabel,
  shortName,
  streamChat,
  type ChatMessage,
  type Model,
  type Usage,
} from "./lib/openrouter";
import {
  NEW_DRAFT,
  isEmptyDraft,
  readDrafts,
  saveDrafts,
  uid,
  useChats,
  useSettings,
  type Chat,
  type Draft,
  type FusionAnswer,
  type Message,
  type Profile,
  type Settings,
} from "./lib/storage";

const MODELS_CACHE = "router.models.v1";
/** Author id of merged "Beste Antwort" answers in handover notes. */
const BEST_AUTHOR = "router/beste-antwort";
const MODELS_TTL = 60 * 60 * 1000;

function readModelCache(): Model[] | null {
  try {
    const raw = localStorage.getItem(MODELS_CACHE);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    return Date.now() - at < MODELS_TTL ? usableModels(data) : null;
  } catch {
    return null;
  }
}

/** Which model slot the picker fills. */
/** The demo chat the guided tour opens; removed again when the tour ends. */
const TOUR_CHAT = "router-tour-demo";
/** The demo room of the chatroom tour; removed again when the tour ends. */
const TOUR_ROOM = "router-room-tour-demo";

type PickerTarget = { kind: "replace"; lane: number; filter?: "vision" | "tools" } | { kind: "add" };

/** Videos above this price (USD), or with a price unknown up front, are confirmed once before they are made. */
const VIDEO_CONFIRM_USD = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [settings, setSettings] = useSettings();
  const [chats, setChats] = useChats();
  const [rooms, setRooms] = useRooms();
  const [folders, setFolders] = useFolders();
  const [mode, setMode] = useState<Mode>("chats");
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomSetupOpen, setRoomSetupOpen] = useState(false);
  const [roomUndo, setRoomUndo] = useState<{ room: Room; timer: number } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Unsent input per chat, so switching chats loses nothing. The one on screen lives in the draft states below. */
  const [drafts] = useState(() => ({ current: readDrafts(new Set(chats.map((c) => c.id))) }));
  const startDraft = drafts.current[NEW_DRAFT];
  const [draft, setDraft] = useState(startDraft?.text ?? "");
  const [draftLanes, setDraftLanes] = useState<string[] | null>(startDraft?.lanes ?? null);
  const [models, setModels] = useState<Model[] | null>(readModelCache);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  /** Document whose converted text is shown: in the draft or in a sent message. */
  const [docOpen, setDocOpen] = useState<{ id: string; where: "draft" | { chatId: string; messageId: string } } | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoModel, setVideoModel] = useState<string | undefined>();
  const [videoModels, setVideoModels] = useState<VideoModel[] | null>(null);
  const [draftFiles, setDraftFiles] = useState<Attachment[]>(startDraft?.files ?? []);
  const [attaching, setAttaching] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [draftWeb, setDraftWeb] = useState<boolean | null>(startDraft?.web ?? null);
  const [draftVisual, setDraftVisual] = useState<boolean | null>(startDraft?.visual ?? null);
  const [draftFusion, setDraftFusion] = useState<boolean | null>(startDraft?.fusion ?? null);
  /** Profile of the new chat; undefined = the default profile from the settings, null = none. */
  const [draftProfile, setDraftProfile] = useState<string | null | undefined>(startDraft?.profile);
  const [profilesOpen, setProfilesOpen] = useState(false);
  /** The start sequence, once per browser tab. */
  const [intro, setIntro] = useState(introPending);
  /** Which guided tour is open: through a chat or through a chatroom. */
  const [tour, setTour] = useState<"chat" | "room" | null>(null);
  /** The room that was open before the chatroom tour, to return to afterwards. */
  const roomBeforeTour = useRef<string | null>(null);
  const [draftReasoning, setDraftReasoning] = useState<"low" | "high" | undefined>(startDraft?.reasoning);
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIOS[0]);
  const [dragging, setDragging] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  /** Draft text before "Verbessern", so the user can go back. */
  const [draftOriginal, setDraftOriginal] = useState<{ text: string; note: string } | null>(startDraft?.original ?? null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** messageId → chatId for every answer currently streaming. */
  const [streams, setStreams] = useState<Record<string, string>>({});
  const [credits, setCredits] = useState<{ remaining: number; total: number } | null>(null);
  const [freeQuota, setFreeQuota] = useState<FreeQuota | null>(null);
  const [scores, setScores] = useState<Map<string, Scores> | null>(cachedScores);
  const [undo, setUndo] = useState<{ chat: Chat; timer: number } | null>(null);
  /** History for "Bis hier zusammenfassen"; null = the whole chat. */
  const [summaryHistory, setSummaryHistory] = useState<Message[] | null>(null);
  const [onboardingKey, setOnboardingKey] = useState("");
  /** Short message after logging in (or why it failed). */
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const controllers = useRef(new Map<string, AbortController>());
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const activeChat = chats.find((c) => c.id === activeId) ?? null;
  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? null;
  const bestFree = useMemo(() => bestFreeModel(models, scores), [models, scores]);
  const autoDefault = settings.defaultMode !== "last";
  const freePin = settings.tiers?.free;
  const defaultModel = autoDefault ? (freePin && models?.some((m) => m.id === freePin) ? freePin : bestFree.id) : settings.defaultModel;
  const autoTierMap = useMemo(() => autoTiers(models, scores, isUncensored), [models, scores]);
  const modelById = useMemo(() => new Map((models ?? []).map((m) => [m.id, m])), [models]);
  const videoById = useMemo(() => new Map((videoModels ?? []).map((m) => [m.id, m])), [videoModels]);
  const tiers = useMemo(() => resolveTiers(autoTierMap, settings.tiers, (id) => modelById.has(id)), [autoTierMap, settings.tiers, modelById]);
  /** "Beste Antwort": the models that answer together; the first one merges. */
  const team = useMemo(() => fusionTeam(models, scores, isUncensored), [models, scores]);
  const teamCost = useMemo(() => fusionAnswerUsd(team.map((id) => modelById.get(id)!).filter(Boolean)), [team, modelById]);
  const profiles = settings.profiles ?? [];
  const profileById = (id?: string | null) => (id ? profiles.find((p) => p.id === id) : undefined);
  /** The new chat's profile, until it is chosen differently there. */
  const draftProfileObj = profileById(draftProfile === undefined ? settings.defaultProfile : draftProfile);
  const profileId = activeChat ? activeChat.profile?.id : draftProfileObj?.id;
  /** The model a profile's level stands for. */
  const profileModel = (p?: Profile) => (!p?.level ? undefined : p.level === "best" ? team[0] : tiers[p.level]);
  const lanes = activeChat
    ? lanesOf(activeChat)
    : (draftLanes ?? [profileModel(draftProfileObj) ?? defaultModel]);
  const comparing = lanes.length > 1;
  /** A video model chosen as the chat's model turns the composer into video input. */
  const videoLane = !comparing ? videoById.get(lanes[0]) : undefined;
  const videoName = (v: VideoModel) => v.name.replace(/^[^:]+:\s*/, "");
  /** "Erzeugen": the input bar makes an image, a video or music at a level, in this chat. */
  const [create, setCreateState] = useState<{ kind: MediaKind; level: number } | null>(null);
  /** The level last used per kind, so "Erzeugen" opens where the user left it. */
  const createLevel = useRef<Partial<Record<MediaKind, number>>>({});
  const setCreate = (next: { kind: MediaKind; level: number } | null) => {
    if (next) createLevel.current[next.kind] = next.level;
    setCreateState(next);
  };
  const createKind = create?.kind;
  const levelLists = useMemo(
    () => ({
      image: mediaLevels("image", models, videoModels),
      video: mediaLevels("video", models, videoModels),
      music: mediaLevels("music", models, videoModels),
    }),
    [models, videoModels],
  );
  const createLevels = createKind ? levelLists[createKind] : [];
  const createModel = create ? createLevels[Math.min(create.level, createLevels.length - 1)]?.model : undefined;
  /** The video model the input bar works with: from "Erzeugen", or the chat's own model. */
  const activeVideo = createKind === "video" ? (createModel ? videoById.get(createModel) : undefined) : createKind ? undefined : videoLane;
  /** Video options in the input bar; adjusted to what a newly chosen video model can do. */
  const [videoOptions, setVideoOptions] = useState<VideoOptions | null>(null);
  /** Expensive or unpredictable videos wait for a second "Erstellen". */
  const [videoConfirm, setVideoConfirm] = useState(false);
  useEffect(() => {
    setVideoOptions((o) => (activeVideo ? videoDefaults(activeVideo, o ?? undefined) : null));
    setVideoConfirm(false);
  }, [activeVideo]);
  useEffect(() => setVideoConfirm(false), [draft]);
  const videoCost =
    activeVideo && videoOptions?.duration
      ? estimateVideoCost(activeVideo, videoOptions.duration, videoOptions.resolution, videoOptions.audio)
      : null;

  const isStreaming = (chatId: string | undefined) => !!chatId && Object.values(streams).includes(chatId);
  const chatStreaming = isStreaming(activeChat?.id);
  const webOn = activeChat ? !!activeChat.webSearch : (draftWeb ?? (draftProfileObj ? draftProfileObj.web : !!settings.webSearch));
  const visualOn = activeChat ? !!activeChat.visualize : (draftVisual ?? !!draftProfileObj?.visualize);
  const reasoning = activeChat ? activeChat.reasoning : (draftReasoning ?? draftProfileObj?.reasoning);
  const canThink = lanes.some((id) => !!modelById.get(id)?.supported_parameters?.includes("reasoning"));
  const imageLanes = lanes.filter((id) => makesImages(modelById.get(id)));
  /** One text model: the level menu replaces the model choice in the input bar. */
  const textLane = !comparing && !videoLane && !!modelById.get(lanes[0]) && !makesImages(modelById.get(lanes[0])) && !makesAudio(modelById.get(lanes[0]));
  /** "Beste Antwort" is on and possible: one text model, a team to ask. */
  const fusionOn =
    textLane && team.length > 1 && (activeChat ? !!activeChat.fusion : (draftFusion ?? draftProfileObj?.level === "best"));
  // Models that would get a draft image they cannot see; sending is held back until one is swapped.
  const blindLanes = !createKind && draftFiles.some((f) => f.kind === "image")
    ? lanes.filter((id) => {
        const m = modelById.get(id);
        return m && !acceptsImages(m) && !makesImages(m);
      })
    : [];
  const sendBlocked = blindLanes.length > 0;
  // Models that would get a link they cannot open: only a hint, sending stays possible.
  const draftHasLink = useMemo(() => findLinks(draft).length > 0, [draft]);
  const linkBlindLanes = draftHasLink
    ? lanes.filter((id) => {
        const m = modelById.get(id);
        return m && !canCallTools(m);
      })
    : [];
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const watching = useRef(new Set<string>());

  const patchSettings = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    [setSettings],
  );

  // Simple view: chats only, levels instead of models, no costs. Rooms, folders and profiles keep working out of sight.
  const simple = settings.view === "simple";
  useEffect(() => {
    if (simple) setCreateState(null);
  }, [simple]);
  useEffect(() => {
    if (simple && mode === "rooms") {
      stopSpeaking();
      setMode("chats");
    }
  }, [simple, mode]);

  function setSimple(on: boolean) {
    if (on === simple) return;
    patchSettings({ view: on ? "simple" : "full" });
    setNotice({
      text: on
        ? "Einfache Ansicht: Nur das Wichtigste ist zu sehen. Mit „Alles“ ist der Rest sofort wieder da."
        : "Alles ist wieder zu sehen: Chatrooms, Ordner, Vergleichen, alle Modelle und Kosten.",
    });
  }

  // ---- data loading -------------------------------------------------------

  const loadModels = useCallback(() => {
    setModelsError(null);
    const ctrl = new AbortController();
    fetchModels(ctrl.signal)
      .then((data) => {
        setModels(data);
        try {
          localStorage.setItem(MODELS_CACHE, JSON.stringify({ at: Date.now(), data }));
        } catch {
          /* cache is optional */
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setModelsError(e.message);
      });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (!models) return loadModels();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // index.html sets both before first paint; this keeps them in step with the settings.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme ?? "dark";
    if (settings.textSize && settings.textSize !== "normal") root.dataset.text = settings.textSize;
    else delete root.dataset.text;
  }, [settings.theme, settings.textSize]);

  const refreshCredits = useCallback(() => {
    if (!settings.apiKey) return setCredits(null);
    fetchCredits(settings.apiKey)
      .then(setCredits)
      .catch(() => setCredits(null));
    fetchFreeQuota(settings.apiKey)
      .then(setFreeQuota)
      .catch(() => setFreeQuota(null));
  }, [settings.apiKey]);

  useEffect(refreshCredits, [refreshCredits]);

  useEffect(() => setZeroRetention(!!settings.zdr), [settings.zdr]);
  useEffect(() => setUnrestricted(!!settings.unrestricted), [settings.unrestricted]);
  // Judge, checks, titles, voices: chosen from the catalog and the scores, like the levels.
  // Set during render (a plain assignment), so rooms and dialogs rendered below already see them.
  setHelperData(models, scores);

  // ---- drafts ---------------------------------------------------------------

  const draftKey = activeId ?? NEW_DRAFT;
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;

  // The input on screen is mirrored into the drafts of its chat and saved.
  useEffect(() => {
    const d: Draft = {
      text: draft,
      files: draftFiles,
      original: draftOriginal,
      // An existing chat keeps its models and switches itself; only the new chat needs them in the draft.
      ...(activeId
        ? {}
        : { lanes: draftLanes, web: draftWeb, visual: draftVisual, reasoning: draftReasoning, fusion: draftFusion, profile: draftProfile }),
    };
    if (isEmptyDraft(d)) delete drafts.current[draftKey];
    else drafts.current[draftKey] = d;
    saveDrafts(drafts.current);
  }, [draftKey, draft, draftFiles, draftOriginal, draftLanes, draftWeb, draftVisual, draftReasoning, draftFusion, draftProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Show a chat (null = the new one) with whatever was left unsent there. */
  function openChat(id: string | null) {
    const d = drafts.current[id ?? NEW_DRAFT];
    setActiveId(id);
    setDraft(d?.text ?? "");
    setDraftFiles(d?.files ?? []);
    setDraftOriginal(d?.original ?? null);
    setDraftLanes(d?.lanes ?? null);
    setDraftWeb(d?.web ?? null);
    setDraftVisual(d?.visual ?? null);
    setDraftReasoning(d?.reasoning);
    setDraftFusion(d?.fusion ?? null);
    setDraftProfile(d?.profile);
    setFileError(null);
    setCreate(null);
  }

  /** Change the files of a draft, on screen or parked in another chat (an upload can finish after a switch). */
  function updateDraftFiles(key: string, change: (files: Attachment[]) => Attachment[]) {
    if (key === draftKeyRef.current) return setDraftFiles(change);
    const d = drafts.current[key] ?? { text: "", files: [] };
    drafts.current[key] = { ...d, files: change(d.files) };
    saveDrafts(drafts.current);
  }

  // ---- guided tour ----------------------------------------------------------

  function startTour() {
    const model = lanes[0] ?? defaultModel;
    const now = Date.now();
    const demo: Chat = {
      id: TOUR_CHAT,
      title: "Beispiel-Chat (Einführung)",
      model,
      messages: [
        { id: `${TOUR_CHAT}-q`, role: "user", content: "Worauf muss ich bei einem Autokredit achten?", createdAt: now },
        {
          id: `${TOUR_CHAT}-a`,
          role: "assistant",
          model,
          requested: model,
          createdAt: now,
          content:
            "Das Wichtigste in Kürze:\n\n1. **Effektiver Jahreszins**: die Zahl, mit der du Angebote vergleichst.\n2. **Laufzeit**: Je länger, desto kleiner die Rate, aber desto mehr Zinsen insgesamt.\n3. **Sondertilgungen**: Achte darauf, dass du früher zurückzahlen darfst.\n\nSoll ich zwei Angebote für dich vergleichen?",
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    setChats((all) => [demo, ...all.filter((c) => c.id !== TOUR_CHAT)]);
    setMode("chats");
    openChat(TOUR_CHAT);
    setSidebarOpen(false);
    setTour("chat");
  }

  function endTour() {
    if (tour === "room") return endRoomTour();
    setTour(null);
    setChats((all) => all.filter((c) => c.id !== TOUR_CHAT));
    delete drafts.current[TOUR_CHAT];
    openChat(null);
    patchSettings({ tourDone: true });
  }

  /** The chatroom tour on a demo room: a quarrel between neighbours with a mediator, two rounds already spoken. */
  function startRoomTour() {
    stopSpeaking();
    const now = Date.now();
    const pool = tierModels("cheap", models);
    const mediator = { ...makeParticipant("nvc", 0, pool[0]), name: "Ines", gender: "w" as const };
    const brandt = {
      ...makeParticipant("provocateur", 1, pool[1 % pool.length]),
      name: "Herr Brandt",
      roleName: "Nachbar",
      gender: "m" as const,
    };
    const yilmaz = {
      ...makeParticipant("contra", 2, pool[2 % pool.length]),
      name: "Frau Yilmaz",
      roleName: "Nachbarin",
      gender: "w" as const,
    };
    const participants = withLeader([mediator, brandt, yilmaz], mediator.id);
    const say = (p: (typeof participants)[number], content: string, round: number, n: number) => ({
      id: `${TOUR_ROOM}-${n}`,
      authorId: p.id,
      content,
      model: p.model,
      round,
      createdAt: now + n,
    });
    const demo: Room = {
      id: TOUR_ROOM,
      title: "Beispielraum (Einführung)",
      titleSource: "user",
      topic: "Streit unter Nachbarn: Frau Yilmaz' Hund bellt jeden Morgen um sechs, Herr Brandt hat sich beim Vermieter beschwert.",
      goal: "Eine Absprache, mit der beide leben können",
      language: "Deutsch",
      participants,
      order: "round",
      pace: "step",
      maxRounds: 4,
      budget: 0.5,
      aiAware: false,
      round: 2,
      spoken: [],
      messages: [
        say(participants[0], "Schön, dass Sie beide da sind. Herr Brandt, erzählen Sie bitte zuerst, was Sie morgens erleben.", 1, 1),
        say(participants[1], "Jeden Morgen um sechs bellt der Hund, eine halbe Stunde lang. Ich arbeite im Schichtdienst und komme um vier ins Bett.", 1, 2),
        say(participants[2], "Das wusste ich nicht. Aber gleich zum Vermieter zu gehen, ohne mit mir zu reden, das hat mich verletzt.", 1, 3),
        say(participants[0], "Ich höre zwei Bedürfnisse: Ruhe am Morgen und ein respektvoller Umgang. Frau Yilmaz, was wäre für Sie denkbar?", 2, 4),
      ],
      createdAt: now,
      updatedAt: now,
    };
    roomBeforeTour.current = activeRoomId;
    setRooms((all) => [demo, ...all.filter((r) => r.id !== TOUR_ROOM)]);
    setMode("rooms");
    setActiveRoomId(TOUR_ROOM);
    setSidebarOpen(false);
    setTour("room");
  }

  function endRoomTour() {
    setTour(null);
    setRooms((all) => all.filter((r) => r.id !== TOUR_ROOM));
    setActiveRoomId(roomBeforeTour.current);
    patchSettings({ roomTourDone: true });
  }

  // First visit after signing in: show the tour once. A demo chat left over from an interrupted tour goes away.
  const tourChecked = useRef(false);
  useEffect(() => {
    if (tourChecked.current || !settings.apiKey || !models) return;
    tourChecked.current = true;
    if (!settings.tourDone) startTour();
    else setChats((all) => (all.some((c) => c.id === TOUR_CHAT) ? all.filter((c) => c.id !== TOUR_CHAT) : all));
    setRooms((all) => (all.some((r) => r.id === TOUR_ROOM) ? all.filter((r) => r.id !== TOUR_ROOM) : all));
  }, [settings.apiKey, models]); // eslint-disable-line react-hooks/exhaustive-deps

  // Video models live in their own catalog; needed to recognize them as a chat's model.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchVideoModels(ctrl.signal)
      .then(setVideoModels)
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  // Benchmark scores change rarely; refresh them once a day.
  useEffect(() => {
    if (!settings.apiKey || cachedScores()) return;
    const ctrl = new AbortController();
    fetchScores(settings.apiKey, ctrl.signal)
      .then(setScores)
      .catch(() => {
        /* without scores the free router is the default */
      });
    return () => ctrl.abort();
  }, [settings.apiKey]);

  // Back from OpenRouter's login page with a code: turn it into this browser's key.
  useEffect(() => {
    completeLogin()
      .then((key) => {
        if (!key) return;
        patchSettings({ apiKey: key });
        setNotice({ text: "Mit OpenRouter verbunden. Du kannst loslegen." });
      })
      .catch((e: Error) =>
        setNotice({ text: e instanceof TypeError ? "OpenRouter ist nicht erreichbar. Prüfe die Internetverbindung." : e.message, error: true }),
      );
  }, [patchSettings]);

  useEffect(() => {
    if (!notice || notice.error) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- keyboard shortcuts -------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPicker((p) => (p ? null : { kind: "replace", lane: 0 }));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- scrolling ----------------------------------------------------------

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [activeChat?.messages, activeId]);

  useEffect(() => {
    stickToBottom.current = true;
  }, [activeId]);

  // ---- chat mutations -----------------------------------------------------

  const updateChat = useCallback(
    (chatId: string, fn: (c: Chat) => Chat) => setChats((all) => all.map((c) => (c.id === chatId ? fn(c) : c))),
    [setChats],
  );

  const updateMessage = useCallback(
    (chatId: string, messageId: string, fn: (m: Message) => Message) =>
      updateChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)) })),
    [updateChat],
  );

  /** API messages for `target`: system prompt, continued-chat summary, and who wrote which answer. */
  async function buildMessages(history: Message[], target: string, chat?: Chat | null, extra?: string): Promise<ChatMessage[]> {
    const attributed = attributeHistory(history, target, modelName);
    const targetModel = modelById.get(target);
    // Image and music models make media; guides for charts and text cards would only confuse them.
    const makesMedia = makesImages(targetModel) || makesAudio(targetModel);
    // Charts are explained to the model when the message asks for one, or always where a profile wants it.
    const lastAsk = history.findLast((m) => m.role === "user")?.content ?? "";
    const visual = ((chat ? chat.visualize : visualOn) || asksForVisual(lastAsk)) && !makesMedia;
    const system = [
      settings.systemPrompt.trim(),
      chat?.prep?.system,
      chat?.profile?.system,
      chat?.seed && seedNote(chat.seed.summary),
      attributed.note,
      visual && VISUAL_GUIDE,
      !makesMedia && TEXT_GUIDE,
      // Models do not know today's date; questions like "next Friday" need it.
      `Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`,
      extra,
    ]
      .filter(Boolean)
      .join("\n\n");
    const seesImages = acceptsImages(targetModel) || makesImages(targetModel);
    // An image model edits its last picture when asked to change it, so it gets that picture back.
    const previousImages = makesImages(targetModel) ? lastGeneratedImages(history) : [];
    const lastUser = attributed.messages.map((m) => m.role).lastIndexOf("user");

    const out: ChatMessage[] = system ? [{ role: "system", content: system }] : [];
    for (const [i, m] of attributed.messages.entries()) {
      const files = [...(m.attachments ?? []), ...(i === lastUser ? previousImages : [])];
      if (!files.length) {
        out.push({ role: m.role, content: m.content });
        continue;
      }
      // Text first, then files: OpenRouter recommends this order.
      const parts: ContentPart[] = m.content ? [{ type: "text", text: m.content }] : [];
      for (const f of files) {
        if (f.kind === "image" && !seesImages) {
          parts.push({ type: "text", text: `[Bild „${f.name}“ – dieses Modell kann keine Bilder sehen]` });
        } else if (f.kind === "image") {
          parts.push({ type: "image_url", image_url: { url: await attachmentDataUrl(f.id) } });
        } else if (f.kind === "pdf" && sendMode(f) === "original") {
          parts.push({ type: "file", file: { filename: f.name, file_data: await attachmentDataUrl(f.id) } });
        } else if (f.kind === "pdf" || f.kind === "doc") {
          // Converted once to Markdown: every model can read it, and it costs a fraction of a PDF.
          parts.push({ type: "text", text: await documentBlock(f) });
        }
      }
      out.push({ role: m.role, content: parts });
    }
    return out;
  }

  /**
   * Stream one model's answer into an existing (empty) assistant message.
   * With a `team` ("Beste Antwort"), its models answer first and `model` merges their answers.
   */
  async function streamInto(
    chatId: string,
    messageId: string,
    model: string,
    history: Message[],
    chat: Chat | null | undefined,
    web: boolean,
    team?: string[],
  ) {
    const ctrl = new AbortController();
    controllers.current.set(messageId, ctrl);
    setStreams((s) => ({ ...s, [messageId]: chatId }));
    stickToBottom.current = true;

    const target = modelById.get(model);
    // Links in the question: the model may open them (OpenRouter's web_fetch), if it can use tools at all.
    const links = findLinks([...history].reverse().find((m) => m.role === "user")?.content ?? "");
    const fetchLinks = links.length > 0 && canCallTools(target);
    if (links.length) updateMessage(chatId, messageId, (m) => ({ ...m, links: { urls: links, unsupported: !fetchLinks || undefined } }));

    // Tokens arrive faster than the screen refreshes; batch them per frame.
    let content = "";
    let reasoning = "";
    const imageUrls: string[] = [];
    const audioChunks: string[] = [];
    const sources = new Map<string, Source>();
    let frame = 0;
    const started = performance.now();
    const flush = () => {
      frame = 0;
      updateMessage(chatId, messageId, (m) => ({
        ...m,
        content,
        reasoning: reasoning || undefined,
        sources: sources.size ? [...sources.values()] : undefined,
      }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const effort = (m?: Model) =>
      m?.supported_parameters?.includes("reasoning") ? ((chat ? chat.reasoning : draftReasoning) ?? undefined) : undefined;
    /** What the team members cost together; added to the merged answer's cost. */
    let teamCost = 0;
    let brief: string | undefined;

    try {
      if (team?.length) {
        const answers = await askTeam(chatId, messageId, team, history, chat, web, links, ctrl.signal, effort);
        teamCost = answers.reduce((sum, a) => sum + (a.cost ?? 0), 0);
        for (const src of answers.flatMap((a) => a.sources)) sources.set(src.url, src);
        const usable = answers.filter((a) => a.content.trim());
        if (!usable.length) throw new Error(answers.find((a) => a.error)?.error ?? "Keines der Modelle hat geantwortet.");
        if (usable.length === 1) {
          // Nothing to merge: the one answer is the answer.
          content = usable[0].content;
          updateMessage(chatId, messageId, (m) => ({
            ...m,
            model: usable[0].model,
            usage: { promptTokens: 0, completionTokens: 0, cost: teamCost },
          }));
          return;
        }
        brief = fusionBrief(usable.map((a) => a.content));
      }
      const apiMessages = await buildMessages(history, model, chat, brief);
      await streamChat(
        {
          apiKey: settings.apiKey,
          model,
          messages: apiMessages,
          temperature: settings.temperature,
          signal: ctrl.signal,
          // When merging, the team has already searched and opened the links.
          webSearch: web && !brief ? (canCallTools(target) ? "tool" : "plugin") : undefined,
          webResults: settings.webResults,
          webFetch: fetchLinks && !brief,
          reasoningEffort: effort(target),
          image: makesImages(target) ? { aspectRatio } : undefined,
          audio: makesAudio(target) ? audioRequest(model) : undefined,
        },
        {
          onContent: (t) => {
            content += t;
            schedule();
          },
          onReasoning: (t) => {
            reasoning += t;
            schedule();
          },
          onModel: (m) => updateMessage(chatId, messageId, (msg) => ({ ...msg, model: m })),
          onUsage: (usage: Usage) =>
            updateMessage(chatId, messageId, (msg) => ({
              ...msg,
              usage: teamCost ? { ...usage, cost: (usage.cost ?? 0) + teamCost } : usage,
              links: msg.links && usage.webFetches !== undefined ? { ...msg.links, opened: usage.webFetches } : msg.links,
            })),
          onImages: (urls) => imageUrls.push(...urls),
          onAudio: (chunk) => audioChunks.push(chunk),
          onSources: (found) => {
            for (const src of found) sources.set(src.url, src);
            schedule();
          },
        },
      );
    } catch (e) {
      const err = e as Error;
      if (err.name !== "AbortError") {
        const message =
          err instanceof TypeError
            ? "OpenRouter ist nicht erreichbar. Prüfe deine Internetverbindung und versuche es erneut."
            : err instanceof OpenRouterError && err.status === 429 && isFreeModelId(model)
              ? await freeLimitMessage()
              : err.message || "Die Verbindung wurde unterbrochen.";
        updateMessage(chatId, messageId, (m) => ({ ...m, error: message }));
      }
    } finally {
      cancelAnimationFrame(frame);
      flush();
      if (imageUrls.length) {
        const stored = await Promise.all(imageUrls.map((u, i) => storeGeneratedImage(u, i).catch(() => null)));
        const attachments = stored.filter((a): a is Attachment => !!a);
        updateMessage(chatId, messageId, (m) => ({
          ...m,
          attachments,
          error:
            attachments.length < imageUrls.length
              ? "Ein erzeugtes Bild konnte nicht gespeichert werden."
              : m.error,
        }));
      }
      if (audioChunks.length) {
        try {
          const audio = await storeAudio(audioChunks);
          updateMessage(chatId, messageId, (m) => ({ ...m, attachments: [...(m.attachments ?? []), audio] }));
        } catch {
          updateMessage(chatId, messageId, (m) => ({ ...m, error: "Die Audio-Antwort konnte nicht gespeichert werden." }));
        }
      }
      const durationMs = Math.round(performance.now() - started);
      updateMessage(chatId, messageId, (m) => ({ ...m, durationMs }));
      void autoTitle(chatId);
      controllers.current.delete(messageId);
      setStreams((s) => {
        const next = { ...s };
        delete next[messageId];
        return next;
      });
      refreshCredits();
    }
  }

  /**
   * "Beste Antwort": every team member answers the question on its own, in parallel. Each finished answer
   * shows up in the message's list right away; a member that fails is noted and left out of the merge.
   */
  async function askTeam(
    chatId: string,
    messageId: string,
    team: string[],
    history: Message[],
    chat: Chat | null | undefined,
    web: boolean,
    links: string[],
    signal: AbortSignal,
    effort: (m?: Model) => "low" | "high" | undefined,
  ) {
    const patch = (i: number, change: Partial<FusionAnswer>) =>
      updateMessage(chatId, messageId, (m) =>
        m.fusion ? { ...m, fusion: { answers: m.fusion.answers.map((a, j) => (j === i ? { ...a, ...change } : a)) } } : m,
      );
    updateMessage(chatId, messageId, (m) => ({ ...m, fusion: { answers: team.map((model) => ({ model, content: "" })) } }));
    return Promise.all(
      team.map(async (member, i) => {
        const m = modelById.get(member);
        let content = "";
        let cost: number | undefined;
        const found: Source[] = [];
        try {
          await streamChat(
            {
              apiKey: settings.apiKey,
              model: member,
              messages: await buildMessages(history, member, chat),
              temperature: settings.temperature,
              signal,
              webSearch: web ? (canCallTools(m) ? "tool" : "plugin") : undefined,
              webResults: settings.webResults,
              webFetch: links.length > 0 && canCallTools(m),
              reasoningEffort: effort(m),
            },
            {
              onContent: (t) => (content += t),
              onReasoning: () => {},
              onModel: () => {},
              onUsage: (u) => (cost = u.cost),
              onSources: (s) => found.push(...s),
            },
          );
          patch(i, { content, cost, done: true });
          return { model: member, content, cost, sources: found, error: undefined };
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          const error =
            e instanceof TypeError
              ? "OpenRouter ist nicht erreichbar."
              : (e as Error).message || "Die Verbindung wurde unterbrochen.";
          patch(i, { content, cost, error, done: true });
          return { model: member, content: "", cost, sources: found, error };
        }
      }),
    );
  }

  function send(override?: string) {
    // Videos: made directly with the options in the input bar; photos need the dialog.
    if (activeVideo) {
      if (override !== undefined) setDraft(override);
      const prompt = (override ?? draft).trim();
      // Photos need a role (start frame, end frame, reference): that is chosen in the dialog.
      if (!prompt || draftFiles.some((f) => f.kind === "image") || !videoOptions) {
        setVideoModel(activeVideo.id);
        setVideoOpen(true);
        return;
      }
      if (chatStreaming) return;
      if ((videoCost === null || videoCost > VIDEO_CONFIRM_USD) && !videoConfirm) return setVideoConfirm(true);
      setVideoConfirm(false);
      void startVideo({
        model: activeVideo.id,
        modelName: videoName(activeVideo),
        prompt,
        ...videoOptions,
        audio: videoOptions.audio && canMakeSound(activeVideo),
        references: [],
      });
      return;
    }
    const text = (override ?? draft).trim();
    // "Erzeugen" (image or music): one answer from the media model, in this chat; the chat keeps its model.
    const media = createKind && createKind !== "video" ? createModel : undefined;
    if (createKind && !media) return;
    if ((!text && !draftFiles.length) || chatStreaming || (sendBlocked && !media)) return;
    if (!settings.apiKey) return setSettingsOpen(true);

    const now = Date.now();
    const user: Message = {
      id: uid(),
      role: "user",
      content: text,
      attachments: draftFiles.length ? draftFiles : undefined,
      createdAt: now,
    };
    // "Beste Antwort": one answer, written by the team's first model from all the team's answers.
    const fuse = fusionOn && !media ? team : undefined;
    const answerModels = media ? [media] : fuse ? [fuse[0]] : lanes;
    const answers: Message[] = answerModels.map((model, lane) => ({
      id: uid(),
      role: "assistant",
      content: "",
      model,
      requested: model,
      lane,
      createdAt: now,
    }));
    const base = [...(activeChat?.messages ?? []), user];

    let chatId = activeChat?.id;
    let requestChat = activeChat;
    const chatLanes = fuse ? [fuse[0]] : lanes;
    if (!chatId) {
      const created: Chat = {
        id: uid(),
        title: titleFrom(text || draftFiles[0]?.name || "Anhang"),
        model: chatLanes[0],
        lanes: chatLanes,
        webSearch: webOn,
        visualize: visualOn || undefined,
        reasoning,
        fusion: fusionOn || undefined,
        profile: draftProfileObj ? { id: draftProfileObj.id, name: draftProfileObj.name, system: draftProfileObj.instruction } : undefined,
        messages: [...base, ...answers],
        createdAt: now,
        updatedAt: now,
      };
      chatId = created.id;
      requestChat = created;
      setChats((all) => [created, ...all]);
      // The new chat's draft has become the chat; the next new chat starts empty.
      delete drafts.current[NEW_DRAFT];
      openChat(created.id);
      // Making images or music goes on in the new chat.
      if (create) setCreate(create);
    } else {
      // The team's lead can change between starts (new models, new scores); the chat follows it.
      updateChat(chatId, (c) => ({ ...c, ...(fuse ? { model: fuse[0], lanes: chatLanes } : {}), messages: [...base, ...answers], updatedAt: now }));
    }

    setDraft("");
    setDraftFiles([]);
    setFileError(null);
    setDraftOriginal(null);
    for (const a of answers)
      void streamInto(chatId, a.id, a.model!, laneHistory(base, a.lane!), requestChat, media ? false : webOn, fuse);
  }

  function regenerate(messageId: string) {
    if (!activeChat || chatStreaming) return;
    const msgs = activeChat.messages;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const lane = laneOf(msgs[idx]);
    const userIdx = msgs.slice(0, idx).map((m) => m.role).lastIndexOf("user");
    // An active lane answers with its current model; a retired column with the one it had.
    const laneModel = lane >= 0 ? lanesOf(activeChat)[lane] : undefined;
    // A merged answer is merged again, by today's team.
    const fuse = msgs[idx].fusion && team.length > 1 ? team : undefined;
    const model = fuse ? fuse[0] : laneModel && !videoById.has(laneModel) ? laneModel : msgs[idx].model!;
    updateMessage(activeChat.id, messageId, (m) => ({
      id: m.id,
      role: "assistant",
      content: "",
      model,
      requested: model,
      lane: m.lane,
      createdAt: Date.now(),
    }));
    void streamInto(
      activeChat.id,
      messageId,
      model,
      laneHistory(msgs.slice(0, userIdx + 1), lane),
      activeChat,
      !!activeChat.webSearch,
      fuse,
    );
  }

  function editLastUser() {
    if (!activeChat || chatStreaming) return;
    const idx = activeChat.messages.map((m) => m.role).lastIndexOf("user");
    if (idx === -1) return;
    setDraft(activeChat.messages[idx].content);
    setDraftFiles(activeChat.messages[idx].attachments ?? []);
    updateChat(activeChat.id, (c) => ({ ...c, messages: c.messages.slice(0, idx) }));
    composer.current?.focus();
  }

  function stop(chatId = activeChat?.id) {
    for (const [messageId, cid] of Object.entries(streams)) {
      if (cid === chatId) controllers.current.get(messageId)?.abort();
    }
  }

  /** Explain a 429 on a free model: daily allowance used up, or just too many per minute. */
  async function freeLimitMessage() {
    const q = await fetchFreeQuota(settings.apiKey).catch(() => null);
    if (q) setFreeQuota(q);
    if (q && q.remaining <= 0) {
      const more = q.limit < 1000 ? " Wer einmal mindestens 10 $ Guthaben gekauft hat, bekommt 1.000 pro Tag." : "";
      return `Die ${q.limit} kostenlosen Anfragen für heute sind aufgebraucht. Ab ${freeResetTime()} Uhr geht es weiter, oder wähle ein günstiges bezahltes Modell.${more}`;
    }
    return "Kostenlose Modelle erlauben höchstens 20 Anfragen pro Minute, oder das Modell ist gerade überlastet. Warte kurz und versuche es erneut, oder wähle ein anderes Modell.";
  }

  // ---- titles ------------------------------------------------------------------

  const titling = useRef(new Set<string>());

  /**
   * Name the chat once the first answer is in, and refine it after the third:
   * a first message like "Hallo, kurze Frage" rarely shows what a chat is about.
   */
  async function autoTitle(chatId: string) {
    await sleep(50); // let the final message update land in chatsRef
    const chat = chatsRef.current.find((c) => c.id === chatId);
    if (!chat || !models || !settings.apiKey || chat.titleSource === "user" || chat.seed || titling.current.has(chatId)) return;
    const answers = chat.messages.filter((m) => m.role === "assistant" && laneOf(m) === 0 && m.content && !m.error).length;
    const due = (answers >= 1 && !chat.titledAt) || (answers >= 3 && (chat.titledAt ?? 0) < 3);
    if (!due) return;
    titling.current.add(chatId);
    try {
      const text = chat.messages
        .filter((m) => m.content && (m.role === "user" || laneOf(m) === 0))
        .slice(0, 6)
        .map((m) => `${m.role === "user" ? "Nutzer" : "Assistent"}: ${m.content.slice(0, 700)}`)
        .join("\n\n");
      const title = await makeTitle({ apiKey: settings.apiKey, models, fallbackModel: chat.model, text });
      if (title) {
        updateChat(chatId, (c) => (c.titleSource === "user" ? c : { ...c, title, titleSource: "auto", titledAt: answers }));
      } else {
        updateChat(chatId, (c) => ({ ...c, titledAt: answers }));
      }
    } catch {
      /* the first-message title stays; not worth bothering the user */
    } finally {
      titling.current.delete(chatId);
    }
  }

  async function titleRoom(room: Room) {
    if (!models || !settings.apiKey) return;
    try {
      const title = await makeTitle({
        apiKey: settings.apiKey,
        models,
        fallbackModel: room.participants.find((p) => !p.human)?.model ?? "",
        text: `Thema: ${room.topic}${room.goal ? `\nZiel: ${room.goal}` : ""}`,
      });
      if (title) setRooms((all) => all.map((r) => (r.id === room.id && r.titleSource !== "user" ? { ...r, title, titleSource: "auto" } : r)));
    } catch {
      /* keep the topic as title */
    }
  }

  function rename(id: string, title: string) {
    const t = title.trim();
    if (!t) return;
    if (mode === "rooms") setRooms((all) => all.map((r) => (r.id === id ? { ...r, title: t, titleSource: "user" } : r)));
    else updateChat(id, (c) => ({ ...c, title: t, titleSource: "user" }));
  }

  // ---- attachments, web search, video ----------------------------------------

  async function addFiles(files: File[]) {
    setFileError(null);
    // The files belong to the chat they were dropped into, even if the user switches meanwhile.
    const key = draftKey;
    for (const f of files) {
      setAttaching((n) => n + 1);
      try {
        const a = await storeFile(f);
        updateDraftFiles(key, (d) => [...d, a]);
        // Documents become Markdown right away; sending waits until that is done.
        if (a.status === "converting") {
          void convertAttachment(a, { apiKey: settings.apiKey, models, bestFree: bestFree.id })
            .then((done) => {
              updateDraftFiles(key, (d) => d.map((x) => (x.id === done.id ? done : x)));
              if (done.status === "failed" && done.kind === "doc") setFileError(`„${done.name}“: ${done.error}`);
              refreshCredits();
            })
            .finally(() => setAttaching((n) => n - 1));
          continue;
        }
      } catch (e) {
        setFileError(e instanceof AttachmentError ? e.message : `„${f.name}“ konnte nicht gelesen werden.`);
      }
      setAttaching((n) => n - 1);
    }
    composer.current?.focus();
  }

  function removeDraftFile(id: string) {
    const file = draftFiles.find((f) => f.id === id);
    setDraftFiles((d) => d.filter((f) => f.id !== id));
    for (const blob of file ? blobIdsOf(file) : [id]) void deleteBlob(blob).catch(() => {});
  }

  /** Apply a change from the document dialog to the draft or to a sent message. */
  function updateAttachment(next: Attachment) {
    if (!docOpen) return;
    if (docOpen.where === "draft") setDraftFiles((d) => d.map((x) => (x.id === next.id ? next : x)));
    else {
      const { chatId, messageId } = docOpen.where;
      updateMessage(chatId, messageId, (m) => ({ ...m, attachments: m.attachments?.map((x) => (x.id === next.id ? next : x)) }));
    }
  }

  async function enhanceDraft() {
    const text = draft.trim();
    const target = modelById.get(imageLanes[0]);
    if (!text || !target || !models) return;
    setEnhancing(true);
    setFileError(null);
    try {
      const editing =
        draftFiles.some((f) => f.kind === "image") ||
        (activeChat ? lastGeneratedImages(activeChat.messages).length > 0 : false);
      const result = await enhancePrompt({
        apiKey: settings.apiKey,
        models,
        fallbackModel: lanes[0],
        text,
        context: { kind: "image", modelName: shortName(target), aspectRatio, editing },
      });
      setDraftOriginal((o) => ({
        text: o?.text ?? draft,
        note: `Ergänzt von ${modelName(result.model)}. Prüfe, ob alles stimmt, und passe es bei Bedarf an.`,
      }));
      setDraft(result.text);
    } catch (e) {
      setFileError(`Die Beschreibung konnte nicht verbessert werden: ${(e as Error).message}`);
    } finally {
      setEnhancing(false);
      composer.current?.focus();
    }
  }

  /**
   * Rewrites only the marked passage of an answer: the model sees that answer (not the whole chat)
   * and returns the new passage, which replaces the old one. The previous version is kept for undo.
   */
  async function editPassage(chatId: string, messageId: string, marked: string, instruction: string) {
    const chat = chatsRef.current.find((c) => c.id === chatId);
    const msg = chat?.messages.find((m) => m.id === messageId);
    if (!chat || !msg) throw new Error("Die Antwort gibt es nicht mehr.");
    const at = locate(msg.content, marked);
    if (!at) throw new Error("Die markierte Stelle wurde im Text nicht wiedergefunden. Markiere bitte etwas weniger, zum Beispiel einen Satz.");
    const passage = msg.content.slice(at.start, at.end);
    const model = msg.requested ?? chat.model;
    const thinks = modelById.get(model)?.supported_parameters?.includes("reasoning");
    const { text, usage } = await complete({
      apiKey: settings.apiKey,
      model,
      messages: passagePrompt(msg.content, passage, instruction),
      signal: new AbortController().signal,
      reasoningEffort: thinks ? "low" : undefined,
    });
    const next = cleanPassage(text, passage);
    if (!next.trim()) throw new Error("Das Modell hat keine neue Fassung geliefert. Versuch es bitte nochmal.");
    updateMessage(chatId, messageId, (m) => ({
      ...m,
      content: m.content.slice(0, at.start) + next + m.content.slice(at.end),
      revisions: [...(m.revisions ?? []), m.content],
      // The edit's cost counts toward the answer, so the chat total stays honest.
      usage: m.usage && usage ? { ...m.usage, cost: (m.usage.cost ?? 0) + (usage.cost ?? 0) } : m.usage,
    }));
    refreshCredits();
    return next;
  }

  function undoEdit(chatId: string, messageId: string) {
    updateMessage(chatId, messageId, (m) => {
      const revisions = [...(m.revisions ?? [])];
      const previous = revisions.pop();
      return previous === undefined ? m : { ...m, content: previous, revisions: revisions.length ? revisions : undefined };
    });
  }

  function changeReasoning(v: "low" | "high" | undefined) {
    if (activeChat) updateChat(activeChat.id, (c) => ({ ...c, reasoning: v }));
    else setDraftReasoning(v);
  }

  function toggleWebSearch() {
    const next = !webOn;
    if (activeChat) updateChat(activeChat.id, (c) => ({ ...c, webSearch: next }));
    else setDraftWeb(next);
    setSettings((s) => ({ ...s, webSearch: next }));
  }

  async function startVideo(req: VideoRequest) {
    setVideoOpen(false);
    if (!settings.apiKey) return setSettingsOpen(true);
    const used = [req.firstFrame, req.lastFrame, ...req.references].filter((a): a is Attachment => !!a);
    const now = Date.now();
    const user: Message = {
      id: uid(),
      role: "user",
      content: req.prompt,
      attachments: used.length ? used : undefined,
      createdAt: now,
    };
    const answer: Message = {
      id: uid(),
      role: "assistant",
      content: "",
      model: req.model,
      requested: req.model,
      modelLabel: req.modelName,
      createdAt: now,
      video: { jobId: "", status: "pending", startedAt: now },
    };
    let chatId = activeChat?.id;
    if (!chatId) {
      const created: Chat = {
        id: uid(),
        title: `Video: ${titleFrom(req.prompt)}`,
        model: lanes[0],
        lanes,
        messages: [user, answer],
        createdAt: now,
        updatedAt: now,
      };
      chatId = created.id;
      setChats((all) => [created, ...all]);
      // Whatever the video did not use stays in the new chat's input.
      delete drafts.current[NEW_DRAFT];
      setActiveId(created.id);
      setDraftLanes(null);
      setDraftWeb(null);
      setDraftVisual(null);
      setDraftReasoning(undefined);
      setDraftFusion(null);
      setDraftProfile(undefined);
    } else {
      updateChat(chatId, (c) => ({ ...c, messages: [...c.messages, user, answer], updatedAt: now }));
    }
    if (draft.trim() === req.prompt) setDraft("");
    setDraftFiles((d) => d.filter((f) => !used.some((u) => u.id === f.id)));
    stickToBottom.current = true;

    try {
      const image = async (a: Attachment) => ({ type: "image_url" as const, image_url: { url: await attachmentDataUrl(a.id) } });
      const frames = [
        ...(req.firstFrame ? [{ ...(await image(req.firstFrame)), frame_type: "first_frame" as const }] : []),
        ...(req.lastFrame ? [{ ...(await image(req.lastFrame)), frame_type: "last_frame" as const }] : []),
      ];
      const references = await Promise.all(req.references.map(image));
      const job = await submitVideo(settings.apiKey, {
        model: req.model,
        prompt: req.prompt,
        duration: req.duration,
        resolution: req.resolution,
        aspect_ratio: req.aspectRatio,
        generate_audio: req.audio,
        frame_images: frames.length ? frames : undefined,
        input_references: references.length ? references : undefined,
      });
      updateMessage(chatId, answer.id, (m) => ({ ...m, video: { ...m.video!, jobId: job.id, status: job.status } }));
      void watchVideo(chatId, answer.id, job.id);
    } catch (e) {
      const err = e as Error;
      updateMessage(chatId, answer.id, (m) => ({
        ...m,
        error: err instanceof TypeError ? "OpenRouter ist nicht erreichbar." : err.message,
        video: { ...m.video!, status: "failed" },
      }));
    }
  }

  /** Poll a video job until it finishes, then store the video in the chat. Survives reloads (see below). */
  async function watchVideo(chatId: string, messageId: string, jobId: string) {
    if (!jobId || watching.current.has(jobId)) return;
    watching.current.add(jobId);
    let failures = 0;
    const fail = (error: string) =>
      updateMessage(chatId, messageId, (m) => ({ ...m, error, video: { ...m.video!, status: "failed" } }));
    try {
      while (chatsRef.current.some((c) => c.id === chatId)) {
        await sleep(5000);
        let job;
        try {
          job = await pollVideo(settings.apiKey, jobId);
          failures = 0;
        } catch (e) {
          // Short network hiccups are normal over minutes of polling.
          if (++failures >= 6) return fail(`Der Status des Videos ist nicht abrufbar: ${(e as Error).message}`);
          continue;
        }
        if (job.status === "completed") {
          const url = job.unsigned_urls?.[0];
          if (!url) return fail("Das Video wurde erstellt, aber OpenRouter hat keine Download-Adresse geliefert.");
          const blob = await downloadVideo(settings.apiKey, url);
          const video = await storeVideo(blob, `Video ${new Date().toLocaleString("de-DE")}.mp4`);
          updateMessage(chatId, messageId, (m) => ({
            ...m,
            attachments: [video],
            video: { ...m.video!, status: "completed" },
            usage: job.usage?.cost !== undefined ? { promptTokens: 0, completionTokens: 0, cost: job.usage.cost } : m.usage,
            durationMs: Date.now() - m.video!.startedAt,
          }));
          return;
        }
        if (job.status === "failed" || job.status === "cancelled") {
          return fail(job.error ?? "Die Videoerstellung ist fehlgeschlagen.");
        }
        updateMessage(chatId, messageId, (m) =>
          m.video?.status === job.status ? m : { ...m, video: { ...m.video!, status: job.status } },
        );
      }
    } catch (e) {
      fail(`Das fertige Video konnte nicht geladen werden: ${(e as Error).message}`);
    } finally {
      watching.current.delete(jobId);
      refreshCredits();
    }
  }

  // Videos keep rendering on OpenRouter's side; pick up unfinished jobs after a reload.
  useEffect(() => {
    if (!settings.apiKey) return;
    for (const c of chatsRef.current) {
      for (const m of c.messages) {
        if (m.video?.jobId && (m.video.status === "pending" || m.video.status === "in_progress")) {
          void watchVideo(c.id, m.id, m.video.jobId);
        }
      }
    }
  }, [settings.apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- model slots ----------------------------------------------------------

  /** Choosing models by hand or by level ends "Beste Antwort". */
  function setLanes(next: string[], fusion = false) {
    if (activeChat) updateChat(activeChat.id, (c) => ({ ...c, model: next[0], lanes: next, fusion: fusion || undefined }));
    else {
      setDraftLanes(next);
      setDraftFusion(fusion);
    }
  }

  function selectModel(id: string) {
    if (!picker) return;
    if (picker.kind === "add") {
      if (!lanes.includes(id)) setLanes([...lanes, id].slice(0, MAX_LANES));
    } else {
      setLanes(lanes.map((m, i) => (i === picker.lane ? id : m)));
    }
    setSettings((s) => ({
      ...s,
      defaultModel: picker.kind === "replace" && picker.lane === 0 ? id : s.defaultModel,
      recents: [id, ...s.recents.filter((r) => r !== id)].slice(0, 12),
    }));
    setPicker(null);
    requestAnimationFrame(() => composer.current?.focus());
  }

  /** A level from the input bar's menu: its model becomes the chat's model. */
  function pickTier(id: string) {
    setLanes([id]);
    setSettings((s) => ({ ...s, defaultModel: id, recents: [id, ...s.recents.filter((r) => r !== id)].slice(0, 12) }));
    requestAnimationFrame(() => composer.current?.focus());
  }

  /** "Beste Antwort" from the level menu: the team's lead becomes the chat's model. */
  function pickFusion() {
    if (!team.length) return;
    setLanes([team[0]], true);
    requestAnimationFrame(() => composer.current?.focus());
  }

  /**
   * A profile for this chat: its instruction, level and switches. In the new chat the profile only fills
   * in what has not been chosen there; choosing it again resets those choices.
   */
  function chooseProfile(p: Profile | null) {
    if (!activeChat) {
      setDraftProfile(p ? p.id : null);
      setDraftLanes(null);
      setDraftFusion(null);
      setDraftWeb(null);
      setDraftVisual(null);
      setDraftReasoning(undefined);
    } else if (!p) {
      updateChat(activeChat.id, (c) => ({ ...c, profile: undefined }));
    } else {
      const model = profileModel(p);
      updateChat(activeChat.id, (c) => ({
        ...c,
        profile: { id: p.id, name: p.name, system: p.instruction },
        webSearch: p.web,
        visualize: p.visualize || undefined,
        reasoning: p.reasoning,
        ...(model ? { model, lanes: [model], fusion: p.level === "best" || undefined } : {}),
      }));
    }
    requestAnimationFrame(() => composer.current?.focus());
  }

  function saveProfiles(next: Profile[], defaultProfile: string | undefined) {
    setSettings((s) => ({ ...s, profiles: next, defaultProfile }));
    // Chats keep the instruction they were given; an edit also reaches the chat on screen.
    if (activeChat?.profile) {
      const p = next.find((x) => x.id === activeChat.profile!.id);
      if (p) updateChat(activeChat.id, (c) => ({ ...c, profile: { id: p.id, name: p.name, system: p.instruction } }));
    }
  }

  function dropLane(index: number) {
    if (lanes.length < 2) return;
    if (activeChat) updateChat(activeChat.id, (c) => removeLane(c, index));
    else setDraftLanes(lanes.filter((_, i) => i !== index));
  }

  function keepLane(index: number) {
    if (!activeChat) return;
    updateChat(activeChat.id, (c) => chooseLane(c, index));
    setSettings((s) => ({ ...s, defaultModel: lanes[index] }));
  }

  function toggleFavorite(id: string) {
    setSettings((s) => ({
      ...s,
      favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [...s.favorites, id],
    }));
  }

  // ---- backup ---------------------------------------------------------------

  async function downloadBackup() {
    const { apiKey: _key, ...rest } = settings;
    const { blob, files, missing } = await makeBackup({ chats, rooms, folders, roles: loadRoles(), templates: loadTemplates(), settings: rest });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setSettings((s) => ({ ...s, lastBackup: Date.now(), backupLater: undefined }));
    const parts = [count(chats.length, "Chat", "Chats"), count(rooms.length, "Chatroom", "Chatrooms"), files ? count(files, "Datei", "Dateien") : ""].filter(Boolean);
    setNotice({
      text: `Sicherung gespeichert (${parts.join(", ")}). Sie liegt in deinem Download-Ordner.${missing ? ` ${count(missing, "Datei fehlte", "Dateien fehlten")} schon vorher.` : ""}`,
    });
  }

  async function restoreBackup(file: File) {
    try {
      const b = await readBackup(file);
      if (b.kind === "chat" && b.chats[0]) return openSharedChat(b.chats[0]);
      const c = mergeById(chats, b.chats);
      const r = mergeById(rooms, b.rooms);
      const f = mergeById(folders, b.folders);
      setChats(c.merged);
      setRooms(r.merged);
      setFolders(f.merged);
      const roles = importRoles(b.roles);
      const templates = importTemplates(b.templates ?? []);
      // Settings come along for a new computer; the key stays the one of this browser.
      setSettings((s) => ({
        ...s,
        ...b.settings,
        apiKey: s.apiKey,
        favorites: [...new Set([...s.favorites, ...(b.settings.favorites ?? [])])],
        profiles: mergeById(s.profiles ?? [], b.settings.profiles ?? []).merged,
        defaultProfile: s.defaultProfile ?? b.settings.defaultProfile,
        recents: s.recents.length ? s.recents : (b.settings.recents ?? []),
      }));
      setSettingsOpen(false);
      const added = [
        c.added && count(c.added, "Chat", "Chats"),
        r.added && count(r.added, "Chatroom", "Chatrooms"),
        f.added && count(f.added, "Ordner", "Ordner"),
        roles && count(roles, "eigene Rolle", "eigene Rollen"),
        templates && count(templates, "Raum-Vorlage", "Raum-Vorlagen"),
      ].filter(Boolean);
      setNotice({
        text: added.length ? `Wiederhergestellt: ${added.join(", ")}.` : "Alles aus der Sicherung war schon vorhanden. Es wurde nichts doppelt angelegt.",
      });
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
    }
  }

  // ---- sharing one chat -------------------------------------------------------

  async function shareChatText(chat: Chat) {
    const text = forMessenger(chatToMarkdown(chat, modelName));
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: chat.title, text });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setNotice({ text: "Teilen hat nicht geklappt. Versuch es noch einmal.", error: true });
      }
      return;
    }
    await navigator.clipboard.writeText(text);
    setNotice({ text: "Chat als Text kopiert. Du kannst ihn jetzt in WhatsApp Web, eine Mail oder ein Dokument einfügen." });
  }

  async function shareChatFile(chat: Chat) {
    const { blob, missing } = await makeChatFile(chat);
    const name = fileName(chat.title).replace(/\.md$/, ".json");
    const file = new File([blob], name, { type: "application/json" });
    // Phones offer the file to WhatsApp and co. where they can; otherwise it is downloaded.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: chat.title });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setNotice({
      text: `Gespeichert als „${name}“ im Download-Ordner. Öffnen in Leuchtfeuer: Einstellungen → Sicherung → „Sicherung einlesen“.${missing ? ` ${count(missing, "Datei fehlte", "Dateien fehlten")} schon vorher.` : ""}`,
    });
  }

  /** A chat someone shared as a file: opened right away; a changed version of one already here comes in as a copy. */
  function openSharedChat(chat: Chat) {
    const here = chats.find((c) => c.id === chat.id);
    setSettingsOpen(false);
    if (here && here.updatedAt === chat.updatedAt) {
      openChat(here.id);
      setNotice({ text: `„${here.title}“ ist schon da und wurde geöffnet.` });
      return;
    }
    const added: Chat = here ? { ...chat, id: uid(), title: `${chat.title} (Kopie)`, folderId: undefined } : { ...chat, folderId: undefined };
    setChats((cs) => [added, ...cs]);
    openChat(added.id);
    setNotice({ text: `Chat „${added.title}“ geöffnet.` });
  }

  // ---- chats ----------------------------------------------------------------

  /** Back to the new chat; text and model chosen there earlier are still there. */
  function newChat() {
    openChat(null);
    setSidebarOpen(false);
    requestAnimationFrame(() => composer.current?.focus());
  }

  /** Open the workbench; whatever is in the input field becomes the starting idea. */
  function openWorkbench() {
    if (!settings.apiKey) return setSettingsOpen(true);
    setWorkbenchOpen(true);
  }

  /** A chat prepared on the workbench: its own instruction, chosen model, and the task as first message. */
  function startPrepared(r: PreparedChat) {
    setWorkbenchOpen(false);
    setSettings((s) => ({ ...s, recents: [r.model, ...s.recents.filter((x) => x !== r.model)].slice(0, 12) }));
    // Videos are made in the video dialog, which shows duration and cost first.
    if (r.kind === "video") {
      openChat(null);
      setDraftLanes([r.model]);
      setDraft(r.task);
      setDraftOriginal(null);
      requestAnimationFrame(() => composer.current?.focus());
      return;
    }
    const now = Date.now();
    const user: Message = {
      id: uid(),
      role: "user",
      content: r.task,
      attachments: draftFiles.length ? draftFiles : undefined,
      createdAt: now,
    };
    const answer: Message = { id: uid(), role: "assistant", content: "", model: r.model, requested: r.model, lane: 0, createdAt: now };
    const chat: Chat = {
      id: uid(),
      title: r.title,
      titleSource: "auto",
      // The workbench already named it after the task; no automatic retitling.
      titledAt: 3,
      model: r.model,
      lanes: [r.model],
      webSearch: r.web,
      prep: r.system ? { role: r.role, approach: r.approach, system: r.system } : undefined,
      messages: r.send ? [user, answer] : [],
      createdAt: now,
      updatedAt: now,
    };
    setChats((all) => [chat, ...all]);
    // The idea in the input became this chat's task; it leaves the chat it was typed in.
    const files = draftFiles;
    delete drafts.current[draftKey];
    openChat(chat.id);
    if (r.send) {
      void streamInto(chat.id, answer.id, r.model, [user], chat, r.web);
    } else {
      setDraft(r.task);
      setDraftFiles(files);
      requestAnimationFrame(() => composer.current?.focus());
    }
  }

  /** "Bis hier zusammenfassen": the same dialog as for the whole chat, limited to the history up to this answer. */
  function summarizeUpTo(messageId: string) {
    const chat = activeChat;
    const idx = chat?.messages.findIndex((m) => m.id === messageId) ?? -1;
    if (!chat || idx === -1) return;
    setSummaryHistory(laneHistory(chat.messages.slice(0, idx + 1), laneOf(chat.messages[idx])));
    setSummaryOpen(true);
  }

  function continueFromSummary(summary: string) {
    if (!activeChat) return;
    const now = Date.now();
    const fromTitle = activeChat.title.replace(/^Fortsetzung: /, "");
    const next: Chat = {
      id: uid(),
      title: `Fortsetzung: ${fromTitle}`,
      model: lanes[0],
      messages: [],
      seed: { summary, fromChatId: activeChat.id, fromTitle },
      prep: activeChat.prep,
      createdAt: now,
      updatedAt: now,
    };
    setChats((all) => [next, ...all]);
    openChat(next.id);
    setSummaryOpen(false);
    setSummaryHistory(null);
    requestAnimationFrame(() => composer.current?.focus());
  }

  function deleteChat(id: string) {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    stop(id);
    setChats((all) => all.filter((c) => c.id !== id));
    if (activeId === id) openChat(null);
    if (undo) {
      clearTimeout(undo.timer);
      purgeFiles(undo.chat);
    }
    setUndo({
      chat,
      timer: window.setTimeout(() => {
        setUndo(null);
        purgeFiles(chat);
      }, 6000),
    });
  }

  function deleteRoom(id: string) {
    const room = rooms.find((r) => r.id === id);
    if (!room) return;
    setRooms((all) => all.filter((r) => r.id !== id));
    if (activeRoomId === id) setActiveRoomId(null);
    if (roomUndo) clearTimeout(roomUndo.timer);
    setRoomUndo({ room, timer: window.setTimeout(() => setRoomUndo(null), 6000) });
  }

  function restoreRoom() {
    if (!roomUndo) return;
    clearTimeout(roomUndo.timer);
    setRooms((all) => [roomUndo.room, ...all]);
    setActiveRoomId(roomUndo.room.id);
    setMode("rooms");
    setRoomUndo(null);
  }

  /** Free stored files once a deleted chat can no longer be restored. */
  function purgeFiles(chat: Chat) {
    // Branched chats share their files with the original; only free what nobody uses anymore.
    const used = new Set(
      chatsRef.current.filter((c) => c.id !== chat.id).flatMap((c) => c.messages.flatMap((m) => (m.attachments ?? []).map((a) => a.id))),
    );
    for (const m of chat.messages)
      for (const a of m.attachments ?? []) if (!used.has(a.id)) for (const id of blobIdsOf(a)) void deleteBlob(id).catch(() => {});
  }

  /**
   * Branch the conversation: a new chat with everything up to and including this answer.
   * The original stays as it is, so nothing is lost on either path.
   */
  function forkAt(messageId: string) {
    if (!activeChat) return;
    const msgs = activeChat.messages;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const chosen = msgs[idx];
    const turnStart = msgs.slice(0, idx + 1).map((m) => m.role).lastIndexOf("user");
    // In a comparison turn only the chosen answer goes along; it becomes the fork's only model.
    const lastTurn = msgs.slice(turnStart, idx + 1).filter((m) => m.role === "user" || m.id === messageId);
    const copied = [...msgs.slice(0, turnStart), ...lastTurn].map((m) => ({
      ...m,
      id: uid(),
      ...(m.id === messageId ? { lane: 0 } : {}),
    }));
    const model = chosen.requested ?? chosen.model ?? activeChat.model;
    const now = Date.now();
    const fork: Chat = {
      id: uid(),
      title: `${activeChat.title} (Abzweigung)`,
      titleSource: "user",
      model,
      lanes: [model],
      webSearch: activeChat.webSearch,
      folderId: activeChat.folderId,
      seed: activeChat.seed,
      prep: activeChat.prep,
      forkOf: { chatId: activeChat.id, title: activeChat.title, messageId },
      messages: copied,
      createdAt: now,
      updatedAt: now,
    };
    setChats((all) => [fork, ...all]);
    openChat(fork.id);
    requestAnimationFrame(() => composer.current?.focus());
  }

  function restoreChat() {
    if (!undo) return;
    clearTimeout(undo.timer);
    setChats((all) => [undo.chat, ...all]);
    openChat(undo.chat.id);
    setUndo(null);
  }

  const modelName = useCallback(
    (id: string) => {
      const m = modelById.get(id) ?? modelById.get(id.replace(/-\d{8}$/, ""));
      return m ? shortName(m) : id;
    },
    [modelById],
  );

  // ---- render -------------------------------------------------------------

  const totalCost = activeChat ? chatCost(activeChat) : 0;
  const context = activeChat && (activeChat.messages.length > 0 || activeChat.seed)
    ? contextUsage(activeChat, modelById.get(lanes[0]))
    : null;
  const turns = activeChat ? toTurns(activeChat.messages) : [];
  const due = useMemo(() => backupDue(settings, [...chats, ...rooms]), [settings, chats, rooms]);
  const wide = turns.some((t) => t.answers.length > 1) || comparing;

  /** The single chat model that answered a turn, if exactly one did. Video jobs are not conversation turns. */
  const soleAuthor = (turn?: Turn) => {
    if (!turn || turn.answers.some((a) => a.video)) return undefined;
    const main = turn.answers.filter((a) => laneOf(a) === 0);
    const sole = turn.answers.length === 1 || main.length === 1 ? (main[0] ?? turn.answers[0]) : undefined;
    // "Beste Antwort" is one author of its own, whichever model merged.
    return sole?.fusion ? BEST_AUTHOR : sole && answeredBy(sole);
  };
  const authorName = (id: string) => (id === BEST_AUTHOR ? "„Beste Antwort“" : modelName(id));
  /** Last chat model that answered before turn `index`. */
  const authorBefore = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      const a = soleAuthor(turns[i]);
      if (a) return a;
    }
    return undefined;
  };

  function renderTurn(turn: Turn, isLast: boolean, index: number) {
    const before = authorBefore(index);
    const now = soleAuthor(turn);
    const handover = before && now && !sameModel(before, now);
    const multi = turn.answers.length > 1;
    const highlights = multi ? turnHighlights(turn.answers) : new Map<string, string[]>();
    const answers = turn.answers.map((m) => (
      <MessageView
        key={m.id}
        message={m}
        modelName={modelName}
        streaming={m.id in streams}
        canRegenerate={!chatStreaming && isLast}
        onRegenerate={() => regenerate(m.id)}
        onChoose={multi && comparing && isLast && !chatStreaming && laneOf(m) >= 0 ? () => keepLane(laneOf(m)) : undefined}
        highlights={highlights.get(m.id)}
        voice={{
          mode: settings.voiceMode ?? "browser",
          apiKey: settings.apiKey,
          naturalVoice: settings.naturalVoice,
          browserVoice: settings.browserVoice,
          onError: setFileError,
        }}
        onFork={!chatStreaming && m.content && !m.video ? () => forkAt(m.id) : undefined}
        onSummarize={!chatStreaming && m.content && !m.video && models ? () => summarizeUpTo(m.id) : undefined}
        onEditPassage={activeChat && m.content && !m.video && settings.apiKey && !simple ? (marked, how) => editPassage(activeChat.id, m.id, marked, how) : undefined}
        onUndoEdit={activeChat && m.revisions?.length ? () => undoEdit(activeChat.id, m.id) : undefined}
        simple={simple}
      />
    ));
    // Branches that start at one of these answers, shown right below it.
    const branches = chats.filter((c) => c.forkOf?.chatId === activeChat?.id && turn.answers.some((a) => a.id === c.forkOf?.messageId));
    return (
      <div className="turn" key={turn.user?.id ?? turn.answers[0]?.id}>
        {handover && (
          <p className="handover">
            <span>
              {now === BEST_AUTHOR ? (
                <>
                  Ab hier antworten mehrere Modelle gemeinsam (<strong>Beste Antwort</strong>). Sie kennen den bisherigen
                  Verlauf und wissen, welche Antworten von {authorName(before)} stammen.
                </>
              ) : (
                <>
                  Ab hier antwortet <strong>{modelName(now)}</strong>. Es kennt den bisherigen Verlauf
                  {before === BEST_AUTHOR ? "." : <> und weiß, welche Antworten von {modelName(before)} stammen.</>}
                </>
              )}
            </span>
          </p>
        )}
        {turn.user && (
          <MessageView
            message={turn.user}
            modelName={modelName}
            streaming={false}
            canRegenerate={false}
            onRegenerate={() => {}}
            onEdit={isLast && !chatStreaming ? editLastUser : undefined}
            onOpenAttachment={(id) => activeChat && setDocOpen({ id, where: { chatId: activeChat.id, messageId: turn.user!.id } })}
          />
        )}
        {multi ? (
          <div className="compare" style={{ "--n": turn.answers.length } as React.CSSProperties}>
            {answers}
          </div>
        ) : (
          answers
        )}
        {branches.map((c) => (
          <p key={c.id} className="branch-note">
            <Icon name="fork" size={14} />
            Hier abgezweigt:{" "}
            <button className="link-button" onClick={() => openChat(c.id)} title="Den abgezweigten Chat öffnen">
              {c.title}
            </button>
          </p>
        ))}
      </div>
    );
  }

  // Shown before sending, so a model switch mid-chat is never a surprise.
  const lastAuthor = authorBefore(turns.length);
  // Images, music and videos made in between are no conversation partner to hand over from.
  const mediaAuthor = (id: string) => makesImages(modelById.get(id)) || makesAudio(modelById.get(id)) || videoById.has(id);
  const pendingHandover =
    !comparing && !createKind && lastAuthor && !mediaAuthor(lastAuthor) && !sameModel(lastAuthor, fusionOn ? BEST_AUTHOR : lanes[0])
      ? lastAuthor
      : null;

  const imagePrompt = !comparing && imageLanes.length === 1;
  const placeholderTarget = comparing
    ? `${lanes.length} Modelle`
    : fusionOn
    ? `${team.length} Modelle`
    : videoLane
      ? videoName(videoLane)
      : modelById.get(lanes[0])
      ? shortName(modelById.get(lanes[0])!)
      : lanes[0];

  return (
    <div className={`app${sidebarOpen ? " sidebar-open" : ""}`}>
      <Sidebar
        mode={mode}
        onMode={(next) => {
          // The player bar lives in the chat view; leaving it should not leave a voice running unreachable.
          if (next !== mode) stopSpeaking();
          setMode(next);
          // First visit to the chatrooms: show what they are, on an example.
          if (next === "rooms" && !settings.roomTourDone && settings.apiKey && models && !tour) startRoomTour();
        }}
        items={
          mode === "rooms"
            ? rooms.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, cost: roomCost(r), folderId: r.folderId }))
            : chats.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, cost: chatCost(c), folderId: c.folderId }))
        }
        folders={folders.filter((f) => f.kind === mode)}
        onMove={(id, folderId) => {
          // Sorting into a folder does not count as activity, so updatedAt stays.
          const set = folderId ?? undefined;
          if (mode === "rooms") setRooms((all) => all.map((r) => (r.id === id ? { ...r, folderId: set } : r)));
          else setChats((all) => all.map((c) => (c.id === id ? { ...c, folderId: set } : c)));
        }}
        onCreateFolder={(name) =>
          setFolders((all) => [...all, { id: uid(), name, kind: mode, createdAt: Date.now() }])
        }
        onRenameFolder={(id, name) => {
          if (name.trim()) setFolders((all) => all.map((f) => (f.id === id ? { ...f, name: name.trim() } : f)));
        }}
        onDeleteFolder={(id) => {
          setFolders((all) => all.filter((f) => f.id !== id));
          setChats((all) => all.map((c) => (c.folderId === id ? { ...c, folderId: undefined } : c)));
          setRooms((all) => all.map((r) => (r.folderId === id ? { ...r, folderId: undefined } : r)));
        }}
        onToggleFolder={(id) => setFolders((all) => all.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)))}
        activeId={mode === "rooms" ? activeRoomId : activeId}
        credits={credits}
        backupReminder={
          due
            ? {
                days: due.days,
                onBackup: () => downloadBackup().catch((e) => setNotice({ text: (e as Error).message, error: true })),
                onLater: () => setSettings((s) => ({ ...s, backupLater: Date.now() })),
                onNever: () => {
                  setSettings((s) => ({ ...s, noBackupReminder: true }));
                  setNotice({ text: "Keine Erinnerungen mehr. Sichern kannst du jederzeit unter Einstellungen > Sicherung, dort lässt sich die Erinnerung auch wieder einschalten." });
                },
              }
            : undefined
        }
        freeQuota={freeQuota}
        hasKey={!!settings.apiKey}
        onSelect={(id) => {
          if (mode === "rooms") setActiveRoomId(id);
          else openChat(id);
          setSidebarOpen(false);
        }}
        onNew={() => {
          if (mode === "rooms") {
            if (!settings.apiKey) setSettingsOpen(true);
            else setRoomSetupOpen(true);
          } else newChat();
          setSidebarOpen(false);
        }}
        onDelete={mode === "rooms" ? deleteRoom : deleteChat}
        onRename={rename}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setSidebarOpen(false);
        }}
        onTour={settings.apiKey && models ? (mode === "rooms" ? startRoomTour : startTour) : undefined}
        simple={simple}
        onSimple={setSimple}
      />
      <div className="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      {mode === "rooms" && (
        <main className="main room-main">
          {activeRoom ? (
            <RoomView
              key={activeRoom.id}
              room={activeRoom}
              models={models}
              apiKey={settings.apiKey}
              favorites={settings.favorites}
              recents={settings.recents}
              onToggleFavorite={toggleFavorite}
              onSave={(r) => setRooms((all) => all.map((x) => (x.id === r.id ? r : x)))}
              onSpent={refreshCredits}
              onOpenMenu={() => setSidebarOpen(true)}
            />
          ) : (
            <section className="hero rooms-hero">
              <button className="ghost icon-only menu-button rooms-menu" onClick={() => setSidebarOpen(true)} aria-label="Räume anzeigen">
                <Icon name="menu" />
              </button>
              <p className="hero-provider">Chatrooms</p>
              <h1 className="hero-name compare-title">Mehrere Modelle, ein Gespräch.</h1>
              <p className="rooms-lead">
                Gib jedem Modell eine Rolle und lass sie miteinander sprechen: Ideen sammeln, streiten und schlichten,
                Texte prüfen, debattieren. Du steuerst Tempo und Budget, greifst jederzeit ein oder spielst selbst mit.
              </p>
              <button
                className="button primary"
                onClick={() => (settings.apiKey ? setRoomSetupOpen(true) : setSettingsOpen(true))}
                title="Einen Raum einrichten: Situation beschreiben, die Rollen entstehen von selbst"
              >
                <Icon name="plus" size={16} />
                Chatroom erstellen
              </button>
            </section>
          )}
        </main>
      )}

      <main
        hidden={mode === "rooms"}
        className={`main${dragging ? " dragging" : ""}${settings.apiKey ? "" : " signed-out"}`}
        onDragOver={(e) => {
          if (!settings.apiKey || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        {!activeChat?.messages.some((m) => m.role === "assistant" && m.content) && <SignalField thinking={chatStreaming} />}
        {dragging && (
          <div className="drop-hint" aria-hidden="true">
            Bild oder PDF hier ablegen
          </div>
        )}
        <header className="topbar">
          <button className="ghost icon-only menu-button" onClick={() => setSidebarOpen(true)} aria-label="Chats anzeigen">
            <Icon name="menu" />
          </button>
          <div className="lanes" role="group" aria-label={comparing ? "Modelle im Vergleich" : "Modell"}>
            {lanes.map((id, i) => {
              const m = modelById.get(id);
              return (
                <div className="lane-chip" key={`${id}-${i}`}>
                  {simple ? (
                    // The level menu in the input bar is the way to change it here.
                    <span className="model-chip static" title="Dieses Modell antwortet dir. Wechseln kannst du unten über die Stufe.">
                      <span className="chip-name">
                        {fusionOn ? "Beste Antwort" : m ? shortName(m) : videoById.get(id) ? videoName(videoById.get(id)!) : id}
                      </span>
                    </span>
                  ) : (
                  <button
                    className="model-chip"
                    onClick={() => setPicker({ kind: "replace", lane: i })}
                    title={
                      fusionOn
                        ? `Beste Antwort: ${team.map(modelName).join(", ")}. Klicken, um ein einzelnes Modell zu wählen.`
                        : i === 0
                          ? "Modell wechseln (⌘K)"
                          : "Modell wechseln"
                    }
                    aria-haspopup="dialog"
                  >
                    {fusionOn ? (
                      <span className="chip-name">Beste Antwort</span>
                    ) : (
                      <span className="chip-name">{m ? shortName(m) : videoById.get(id) ? videoName(videoById.get(id)!) : id}</span>
                    )}
                    {m && isUncensored(m) && (
                      <span className="chip-flag" title="Modell mit wenigen Einschränkungen: lehnt kaum etwas ab und kann Anstößiges schreiben">
                        18+
                      </span>
                    )}
                    {fusionOn && <span className="chip-price">{team.length} Modelle</span>}
                    {m && !comparing && !fusionOn && itemPrice(m) && <span className="chip-price">{`${itemPrice(m)!.usd.toFixed(2).replace(".", ",")} $/${itemPrice(m)!.unit}`}</span>}
                    {m && !comparing && !fusionOn && !itemPrice(m) && (
                      <span className="chip-price">
                        <span className="in">{formatPrice(perMillion(m.pricing.prompt))}</span>
                        <span className="out">{formatPrice(perMillion(m.pricing.completion))}</span>
                      </span>
                    )}
                    <Icon name="chevron" size={16} />
                  </button>
                  )}
                  {comparing && (
                    <button
                      className="ghost lane-remove"
                      onClick={() => dropLane(i)}
                      aria-label={`${m ? shortName(m) : id} aus dem Vergleich entfernen`}
                      title="Aus dem Vergleich entfernen"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              );
            })}
            {lanes.length < MAX_LANES && !videoLane && !simple && (
              <button
                className="ghost compare-add"
                onClick={() => setPicker({ kind: "add" })}
                aria-label={comparing ? "Modell zum Vergleich hinzufügen" : "Mit weiteren Modellen vergleichen"}
                title={comparing ? "Noch ein Modell zum Vergleich dazunehmen" : "Dieselbe Frage mehreren Modellen stellen und die Antworten nebeneinander sehen"}
              >
                <Icon name="plus" size={16} />
                <span className="compare-add-label">{comparing ? "Modell" : "Vergleichen"}</span>
              </button>
            )}
          </div>
          <div className="topbar-end">
            {activeChat && activeChat.messages.length > 0 && !chatStreaming && (
              <ShareMenu
                simple={simple}
                onShareText={() => void shareChatText(activeChat)}
                onChatFile={() => void shareChatFile(activeChat).catch((e) => setNotice({ text: (e as Error).message, error: true }))}
                onMarkdown={() => downloadText(fileName(activeChat.title), chatToMarkdown(activeChat, modelName))}
              />
            )}
            {!simple && (
            <>
            {activeChat && models && activeChat.messages.some((m) => m.role === "assistant" && m.content) && !chatStreaming && (
              <button
                className="ghost small summarize-chat"
                onClick={() => setSummaryOpen(true)}
                title="Den Chat zusammenfassen und mit der Zusammenfassung in einem neuen Chat weitermachen. Hilft, wenn ein Chat lang wird: Das Modell behält den Überblick, und jede Nachricht kostet weniger."
              >
                <Icon name="summary" size={16} />
                <span className="label">Zusammenfassen</span>
              </button>
            )}
            {context && <ContextMeter usage={context} onClick={() => setSummaryOpen(true)} />}
            {totalCost > 0 && (
              <span className="chat-total" title="Kosten dieses Chats">
                {formatCost(totalCost)}
              </span>
            )}
            </>
            )}
          </div>
        </header>

        <div
          className="scroller"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {!settings.apiKey ? (
            <section className="welcome">
              <h1>Ein Fenster zu jedem Modell auf OpenRouter.</h1>
              <p>
                Melde dich mit deinem OpenRouter-Konto an. Noch keins? Bei der Anmeldung kannst du eins anlegen, zum
                Beispiel mit deinem Google-Konto. Einen Key musst du dabei nicht kopieren, Leuchtfeuer bekommt ihn
                automatisch.
              </p>
              <OpenRouterLogin
                primary
                onKey={(key) => {
                  patchSettings({ apiKey: key });
                  setNotice({ text: "Mit OpenRouter verbunden. Du kannst loslegen." });
                }}
              />
              <p className="hint welcome-free">
                Kostenlos starten: Ohne Guthaben gehen die kostenlosen Modelle, derzeit bis zu 50 Anfragen am Tag. Für
                stärkere Modelle lädst du später bei OpenRouter Guthaben auf.
              </p>
              <details className="welcome-manual">
                <summary title="Einen vorhandenen Key von openrouter.ai einfügen, statt dich anzumelden">Ich habe schon einen API-Key</summary>
              <form
                className="welcome-key"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (onboardingKey.trim()) patchSettings({ apiKey: onboardingKey.trim() });
                }}
              >
                <label htmlFor="onboard-key" className="visually-hidden">
                  OpenRouter-API-Key
                </label>
                <ApiKeyField id="onboard-key" value={onboardingKey} onChange={setOnboardingKey} />
                <button className="button primary" type="submit" disabled={!onboardingKey.trim()} title="Den Key in diesem Browser speichern und loslegen">
                  Key speichern
                </button>
              </form>
                <KeyStatus apiKey={onboardingKey} />
                <p className="hint">
                  Den Key findest du auf openrouter.ai unter{" "}
                  <a href={KEYS_URL} target="_blank" rel="noreferrer">
                    Keys
                  </a>{" "}
                  („Create Key“, dann kopieren). Er bleibt in diesem Browser und geht nur an OpenRouter.
                </p>
              </details>
            </section>
          ) : turns.length === 0 && !activeChat?.seed && !activeChat?.prep ? (
            comparing ? (
              <CompareHero lanes={lanes} modelById={modelById} />
            ) : videoLane ? (
              <VideoHero video={videoLane} />
            ) : fusionOn ? (
              <FusionHero team={team} cost={teamCost} modelName={modelName} onChange={() => setPicker({ kind: "replace", lane: 0 })} />
            ) : (
              <ModelHero
                model={modelById.get(lanes[0])}
                id={lanes[0]}
                note={
                  !draftLanes && !activeChat && autoDefault
                    ? bestFree.score !== undefined
                      ? `Automatisch gewählt: das beste kostenlose Modell, Intelligence Index ${Math.round(bestFree.score)} laut Artificial Analysis.`
                      : "Automatisch gewählt: wechselt bei jeder Anfrage zu einem gerade verfügbaren kostenlosen Modell."
                    : undefined
                }
                onChange={() => setPicker({ kind: "replace", lane: 0 })}
                onCompare={() => setPicker({ kind: "add" })}
                simple={simple}
              >
              {!imagePrompt && models && !simple && (
                <div className="wb-invite">
                  <p>
                    <strong>Größere Aufgabe vor?</strong>
                    Beschreib sie grob. Die Werkbank stellt Rückfragen, formuliert die Aufgabe aus und schlägt Rolle,
                    Vorgehen und Modell vor.
                  </p>
                  <button className="button" onClick={openWorkbench} title="Die Werkbank öffnen: Sie stellt Rückfragen und macht aus deiner Idee eine klare Aufgabe">
                    <Icon name="sparkle" size={15} />
                    Aufgabe vorbereiten
                  </button>
                </div>
              )}
              </ModelHero>
            )
          ) : (
            <div className={`transcript${wide ? " wide" : ""}`}>
              {activeChat?.forkOf && (
                <p className="branch-note top">
                  <Icon name="fork" size={14} />
                  Abgezweigt von{" "}
                  {chats.some((c) => c.id === activeChat.forkOf!.chatId) ? (
                    <button className="link-button" onClick={() => openChat(activeChat.forkOf!.chatId)} title="Den Chat öffnen, aus dem dieser abgezweigt wurde">
                      „{activeChat.forkOf.title}“
                    </button>
                  ) : (
                    <>„{activeChat.forkOf.title}“ (gelöscht)</>
                  )}
                  . Ab hier geht dieser Chat eigene Wege, das Original bleibt unverändert.
                </p>
              )}
              {activeChat?.prep && <PrepCard prep={activeChat.prep} open={turns.length === 0} />}
              {activeChat?.seed && (
                <SeedCard
                  seed={activeChat.seed}
                  exists={chats.some((c) => c.id === activeChat.seed!.fromChatId)}
                  onOpen={() => openChat(activeChat.seed!.fromChatId)}
                  open={turns.length === 0}
                />
              )}
              {turns.map((t, i) => renderTurn(t, i === turns.length - 1, i))}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <SpeechBar />
          {context && context.level !== "ok" && !chatStreaming && !pendingHandover && (
            <div className={`context-hint ${context.level}`} role="status">
              <p>
                {context.level === "full"
                  ? `Der Verlauf füllt ${Math.round((context.tokens / context.window!) * 100)} % des Kontextfensters. Bald nimmt das Modell keine weiteren Nachrichten an.`
                  : `Dieser Chat ist lang (${formatTokens(context.tokens)} Tokens). Modelle verlieren dabei leichter den Überblick, und jede Nachricht kostet mehr.`}
              </p>
              <button
                className="button small"
                onClick={() => setSummaryOpen(true)}
                title="Den bisherigen Stand zusammenfassen und damit in einem neuen Chat weitermachen. Dieser Chat bleibt erhalten."
              >
                Zusammenfassen und neu starten
              </button>
            </div>
          )}
          {videoConfirm && videoLane && (
            <p className="composer-note info" role="status">
              <span>
                {videoCost !== null
                  ? `Dieses Video kostet etwa ${formatCost(videoCost)}.`
                  : "Die Kosten dieses Modells richten sich nach dem Ergebnis und lassen sich vorab nicht genau schätzen."}{" "}
                Trotzdem erstellen?
              </span>
              <button className="button small primary" onClick={() => send()} title="Das Video jetzt in Auftrag geben">
                Video erstellen
              </button>
              <button className="link-button" onClick={() => setVideoConfirm(false)} title="Nichts erstellen, die Beschreibung bleibt im Eingabefeld">
                Abbrechen
              </button>
            </p>
          )}
          {draftOriginal && imagePrompt && (
            <p className="composer-note info" role="status">
              <span>{draftOriginal.note}</span>
              <button
                className="link-button"
                title="Deinen ursprünglichen Text zurück ins Eingabefeld holen"
                onClick={() => {
                  setDraft(draftOriginal.text);
                  setDraftOriginal(null);
                }}
              >
                Original wiederherstellen
              </button>
            </p>
          )}
          {fileError && (
            <p className="composer-note error" role="alert">
              {fileError}
            </p>
          )}
          {sendBlocked && (
            <div className="composer-note" role="status">
              <p>
                <strong>{blindLanes.map(modelName).join(", ")}</strong>{" "}
                {blindLanes.length === 1 ? "kann" : "können"} keine Bilder sehen. Wähle ein Modell mit Bildverständnis
                oder entferne das Bild.
              </p>
              <button
                className="button small"
                onClick={() => setPicker({ kind: "replace", lane: lanes.indexOf(blindLanes[0]), filter: "vision" })}
                title="Die Modellauswahl öffnen, gefiltert auf Modelle, die Bilder sehen können"
              >
                Modell wählen
              </button>
            </div>
          )}
          {linkBlindLanes.length > 0 && !sendBlocked && (
            <div className="composer-note" role="status">
              <p>
                <strong>{linkBlindLanes.map(modelName).join(", ")}</strong>{" "}
                {linkBlindLanes.length === 1 ? "kann" : "können"} keine Links öffnen und würde nur die Adresse sehen,
                nicht die Seite. Wähle ein Modell, das Werkzeuge nutzen kann.
              </p>
              <button
                className="button small"
                onClick={() => setPicker({ kind: "replace", lane: lanes.indexOf(linkBlindLanes[0]), filter: "tools" })}
                title="Die Modellauswahl öffnen, gefiltert auf Modelle, die Links öffnen können"
              >
                Modell wählen
              </button>
            </div>
          )}
          {pendingHandover && settings.apiKey && (
            <p className="handover-hint" role="status">
              <strong>{fusionOn ? "Beste Antwort" : modelName(lanes[0])}</strong> übernimmt den bisherigen Verlauf
              {pendingHandover === BEST_AUTHOR ? "." : <> und erfährt, welche Antworten von {modelName(pendingHandover)} stammen.</>}
            </p>
          )}
          <Composer
            ref={composer}
            value={draft}
            onChange={setDraft}
            onSend={() => send()}
            onStop={() => stop()}
            streaming={chatStreaming}
            disabled={!settings.apiKey}
            placeholder={
              !settings.apiKey
                ? "Zuerst API-Key hinterlegen"
                : createKind
                  ? `${MEDIA_INFO[createKind].placeholder}. Das Ergebnis erscheint hier im Chat.`
                  : videoLane
                  ? `Beschreibe das Video, das ${placeholderTarget} erzeugen soll`
                  : imagePrompt
                    ? `Beschreibe das Bild, das ${placeholderTarget} erzeugen soll`
                    : `Nachricht an ${placeholderTarget}`
            }
            blocked={sendBlocked}
            attachments={draftFiles}
            attaching={attaching > 0}
            onFiles={addFiles}
            onRemoveAttachment={removeDraftFile}
            onOpenAttachment={(id) => setDocOpen({ id, where: "draft" })}
            webSearch={webOn}
            onToggleWebSearch={toggleWebSearch}
            reasoning={reasoning}
            leading={
              create ? (
                <MediaModeBar
                  kind={create.kind}
                  levels={createLevels}
                  level={Math.min(create.level, createLevels.length - 1)}
                  onLevel={(level) => setCreate({ ...create, level })}
                  onClose={() => {
                    setCreate(null);
                    composer.current?.focus();
                  }}
                  disabled={chatStreaming}
                />
              ) : textLane ? (
                <>
                <TierMenu
                  tiers={tiers}
                  modelById={modelById}
                  current={lanes[0]}
                  onPick={pickTier}
                  fusion={
                    team.length > 1 && !simple
                      ? { on: fusionOn, team: team.map((id) => modelById.get(id)!), cost: teamCost, onPick: pickFusion }
                      : undefined
                  }
                  reasoning={reasoning}
                  onReasoning={canThink && !simple ? changeReasoning : undefined}
                  onAllModels={simple ? undefined : () => setPicker({ kind: "replace", lane: 0 })}
                  disabled={chatStreaming}
                />
                {!simple && (
                <>
                <ProfileMenu
                  profiles={profiles}
                  current={profileId}
                  onChoose={chooseProfile}
                  onManage={() => setProfilesOpen(true)}
                  disabled={chatStreaming}
                />
                <CreateButton
                  available={{ image: levelLists.image.length > 0, video: levelLists.video.length > 0, music: levelLists.music.length > 0 }}
                  onPick={(kind) => {
                    setCreate({ kind, level: createLevel.current[kind] ?? (kind === "music" ? 0 : 1) });
                    composer.current?.focus();
                  }}
                  disabled={chatStreaming}
                />
                </>
                )}
                </>
              ) : undefined
            }
            onReasoning={canThink && !videoLane && !textLane && !createKind && !simple ? changeReasoning : undefined}
            aspectRatio={createKind === "image" || (!createKind && imageLanes.length) ? aspectRatio : null}
            onAspectRatio={setAspectRatio}
            onVideo={
              activeVideo
                ? () => {
                    setVideoModel(activeVideo.id);
                    setVideoOpen(true);
                  }
                : undefined
            }
            video={
              activeVideo && videoOptions
                ? {
                    model: activeVideo,
                    options: videoOptions,
                    cost: videoCost,
                    onChange: (o) => {
                      setVideoOptions(o);
                      setVideoConfirm(false);
                    },
                  }
                : undefined
            }
            showWebSearch={!videoLane && !createKind}
            onEnhance={imagePrompt && !createKind ? enhanceDraft : undefined}
            onPrepare={!simple && !activeChat?.messages.length && !imagePrompt && !videoLane && !createKind && !comparing && models ? openWorkbench : undefined}
            enhancing={enhancing}
            apiKey={settings.apiKey}
            onDictated={(spoken) => {
              setFileError(null);
              const next = draft.trim() ? `${draft.trimEnd()} ${spoken}` : spoken;
              if (settings.dictateSend && !chatStreaming) send(next);
              else {
                setDraft(next);
                composer.current?.focus();
              }
            }}
            onError={setFileError}
          />
          {!activeChat?.messages.length && (
            <p className="composer-hint">
              <kbd>Enter</kbd> senden, <kbd>Shift</kbd>+<kbd>Enter</kbd> neue Zeile,{" "}
              {!simple && (
                <>
                  <kbd>⌘K</kbd> Modell wechseln,{" "}
                </>
              )}
              Mikrofon: sprechen statt tippen
            </p>
          )}
        </div>
      </main>

      {picker && (
        <ModelPicker
          models={models}
          error={modelsError}
          current={picker.kind === "replace" ? lanes[picker.lane] : ""}
          initialFilter={picker.kind === "replace" ? picker.filter : undefined}
          onSelectVideo={(id) => {
            // The video model becomes the chat's model; the composer then takes video descriptions.
            setLanes([id]);
            setPicker(null);
            requestAnimationFrame(() => composer.current?.focus());
          }}
          initialArea={videoLane ? "video" : undefined}
          scores={scores}
          favorites={settings.favorites}
          recents={settings.recents}
          onSelect={selectModel}
          onToggleFavorite={toggleFavorite}
          onRetry={loadModels}
          onClose={() => setPicker(null)}
        />
      )}

      {summaryOpen && activeChat && models && (
        <SummaryDialog
          chat={activeChat}
          modelId={lanes[0]}
          models={models}
          apiKey={settings.apiKey}
          buildMessages={(history, target) => buildMessages(history, target, activeChat)}
          history={summaryHistory ?? undefined}
          onStart={continueFromSummary}
          onClose={() => {
            setSummaryOpen(false);
            setSummaryHistory(null);
          }}
        />
      )}

      {docOpen &&
        (() => {
          const list =
            docOpen.where === "draft"
              ? draftFiles
              : (chats.find((c) => c.id === (docOpen.where as { chatId: string }).chatId)?.messages.find(
                  (m) => m.id === (docOpen.where as { messageId: string }).messageId,
                )?.attachments ?? []);
          const doc = list.find((x) => x.id === docOpen.id);
          return doc ? (
            <DocumentDialog
              attachment={doc}
              models={models}
              apiKey={settings.apiKey}
              bestFree={bestFree.id}
              chatModel={lanes[0]}
              sent={docOpen.where !== "draft"}
              onChange={(next) => {
                updateAttachment(next);
                refreshCredits();
              }}
              onClose={() => setDocOpen(null)}
            />
          ) : null;
        })()}

      {workbenchOpen && models && (
        <Workbench
          apiKey={settings.apiKey}
          models={models}
          videos={videoModels ?? []}
          scores={scores}
          bestFree={bestFree}
          pricePerSecond={minPricePerSecond}
          initialIdea={draft}
          onStart={startPrepared}
          onClose={() => setWorkbenchOpen(false)}
        />
      )}

      {videoOpen && (
        <VideoDialog
          apiKey={settings.apiKey}
          chatModels={models ?? []}
          fallbackModel={lanes[0]}
          initialPrompt={draft.trim()}
          initialModel={videoModel}
          initialOptions={videoOptions ?? undefined}
          images={draftFiles.filter((f) => f.kind === "image")}
          onAddFiles={(files) => void addFiles(files)}
          onSubmit={(req) => void startVideo(req)}
          onClose={() => {
            setVideoOpen(false);
            setVideoModel(undefined);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          models={models}
          autoTiers={autoTierMap}
          onSave={patchSettings}
          onBackup={downloadBackup}
          onRestore={(file) => void restoreBackup(file)}
          onClose={() => setSettingsOpen(false)}
          onTour={() => {
            setSettingsOpen(false);
            startTour();
          }}
          onRoomTour={() => {
            setSettingsOpen(false);
            startRoomTour();
          }}
          onProfiles={() => setProfilesOpen(true)}
        />
      )}
      {/* After the settings, so it opens on top of them. */}
      {profilesOpen && (
        <ProfileDialog
          profiles={profiles}
          defaultProfile={settings.defaultProfile}
          onSave={saveProfiles}
          onClose={() => setProfilesOpen(false)}
        />
      )}

      {tour && (
        <Tour
          key={tour}
          steps={tour === "room" ? ROOM_TOUR : simple ? SIMPLE_CHAT_TOUR : CHAT_TOUR}
          onEnd={endTour}
          // On phones the sidebar is a drawer: open it for the steps that point into it.
          onStep={(s) => {
            if (matchMedia("(max-width: 860px)").matches) setSidebarOpen(!!s.inSidebar);
          }}
        />
      )}

      {roomSetupOpen && (
        <RoomSetup
          models={models}
          apiKey={settings.apiKey}
          favorites={settings.favorites}
          recents={settings.recents}
          onToggleFavorite={toggleFavorite}
          onCreate={(room) => {
            setRooms((all) => [room, ...all]);
            setActiveRoomId(room.id);
            setRoomSetupOpen(false);
            void titleRoom(room);
          }}
          onClose={() => setRoomSetupOpen(false)}
        />
      )}

      {roomUndo && (
        <div className="toast" role="status">
          <span>„{roomUndo.room.title}“ gelöscht.</span>
          <button className="link-button" onClick={restoreRoom} title="Den gelöschten Raum zurückholen">
            Rückgängig
          </button>
        </div>
      )}

      <Tooltips />
      {intro && <Intro onDone={() => setIntro(false)} />}

      {notice && (
        <div className={`toast${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button className="toast-close" onClick={() => setNotice(null)} aria-label="Hinweis schließen">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {undo && (
        <div className="toast" role="status">
          <span>„{undo.chat.title}“ gelöscht.</span>
          <button className="link-button" onClick={restoreChat} title="Den gelöschten Chat zurückholen">
            Rückgängig
          </button>
        </div>
      )}
    </div>
  );
}

function ContextMeter({ usage, onClick }: { usage: ContextUsage; onClick: () => void }) {
  const share = usage.window ? Math.min(1, usage.tokens / usage.window) : 0;
  const label = usage.window
    ? `${formatTokens(usage.tokens)} von ${formatTokens(usage.window)} Tokens Kontext belegt`
    : `${formatTokens(usage.tokens)} Tokens Kontext`;
  return (
    <button className={`context-meter ${usage.level}`} onClick={onClick} title={`${label}. Klicken zum Zusammenfassen.`}>
      <span className="visually-hidden">{label}</span>
      <span className="meter-track" aria-hidden="true">
        <span className="meter-fill" style={{ width: `${Math.max(3, share * 100)}%` }} />
      </span>
      <span aria-hidden="true">{formatTokens(usage.tokens)}</span>
    </button>
  );
}

function PrepCard({ prep, open }: { prep: NonNullable<Chat["prep"]>; open: boolean }) {
  return (
    <details className="seed prep-card" open={open}>
      <summary title="Aufklappen: die Anweisung, mit der die Werkbank diesen Chat vorbereitet hat">Vorbereitet mit der Werkbank{prep.role ? `: ${prep.role}` : ""}</summary>
      {prep.approach && <p className="prep-role">Vorgehen: {prep.approach}</p>}
      <pre>{prep.system}</pre>
    </details>
  );
}

function SeedCard(props: {
  seed: NonNullable<Chat["seed"]>;
  exists: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <details className="seed" open={props.open}>
      <summary title="Aufklappen: die Zusammenfassung, mit der dieser Chat weitermacht">
        Fortsetzung von „{props.seed.fromTitle}“. Das Modell kennt die Zusammenfassung des bisherigen Stands.
      </summary>
      <Markdown text={props.seed.summary} />
      {props.exists && (
        <button className="link-button" onClick={props.onOpen} title="Den Chat öffnen, der hier zusammengefasst wurde">
          Ursprünglichen Chat öffnen
        </button>
      )}
    </details>
  );
}

/** Mark the fastest and cheapest of a finished comparison. */
function turnHighlights(answers: Message[]) {
  const out = new Map<string, string[]>();
  const done = answers.filter((a) => a.durationMs !== undefined && !a.error && a.content);
  if (done.length < 2) return out;
  // Ties all get the mark; durations count as tied within 0.1 s.
  const mark = (items: Message[], value: (m: Message) => number, tolerance: number, label: string) => {
    if (items.length < 2) return;
    const best = Math.min(...items.map(value));
    const winners = items.filter((m) => value(m) - best <= tolerance);
    if (winners.length === items.length) return;
    for (const m of winners) out.set(m.id, [...(out.get(m.id) ?? []), label]);
  };
  mark(done, (m) => m.durationMs!, 100, "am schnellsten");
  mark(done.filter((m) => m.usage?.cost !== undefined), (m) => m.usage!.cost!, 0, "am günstigsten");
  return out;
}

function ModelHero(props: {
  model?: Model;
  id: string;
  note?: string;
  onChange: () => void;
  onCompare: () => void;
  /** Simple view: name only, without prices or ways to pick and compare. */
  simple?: boolean;
  children?: React.ReactNode;
}) {
  const { model, id } = props;
  const input = model ? perMillion(model.pricing.prompt) : null;
  const output = model ? perMillion(model.pricing.completion) : null;
  return (
    <section className="hero">
      <p className="hero-provider">{model ? providerLabel(model) : "Modell"}</p>
      <h1 className="hero-name">{model ? shortName(model) : id}</h1>
      {props.note && <p className="hero-note">{props.note}</p>}
      {model && !props.simple && (
        <dl className="hero-stats">
          <div>
            <dt>Eingabe</dt>
            <dd className="in">{formatPrice(input)}</dd>
          </div>
          <div>
            <dt>Ausgabe</dt>
            <dd className="out">{formatPrice(output)}</dd>
          </div>
          <div>
            <dt>Kontext</dt>
            <dd>{formatTokens(model.context_length)}</dd>
          </div>
        </dl>
      )}
      {model && !props.simple && <p className="hero-unit">Preise in US-Dollar pro einer Million Tokens.</p>}
      {!props.simple && (
        <div className="hero-actions">
          <button className="link-button" onClick={props.onChange} title="Die Auswahl aller Modelle mit Preisen öffnen">
            Anderes Modell wählen
          </button>
          <button className="link-button" onClick={props.onCompare} title="Dieselbe Frage mehreren Modellen stellen und die Antworten nebeneinander sehen">
            Mit weiteren Modellen vergleichen
          </button>
        </div>
      )}
      {props.children}
    </section>
  );
}

function FusionHero(props: { team: string[]; cost: number | null; modelName: (id: string) => string; onChange: () => void }) {
  const names = props.team.map(props.modelName);
  return (
    <section className="hero">
      <p className="hero-provider">{names.length} Modelle, eine Antwort</p>
      <h1 className="hero-name">Beste Antwort</h1>
      <p className="hero-note">
        {names.slice(0, -1).join(", ")} und {names[names.length - 1]} beantworten deine Frage unabhängig voneinander.
        Danach macht {names[0]} daraus eine Antwort: Was stimmt, wird übernommen, Fehler und Widersprüche werden geklärt.
      </p>
      <dl className="hero-stats">
        <div>
          <dt>Pro Antwort</dt>
          <dd>≈ {formatAnswerCost(props.cost)}</dd>
        </div>
        <div>
          <dt>Dauer</dt>
          <dd>etwas länger</dd>
        </div>
      </dl>
      <p className="hero-unit">Die einzelnen Antworten kannst du unter jeder Antwort aufklappen.</p>
      <div className="hero-actions">
        <button className="link-button" onClick={props.onChange} title="Statt mehrerer Modelle wieder nur eines antworten lassen">
          Ein einzelnes Modell wählen
        </button>
      </div>
    </section>
  );
}

function VideoHero({ video }: { video: VideoModel }) {
  const p = minPricePerSecond(video);
  const durations = video.supported_durations ?? [];
  return (
    <section className="hero">
      <p className="hero-provider">Videomodell, {video.name.split(":")[0]}</p>
      <h1 className="hero-name">{video.name.replace(/^[^:]+:\s*/, "")}</h1>
      <dl className="hero-stats">
        <div>
          <dt>Preis ab</dt>
          <dd>{p !== null ? `${(p * 60).toFixed(2).replace(".", ",")} $/min` : "nach Video-Tokens"}</dd>
        </div>
        {durations.length > 0 && (
          <div>
            <dt>Länge</dt>
            <dd>
              {Math.min(...durations)} bis {Math.max(...durations)} s
            </dd>
          </div>
        )}
      </dl>
      <p className="hero-note">
        Beschreibe unten, was zu sehen sein soll. Vor dem Erstellen siehst du Dauer, Format und die genauen Kosten. Fotos
        lassen sich als Start- oder Referenzbild anhängen.
      </p>
    </section>
  );
}

function CompareHero({ lanes, modelById }: { lanes: string[]; modelById: Map<string, Model> }) {
  return (
    <section className="hero">
      <p className="hero-provider">{lanes.length} Modelle im Vergleich</p>
      <h1 className="hero-name compare-title">Eine Frage, {lanes.length} Antworten.</h1>
      <table className="compare-table">
        <thead>
          <tr>
            <th>Modell</th>
            <th className="num">Eingabe</th>
            <th className="num">Ausgabe</th>
            <th className="num">Kontext</th>
          </tr>
        </thead>
        <tbody>
          {lanes.map((id) => {
            const m = modelById.get(id);
            return (
              <tr key={id}>
                <td>
                  <span className="ct-name">{m ? shortName(m) : id}</span>
                  {m && <span className="ct-provider">{providerLabel(m)}</span>}
                </td>
                <td className="num in">{m ? formatPrice(perMillion(m.pricing.prompt)) : ""}</td>
                <td className="num out">{m ? formatPrice(perMillion(m.pricing.completion)) : ""}</td>
                <td className="num">{m ? formatTokens(m.context_length) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hero-unit">
        Preise in US-Dollar pro einer Million Tokens. Jedes Modell wird einzeln abgerechnet, ein Vergleich kostet
        also die Summe aller Antworten.
      </p>
    </section>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function titleFrom(text: string) {
  const line = text.split("\n")[0].trim();
  return line.length > 48 ? `${line.slice(0, 46).trimEnd()} …` : line;
}
