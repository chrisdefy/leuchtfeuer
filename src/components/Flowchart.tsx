import { useId, useMemo, useRef } from "react";
import dagre from "@dagrejs/dagre";
import type { Flow, FlowNode, Shape } from "../lib/flow";
import { downloadSvg } from "../lib/svgExport";

/**
 * Draws a flowchart from a model's Mermaid notation. Leuchtfeuer measures every label and sizes the boxes
 * to fit, wraps long text, and lets dagre place nodes and arrows, so nothing overlaps or spills out.
 */
export function Flowchart({ flow }: { flow: Flow }) {
  const svg = useRef<SVGSVGElement>(null);
  const marker = useId().replace(/:/g, "");
  const chart = useMemo(() => layout(flow), [flow]);

  return (
    <figure className="viz viz-flow">
      <div className="viz-flow-scroll">
        <svg
          ref={svg}
          width={chart.width}
          height={chart.height}
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label={`Ablaufdiagramm: ${flow.nodes.map((n) => n.label.replace(/\n/g, " ")).join(", ")}`}
        >
          <defs>
            <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" className="flow-arrow" />
            </marker>
          </defs>
          {chart.edges.map((e, i) => (
            <path key={i} d={e.path} className={`flow-edge${e.dashed ? " dashed" : ""}`} markerEnd={`url(#${marker})`} />
          ))}
          {chart.edges.map((e, i) =>
            e.label ? (
              <g key={`l${i}`}>
                <rect x={e.lx - e.lw / 2} y={e.ly - e.lh / 2} width={e.lw} height={e.lh} rx={6} className="flow-label-bg" />
                <Lines lines={e.lines} x={e.lx} y={e.ly} lh={chart.lineHeight} className="flow-label" />
              </g>
            ) : null,
          )}
          {chart.nodes.map((n) => (
            <g key={n.id}>
              <NodeShape shape={n.shape} x={n.x} y={n.y} w={n.w} h={n.h} />
              <Lines lines={n.lines} x={n.x} y={n.y} lh={chart.lineHeight} className="flow-text" />
            </g>
          ))}
        </svg>
      </div>
      <div className="viz-foot">
        <button className="ghost small" onClick={() => svg.current && downloadSvg(svg.current, "Ablauf")} title="Den Ablauf als Bilddatei speichern, die sich ohne Qualitätsverlust vergrößern lässt">
          Als SVG herunterladen
        </button>
      </div>
    </figure>
  );
}

