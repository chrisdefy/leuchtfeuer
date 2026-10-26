import type { Profile } from "../lib/storage";
import { profileSummary } from "../lib/profiles";
import { Icon } from "./Icon";
import { usePopover } from "./usePopover";

interface Props {
  profiles: Profile[];
  /** The chat's profile right now. */
  current?: string;
  onChoose: (p: Profile | null) => void;
  /** Create and edit profiles. */
  onManage: () => void;
  disabled?: boolean;
}

/** Pull-up menu in the input bar: one tap sets instruction, level and switches for this chat. */
export function ProfileMenu(props: Props) {
  const { open, setOpen, box } = usePopover();
  const current = props.profiles.find((p) => p.id === props.current);

  return (
    <div className="tier-menu" ref={box}>
      <button
        type="button"
        className="tool"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={!!current}
        onClick={() => setOpen(!open)}
        disabled={props.disabled}
        title={current ? `Profil „${current.name}“: ${profileSummary(current)}. Klicken zum Wechseln.` : "Profil wählen: gespeicherte Anweisung, Stufe und Schalter in einem Klick"}
      >
        <Icon name="profile" size={17} />
        {/* Without a profile only the icon, so the bar stays short; a chosen profile shows its name. */}
        {current ? <span className="tool-label">{current.name}</span> : <span className="visually-hidden">Profil</span>}
      </button>
      {open && (
        <div className="tier-pop" role="menu" aria-label="Profil wählen">
          <p className="tier-pop-title">Wie soll das Modell arbeiten?</p>
          {props.profiles.map((p) => (
            <button
              key={p.id}
              role="menuitemradio"
              aria-checked={p.id === current?.id}
              className="tier-item profile-item"
              onClick={() => {
                props.onChoose(p);
                setOpen(false);
              }}
            >
              <Icon name="profile" size={16} />
              <span className="tier-text">
                <span className="tier-name">{p.name}</span>
                {p.instruction.trim() && <span className="tier-hint profile-instruction">{p.instruction.trim()}</span>}
                <span className="tier-model">{profileSummary(p)}</span>
              </span>
              {p.id === current?.id && <Icon name="check" size={16} />}
            </button>
          ))}
          {current && (
            <button
              role="menuitem"
              className="tier-all"
              title="Das Profil für diesen Chat ablegen; es gilt dann nur die normale Anweisung"
              onClick={() => {
                props.onChoose(null);
                setOpen(false);
              }}
            >
              <Icon name="close" size={15} />
              Ohne Profil weiter
            </button>
          )}
          <button
            role="menuitem"
            className="tier-all"
            title="Profile anlegen, ändern oder löschen"
            onClick={() => {
              setOpen(false);
              props.onManage();
            }}
          >
            <Icon name={props.profiles.length ? "edit" : "plus"} size={15} />
            {props.profiles.length ? "Profile bearbeiten …" : "Erstes Profil anlegen …"}
          </button>
        </div>
      )}
    </div>
  );
}
