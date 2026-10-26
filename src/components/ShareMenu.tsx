import { Icon } from "./Icon";
import { usePopover } from "./usePopover";

/** "Teilen" above a chat: as text into WhatsApp and co., as a Markdown file, or as a file Leuchtfeuer opens again. */
export function ShareMenu(props: { onShareText: () => void; onMarkdown: () => void; onChatFile: () => void; simple?: boolean }) {
  const { open, setOpen, box } = usePopover();
  const canShare = typeof navigator.share === "function";
  const item = (icon: string, name: string, hint: string, run: () => void) => (
    <button
      role="menuitem"
      className="tier-item create-item"
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      <Icon name={icon} size={18} />
      <span className="tier-text">
        <span className="tier-name">{name}</span>
        <span className="tier-hint">{hint}</span>
      </span>
    </button>
  );
  return (
    <div className="tier-menu" ref={box}>
      <button
        className={`ghost ${props.simple ? "small" : "icon-only"} share-chat`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Diesen Chat teilen oder als Datei speichern"
        aria-label="Chat teilen"
      >
        <Icon name="share" size={17} />
        {props.simple && <span className="label">Teilen</span>}
      </button>
      {open && (
        <div className="tier-pop share-pop" role="menu" aria-label="Chat teilen">
          {item(
            "share",
            canShare ? "Als Text teilen" : "Als Text kopieren",
            canShare ? "Zum Beispiel in WhatsApp, per Mail oder in Notizen" : "Zum Einfügen in WhatsApp Web, eine Mail oder ein Dokument",
            props.onShareText,
          )}
          {item("file", "Als Leuchtfeuer-Datei", "Mit Bildern und Modellen; in Leuchtfeuer wieder zu öffnen (Einstellungen → Sicherung)", props.onChatFile)}
          {item("download", "Als Textdatei (.md)", "Zum Archivieren oder Weiterbearbeiten", props.onMarkdown)}
          <p className="share-note">Der Chat kann persönliche Daten enthalten. Teile ihn nur mit Menschen, denen du vertraust.</p>
        </div>
      )}
    </div>
  );
}
