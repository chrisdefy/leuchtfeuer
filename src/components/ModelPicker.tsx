import { useEffect, useMemo, useRef, useState } from "react";
import { formatPrice, formatTokens } from "../lib/format";
import {
  fetchCategory,
  fetchVideoModels,
  isFree,
  itemPrice,
  makesMusic,
  perMillion,
  providerLabel,
  shortName,
  type Model,
  type VideoModel,
} from "../lib/openrouter";
import { isClassifier, scoreOf, type Scores } from "../lib/benchmarks";
import { USE_CASES, blendedPrice, isUncensored, recommend, type UseCase } from "../lib/recommend";
import { Icon } from "./Icon";
import { minPricePerSecond } from "./VideoDialog";

type Sort = "popular" | "smartest" | "newest" | "cheapest" | "context";
type VideoSort = "cheapest" | "newest" | "longest" | "sharpest";
type Filter = "free" | "vision" | "pdf" | "reasoning" | "tools" | "memory" | "code" | "open" | "uncensored" | "roleplay";
type Area = "text" | "image" | "video" | "audio";
type Tier = "flagship" | "upper" | "mid" | "cheap";

const AREAS: { id: Area; label: string; hint: string }[] = [
  { id: "text", label: "Text & Chat", hint: "Schreiben, Fragen, Code, Analyse" },
  { id: "image", label: "Bilder", hint: "Erzeugt und bearbeitet Bilder" },
  { id: "video", label: "Video", hint: "Erzeugt kurze Videos" },
  { id: "audio", label: "Audio", hint: "Macht Musik oder antwortet mit gesprochener Stimme" },
];

export function areaOf(m: Model): Area {
  const out = m.architecture?.output_modalities ?? ["text"];
  if (m.id.startsWith("openrouter/")) return "text";
  if (out.includes("image")) return "image";
  if (out.includes("audio")) return "audio";
  return "text";
}

const TIERS: { id: Tier; label: string; hint: string }[] = [
  { id: "flagship", label: "Flaggschiff", hint: "Ab 5 $ pro 1M Eingabe-Tokens: die stärksten und teuersten Modelle" },
  { id: "upper", label: "Oberklasse", hint: "1 bis 5 $: sehr gut für fast alles" },
  { id: "mid", label: "Mittelklasse", hint: "0,20 bis 1 $: solide und günstig" },
  { id: "cheap", label: "Schnell & günstig", hint: "Unter 0,20 $ oder kostenlos: für einfache Aufgaben und viel Volumen" },
];

/** Price is the only signal for capability tiers the catalog offers; good enough to orient. */
export function tierOf(m: Model): Tier | undefined {
  if (itemPrice(m)) return undefined;
  const p = perMillion(m.pricing.prompt);
  if (p === null) return undefined;
  if (p >= 5) return "flagship";
  if (p >= 1) return "upper";
  if (p >= 0.2) return "mid";
  return "cheap";
}

const isCode = (m: Model) => /code|coder|devstral|codestral/i.test(`${m.id} ${m.name}`);

/** Kinds of models no catalog field marks; their makers say so in name or description. */
const describes = (m: Model, re: RegExp) => re.test(`${m.id} ${m.name} ${m.description ?? ""}`);
export { isUncensored };
const isRoleplay = (m: Model) =>
  describes(m, /role-?play|storytelling|interactive fiction|immersive|euryale|mythomax|magnum/i);

/** "Viel Gedächtnis": long documents or long chats fit. */
const BIG_CONTEXT = 400_000;

/**
 * Filters by what a model can do. `expert` ones show only with "Alle Modelle zeigen";
 * "Wenige Einschränkungen" only after the opt-in in the settings.
 */
const FILTERS: { id: Filter; label: string; hint: string; test: (m: Model) => boolean; expert?: boolean }[] = [
  { id: "free", label: "Kostenlos", hint: "Nichts bezahlen, dafür höchstens 50 oder 1.000 Anfragen pro Tag", test: isFree },
  { id: "vision", label: "Versteht Bilder", hint: "Kann Fotos und Screenshots ansehen", test: (m) => !!m.architecture?.input_modalities?.includes("image") },
  { id: "pdf", label: "Liest PDFs", hint: "Bekommt PDFs als Original, mit Bildern und Tabellen", test: (m) => !!m.architecture?.input_modalities?.includes("file") },
  { id: "reasoning", label: "Denkt nach", hint: "Überlegt vor der Antwort: besser bei kniffligen Aufgaben, etwas langsamer", test: (m) => !!m.supported_parameters?.includes("reasoning") },
  { id: "tools", label: "Kann Werkzeuge nutzen", hint: "Kann z. B. die Websuche selbst einsetzen und Links öffnen", test: (m) => !!m.supported_parameters?.includes("tools") },
  { id: "memory", label: "Viel Gedächtnis", hint: "Ab 400.000 Tokens Kontext: ganze Bücher oder sehr lange Chats passen hinein", test: (m) => m.context_length >= BIG_CONTEXT },
  { id: "code", label: "Code", hint: "Auf Programmieren spezialisiert", test: isCode, expert: true },
  { id: "open", label: "Offene Gewichte", hint: "Frei veröffentlichte Modelle, meist günstig", test: (m) => !!m.hugging_face_id, expert: true },
  { id: "roleplay", label: "Rollenspiel & Geschichten", hint: "Für Geschichten, Figuren und Rollen im Chatroom", test: isRoleplay, expert: true },
  { id: "uncensored", label: "Wenige Einschränkungen", hint: "Verweigert selten, auch bei heiklen Themen. Nicht klüger, eher ältere Modelle. Nur ab 18.", test: isUncensored },
];

