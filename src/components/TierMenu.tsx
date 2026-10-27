import { shortName, type Model } from "../lib/openrouter";
import { TIER_INFO, formatAnswerCost, tierOfModel, typicalAnswerUsd, type TierId } from "../lib/tiers";
import { Icon } from "./Icon";
import { usePopover } from "./usePopover";

interface Props {
  tiers: Record<TierId, string | undefined>;
  modelById: Map<string, Model>;
  /** The chat's model right now. */
  current: string;
  onPick: (id: string) => void;
  /** Thinking effort; only when the current model can think. */
  reasoning?: "low" | "high";
  onReasoning?: (v: "low" | "high" | undefined) => void;
  /** The full model picker, for everyone who wants to choose themselves. Missing in the simple view. */
  onAllModels?: () => void;
  /** "Beste Antwort" variants: several models answer, the strongest merges. Only those with a team. */
  fusions?: { label: string; hint: string; on: boolean; team: Model[]; cost: number | null; onPick: () => void }[];
  /** New models the benchmark has not rated yet, offered apart from the levels. */
  unrated?: Model[];
  disabled?: boolean;
}

const released = (m: Model) => new Date(m.created * 1000).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" });

const EFFORTS: { value: "low" | undefined | "high"; label: string; hint: string }[] = [
  { value: "low", label: "Kurz", hint: "Schneller und günstiger" },
  { value: undefined, label: "Normal", hint: "Wie das Modell es von sich aus hält" },
  { value: "high", label: "Gründlich", hint: "Besser bei schwierigen Aufgaben, dauert länger" },
];

/**
 * Pull-up menu in the input bar: choose how strong the answer should be, not which model.
 * Experts still reach every model through "Alle Modelle".
 */
export function TierMenu(props: Props) {
  const { open, setOpen, box } = usePopover();

  const fusion = props.fusions?.find((f) => f.on);
  const fusionOn = !!fusion;
  const tier = fusionOn ? undefined : tierOfModel(props.tiers, props.current);
  const currentModel = props.modelById.get(props.current);
  const label = fusion
    ? fusion.label
    : tier
      ? TIER_INFO.find((t) => t.id === tier)!.label
      : currentModel
        ? shortName(currentModel)
        : "Modell";
  const effort = EFFORTS.find((e) => e.value === props.reasoning)!;

  return (
    <div className="tier-menu" ref={box}>
      <button
        type="button"
        className="tool tier-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={props.disabled}
        title={
          fusion
            ? `${fusion.label}: ${fusion.team.map(shortName).join(", ")}. Klicken, um die Stufe zu wechseln.`
            : tier
            ? `Stufe ${label}: ${currentModel ? shortName(currentModel) : props.current}. Klicken, um die Stufe zu wechseln.`
            : "Selbst gewähltes Modell. Klicken, um eine Stufe zu wählen."
        }
      >
        <span className={`tier-dot ${fusionOn ? "best" : (tier ?? "custom")}`} aria-hidden="true" />
        <span className="tool-label-always">{label}</span>
        {props.onReasoning && props.reasoning && <span className="tier-effort">· {effort.label}</span>}
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="tier-pop" role="menu" aria-label="Stufe wählen">
          <p className="tier-pop-title">Wie stark soll die Antwort sein?</p>
          {TIER_INFO.map((t) => {
            const id = props.tiers[t.id];
            const m = id ? props.modelById.get(id) : undefined;
            if (!id || !m) return null;
            return (
              <button
                key={t.id}
                role="menuitemradio"
                aria-checked={tier === t.id}
                className="tier-item"
                onClick={() => {
                  props.onPick(id);
                  setOpen(false);
                }}
                title={t.hint}
              >
                <span className={`tier-dot ${t.id}`} aria-hidden="true" />
                <span className="tier-text">
                  <span className="tier-name">
                    {t.label}
                    <span className="tier-cost">{t.id === "free" ? "kostenlos" : `≈ ${formatAnswerCost(typicalAnswerUsd(m))} pro Antwort`}</span>
                  </span>
                  <span className="tier-hint">{t.hint}</span>
                  <span className="tier-model">{shortName(m)}</span>
                </span>
                {tier === t.id && <Icon name="check" size={16} />}
              </button>
            );
          })}
          {props.fusions?.map((f) => (
            <button
              key={f.label}
              role="menuitemradio"
              aria-checked={f.on}
              className="tier-item"
              onClick={() => {
                f.onPick();
                setOpen(false);
              }}
              title={f.hint}
            >
              <span className="tier-dot best" aria-hidden="true" />
              <span className="tier-text">
                <span className="tier-name">
                  {f.label}
                  <span className="tier-cost">≈ {formatAnswerCost(f.cost)} pro Antwort</span>
                </span>
                <span className="tier-hint">{f.hint}</span>
                <span className="tier-model">{f.team.map(shortName).join(" + ")}</span>
              </span>
              {f.on && <Icon name="check" size={16} />}
            </button>
          ))}
          {!!props.unrated?.length && (
            <div className="tier-new" role="group" aria-label="Neu, noch ohne Bewertung">
              <p className="tier-new-title" title="Diese Modelle sind neu. Der unabhängige Test hat sie noch nicht bewertet, deshalb wählt die App sie noch für keine Stufe.">
                Neu, noch ohne Bewertung
              </p>
              {props.unrated.map((m) => (
                <button
                  key={m.id}
                  role="menuitemradio"
                  aria-checked={!fusionOn && props.current === m.id}
                  className="tier-new-item"
                  onClick={() => {
                    props.onPick(m.id);
                    setOpen(false);
                  }}
                  title={`${shortName(m)} ausprobieren. Erschienen am ${released(m)}, ≈ ${formatAnswerCost(typicalAnswerUsd(m))} pro Antwort.`}
                >
                  <span className="tier-model">{shortName(m)}</span>
                  <span className="tier-cost">
                    seit {released(m)} · ≈ {formatAnswerCost(typicalAnswerUsd(m))}
                  </span>
                  {!fusionOn && props.current === m.id && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          )}
          {props.onReasoning && (
            <div className="tier-effort-row" role="group" aria-label="Nachdenken">
              <span>Nachdenken</span>
              <div className="segmented">
                {EFFORTS.map((e) => (
                  <button
                    key={e.label}
                    type="button"
                    aria-pressed={props.reasoning === e.value}
                    onClick={() => props.onReasoning!(e.value)}
                    title={e.hint}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {props.onAllModels && (
            <button
              role="menuitem"
              className="tier-all"
              title="Die Auswahl aller Modelle mit Preisen öffnen, um selbst zu wählen"
              onClick={() => {
                setOpen(false);
                props.onAllModels!();
              }}
            >
              <Icon name="search" size={15} />
              Alle Modelle …
              {!tier && !fusionOn && currentModel && <span className="tier-model">jetzt: {shortName(currentModel)}</span>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
