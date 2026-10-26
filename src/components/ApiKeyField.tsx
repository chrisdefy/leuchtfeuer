import { useEffect, useState } from "react";
import { KEYS_URL } from "../lib/auth";
import { formatCost } from "../lib/format";
import { checkKey, type KeyCheck } from "../lib/openrouter";
import { Icon } from "./Icon";

export function ApiKeyField(props: { id: string; value: string; onChange: (v: string) => void; onEnter?: () => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="key-field">
      <input
        id={props.id}
        type={visible ? "text" : "password"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && props.onEnter?.()}
        placeholder="sk-or-v1-…"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="ghost icon-only"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Key verbergen" : "Key anzeigen"}
      >
        <Icon name={visible ? "eye-off" : "eye"} />
      </button>
    </div>
  );
}

/** Checks a pasted key while it is typed, and says in plain words whether and how it works. */
export function KeyStatus({ apiKey }: { apiKey: string }) {
  const key = apiKey.trim();
  const [result, setResult] = useState<{ key: string; check: KeyCheck } | null>(null);
  const looksRight = key.startsWith("sk-or-") && key.length > 20;

  useEffect(() => {
    if (!looksRight) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      checkKey(key, ctrl.signal).then(
        (check) => setResult({ key, check }),
        () => {},
      );
    }, 400);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, looksRight]);

  if (key.length < 8) return null;
  if (!looksRight)
    return <p className="key-status bad">Ein OpenRouter-Key beginnt mit „sk-or-“ und ist recht lang. Kopier ihn bitte noch einmal ganz.</p>;
  const check = result?.key === key ? result.check : null;
  if (!check) return <p className="key-status">Key wird geprüft …</p>;
  if (!check.ok)
    return check.reason === "invalid" ? (
      <p className="key-status bad">
        Diesen Key kennt OpenRouter nicht. Vielleicht ist er unvollständig oder wurde gelöscht.{" "}
        <a href={KEYS_URL} target="_blank" rel="noreferrer">
          Neuen Key erstellen
        </a>
      </p>
    ) : (
      <p className="key-status">Prüfen ging gerade nicht (keine Verbindung?). Du kannst den Key trotzdem speichern.</p>
    );
  const today = check.free ? `heute noch ${check.free.remaining} von ${check.free.limit} Anfragen` : "";
  if (check.balance !== null && check.balance < 0)
    return (
      <p className="key-status bad">
        Key gültig, aber das Guthaben ist im Minus ({formatCost(check.balance)}). Dann können auch kostenlose Modelle ausfallen: bitte aufladen.
      </p>
    );
  if (check.balance !== null && check.balance > 0)
    return (
      <p className="key-status ok">
        ✓ Key gültig. Guthaben: {formatCost(check.balance)}.{today && ` Kostenlose Modelle: ${today}.`}
      </p>
    );
  return <p className="key-status ok">✓ Key gültig. Noch kein Guthaben: Die kostenlosen Modelle gehen trotzdem{today ? `, ${today}` : ""}.</p>;
}