/** Set from the settings: models with few restrictions are offered only after an explicit opt-in (18+). */
let unrestricted = false;
export function setUnrestricted(on: boolean) {
  unrestricted = on;
}

const DAY = 86_400;
/** Older models are hidden by default; newer ones of the same maker do the job better and often cheaper. */
const OLD_AFTER_DAYS = 365;

/**
 * Models the default list leaves out, because a better entry for the same thing is already there:
 * safety filters (no chat), special routers, previews and dated snapshots of a released model,
 * free twins of a paid model (they show with "Kostenlos"), and models older than a year.
 */
function niche(m: Model, ids: Set<string>, now: number): string | null {
  if (isClassifier(m.id)) return "filter";
  if (m.id.startsWith("openrouter/")) return m.id === "openrouter/auto" || m.id === "openrouter/free" ? null : "router";
  const base = m.id.replace(/:.*$/, "");
  if (m.id.endsWith(":free") && ids.has(base)) return "free-twin";
  if (/-preview(-[\w-]+)?$/.test(base) && ids.has(base.replace(/-preview(-[\w-]+)?$/, ""))) return "preview";
  if (/-(\d{4}|\d{8}|\d{2}-\d{2})$/.test(base) && ids.has(base.replace(/-(\d{4}|\d{8}|\d{2}-\d{2})$/, ""))) return "snapshot";
  if (m.created && now - m.created > OLD_AFTER_DAYS * DAY) return "old";
  return null;
}

const SORTS: { id: Sort; label: string }[] = [
  { id: "popular", label: "Meistgenutzt" },
  { id: "smartest", label: "Intelligenteste" },
  { id: "newest", label: "Neueste" },
  { id: "cheapest", label: "Günstigste" },
  { id: "context", label: "Größter Kontext" },
];

const VIDEO_SORTS: { id: VideoSort; label: string }[] = [
  { id: "cheapest", label: "Günstigste" },
  { id: "newest", label: "Neueste" },
  { id: "longest", label: "Längste Videos" },
  { id: "sharpest", label: "Schärfste Auflösung" },
];

/** "480p" → 480, "2K" → 1440, "4K" → 2160; unknown → 0. */
function resolutionRank(r: string) {
  const p = /^(\d+)p$/i.exec(r);
  if (p) return Number(p[1]);
  const k = /^(\d+)K$/i.exec(r);
  return k ? Number(k[1]) * 540 + (k[1] === "2" ? 360 : 0) : 0;
}

const longest = (v: VideoModel) => Math.max(0, ...(v.supported_durations ?? []));
const sharpest = (v: VideoModel) => Math.max(0, ...(v.supported_resolutions ?? []).map(resolutionRank));

