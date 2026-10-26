import { shortName, type Model } from "../lib/openrouter";
import { FUSION_INFO } from "../lib/fusion";
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
  /** "Beste Antwort": several models answer, the strongest merges. Missing when there is no team. */
  fusion?: { on: boolean; team: Model[]; cost: number | null; onPick: () => void };
  disabled?: boolean;
}

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

  const fusionOn = !!props.fusion?.on;
  const tier = fusionOn ? undefined : tierOfModel(props.tiers, props.current);
  const currentModel = props.modelById.get(props.current);
  const label = fusionOn
    ? FUSION_INFO.label
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
          fusionOn
            ? `${FUSION_INFO.label}: ${props.fusion!.team.map(shortName).join(", ")}. Klicken, um die Stufe zu wechseln.`
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
          {props.fusion && (
            <button
              role="menuitemradio"
              aria-checked={fusionOn}
              className="tier-item"
              onClick={() => {
                props.fusion!.onPick();
                setOpen(false);
              }}
              title={FUSION_INFO.hint}
            >
              <span className="tier-dot best" aria-hidden="true" />
              <span className="tier-text">
                <span className="tier-name">
                  {FUSION_INFO.label}
                  <span className="tier-cost">≈ {formatAnswerCost(props.fusion.cost)} pro Antwort</span>
                </span>
                <span className="tier-hint">{FUSION_INFO.hint}</span>
                <span className="tier-model">{props.fusion.team.map(shortName).join(" + ")}</span>
              </span>
              {fusionOn && <Icon name="check" size={16} />}
            </button>
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
