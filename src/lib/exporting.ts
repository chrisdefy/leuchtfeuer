import { toTurns } from "./conversation";
import { formatCost } from "./format";
import { HOST, SYSTEM, roomCost, type Room } from "./rooms";
import type { Chat } from "./storage";

/** Offer a text file for download without a server. */
export function downloadText(filename: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileName(title: string) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = title
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[c]!)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${date}-${slug || "export"}.md`;
}

const when = (ts: number) => new Date(ts).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

export function roomToMarkdown(room: Room, modelName: (id: string) => string) {
  const byId = new Map(room.participants.map((p) => [p.id, p]));
  const people = room.participants
    .map((p) => `- **${p.name}**, ${p.roleName}${p.human ? " (Mensch)" : `, ${modelName(p.model)}`}${p.leads ? ", leitet" : ""}`)
    .join("\n");
  const body = room.messages
    .filter((m) => m.content)
    .map((m) => {
      if (m.authorId === SYSTEM) return `> ${m.content}`;
      const p = byId.get(m.authorId);
      const who = m.authorId === HOST ? "Gesprächsleitung (du)" : p ? `${p.name}, ${p.roleName}` : "Teilnehmer";
      return `**${who}:**\n\n${m.content}`;
    })
    .join("\n\n");
  return [
    `# ${room.title}`,
    `Chatroom vom ${when(room.createdAt)}. Kosten: ${formatCost(roomCost(room)) || "$0"}.`,
    `**Thema:** ${room.topic}`,
    room.goal ? `**Ziel:** ${room.goal}` : "",
    `## Teilnehmer\n\n${people}`,
    `## Gespräch\n\n${body}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function chatToMarkdown(chat: Chat, modelName: (id: string) => string) {
  const turns = toTurns(chat.messages).map((t) => {
    const parts: string[] = [];
    if (t.user) {
      const files = t.user.attachments?.length ? `\n\n*Anhänge: ${t.user.attachments.map((a) => a.name).join(", ")}*` : "";
      parts.push(`**Du:**\n\n${t.user.content}${files}`);
    }
    for (const a of t.answers) {
      if (!a.content && !a.attachments?.length) continue;
      const media = a.attachments?.length ? `\n\n*${a.attachments.map((x) => x.name).join(", ")} (nur in der App gespeichert)*` : "";
      const sources = a.sources?.length ? `\n\nQuellen:\n${a.sources.map((s) => `- [${s.title || s.url}](${s.url})`).join("\n")}` : "";
      parts.push(`**${a.modelLabel ?? (a.model ? modelName(a.model) : "Modell")}:**\n\n${a.content}${media}${sources}`);
    }
    return parts.join("\n\n");
  });
  return [
    `# ${chat.title}`,
    `Chat vom ${when(chat.createdAt)}.`,
    chat.prep ? `> Anweisung an das Modell${chat.prep.role ? ` (${chat.prep.role})` : ""}:\n>\n${chat.prep.system.split("\n").map((l) => `> ${l}`).join("\n")}` : "",
    chat.seed ? `> Fortsetzung von „${chat.seed.fromTitle}“. Zusammenfassung:\n>\n${chat.seed.summary.split("\n").map((l) => `> ${l}`).join("\n")}` : "",
    turns.join("\n\n---\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}
