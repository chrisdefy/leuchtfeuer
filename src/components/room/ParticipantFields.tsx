import { useMemo, useState } from "react";
import { fillTemplate, loadRoles, parseTemplate, saveRole, templateFor, type RoleDraft } from "../../lib/roleTemplate";
import { formatPrice } from "../../lib/format";
import { perMillion, shortName, type Model } from "../../lib/openrouter";
import { CUSTOM_ROLE, LENGTHS, PALETTE, ROLES, TIERS, roleById, type Length, type Participant } from "../../lib/rooms";

const MORE = "__more";

interface Props {
  participant: Participant;
  models: Model[] | null;
  onChange: (patch: Partial<Participant>) => void;
  /** Open the full model picker for this participant. */
  onPickModel: () => void;
  compact?: boolean;
  /** Enables "Mit KI ausfüllen" for custom roles. */
  apiKey?: string;
}

/** Name, role, model and length of one participant; used in setup and in the running room. */
export function ParticipantFields({ participant: p, models, onChange, onPickModel, compact, apiKey }: Props) {
  const byId = useMemo(() => new Map((models ?? []).map((m) => [m.id, m])), [models]);
  const [saved, setSaved] = useState(loadRoles);
  const isOwn = p.roleId === CUSTOM_ROLE || p.roleId.startsWith("saved-");

  const modelOptions = useMemo(() => {
    const tiers = Object.values(TIERS).flatMap((t) => t.models.map((id) => ({ id, tier: t.label })));
    const ids = new Set(tiers.map((t) => t.id));
    const extra = ids.has(p.model) ? [] : [{ id: p.model, tier: "Gewählt" }];
    return [...extra, ...tiers].filter((o) => !models || byId.has(o.id));
  }, [p.model, models, byId]);

  function label(id: string) {
    const m = byId.get(id);
    if (!m) return id;
    return `${shortName(m)} (${formatPrice(perMillion(m.pricing.prompt))} / ${formatPrice(perMillion(m.pricing.completion))})`;
  }

  if (p.human) {
    return (
      <div className={`pfields human${compact ? " compact" : ""}`}>
        <Field label="Dein Name" compact={compact}>
          <input className="input" value={p.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Deine Rolle" compact={compact}>
          <input
            className="input"
            value={p.roleName}
            placeholder="Zum Beispiel: Kunde, Nachbar, Chefin"
            onChange={(e) => onChange({ roleName: e.target.value })}
          />
        </Field>
      </div>
    );
  }

  return (
    <div className={`pfields${compact ? " compact" : ""}`}>
      <Field label="Name" compact={compact}>
        <span className="name-input">
          <span className="swatch" style={{ background: PALETTE[p.color] }} aria-hidden="true" />
          <input className="input" value={p.name} onChange={(e) => onChange({ name: e.target.value })} />
        </span>
      </Field>
      <Field label="Rolle" compact={compact}>
        <select
          className="select"
          value={p.roleId}
          onChange={(e) => {
            const own = saved.find((r) => r.id === e.target.value);
            if (own) {
              onChange({ roleId: own.id, roleName: own.name, rolePrompt: own.prompt, finalOnly: false, leads: false, ...(own.length ? { length: own.length } : {}) });
              return;
            }
            const role = roleById(e.target.value);
            onChange(
              role
                ? { roleId: role.id, roleName: role.name, rolePrompt: role.prompt, finalOnly: role.finalOnly, leads: !!role.leads }
                : {
                    roleId: CUSTOM_ROLE,
                    roleName: p.roleId === CUSTOM_ROLE ? p.roleName : "Eigene Rolle",
                    finalOnly: false,
                    leads: false,
                  },
            );
          }}
        >
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}: {r.summary}
            </option>
          ))}
          {saved.length > 0 && (
            <optgroup label="Meine Rollen">
              {saved.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value={CUSTOM_ROLE}>Eigene Rolle erstellen …</option>
        </select>
      </Field>
      <Field label="Modell" compact={compact}>
        <select
          className="select"
          value={p.model}
          onChange={(e) => (e.target.value === MORE ? onPickModel() : onChange({ model: e.target.value }))}
        >
          {Object.values(TIERS).map((t) => (
            <optgroup key={t.label} label={t.label}>
              {modelOptions
                .filter((o) => o.tier === t.label)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {label(o.id)}
                  </option>
                ))}
            </optgroup>
          ))}
          {modelOptions.some((o) => o.tier === "Gewählt") && (
            <optgroup label="Gewählt">
              <option value={p.model}>{label(p.model)}</option>
            </optgroup>
          )}
          <option value={MORE}>Weitere Modelle …</option>
        </select>
      </Field>
      <Field label="Länge" compact={compact}>
        <select className="select" value={p.length} onChange={(e) => onChange({ length: e.target.value as Length })}>
          {Object.entries(LENGTHS).map(([id, l]) => (
            <option key={id} value={id}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      {isOwn && (
        <div className="custom-role">
          {p.roleId === CUSTOM_ROLE && (
            <RoleBuilder
              apiKey={apiKey}
              models={models}
              fallbackModel={p.model}
              onRole={(r) => onChange({ roleName: r.name, rolePrompt: r.prompt, ...(r.length ? { length: r.length } : {}) })}
            />
          )}
          <Field label="Name der Rolle">
            <input
              className="input"
              value={p.roleName}
              placeholder="Zum Beispiel: Skeptische Investorin"
              onChange={(e) => onChange({ roleName: e.target.value })}
            />
          </Field>
          <Field label="Wie verhält sich die Rolle?">
            <textarea
              rows={3}
              value={p.rolePrompt}
              placeholder="Haltung, Ziel im Gespräch, Sprechweise und Grenzen, zum Beispiel: Du fragst bei jeder Idee nach Zahlen und glaubst nichts ohne Beleg."
              onChange={(e) => onChange({ rolePrompt: e.target.value })}
            />
          </Field>
          {p.roleId === CUSTOM_ROLE && (
            <button
              type="button"
              className="ghost small save-role"
              disabled={!p.roleName.trim() || !p.rolePrompt.trim() || p.roleName === "Eigene Rolle"}
              onClick={() => {
                const role = saveRole({ name: p.roleName.trim(), prompt: p.rolePrompt.trim(), length: p.length });
                setSaved(loadRoles());
                onChange({ roleId: role.id });
              }}
            >
              Rolle speichern, um sie wiederzuverwenden
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children, compact }: { label: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <label className="pfield">
      <span className={compact ? "visually-hidden" : "pfield-label"}>{label}</span>
      {children}
    </label>
  );
}

/** Fill the role template with a model in the app, or via any external AI by copy and paste. */
function RoleBuilder(props: { apiKey?: string; models: Model[] | null; fallbackModel: string; onRole: (r: RoleDraft) => void }) {
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");

  async function fill() {
    if (!props.apiKey || !props.models) return;
    setBusy(true);
    setError(null);
    try {
      props.onRole(await fillTemplate({ apiKey: props.apiKey, models: props.models, fallbackModel: props.fallbackModel, idea }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function readPasted(text: string) {
    setPasted(text);
    if (!text.trim()) return setError(null);
    const role = parseTemplate(text);
    if (role) {
      props.onRole(role);
      setError(null);
    } else {
      setError("Die eingefügte Vorlage ist noch nicht vollständig. Es fehlen Name der Rolle oder mindestens zwei Felder.");
    }
  }

  return (
    <div className="role-builder">
      <label className="pfield">
        <span className="pfield-label">Beschreibe die Rolle in einem Satz</span>
        <span className="role-idea">
          <input
            className="input"
            value={idea}
            placeholder="Zum Beispiel: skeptische Investorin, die bei jeder Idee nach Zahlen fragt"
            onChange={(e) => setIdea(e.target.value)}
          />
          {props.apiKey && (
            <button type="button" className="button small" onClick={fill} disabled={busy || !idea.trim()}>
              {busy ? "Füllt aus …" : "Mit KI ausfüllen"}
            </button>
          )}
        </span>
      </label>
      <details className="role-copy">
        <summary>Lieber mit einer anderen KI? Vorlage kopieren und Ergebnis einfügen</summary>
        <button
          type="button"
          className="ghost small"
          onClick={async () => {
            await navigator.clipboard.writeText(templateFor(idea));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Kopiert" : "Vorlage kopieren"}
        </button>
        <textarea
          rows={4}
          value={pasted}
          placeholder="Ausgefüllte Vorlage hier einfügen"
          onChange={(e) => readPasted(e.target.value)}
        />
      </details>
      {error && <p className="hint error-text">{error}</p>}
    </div>
  );
}
