import { pickChecker } from "./context";
import { complete, type Model } from "./openrouter";
import type { Length } from "./rooms";

/**
 * Custom roles (F25): a fixed template with the fields that make a role work in a
 * conversation. It can be filled by a model inside the app, or copied into any AI and pasted back.
 */

export interface RoleDraft {
  name: string;
  prompt: string;
  length?: Length;
}

export interface SavedRole extends RoleDraft {
  id: string;
}

const FIELDS = ["Name der Rolle", "Haltung", "Ziel im Gespräch", "Sprechweise", "Grenzen", "Beitragslänge"] as const;

export function templateFor(idea: string) {
  return `Erstelle eine Rolle für ein Gespräch, in dem mehrere KI-Modelle miteinander sprechen. Fülle die Vorlage unten aus und antworte nur mit der ausgefüllten Vorlage, ohne weitere Erklärungen.

Beschreibung der Rolle: ${idea.trim() || "<hier in einem Satz beschreiben, z. B. skeptische Investorin, die bei jeder Idee nach Zahlen fragt>"}

Name der Rolle: <kurz, zwei bis drei Wörter>
Haltung: <welche Einstellung und Werte die Rolle hat, in der Du-Form>
Ziel im Gespräch: <was die Rolle erreichen will>
Sprechweise: <Ton, Wortwahl, Temperament>
Grenzen: <was die Rolle nie tut, z. B. keine Beleidigungen>
Beitragslänge: <kurz, mittel oder lang>`;
}

/** Read a filled template, tolerant of markdown bold, bullets and extra text around it. */
export function parseTemplate(text: string): RoleDraft | null {
  const values = new Map<string, string>();
  let current: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[\s>*-]+/, "").replace(/\*\*/g, "").trim();
    const field = FIELDS.find((f) => line.toLowerCase().startsWith(`${f.toLowerCase()}:`));
    if (field) {
      current = field;
      values.set(field, line.slice(field.length + 1).trim());
    } else if (current && line && current !== "Beitragslänge") {
      values.set(current, `${values.get(current)} ${line}`.trim());
    }
  }
  const name = values.get("Name der Rolle");
  const parts = [
    values.get("Haltung"),
    values.get("Ziel im Gespräch") && `Dein Ziel im Gespräch: ${values.get("Ziel im Gespräch")}`,
    values.get("Sprechweise") && `So sprichst du: ${values.get("Sprechweise")}`,
    values.get("Grenzen") && `Deine Grenzen: ${values.get("Grenzen")}`,
  ].filter((p): p is string => !!p && !p.includes("<"));
  if (!name || name.includes("<") || parts.length < 2) return null;
  const len = values.get("Beitragslänge")?.toLowerCase() ?? "";
  const length: Length | undefined = len.startsWith("kurz") ? "short" : len.startsWith("lang") ? "long" : len.startsWith("mittel") ? "medium" : undefined;
  return { name: name.replace(/[.]$/, ""), prompt: parts.map((p) => (/[.!?]$/.test(p) ? p : `${p}.`)).join(" "), length };
}

export async function fillTemplate(opts: { apiKey: string; models: Model[]; fallbackModel: string; idea: string }) {
  const model = pickChecker(opts.models, 2000, opts.fallbackModel);
  const { text } = await complete({
    apiKey: opts.apiKey,
    model,
    signal: new AbortController().signal,
    messages: [{ role: "user", content: templateFor(opts.idea) }],
  });
  const role = parseTemplate(text);
  if (!role) throw new Error("Das Modell hat die Vorlage nicht vollständig ausgefüllt. Versuche es erneut oder beschreibe die Rolle genauer.");
  return role;
}

// ---- saved roles ---------------------------------------------------------------

const KEY = "router.roles.v1";

export function loadRoles(): SavedRole[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRole(role: RoleDraft): SavedRole {
  const saved = { ...role, id: `saved-${crypto.randomUUID()}` };
  const all = [saved, ...loadRoles().filter((r) => r.name !== role.name)];
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50)));
  } catch {
    /* storage full */
  }
  return saved;
}

/** Roles from a backup; a role with the same name already here wins. */
export function importRoles(roles: SavedRole[]) {
  const current = loadRoles();
  const added = roles.filter((r) => r?.name && !current.some((c) => c.id === r.id || c.name === r.name));
  try {
    localStorage.setItem(KEY, JSON.stringify([...current, ...added].slice(0, 50)));
  } catch {
    /* storage full */
  }
  return added.length;
}

export function deleteRole(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadRoles().filter((r) => r.id !== id)));
  } catch {
    /* ignore */
  }
}
