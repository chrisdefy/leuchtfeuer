import { useEffect, useRef, useState } from "react";
import type { ChartSpec } from "../lib/visual";
import { downloadSvg } from "../lib/svgExport";

/**
 * Draws a ```chart block from a model: columns, lines or a donut, in the theme's validated chart colors
 * (--series-1…4, checked for color blindness and contrast in both themes). At most four series get a color;
 * more stay in the table. Hover or tap shows the values; "Als Tabelle" shows all numbers.
 */
export function Chart({ spec }: { spec: ChartSpec }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const pie = spec.type === "pie" ? foldSlices(spec) : null;
  const shown = spec.series.slice(0, 4);
  const hiddenSeries = spec.series.length - shown.length;
  const legend = pie ? pie.labels.map((l, i) => ({ name: `${l}, ${percent(pie.values[i], pie.total)}`, color: pie.colors[i] })) : shown.length > 1 ? shown.map((s, i) => ({ name: s.name, color: seriesColor(i) })) : [];

  return (
    <figure className="viz">
      {spec.title && <figcaption className="viz-title">{spec.title}</figcaption>}
      {!table && legend.length > 0 && (
        <ul className="viz-legend">
          {legend.map((l) => (
            <li key={l.name}>
              <span className="viz-swatch" style={{ background: l.color }} aria-hidden="true" />
              {l.name}
            </li>
          ))}
        </ul>
      )}
      <div ref={box} className="viz-plot">
        {table ? (
          <ChartTable spec={spec} />
        ) : pie ? (
          <Donut pie={pie} unit={spec.unit} width={width} />
        ) : (
          <Cartesian spec={{ ...spec, series: shown }} width={width} />
        )}
      </div>
      <div className="viz-foot">
        {hiddenSeries > 0 && !table && <span>{hiddenSeries} weitere Reihen stehen in der Tabelle.</span>}
        {!table && (
          <button
            className="ghost small"
            title="Das Diagramm als Bilddatei speichern, die sich ohne Qualitätsverlust vergrößern lässt"
            onClick={() => {
              const el = box.current?.querySelector("svg");
              if (el) downloadSvg(el, spec.title ?? "Diagramm");
            }}
          >
            Als SVG herunterladen
          </button>
        )}
        <button className="ghost small" onClick={() => setTable(!table)} title={table ? "Wieder als Diagramm zeigen" : "Die Zahlen hinter dem Diagramm als Tabelle zeigen"}>
          {table ? "Als Grafik" : "Als Tabelle"}
        </button>
      </div>
    </figure>
  );
}

const H = 240;
const PAD = { top: 14, right: 18, bottom: 34, left: 52 };

const seriesColor = (i: number) => `var(--series-${i + 1})`;

const numberFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 });
/** Axis ticks: full numbers ("12.500") up to a million, then short ("1,5 Mio."). */
const tickLabel = (v: number) => (Math.abs(v) >= 1e6 ? compactFormat.format(v) : numberFormat.format(v));
const withUnit = (v: number, unit?: string) => `${numberFormat.format(v)}${unit ? ` ${unit}` : ""}`;
const percent = (v: number, total: number) => `${total ? Math.round((v / total) * 100) : 0} %`;

