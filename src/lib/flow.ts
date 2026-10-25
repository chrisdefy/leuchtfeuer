/**
 * Flowcharts in Mermaid's flowchart notation, which nearly every model writes fluently.
 * Only the drawing-relevant subset is read (nodes, shapes, arrows, arrow labels); styling lines are skipped.
 * Leuchtfeuer lays the chart out itself (components/Flowchart.tsx), so text always fits its box.
 */

export type Shape = "box" | "round" | "pill" | "diamond" | "circle" | "data";

export interface FlowNode {
  id: string;
  label: string;
  shape: Shape;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface Flow {
  dir: "TB" | "BT" | "LR" | "RL";
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// Longest openers first, so "([" wins over "(".
const SHAPES: [open: string, close: string, shape: Shape][] = [
  ["([", "])", "pill"],
  ["[[", "]]", "box"],
  ["[(", ")]", "data"],
  ["((", "))", "circle"],
  ["{{", "}}", "box"],
  ["[/", "/]", "box"],
  ["[\\", "\\]", "box"],
  ["[", "]", "box"],
  ["(", ")", "round"],
  ["{", "}", "diamond"],
  [">", "]", "box"],
];

const SKIP = /^(%%|classDef\b|class\b|style\b|linkStyle\b|click\b|subgraph\b|end\b|direction\b)/;
const ID = /^[\p{L}\p{N}_]+/u;
// "-->|Ja|", "---", "-.->", "==>", or "-- Ja -->", "-. Ja .->", "== Ja ==>"
const ARROW = /^(?:--\s+([^\n]+?)\s+-->|-\.\s+([^\n]+?)\s+\.->|==\s+([^\n]+?)\s+==>|(<?-{2,}>|<?={2,}>|<?-\.+->|-{3,}|-\.+-|--[ox]))\s*(?:\|([^|]*)\|)?/;

const MAX_NODES = 60;

function cleanLabel(raw: string) {
  let t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  if (t.startsWith("`") && t.endsWith("`")) t = t.slice(1, -1);
  return t
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\*\*/g, "")
    .trim();
}

export function parseFlow(code: string): Flow | null {
  const lines = code
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  const head = /^(?:flowchart|graph)\b\s*(TD|TB|BT|LR|RL)?/i.exec(lines[0] ?? "");
  if (!head) return null;
  const d = (head[1] ?? "TB").toUpperCase();
  const dir = (d === "TD" ? "TB" : d) as Flow["dir"];

  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  const node = (id: string, label?: string, shape?: Shape) => {
    const known = nodes.get(id);
    if (known) {
      if (label !== undefined) Object.assign(known, { label, shape: shape ?? known.shape });
      return known;
    }
    if (nodes.size >= MAX_NODES) return null;
    const created: FlowNode = { id, label: label ?? id, shape: shape ?? "box" };
    nodes.set(id, created);
    return created;
  };

  /** Reads "A", "A[Text]", "A{"Frage?"}" etc. at s[i]; returns the ids ("A & B" gives two) and the new index. */
  const readNodes = (s: string, i: number): { ids: string[]; at: number } | null => {
    const ids: string[] = [];
    for (;;) {
      while (s[i] === " ") i++;
      const m = ID.exec(s.slice(i));
      if (!m) return ids.length ? { ids, at: i } : null;
      const id = m[0];
      i += id.length;
      let label: string | undefined;
      let shape: Shape | undefined;
      for (const [open, close, sh] of SHAPES) {
        if (!s.startsWith(open, i)) continue;
        const start = i + open.length;
        let end: number;
        if (s[start] === '"') {
          const q = s.indexOf('"', start + 1);
          end = q === -1 ? -1 : s.indexOf(close, q + 1);
        } else {
          end = s.indexOf(close, start);
        }
        if (end === -1) break;
        label = cleanLabel(s.slice(start, end));
        shape = sh;
        i = end + close.length;
        break;
      }
      if (node(id, label, shape)) ids.push(id);
      while (s[i] === " ") i++;
      if (s[i] !== "&") return { ids, at: i };
      i++;
    }
  };

  for (const line of lines.slice(1)) {
    if (SKIP.test(line)) continue;
    let left = readNodes(line, 0);
    if (!left) continue;
    let i = left.at;
    for (;;) {
      while (line[i] === " ") i++;
      const a = ARROW.exec(line.slice(i));
      if (!a) break;
      const label = cleanLabel(a[1] ?? a[2] ?? a[3] ?? a[5] ?? "") || undefined;
      const dashed = a[0].includes(".");
      i += a[0].length;
      const right = readNodes(line, i);
      if (!right) break;
      for (const from of left.ids) for (const to of right.ids) edges.push({ from, to, label, dashed });
      left = right;
      i = right.at;
    }
  }

  return nodes.size >= 2 ? { dir, nodes: [...nodes.values()], edges } : null;
}