const usd = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2 })} $`;

/** What a model is and can do, in a few plain words. */
function summary(m: Model) {
  const inputs = m.architecture?.input_modalities ?? [];
  const tier = tierOf(m);
  if (isClassifier(m.id)) return "Sicherheitsfilter, prüft Inhalte, kein Chatmodell";
  if (areaOf(m) === "audio") {
    const item = itemPrice(m);
    return makesMusic(m)
      ? `Macht Musik${item ? `, ${usd(item.usd)} pro ${item.unit}` : ""}`
      : "Spricht seine Antworten, keine Musik";
  }
  const parts = [
    m.id.startsWith("openrouter/") ? "Wählt selbst ein passendes Modell" : tier && TIERS.find((t) => t.id === tier)!.label,
    isFree(m) && "kostenlos",
    m.supported_parameters?.includes("reasoning") && "denkt nach",
    inputs.includes("image") && "versteht Bilder",
    inputs.includes("file") && "liest PDFs",
    inputs.includes("video") && "versteht Video",
    inputs.includes("audio") && "versteht Audio",
    isCode(m) && "für Code",
    isUncensored(m) && "wenige Einschränkungen",
    isRoleplay(m) && "Rollenspiel",
    m.hugging_face_id && "offene Gewichte",
  ].filter(Boolean) as string[];
  return parts.slice(0, 5).join(", ");
}

interface Props {
  models: Model[] | null;
  error: string | null;
  current: string;
  favorites: string[];
  recents: string[];
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onRetry: () => void;
  onClose: () => void;
  /** Preselected filter, e.g. when the user needs a model that can see images. */
  initialFilter?: Filter;
  /** Picking a video model opens video creation; without this the Video area is hidden. */
  onSelectVideo?: (id: string) => void;
  /** Independent benchmark scores (Artificial Analysis), if available. */
  scores?: Map<string, Scores> | null;
  /** Open on this area, e.g. "video" when a video model is current. */
  initialArea?: Area;
}

interface Group {
  label: string;
  models: Model[];
  /** Badge and one-line reason per model id, for recommendation rows. */
  notes?: Map<string, { badge: string; reason: string }>;
}

/** "Alle Modelle zeigen" stays on for the session once chosen. */
let showAllMemory = false;

/** Usage rankings per category; they change slowly, so one fetch per session is enough. */
const rankingCache = new Map<string, string[]>();
let videoCache: VideoModel[] | null = null;

function matches(text: string, terms: string[]) {
  const hay = text.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function ModelPicker(props: Props) {
  const { models, current, favorites, recents } = props;
  const currentModel = models?.find((m) => m.id === current);
  const [area, setArea] = useState<Area>(currentModel ? areaOf(currentModel) : (props.initialArea ?? "text"));
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const [filters, setFilters] = useState<Set<Filter>>(() => new Set(props.initialFilter ? [props.initialFilter] : []));
  const [tier, setTier] = useState<Tier | null>(null);
  const [sort, setSort] = useState<Sort>("newest");
  const [videoSort, setVideoSort] = useState<VideoSort>("cheapest");
  const [useCase, setUseCase] = useState<UseCase | null>(null);
  const [ranked, setRanked] = useState<string[] | null>(null);
  const [rankError, setRankError] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoModel[] | null>(videoCache);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  /** Expert view: every model in the catalog and the "Wofür?" rankings. */
  const [showAll, setShowAll] = useState(showAllMemory);
  /** The "Favoriten" tab: starred models side by side in a table. */
  const [favView, setFavView] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), [area]);

  useEffect(() => {
    if (area !== "video" || videoCache) return;
    const ctrl = new AbortController();
    fetchVideoModels(ctrl.signal)
      .then((data) => {
        videoCache = data.filter((m) => m.supported_durations?.length && !/edit|upscale|avatar/.test(m.id));
        setVideos(videoCache);
      })
      .catch((e) => e.name !== "AbortError" && setVideoError(e.message));
    return () => ctrl.abort();
  }, [area]);

  useEffect(() => {
    setRankError(null);
    if (!useCase) return setRanked(null);
    const cached = rankingCache.get(useCase.category);
    if (cached) return setRanked(cached);
    setRanked(null);
    const ctrl = new AbortController();
    fetchCategory(useCase.category, ctrl.signal)
      .then((ids) => {
        rankingCache.set(useCase.category, ids);
        setRanked(ids);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setRankError(e.message);
      });
    return () => ctrl.abort();
  }, [useCase]);

  const rankOf = useMemo(() => new Map((ranked ?? []).map((id, i) => [id, i + 1])), [ranked]);
  const ids = useMemo(() => new Set((models ?? []).map((m) => m.id)), [models]);
  const allInArea = useMemo(
    () => (models ?? []).filter((m) => areaOf(m) === area && (unrestricted || !isUncensored(m))),
    [models, area],
  );
  // Favorites, recent and the current model always stay, even if they would be hidden.
  const keep = useMemo(() => new Set([...favorites, ...recents, current]), [favorites, recents, current]);
  const inArea = useMemo(() => {
    if (showAll) return allInArea;
    const now = Date.now() / 1000;
    return allInArea.filter((m) => {
      const why = keep.has(m.id) ? null : niche(m, ids, now);
      return !why || (why === "free-twin" && filters.has("free"));
    });
  }, [allInArea, showAll, keep, ids, filters]);
  const hiddenCount = allInArea.length - inArea.length;

  // Only sorts that change something here: scores exist for text models, context matters only for text.
  const sorts = useMemo(() => {
    const scored = inArea.some((m) => scoreOf(m, props.scores ?? null)?.intelligence !== undefined);
    return SORTS.filter(
      (s) => (s.id !== "popular" || useCase) && (s.id !== "smartest" || scored) && (s.id !== "context" || area === "text"),
    );
  }, [inArea, props.scores, useCase, area]);
  const activeSort: Sort = sorts.some((s) => s.id === sort) ? sort : "newest";

  function chooseUseCase(next: UseCase | null) {
    setUseCase(next);
    if (next) setSort("popular");
    else if (sort === "popular") setSort("newest");
  }

  function chooseArea(next: Area) {
    setFavView(false);
    setArea(next);
    setProvider(null);
    setActive(0);
    if (next !== "text") setFilters((f) => new Set([...f].filter((x) => x === "free")));
    if (next !== "text") chooseUseCase(null);
  }

  const providers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of inArea) {
      const label = providerLabel(m);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [inArea]);

  const groups = useMemo<Group[]>(() => {
    if (!models || area === "video") return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const activeFilters = FILTERS.filter((f) => filters.has(f.id));
    const pass = (m: Model) =>
      (!provider || providerLabel(m) === provider) &&
      (!tier || tierOf(m) === tier) &&
      matches(`${m.id} ${m.name}`, terms) &&
      activeFilters.every((f) => f.test(m));

    const byId = new Map(models.map((m) => [m.id, m]));
    // A search looks through every model, so nothing seems to be missing.
    const base = useCase
      ? (ranked ?? []).map((id) => byId.get(id)).filter((m): m is Model => !!m && (unrestricted || !isUncensored(m)))
      : terms.length
        ? allInArea
        : inArea;
    const all = base.filter(pass);
    // Classifiers can score high on paper but are no use as a chat partner.
    const iq = (m: Model) => (isClassifier(m.id) ? -2 : (scoreOf(m, props.scores ?? null)?.intelligence ?? -1));
    // Ties (e.g. all free models cost 0) fall back to the smarter, then the newer model.
    const tie = (a: Model, b: Model) => iq(b) - iq(a) || b.created - a.created;
    // Routers pass the request on; their listed context is the largest of any model behind them.
    const router = (m: Model) => (m.id.startsWith("openrouter/") ? 1 : 0);
    if (activeSort === "newest") all.sort((a, b) => b.created - a.created);
    if (activeSort === "cheapest") all.sort((a, b) => blendedPrice(a) - blendedPrice(b) || tie(a, b));
    if (activeSort === "context") all.sort((a, b) => router(a) - router(b) || b.context_length - a.context_length || tie(a, b));
    if (activeSort === "smartest") all.sort((a, b) => iq(b) - iq(a) || b.created - a.created);

    // A sort the user picked applies to the whole list. Favorites and recents on top would hide it.
    const sorted = activeSort !== (useCase ? "popular" : "newest");
    const sortLabel = `${SORTS.find((s) => s.id === activeSort)!.label} zuerst`;
    const browsing = terms.length === 0 && !provider && filters.size === 0 && !tier && !sorted;
    const onlySorted = terms.length === 0 && !provider && filters.size === 0 && !tier && sorted;
    if (useCase) {
      if (!ranked) return [];
      if (onlySorted) return [{ label: `${all.length} Modelle für ${useCase.label}, ${sortLabel}`, models: all }];
      if (!browsing) return [{ label: `${all.length} Treffer für ${useCase.label}`, models: all }];
      const recs = recommend(models, ranked, useCase);
      return [
        {
          label: `Empfehlungen für ${useCase.label}`,
          models: recs.map((r) => r.model),
          notes: new Map(recs.map((r) => [r.model.id, { badge: r.badge, reason: r.reason }])),
        },
        { label: `Meistgenutzt für ${useCase.label}`, models: all },
      ].filter((g) => g.models.length > 0);
    }
    // With "Kostenlos" on, the free router is the easiest start: no model choice needed.
    const freeRouter = byId.get("openrouter/free");
    if (filters.has("free") && freeRouter && area === "text" && !terms.length) {
      return [
        {
          label: "Einfachster Einstieg",
          models: [freeRouter],
          notes: new Map([
            [
              freeRouter.id,
              {
                badge: "Kostenlos",
                reason: "Wählt bei jeder Anfrage automatisch ein gerade verfügbares kostenloses Modell, passend zur Anfrage.",
              },
            ],
          ]),
        },
        ...(() => {
          const rest = all.filter((m) => m.id !== freeRouter.id);
          return rest.length ? [{ label: `${rest.length} kostenlose Modelle`, models: rest }] : [];
        })(),
      ];
    }
    if (onlySorted) return [{ label: `${all.length} Modelle, ${sortLabel}`, models: all }];
    if (!browsing) return [{ label: `${all.length} Treffer, ${sortLabel}`, models: all }];

    const inThisArea = (m: Model | undefined): m is Model => !!m && areaOf(m) === area;
    const favs = favorites.map((id) => byId.get(id)).filter(inThisArea);
    const recent = recents
      .filter((id) => !favorites.includes(id))
      .map((id) => byId.get(id))
      .filter(inThisArea)
      .slice(0, 5);
    // Music and speaking voices are different things; one list made speech models look like music makers.
    const rest =
      area === "audio"
        ? [
            { label: "Musik", models: all.filter((m) => makesMusic(m)) },
            { label: "Sprechen (Antwort als Stimme)", models: all.filter((m) => !makesMusic(m)) },
          ]
        : [{ label: area === "text" ? "Alle Text-Modelle" : "Alle Modelle", models: all }];
    return [{ label: "Favoriten", models: favs }, { label: "Zuletzt genutzt", models: recent }, ...rest].filter(
      (g) => g.models.length > 0,
    );
  }, [models, area, inArea, allInArea, query, provider, filters, tier, activeSort, favorites, recents, useCase, ranked, props.scores]);

  const videoList = useMemo(() => {
    if (area !== "video" || !videos) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const price = (v: VideoModel) => minPricePerSecond(v) ?? Infinity;
    const list = videos.filter((v) => matches(`${v.id} ${v.name}`, terms));
    if (videoSort === "cheapest") list.sort((a, b) => price(a) - price(b));
    if (videoSort === "newest") list.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    if (videoSort === "longest") list.sort((a, b) => longest(b) - longest(a) || price(a) - price(b));
    if (videoSort === "sharpest") list.sort((a, b) => sharpest(b) - sharpest(a) || price(a) - price(b));
    return list;
  }, [area, videos, query, videoSort]);

  const flat = useMemo(() => groups.flatMap((g) => g.models), [groups]);
  const count = area === "video" ? videoList.length : flat.length;
  const activeModel = area === "video" ? undefined : flat[Math.min(active, flat.length - 1)];
  const activeVideo = area === "video" ? videoList[Math.min(active, videoList.length - 1)] : undefined;

  useEffect(() => setActive(0), [query, provider, filters, sort, videoSort, useCase, ranked, tier, area]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(index: number) {
    if (area === "video") {
      const v = videoList[index];
      if (v) props.onSelectVideo?.(v.id);
    } else {
      const m = flat[index];
      if (m) props.onSelect(m.id);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  }

  /** "Schnell & günstig" means the user is looking for a low price, so the cheapest come first. */
  function chooseTier(next: Tier | null) {
    setTier(next);
    if (next === "cheap") setSort("cheapest");
    else if (next && sort === "cheapest") setSort(useCase ? "popular" : "newest");
  }

  function toggleFilter(id: Filter) {
    // All free models cost the same (nothing), so the best of them should lead.
    if (id === "free" && !filters.has(id)) setSort(props.scores?.size ? "smartest" : sort);
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const areas = AREAS.filter((a) => a.id !== "video" || props.onSelectVideo);
  const areaCount = (a: Area) => {
    if (a === "video") return videos?.length ?? "";
    const now = Date.now() / 1000;
    return (models ?? []).filter(
      (m) => areaOf(m) === a && (unrestricted || !isUncensored(m)) && (showAll || keep.has(m.id) || !niche(m, ids, now)),
    ).length;
  };
  let index = -1;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="picker" role="dialog" aria-modal="true" aria-label="Modell wählen" onKeyDown={onKeyDown}>
        <div className="picker-search">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={area === "video" ? "Videomodelle durchsuchen" : models ? `${allInArea.length} Modelle durchsuchen` : "Modelle werden geladen"}
            aria-label="Modelle durchsuchen"
            aria-controls="picker-list"
          />
          <kbd>esc</kbd>
          <button className="ghost icon-only picker-close" onClick={props.onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </div>

        <div className="areas" role="tablist" aria-label="Art des Modells">
          {areas.map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={!favView && area === a.id}
              className="area"
              onClick={() => chooseArea(a.id)}
              title={a.hint}
            >
              {a.label}
              <span className="count">{areaCount(a.id)}</span>
            </button>
          ))}
          <button
            role="tab"
            aria-selected={favView}
            className="area fav-tab"
            onClick={() => setFavView(true)}
            title="Deine mit Stern markierten Modelle im Vergleich: Art, Klasse, Fähigkeiten, Preise"
          >
            <Icon name="star-filled" size={14} />
            Favoriten
            <span className="count">{favorites.length}</span>
          </button>
        </div>

        {favView && (
          <FavoritesTable
            models={(models ?? []).filter((m) => favorites.includes(m.id))}
            order={favorites}
            current={current}
            scores={props.scores ?? null}
            onSelect={props.onSelect}
            onToggleFavorite={props.onToggleFavorite}
          />
        )}

        {!favView && area === "text" && showAll && (
          <div className="usecases" role="group" aria-label="Wofür brauchst du das Modell?">
            <span className="usecases-label">Wofür?</span>
            <div className="usecases-scroll">
              {USE_CASES.map((u) => (
                <button
                  key={u.id}
                  className="chip usecase"
                  aria-pressed={useCase?.id === u.id}
                  onClick={() => chooseUseCase(useCase?.id === u.id ? null : u)}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!favView && area !== "video" && (
          <div className="picker-toolbar">
            <div className="toolbar-rows">
              <div className="chips tiers" role="group" aria-label="Klasse">
                {TIERS.map((t) => (
                  <button
                    key={t.id}
                    className="chip tier"
                    aria-pressed={tier === t.id}
                    title={t.hint}
                    onClick={() => chooseTier(tier === t.id ? null : t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="chips" role="group" aria-label="Filter">
                {FILTERS.filter(
                  (f) =>
                    (area === "text" || f.id === "free") &&
                    (!f.expert || showAll || filters.has(f.id)) &&
                    (f.id !== "uncensored" || unrestricted),
                ).map((f) => (
                  <button key={f.id} className="chip" aria-pressed={filters.has(f.id)} onClick={() => toggleFilter(f.id)} title={f.hint}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="toolbar-end">
            {(hiddenCount > 0 || showAll) && (
              <button
                className="chip all-models"
                aria-pressed={showAll}
                onClick={() => {
                  const next = !showAll;
                  showAllMemory = next;
                  setShowAll(next);
                  if (!next) {
                    chooseUseCase(null);
                    setFilters((f) => new Set([...f].filter((x) => !FILTERS.find((y) => y.id === x)?.expert)));
                  }
                }}
                title={
                  showAll
                    ? "Zurück zur übersichtlichen Auswahl"
                    : `Auch ${hiddenCount} ältere Modelle, Vorschau- und Zwischenversionen, Gratis-Doppelgänger und Spezialmodelle zeigen, dazu Ranglisten nach Einsatzgebiet`
                }
              >
                {showAll ? "Übersichtlich" : `Alle Modelle (+${hiddenCount})`}
              </button>
            )}
            <label className="sort">
              <span className="visually-hidden">Sortieren</span>
              <select value={activeSort} onChange={(e) => setSort(e.target.value as Sort)}>
                {sorts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            </div>
          </div>
        )}

        {!favView && area === "video" && (
          <div className="picker-toolbar">
            <p className="hint">Auswählen öffnet die Videoerstellung mit Dauer, Format und Kosten.</p>
            <label className="sort">
              <span className="visually-hidden">Sortieren</span>
              <select value={videoSort} onChange={(e) => setVideoSort(e.target.value as VideoSort)}>
                {VIDEO_SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className={`picker-body${area === "video" ? " no-providers" : ""}`} hidden={favView}>
          {area !== "video" && (
            <nav className="providers" aria-label="Anbieter">
              <button className="provider" aria-pressed={provider === null} onClick={() => setProvider(null)}>
                <span>Alle Anbieter</span>
                <span className="count">{inArea.length}</span>
              </button>
              {providers.map(([label, n]) => (
                <button
                  key={label}
                  className="provider"
                  aria-pressed={provider === label}
                  onClick={() => setProvider(provider === label ? null : label)}
                >
                  <span>{label}</span>
                  <span className="count">{n}</span>
                </button>
              ))}
            </nav>
          )}

          <div className="picker-list" id="picker-list" role="listbox" ref={listRef} aria-label="Modelle">
            {area === "video" ? (
              videoError ? (
                <div className="picker-empty">
                  <p>Die Videomodelle konnten nicht geladen werden: {videoError}</p>
                </div>
              ) : !videos ? (
                <div className="picker-empty">
                  <p>Videomodelle werden geladen …</p>
                </div>
              ) : (
                <section className="group">
                  <h3 className="group-label">
                    {videoList.length} Videomodelle, {VIDEO_SORTS.find((s) => s.id === videoSort)!.label} zuerst
                  </h3>
                  {videoList.map((v, i) => (
                    <VideoRow
                      key={v.id}
                      video={v}
                      index={i}
                      active={i === active}
                      onHover={() => setActive(i)}
                      onSelect={() => choose(i)}
                    />
                  ))}
                </section>
              )
            ) : props.error ? (
              <div className="picker-empty">
                <p>Die Modellliste konnte nicht geladen werden: {props.error}</p>
                <button className="button" onClick={props.onRetry}>
                  Erneut laden
                </button>
              </div>
            ) : !models ? (
              <div className="picker-empty">
                <p>Modelle werden geladen …</p>
              </div>
            ) : rankError ? (
              <div className="picker-empty">
                <p>Die Rangliste für {useCase?.label} konnte nicht geladen werden: {rankError}</p>
                <button className="button" onClick={() => chooseUseCase(null)}>
                  Alle Modelle zeigen
                </button>
              </div>
            ) : useCase && !ranked ? (
              <div className="picker-empty">
                <p>Empfehlungen für {useCase.label} werden geladen …</p>
              </div>
            ) : flat.length === 0 ? (
              <div className="picker-empty">
                <p>Kein Modell passt dazu. Entferne einen Filter oder versuche einen kürzeren Suchbegriff.</p>
              </div>
            ) : (
              <>
                <div className="scale-legend" aria-hidden="true">
                  <span />
                  <span className="ctx">Kontext</span>
                  <span className="scale-ticks">
                    <span className="ticks">
                      <span>$0,01</span>
                      <span>$1</span>
                      <span>$100</span>
                    </span>
                    <span className="unit">pro 1M</span>
                  </span>
                </div>
                {groups.map((g) => (
                  <section key={g.label} className="group">
                    <h3 className="group-label">{g.label}</h3>
                    {g.models.map((m) => {
                      index++;
                      const i = index;
                      return (
                        <ModelRow
                          key={`${g.label}-${m.id}`}
                          model={m}
                          index={i}
                          active={i === active}
                          selected={m.id === current}
                          favorite={favorites.includes(m.id)}
                          note={g.notes?.get(m.id)}
                          freeTwin={!m.id.includes(":") && ids.has(`${m.id}:free`)}
                          rank={g.notes ? undefined : rankOf.get(m.id)}
                          onHover={() => setActive(i)}
                          onSelect={() => props.onSelect(m.id)}
                          onToggleFavorite={() => props.onToggleFavorite(m.id)}
                        />
                      );
                    })}
                  </section>
                ))}
              </>
            )}
          </div>
        </div>

        {!favView && (activeModel || activeVideo) && (
          <footer className="picker-detail" aria-live="polite">
            {activeModel ? (
              <ModelDetail model={activeModel} score={scoreOf(activeModel, props.scores ?? null)} onPick={() => props.onSelect(activeModel.id)} />
            ) : (
              <VideoDetail video={activeVideo!} onPick={() => props.onSelectVideo?.(activeVideo!.id)} />
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

type FavSort = "added" | "price" | "smart" | "context";

/** Starred models in one table, so they can be compared at a glance and picked with one click. */
function FavoritesTable(props: {
  models: Model[];
  order: string[];
  current: string;
  scores: Map<string, Scores> | null;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const [sort, setSort] = useState<FavSort>("added");
  const rows = [...props.models];
  const iq = (m: Model) => scoreOf(m, props.scores)?.intelligence ?? -1;
  if (sort === "added") rows.sort((a, b) => props.order.indexOf(a.id) - props.order.indexOf(b.id));
  if (sort === "price") rows.sort((a, b) => blendedPrice(a) - blendedPrice(b));
  if (sort === "smart") rows.sort((a, b) => iq(b) - iq(a));
  if (sort === "context") rows.sort((a, b) => b.context_length - a.context_length);

  if (!rows.length) {
    return (
      <div className="fav-view">
        <div className="picker-empty">
          <p>Noch keine Favoriten.</p>
          <p className="hint">
            Markiere Modelle in der Liste mit dem Stern. Hier stehen sie dann nebeneinander, mit Art, Klasse, Fähigkeiten und
            Preisen, und du wählst sie mit einem Klick.
          </p>
        </div>
      </div>
    );
  }

  const head = (id: FavSort, label: string, className?: string) => (
    <th className={className} aria-sort={sort === id ? (id === "price" ? "ascending" : "descending") : undefined}>
      <button className="fav-sort" onClick={() => setSort(sort === id ? "added" : id)} title={`Nach ${label} sortieren`}>
        {label}
        {sort === id && <Icon name="chevron" size={12} />}
      </button>
    </th>
  );

  return (
    <div className="fav-view">
      <table className="fav-table">
        <thead>
          <tr>
            <th aria-label="Favorit" />
            <th>Modell</th>
            <th>Art</th>
            <th>Klasse</th>
            <th>Kann</th>
            {head("smart", "Intelligenz", "num")}
            {head("context", "Gedächtnis", "num")}
            {head("price", "Preis pro 1M", "num")}
            <th className="num" title="Geschätzt: rund 2.000 Tokens Frage samt Verlauf (etwa 1.500 Wörter) und 500 Tokens Antwort (etwa 375 Wörter)">
              Eine Antwort ≈
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const tier = tierOf(m);
            const score = scoreOf(m, props.scores)?.intelligence;
            const inP = perMillion(m.pricing.prompt);
            const outP = perMillion(m.pricing.completion);
            const item = itemPrice(m);
            const can = [
              m.supported_parameters?.includes("reasoning") && "denkt nach",
              m.architecture?.input_modalities?.includes("image") && "Bilder",
              m.architecture?.input_modalities?.includes("file") && "PDFs",
              m.supported_parameters?.includes("tools") && "Werkzeuge",
            ].filter(Boolean);
            return (
              <tr key={m.id} className={m.id === props.current ? "current" : undefined} onClick={() => props.onSelect(m.id)}>
                <td>
                  <button
                    className="star"
                    aria-pressed
                    aria-label={`${shortName(m)} aus den Favoriten entfernen`}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onToggleFavorite(m.id);
                    }}
                  >
                    <Icon name="star-filled" size={16} />
                  </button>
                </td>
                <td>
                  <span className="fav-name">{shortName(m)}</span>
                  <span className="fav-maker">
                    {providerLabel(m)}
                    {m.id === props.current && <span className="current-mark">aktiv</span>}
                  </span>
                </td>
                <td>{AREAS.find((a) => a.id === areaOf(m))?.label.replace(" & Chat", "")}</td>
                <td>{isFree(m) ? "kostenlos" : item ? `pro ${item.unit}` : tier ? TIERS.find((t) => t.id === tier)!.label : "variabel"}</td>
                <td className="fav-can">{can.join(", ") || "–"}</td>
                <td className="num">{score !== undefined ? Math.round(score) : "–"}</td>
                <td className="num">{formatTokens(m.context_length)}</td>
                {item ? (
                  <>
                    <td className="num">–</td>
                    <td className="num">{usd(item.usd)}</td>
                  </>
                ) : (
                  <>
                    <td className="num fav-price">
                      <span className="in">{formatPrice(inP)}</span>
                      <span className="out">{formatPrice(outP)}</span>
                    </td>
                    <td className="num">{answerCost(inP, outP)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint fav-foot">
        Klick auf eine Zeile wählt das Modell. Preise in US-Dollar pro einer Million Tokens, oben Eingabe, unten Ausgabe.
      </p>
    </div>
  );
}

/** Rough cost of a typical answer: about 2,000 tokens read, 500 written. */
function answerCost(inP: number | null, outP: number | null) {
  if (inP === null || outP === null) return "–";
  const usd = (2000 * inP + 500 * outP) / 1_000_000;
  if (usd === 0) return "kostenlos";
  const cent = usd * 100;
  return cent < 0.01 ? "< 0,01 Cent" : `${cent.toLocaleString("de-DE", { maximumFractionDigits: cent < 1 ? 2 : 1 })} Cent`;
}

function ModelRow(props: {
  model: Model;
  index: number;
  active: boolean;
  selected: boolean;
  favorite: boolean;
  note?: { badge: string; reason: string };
  rank?: number;
  /** A free ":free" variant of this model exists (shown with the "Kostenlos" filter). */
  freeTwin?: boolean;
  onHover: () => void;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const { model: m } = props;
  const input = perMillion(m.pricing.prompt);
  const output = perMillion(m.pricing.completion);
  const item = itemPrice(m);
  return (
    <div
      id={`opt-${m.id}`}
      role="option"
      aria-selected={props.active}
      data-index={props.index}
      title={m.id}
      className={`model-row${props.active ? " active" : ""}${props.selected ? " current" : ""}${props.note ? " recommended" : ""}`}
      onMouseMove={props.active ? undefined : props.onHover}
      onClick={props.onSelect}
    >
      <button
        className="star"
        aria-pressed={props.favorite}
        aria-label={props.favorite ? `${shortName(m)} aus Favoriten entfernen` : `${shortName(m)} zu Favoriten`}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleFavorite();
        }}
      >
        <Icon name={props.favorite ? "star-filled" : "star"} />
      </button>
      <div className="model-name">
        <span className="name">
          {shortName(m)}
          <span className="maker">{providerLabel(m)}</span>
          {props.note && <span className="badge">{props.note.badge}</span>}
          {props.selected && <span className="current-mark">aktiv</span>}
        </span>
        {props.note ? (
          <span className="reason">{props.note.reason}</span>
        ) : (
          <span className="summary">
            {props.rank && <span className="rank">Platz {props.rank}</span>}
            {summary(m)}
            {props.freeTwin && <span className="free-twin">, auch kostenlos</span>}
          </span>
        )}
      </div>
      <span className="ctx" title={`${m.context_length.toLocaleString("de-DE")} Tokens Kontext`}>
        {formatTokens(m.context_length)}
      </span>
      {item ? (
        <span className="video-price" title={`Abgerechnet pro ${item.unit}, nicht nach Tokens`}>
          {usd(item.usd)} / {item.unit}
        </span>
      ) : (
        <div className="prices">
          <PriceBar kind="in" perM={input} />
          <PriceBar kind="out" perM={output} />
        </div>
      )}
    </div>
  );
}

function VideoRow(props: { video: VideoModel; index: number; active: boolean; onHover: () => void; onSelect: () => void }) {
  const v = props.video;
  const p = minPricePerSecond(v);
  const durations = v.supported_durations ?? [];
  return (
    <div
      role="option"
      aria-selected={props.active}
      data-index={props.index}
      title={v.id}
      className={`model-row video-row${props.active ? " active" : ""}`}
      onMouseMove={props.active ? undefined : props.onHover}
      onClick={props.onSelect}
    >
      <span className="video-icon" aria-hidden="true">
        <Icon name="film" size={16} />
      </span>
      <div className="model-name">
        <span className="name">
          {v.name.replace(/^[^:]+:\s*/, "")}
          <span className="maker">{v.name.split(":")[0]}</span>
        </span>
        <span className="summary">
          {[
            durations.length ? `${Math.min(...durations)} bis ${Math.max(...durations)} Sekunden` : null,
            v.supported_resolutions?.length ? `bis ${v.supported_resolutions[v.supported_resolutions.length - 1]}` : null,
            v.supported_frame_images?.length ? "mit Startbild" : null,
          ]
            .filter(Boolean)
            .join(", ")}
        </span>
      </div>
      <span className="video-price">{p !== null ? `ab ${(p * 60).toFixed(2).replace(".", ",")} $/min` : "nach Video-Tokens"}</span>
    </div>
  );
}

/** Log scale from $0.01 to $100 per million tokens. */
function scale(perM: number) {
  return Math.min(1, Math.max(0.02, (Math.log10(perM) + 2) / 4));
}

function PriceBar({ kind, perM }: { kind: "in" | "out"; perM: number | null }) {
  const label = kind === "in" ? "Eingabe" : "Ausgabe";
  return (
    <div className={`price ${kind}`} title={`${label}: ${formatPrice(perM)} pro 1M Tokens`}>
      <span className="track">
        {perM !== null && perM > 0 && <span className="fill" style={{ width: `${scale(perM) * 100}%` }} />}
      </span>
      <span className="value">{formatPrice(perM)}</span>
    </div>
  );
}

function ModelDetail({ model: m, score, onPick }: { model: Model; score?: Scores; onPick: () => void }) {
  const inputs = m.architecture?.input_modalities ?? [];
  const maxOut = m.top_provider?.max_completion_tokens;
  const facts: [string, string, string?][] = [
    ...(score?.intelligence !== undefined ? [["Intelligenz", `${Math.round(score.intelligence)}`, "Artificial Analysis Intelligence Index"] as [string, string, string]] : []),
    ...(score?.coding !== undefined ? [["Programmieren", `${Math.round(score.coding)}`, "Artificial Analysis Coding Index"] as [string, string, string]] : []),
    ["Gedächtnis", `${formatTokens(m.context_length)} Tokens`, "So viel Text passt in einen Chat (Kontext)"],
    ...(maxOut ? [["Längste Antwort", `${formatTokens(maxOut)} Tokens`] as [string, string]] : []),
    ...(inputs.length > 1 ? [["Versteht", inputs.map(modalityLabel).join(", ")] as [string, string]] : []),
    ...(m.created ? [["Seit", new Date(m.created * 1000).toLocaleDateString("de-DE", { month: "short", year: "numeric" })] as [string, string]] : []),
  ];
  const input = perMillion(m.pricing.prompt);
  const output = perMillion(m.pricing.completion);
  const item = itemPrice(m);

  return (
    <>
      <div className="detail-main">
        <p className="detail-maker">{providerLabel(m)}</p>
        <h3 className="detail-name">{shortName(m)}</h3>
        {m.top_provider?.is_moderated && (
          <p className="moderated" title="Der Anbieter prüft Anfragen mit einem eigenen Filter und lehnt manche ab, bevor das Modell sie sieht.">
            Anbieter filtert Anfragen
          </p>
        )}
        {m.description && <p className="detail-desc">{m.description}</p>}
        <dl className="detail-facts">
          {facts.map(([k, v, hint]) => (
            <div key={k} title={hint}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          {item ? (
            <div>
              <dt>Preis</dt>
              <dd>
                {usd(item.usd)} pro {item.unit}
              </dd>
            </div>
          ) : (
            <div title="US-Dollar pro einer Million Tokens, die das Modell liest (Eingabe) und schreibt (Ausgabe)">
              <dt>Eingabe / Ausgabe</dt>
              <dd>
                <span className="in">{formatPrice(input)}</span> / <span className="out">{formatPrice(output)}</span>
              </dd>
            </div>
          )}
        </dl>
        <p className="detail-id">{m.id}</p>
      </div>
      <button className="button primary detail-pick" onClick={onPick}>
        Mit {shortName(m)} chatten
      </button>
    </>
  );
}

function VideoDetail({ video: v, onPick }: { video: VideoModel; onPick: () => void }) {
  return (
    <>
      <div className="detail-main">
        <p className="detail-maker">Videomodell, {v.name.split(":")[0]}</p>
        <h3 className="detail-name">{v.name.replace(/^[^:]+:\s*/, "")}</h3>
        {v.description && <p className="detail-desc">{v.description}</p>}
        {v.supported_aspect_ratios?.length ? (
          <dl className="detail-facts">
            <div>
              <dt>Formate</dt>
              <dd>{v.supported_aspect_ratios.join(", ")}</dd>
            </div>
          </dl>
        ) : null}
        <p className="detail-id">{v.id}</p>
      </div>
      <button className="button primary detail-pick" onClick={onPick}>
        Video erstellen
      </button>
    </>
  );
}

function modalityLabel(m: string) {
  return { text: "Text", image: "Bild", audio: "Audio", file: "Datei", video: "Video" }[m] ?? m;
}