/** Clean axis ticks around the data, always including zero. */
function ticksFor(lo: number, hi: number) {
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** A bar with a 4px rounded data end and a square baseline end. */
function barPath(x: number, w: number, yValue: number, yBase: number) {
  const r = Math.min(4, w / 2, Math.abs(yBase - yValue));
  if (yValue <= yBase) {
    return `M${x},${yBase}V${yValue + r}Q${x},${yValue} ${x + r},${yValue}H${x + w - r}Q${x + w},${yValue} ${x + w},${yValue + r}V${yBase}Z`;
  }
  return `M${x},${yBase}V${yValue - r}Q${x},${yValue} ${x + r},${yValue}H${x + w - r}Q${x + w},${yValue} ${x + w},${yValue - r}V${yBase}Z`;
}

function Cartesian({ spec, width }: { spec: ChartSpec; width: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = spec.labels.length;
  const all = spec.series.flatMap((s) => s.values);
  const ticks = ticksFor(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + innerH * (1 - (v - lo) / (hi - lo));
  const band = innerW / n;
  const cx = (i: number) => PAD.left + band * (i + 0.5);
  const k = spec.series.length;
  const barW = Math.max(3, Math.min(24, (band * 0.72 - (k - 1) * 2) / k));
  const groupW = k * barW + (k - 1) * 2;
  // Every label if there is room, otherwise every second, third, …
  const every = Math.max(1, Math.ceil(46 / band));

  return (
    <div className="viz-area" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={H} role="img" aria-label={spec.title ?? "Diagramm"}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? "viz-base" : "viz-grid"} />
            <text x={PAD.left - 8} y={y(t)} className="viz-tick" textAnchor="end" dominantBaseline="middle">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {spec.labels.map((l, i) =>
          i % every === 0 ? (
            <text key={i} x={cx(i)} y={H - 12} className="viz-tick" textAnchor="middle">
              {l.length > 14 ? `${l.slice(0, 13)}…` : l}
            </text>
          ) : null,
        )}
        {hover !== null && spec.type === "line" && <line x1={cx(hover)} x2={cx(hover)} y1={PAD.top} y2={PAD.top + innerH} className="viz-cross" />}

        {spec.type === "bar"
          ? spec.series.map((s, si) =>
              s.values.map((v, i) => (
                <path
                  key={`${si}-${i}`}
                  d={barPath(cx(i) - groupW / 2 + si * (barW + 2), barW, y(v), y(0))}
                  style={{ fill: seriesColor(si), opacity: hover === null || hover === i ? 1 : 0.45 }}
                />
              )),
            )
          : spec.series.map((s, si) => (
              <g key={si}>
                <path
                  d={s.values.map((v, i) => `${i ? "L" : "M"}${cx(i)},${y(v)}`).join("")}
                  className="viz-line"
                  style={{ stroke: seriesColor(si) }}
                />
                {s.values.map((v, i) =>
                  i === s.values.length - 1 || hover === i ? (
                    <circle key={i} cx={cx(i)} cy={y(v)} r={4} className="viz-dot" style={{ fill: seriesColor(si) }} />
                  ) : null,
                )}
              </g>
            ))}

        {spec.labels.map((_, i) => (
          <rect
            key={i}
            x={PAD.left + band * i}
            y={PAD.top}
            width={band}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onClick={() => setHover(hover === i ? null : i)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div className="viz-tip" style={{ left: Math.min(Math.max(cx(hover), 90), width - 90) }}>
          <strong>{spec.labels[hover]}</strong>
          {spec.series.map((s, si) => (
            <span key={si}>
              <i className="viz-swatch" style={{ background: seriesColor(si) }} aria-hidden="true" />
              {spec.series.length > 1 && `${s.name}: `}
              {s.values[hover] !== undefined ? withUnit(s.values[hover], spec.unit) : "–"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface Pie {
  labels: string[];
  values: number[];
  colors: string[];
  total: number;
}

/** Four colored slices at most; the rest folds into a gray "Andere" so color never runs out or repeats. */
function foldSlices(spec: ChartSpec): Pie {
  const values = spec.series[0].values.map((v) => Math.max(0, v));
  let labels = spec.labels.slice(0, values.length);
  let vals = values;
  if (values.length > 5) {
    vals = [...values.slice(0, 4), values.slice(4).reduce((a, b) => a + b, 0)];
    labels = [...labels.slice(0, 4), "Andere"];
  }
  const colors = vals.map((_, i) => (i < 4 ? seriesColor(i) : "var(--ink-3)"));
  return { labels, values: vals, colors, total: vals.reduce((a, b) => a + b, 0) };
}

function Donut({ pie, unit, width }: { pie: Pie; unit?: string; width: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const r = Math.min(H / 2 - 8, width / 2 - 8);
  const inner = r * 0.62;
  const cx = width / 2;
  const cy = H / 2;
  let angle = -Math.PI / 2;
  const arcs = pie.values.map((v) => {
    const a0 = angle;
    const a1 = angle + (pie.total ? (v / pie.total) * Math.PI * 2 : 0);
    angle = a1;
    return [a0, a1] as const;
  });
  const pt = (a: number, rad: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  const slice = ([a0, a1]: readonly [number, number]) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    // A full circle cannot be one arc; draw it as two halves.
    if (a1 - a0 >= Math.PI * 2 - 1e-6) {
      return `M${pt(a0, r)}A${r},${r} 0 1 1 ${pt(a0 + Math.PI, r)}A${r},${r} 0 1 1 ${pt(a0, r)}M${pt(a0, inner)}A${inner},${inner} 0 1 0 ${pt(a0 + Math.PI, inner)}A${inner},${inner} 0 1 0 ${pt(a0, inner)}Z`;
    }
    return `M${pt(a0, r)}A${r},${r} 0 ${large} 1 ${pt(a1, r)}L${pt(a1, inner)}A${inner},${inner} 0 ${large} 0 ${pt(a0, inner)}Z`;
  };
  const focus = hover ?? null;

  return (
    <div className="viz-area">
      <svg width={width} height={H} role="img" aria-label="Kreisdiagramm">
        {arcs.map((a, i) => (
          <path
            key={i}
            d={slice(a)}
            className="viz-slice"
            fillRule="evenodd"
            style={{ fill: pie.colors[i], opacity: focus === null || focus === i ? 1 : 0.45 }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => setHover(hover === i ? null : i)}
          />
        ))}
        <text x={cx} y={cy - 8} textAnchor="middle" className="viz-center-label">
          {focus === null ? "Gesamt" : pie.labels[focus]}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="viz-center-value">
          {focus === null ? withUnit(pie.total, unit) : `${withUnit(pie.values[focus], unit)}, ${percent(pie.values[focus], pie.total)}`}
        </text>
      </svg>
    </div>
  );
}

function ChartTable({ spec }: { spec: ChartSpec }) {
  return (
    <div className="table-wrap">
      <table className="viz-table">
        <thead>
          <tr>
            <th />
            {spec.series.map((s) => (
              <th key={s.name} className="num">
                {s.name}
                {spec.unit ? ` (${spec.unit})` : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.labels.map((l, i) => (
            <tr key={i}>
              <th scope="row">{l}</th>
              {spec.series.map((s) => (
                <td key={s.name} className="num">
                  {s.values[i] !== undefined ? numberFormat.format(s.values[i]) : "–"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