function Lines({ lines, x, y, lh, className }: { lines: string[]; x: number; y: number; lh: number; className: string }) {
  const top = y - ((lines.length - 1) * lh) / 2;
  return (
    <text className={className} textAnchor="middle" dominantBaseline="central">
      {lines.map((l, i) => (
        <tspan key={i} x={x} y={top + i * lh}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

function NodeShape({ shape, x, y, w, h }: { shape: Shape; x: number; y: number; w: number; h: number }) {
  const l = x - w / 2;
  const t = y - h / 2;
  if (shape === "diamond") {
    return <path d={`M${x},${t}L${l + w},${y}L${x},${t + h}L${l},${y}Z`} className="flow-node decision" />;
  }
  if (shape === "circle") return <circle cx={x} cy={y} r={w / 2} className="flow-node terminal" />;
  const r = shape === "pill" ? h / 2 : shape === "round" || shape === "data" ? 14 : 8;
  return <rect x={l} y={t} width={w} height={h} rx={r} className={`flow-node${shape === "pill" ? " terminal" : ""}`} />;
}

/** Moves a point on a node's bounding box onto its real outline, along the line from the node's center. */
function onOutline(n: { shape: Shape; x: number; y: number; w: number; h: number }, p: { x: number; y: number }) {
  const dx = p.x - n.x;
  const dy = p.y - n.y;
  if (!dx && !dy) return p;
  let t = 1;
  if (n.shape === "diamond") t = 1 / (Math.abs(dx) / (n.w / 2) + Math.abs(dy) / (n.h / 2));
  else if (n.shape === "circle") t = n.w / 2 / Math.hypot(dx, dy);
  else return p;
  return { x: n.x + dx * t, y: n.y + dy * t };
}

const PAD_X = 14;
const PAD_Y = 10;

/** Measures with the same font the chart uses, so boxes fit their text exactly. */
function measurer() {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 18;
  const size = root * 0.8125;
  const ctx = document.createElement("canvas").getContext("2d")!;
  const family = getComputedStyle(document.body).fontFamily;
  return {
    size,
    width: (text: string, weight = 500) => {
      ctx.font = `${weight} ${size}px ${family}`;
      return ctx.measureText(text).width;
    },
  };
}

/** Breaks a label into lines no wider than `max`, keeping the model's own line breaks. */
function wrap(text: string, max: number, width: (t: string) => number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > max) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

function layout(flow: Flow) {
  const m = measurer();
  const lineHeight = Math.round(m.size * 1.3);
  const maxText = m.size * 13;
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: flow.dir, nodesep: 28, ranksep: 44, edgesep: 14, marginx: 10, marginy: 10 });
  g.setDefaultEdgeLabel(() => ({}));

  const sized = new Map<string, FlowNode & { lines: string[] }>();
  for (const n of flow.nodes) {
    const lines = wrap(n.label, n.shape === "diamond" ? maxText * 0.75 : maxText, (t) => m.width(t));
    const tw = Math.max(...lines.map((l) => m.width(l)));
    const th = lines.length * lineHeight;
    let w = tw + PAD_X * 2;
    let h = th + PAD_Y * 2;
    // A diamond needs about 1.5 times the text box to keep the text inside its slanted edges.
    if (n.shape === "diamond") [w, h] = [w * 1.5, h * 1.5];
    if (n.shape === "pill") w += h / 2;
    if (n.shape === "circle") w = h = Math.max(w, h);
    sized.set(n.id, { ...n, lines });
    g.setNode(n.id, { width: Math.ceil(w), height: Math.ceil(h) });
  }
  flow.edges.forEach((e, i) => {
    if (!e.label) return g.setEdge(e.from, e.to, {}, String(i));
    const lines = wrap(e.label, maxText * 0.6, (t) => m.width(t, 400));
    const lw = Math.max(...lines.map((l) => m.width(l, 400))) + 12;
    g.setEdge(e.from, e.to, { width: lw, height: lines.length * lineHeight + 6, labelpos: "c" }, String(i));
  });

  dagre.layout(g);

  const nodes = g.nodes().map((id) => {
    const p = g.node(id);
    return { ...sized.get(id)!, x: p.x, y: p.y, w: p.width, h: p.height };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = g.edges().map((ref) => {
    const e = g.edge(ref) as dagre.GraphEdge & { width?: number; height?: number };
    const src = flow.edges[Number(ref.name)];
    // dagre ends arrows on each node's bounding box; diamonds and circles need them on their actual outline.
    const pts = e.points.map((p) => ({ ...p }));
    pts[0] = onOutline(nodeById.get(ref.v)!, pts[0]);
    pts[pts.length - 1] = onOutline(nodeById.get(ref.w)!, pts[pts.length - 1]);
    // Rounded corners through dagre's bend points.
    let path = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
      path += `Q${pts[i].x},${pts[i].y} ${mid.x},${mid.y}`;
    }
    path += `L${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
    const lines = src?.label ? wrap(src.label, maxText * 0.6, (t) => m.width(t, 400)) : [];
    return {
      path,
      dashed: src?.dashed,
      label: src?.label,
      lines,
      lx: e.x ?? 0,
      ly: e.y ?? 0,
      lw: e.width ?? 0,
      lh: e.height ?? 0,
    };
  });
  const graph = g.graph();
  return { nodes, edges, width: Math.ceil(graph.width ?? 300), height: Math.ceil(graph.height ?? 200), lineHeight };
}
