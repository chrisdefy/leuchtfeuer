import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export interface TourStep {
  /** Element to point at; without one (or when it is not visible, e.g. the sidebar on a phone) the card sits in the middle. */
  target?: string;
  title: string;
  text: string;
  /** Lives in the sidebar, which phones only show when opened. */
  inSidebar?: boolean;
}

/**
 * A short guided tour: dims the screen, lights up one part of the interface at a time and explains it
 * in plain words. Arrow keys move, Escape ends it.
 */
export function Tour({ steps, onEnd, onStep }: { steps: TourStep[]; onEnd: () => void; onStep?: (step: TourStep) => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  /** The card's real height, measured after it rendered, so it never runs off the screen. */
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(240);
  useLayoutEffect(() => {
    const h = card.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 2) setCardH(h);
  });
  const step = steps[i];
  const last = i === steps.length - 1;

  useEffect(() => {
    onStep?.(step);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      const r = el?.getBoundingClientRect();
      const visible = r && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
      if (visible) el!.scrollIntoView({ block: "nearest" });
      setRect(visible ? el!.getBoundingClientRect() : null);
    };
    measure();
    // Layout can still settle (fonts, a chat or the sidebar opening); measure again shortly after.
    const t = setTimeout(measure, 120);
    const t2 = setTimeout(measure, 260);
    addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      removeEventListener("resize", measure);
    };
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEnd();
      if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [steps.length, onEnd]);

  const pad = 6;
  // Grows with the text size setting, so larger text still fits.
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const cardW = Math.min(24 * rem, innerWidth - 24);
  let cardStyle: React.CSSProperties;
  // Below the lit-up part, else above, else beside it (tall things like the chat list), else at the bottom.
  if (rect) {
    const left = Math.min(Math.max(rect.left + rect.width / 2 - cardW / 2, 12), innerWidth - cardW - 12);
    const top = Math.min(Math.max(rect.top, 12), innerHeight - cardH - 12);
    if (rect.bottom + 14 + cardH < innerHeight) cardStyle = { left, top: rect.bottom + 14, width: cardW };
    else if (rect.top - 14 - cardH > 0) cardStyle = { left, bottom: innerHeight - rect.top + 14, width: cardW };
    else if (rect.right + 14 + cardW < innerWidth) cardStyle = { left: rect.right + 14, top, width: cardW };
    else if (rect.left - 14 - cardW > 0) cardStyle = { left: rect.left - 14 - cardW, top, width: cardW };
    else cardStyle = { left: (innerWidth - cardW) / 2, bottom: 12, width: cardW };
  } else {
    cardStyle = { left: "50%", top: "50%", width: cardW, transform: "translate(-50%, -50%)" };
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div
          className="tour-spot"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={cardStyle} key={i} ref={card}>
        <div className="tour-head">
          <span className="tour-count">
            {i + 1} von {steps.length}
          </span>
          <button className="ghost icon-only" onClick={onEnd} aria-label="Einführung beenden" title="Einführung beenden">
            <Icon name="close" size={16} />
          </button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-progress" aria-hidden="true">
          <span style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="tour-foot">
          {i > 0 && (
            <button className="button small" onClick={() => setI(i - 1)} title="Zum vorigen Schritt (Pfeil links)">
              Zurück
            </button>
          )}
          <button
            className="button primary small"
            autoFocus
            onClick={() => (last ? onEnd() : setI(i + 1))}
            title={last ? "Die Einführung beenden" : "Zum nächsten Schritt (Pfeil rechts)"}
          >
            {last ? "Los geht's" : "Weiter"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The tour through a chat; selectors point at the live interface. */
export const CHAT_TOUR: TourStep[] = [
  {
    title: "Willkommen bei Leuchtfeuer",
    text: "In einer Minute zeigen wir dir das Wichtigste. Dafür haben wir einen Beispiel-Chat geöffnet; er kostet nichts und verschwindet danach wieder.",
  },
  {
    target: ".lanes .model-chip",
    title: "Wer antwortet",
    text: "Hier steht das Modell, also die KI, die dir antwortet. Ein Klick öffnet die Auswahl aller Modelle mit Preisen und deinen Favoriten (Stern), für alle, die selbst wählen wollen.",
  },
  {
    target: ".tier-button",
    title: "Einfacher: die Stufe",
    text: "Du musst keine Modelle kennen. Wähl hier Kostenlos, Leicht, Standard oder Stark, und wie gründlich nachgedacht wird. Leuchtfeuer nimmt dafür jeweils ein aktuelles, passendes Modell.",
  },
  {
    target: ".composer",
    title: "Hier fragst du",
    text: "Tippe deine Frage und drück Enter. Wer nicht gern tippt, drückt aufs Mikrofon und spricht einfach.",
  },
  {
    target: ".composer-tools",
    title: "Werkzeuge",
    text: "Erzeugen: ein Bild, ein Video oder Musik direkt hier im Chat. Anhang: Fotos, PDFs, Word und Excel. Websuche: aktuelle Infos aus dem Internet. Visualisieren: Diagramme und Abläufe.",
  },
  {
    target: ".msg.assistant .msg-actions",
    title: "Unter jeder Antwort",
    text: "Kopieren, Vorlesen lassen, und unter „Mehr“: bis hierher zusammenfassen, ab hier einen neuen Chat starten oder neu schreiben lassen.",
  },
  {
    target: ".msg.assistant .prose",
    title: "Nur eine Stelle ändern",
    text: "Markiere einen Satz in einer Antwort, dann erscheint „Stelle ändern“. Sag, was anders werden soll, und nur dieser Satz wird neu geschrieben.",
  },
  {
    target: ".compare-add",
    title: "Vergleichen",
    text: "Stell dieselbe Frage mehreren Modellen gleichzeitig und sieh die Antworten nebeneinander.",
  },
  {
    target: ".sidebar .chat-list",
    inSidebar: true,
    title: "Deine Chats",
    text: "Alle Chats bleiben auf diesem Gerät. Sortier sie in Ordner, indem du sie hineinziehst.",
  },
  {
    target: ".mode-switch button:last-child",
    inSidebar: true,
    title: "Chatrooms: mehrere KIs im Gespräch",
    text: "In einem Chatroom reden mehrere KIs miteinander, jede mit einer eigenen Rolle. Zum Ideen sammeln, für eine Debatte, oder um eine schwierige Situation zu üben, bevor sie wirklich passiert: ein Gehaltsgespräch, einen Streit, eine Verhandlung.",
  },
  {
    target: ".mode-switch button:last-child",
    inSidebar: true,
    title: "So läuft ein Chatroom",
    text: "Beschreib die Situation, die Rollen entstehen von selbst. Du kannst mitspielen, zusehen und dir alles vorlesen lassen; am Ende bewertet eine unabhängige KI das Gespräch. Öffnest du die Chatrooms zum ersten Mal, zeigt dir eine eigene kurze Einführung alles an einem Beispiel.",
  },
  {
    target: ".credits",
    inSidebar: true,
    title: "Kosten im Blick",
    text: "Hier siehst du dein Guthaben und wie viele kostenlose Anfragen heute noch übrig sind. Jede Antwort zeigt außerdem, was sie gekostet hat.",
  },
  {
    target: ".view-switch",
    inSidebar: true,
    title: "Einfach oder Alles",
    text: "Zu viele Knöpfe? „Einfach“ zeigt nur das Wichtigste: Chats, Stufe, Anhang, Websuche und Diktieren. Nichts geht verloren, mit „Alles“ ist der Rest sofort wieder da.",
  },
  {
    target: ".settings-link",
    inSidebar: true,
    title: "Einstellungen",
    text: "Schriftgröße, hell oder dunkel, Datenschutz, die Modelle hinter den Stufen und die Stimme zum Vorlesen. Daneben findest du diese Einführung jederzeit wieder.",
  },
  {
    title: "Fertig!",
    text: "Probier es aus: Stell deine erste Frage. Kostenlose Modelle kosten nichts, und bei allen anderen siehst du den Preis vorher.",
  },
];

/** The same tour for the simple view: only what is on screen there. */
export const SIMPLE_CHAT_TOUR: TourStep[] = [
  {
    title: "Willkommen bei Leuchtfeuer",
    text: "In einer Minute zeigen wir dir das Wichtigste. Dafür haben wir einen Beispiel-Chat geöffnet; er kostet nichts und verschwindet danach wieder.",
  },
  {
    target: ".composer",
    title: "Hier fragst du",
    text: "Tippe deine Frage und drück Enter. Wer nicht gern tippt, drückt aufs Mikrofon und spricht einfach.",
  },
  {
    target: ".tier-button",
    title: "Wie stark die KI sein soll",
    text: "Wähl hier Kostenlos, Leicht, Standard oder Stark. Du musst keine Modelle kennen: Leuchtfeuer nimmt dafür jeweils ein aktuelles, passendes Modell. „Kostenlos“ kostet nichts.",
  },
  {
    target: ".composer-tools",
    title: "Werkzeuge",
    text: "Anhang: Fotos, PDFs, Word und Excel mitschicken. Websuche: aktuelle Infos aus dem Internet holen.",
  },
  {
    target: ".msg.assistant .msg-actions",
    title: "Unter jeder Antwort",
    text: "Kopieren, Vorlesen lassen oder neu schreiben lassen, wenn dir die Antwort nicht gefällt.",
  },
  {
    target: ".sidebar .chat-list",
    inSidebar: true,
    title: "Deine Chats",
    text: "Alle Chats bleiben auf diesem Gerät. Mit „Neu“ oben beginnst du einen neuen.",
  },
  {
    target: ".view-switch",
    inSidebar: true,
    title: "Einfach oder Alles",
    text: "Gerade siehst du die einfache Ansicht. Wer mehr will, klickt auf „Alles“: dann gibt es auch Chatrooms, Ordner, Vergleiche und alle Modelle. Zurück geht es genauso mit einem Klick.",
  },
  {
    target: ".settings-link",
    inSidebar: true,
    title: "Einstellungen",
    text: "Schriftgröße, hell oder dunkel und die Stimme zum Vorlesen. Daneben findest du diese Einführung jederzeit wieder.",
  },
  {
    title: "Fertig!",
    text: "Probier es aus: Stell deine erste Frage.",
  },
];

/** The tour through a chatroom, on a demo room that costs nothing and is removed afterwards. */
export const ROOM_TOUR: TourStep[] = [
  {
    title: "Willkommen im Chatroom",
    text: "Hier reden mehrere KIs miteinander, jede in ihrer Rolle. Wir haben einen Beispielraum geöffnet: Zwei Nachbarn streiten, eine Mediatorin vermittelt. Er kostet nichts und verschwindet danach wieder.",
  },
  {
    target: ".room-people",
    title: "Die Teilnehmer",
    text: "Jede Figur hat einen Namen, eine Rolle und ein Modell. Ein Klick auf eine Figur ändert Rolle, Modell, Länge der Beiträge oder Stimme. „leitet“ heißt: Diese Figur führt durch das Gespräch, die anderen folgen ihr beim Ablauf.",
  },
  {
    target: ".add-person",
    title: "Jemanden dazuholen",
    text: "Auch mitten im Gespräch kannst du jemanden hinzufügen, zum Beispiel einen Moderator, wenn sich alle im Kreis drehen.",
  },
  {
    target: ".room-transcript",
    title: "Das Gespräch",
    text: "Hier erscheinen die Beiträge, jede Figur in ihrer Farbe. „Vorlesen“ unter einem Beitrag spricht ihn mit einer Stimme, die zur Figur passt.",
  },
  {
    target: ".room-buttons",
    title: "Du steuerst",
    text: "Play lässt das Gespräch laufen, „Nächster Zug“ holt genau einen Beitrag, „Runde abspielen“ eine ganze Runde. Pause hält nach dem laufenden Beitrag an, Stopp sofort.",
  },
  {
    target: ".pace",
    title: "Tempo",
    text: "Schritt für Schritt wartet auf dich, Langsam lässt dir Zeit zum Mitlesen, Schnell läuft ohne Pause.",
  },
  {
    target: ".read-aloud",
    title: "Vorlesen mit Stimmen",
    text: "Mit „Automatisch vorlesen“ wird jeder neue Beitrag gleich gesprochen, jede Figur mit ihrer eigenen Stimme, wie ein Hörspiel. Der nächste wartet, bis der vorige fertig ist.",
  },
  {
    target: ".room-input",
    title: "Eingreifen oder mitspielen",
    text: "Schreib hier einen Hinweis an alle, oder sprich jemanden mit @Name direkt an. Spielst du selbst eine Rolle mit, schreibst du hier deine Beiträge, wenn du dran bist.",
  },
  {
    target: ".room-stats",
    title: "Runden und Kosten",
    text: "Du siehst, in welcher Runde ihr seid und was der Raum bisher gekostet hat. Das Budget ist eine feste Grenze: Ist es erreicht, hält der Raum an.",
  },
  {
    target: ".review-button",
    title: "Bewertung und Fazit",
    text: "Eine unabhängige KI, die nicht mitgeredet hat, bewertet das Gespräch: Ist ein Ergebnis da, wer hat überzeugt, wo ist es gekippt, und was du für eine echte Situation daraus lernen kannst. Danach kannst du ihr Fragen stellen.",
  },
  {
    target: ".room-head .more",
    title: "Zum Aufheben",
    text: "Unter „Export“ speicherst du das Gespräch als Text oder als Hörspiel: alle Beiträge in den Stimmen der Figuren, und zum Schluss liest ein Sprecher Bewertung und Fazit vor. Eine MP3 zum Ablegen oder Nachhören.",
  },
  {
    target: ".sidebar-head .button",
    inSidebar: true,
    title: "Eigenen Raum anlegen",
    text: "Über „Neu“ beschreibst du einfach eine Situation, etwa „Ich will meinen Chef um mehr Gehalt bitten“. Die Rollen entstehen von selbst, und du kannst selbst mitspielen.",
  },
  {
    title: "Fertig!",
    text: "Leg deinen ersten Raum an. Diese Einführung findest du jederzeit über „Einführung“ unten in der Seitenleiste, wenn du in den Chatrooms bist.",
  },
];
