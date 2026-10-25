import { MEDIA_INFO, type MediaKind, type MediaLevel } from "../lib/media";
import { Icon } from "./Icon";
import { usePopover } from "./usePopover";

const KIND_ICON: Record<MediaKind, string> = { image: "image", video: "film", music: "speaker" };
const KINDS: MediaKind[] = ["image", "video", "music"];

/** "Erzeugen" in a text chat: switch the input bar to making an image, a video or music. */
export function CreateButton(props: { available: Record<MediaKind, boolean>; onPick: (kind: MediaKind) => void; disabled?: boolean }) {
  const { open, setOpen, box } = usePopover();
  return (
    <div className="tier-menu" ref={box}>
      <button
        type="button"
        className="tool"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={props.disabled}
        title="Ein Bild, ein Video oder Musik erzeugen, direkt hier im Chat"
      >
        <Icon name="sparkle" size={17} />
        <span className="tool-label">Erzeugen</span>
      </button>
      {open && (
        <div className="tier-pop create-pop" role="menu" aria-label="Erzeugen">
          <p className="tier-pop-title">Was soll entstehen? Das Ergebnis erscheint in diesem Chat.</p>
          {KINDS.filter((k) => props.available[k]).map((k) => (
            <button
              key={k}
              role="menuitem"
              className="tier-item create-item"
              onClick={() => {
                setOpen(false);
                props.onPick(k);
              }}
            >
              <Icon name={KIND_ICON[k]} size={18} />
              <span className="tier-text">
                <span className="tier-name">{MEDIA_INFO[k].label}</span>
                <span className="tier-hint">{MEDIA_INFO[k].hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** While making media: what is being made, at which level, and the way back to text. */
export function MediaModeBar(props: {
  kind: MediaKind;
  levels: MediaLevel[];
  level: number;
  onLevel: (i: number) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const { open, setOpen, box } = usePopover();
  const current = props.levels[props.level];
  return (
    <div className="media-mode" ref={box}>
      <button
        type="button"
        className="tool media-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={props.disabled}
        title="Qualitätsstufe wählen"
      >
        <Icon name={KIND_ICON[props.kind]} size={17} />
        <span className="tool-label-always">
          {MEDIA_INFO[props.kind].label}
          {current && props.levels.length > 1 && <span className="tier-effort"> · {current.label}</span>}
        </span>
        {props.levels.length > 1 && <Icon name="chevron" size={14} />}
      </button>
      <button type="button" className="tool media-close" onClick={props.onClose} title="Zurück zum normalen Chat" aria-label="Zurück zum normalen Chat">
        <Icon name="close" size={15} />
      </button>
      {open && props.levels.length > 1 && (
        <div className="tier-pop" role="menu" aria-label="Qualität">
          <p className="tier-pop-title">Qualität</p>
          {props.levels.map((l, i) => (
            <button
              key={l.model}
              role="menuitemradio"
              aria-checked={i === props.level}
              className="tier-item"
              onClick={() => {
                props.onLevel(i);
                setOpen(false);
              }}
            >
              <span className="tier-dot media" aria-hidden="true" />
              <span className="tier-text">
                <span className="tier-name">
                  {l.label}
                  {l.price && <span className="tier-cost">{l.price}</span>}
                </span>
                <span className="tier-hint">{l.hint}</span>
                <span className="tier-model">{l.model}</span>
              </span>
              {i === props.level && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
