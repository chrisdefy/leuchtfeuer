import { useState } from "react";
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
