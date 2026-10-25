import { createContext, memo, useContext, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Icon } from "./Icon";
import { Chart } from "./Chart";
import { Flowchart } from "./Flowchart";
import { parseFlow } from "../lib/flow";
import { downloadText } from "../lib/exporting";
import { parseChart, svgSource } from "../lib/visual";

/** True while the answer is still arriving: a half-written chart shows a placeholder instead of raw code. */
const Live = createContext(false);

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const live = useContext(Live);
  const code = textOf(children);
  const lang = /language-(\S+)/.exec(
    (children as { props?: { className?: string } } | undefined)?.props?.className ?? "",
  )?.[1];

  const flow = useMemo(() => (lang === "mermaid" || lang === "flow" ? parseFlow(code) : null), [lang, code]);
  if (flow) return <Flowchart flow={flow} />;
  if ((lang === "mermaid" || lang === "flow") && live && /^\s*(flowchart|graph)\b/i.test(code)) {
    return <div className="viz viz-pending">Ablauf wird gezeichnet …</div>;
  }

  if (lang === "chart" || lang === "svg") {
    const chart = lang === "chart" ? parseChart(code) : null;
    const svg = lang === "svg" ? svgSource(code) : null;
    if (chart) return <Chart spec={chart} />;
    if (svg) return <SvgFigure svg={svg} />;
    if (live) return <div className="viz viz-pending">Grafik wird gezeichnet …</div>;
  }
  if (lang === "text" || lang === "txt") return <TextCard text={code.replace(/\n$/, "")} />;
  return <Code code={code} lang={lang}>{children}</Code>;
}

/** File extension for a code block's language when it is saved. */
const EXT: Record<string, string> = {
  python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx",
  html: "html", css: "css", json: "json", csv: "csv", markdown: "md", md: "md", yaml: "yml", yml: "yml",
  xml: "xml", sql: "sql", bash: "sh", sh: "sh", shell: "sh", powershell: "ps1", java: "java", c: "c",
  cpp: "cpp", csharp: "cs", cs: "cs", go: "go", rust: "rs", php: "php", ruby: "rb", swift: "swift", kotlin: "kt",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ghost small"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Kopiert" : "Kopieren"}
    </button>
  );
}

/**
 * A finished text the user wants to take along (letter, e-mail, post): shown like a sheet of paper,
 * in normal type, ready to copy or save, with the model's explanations kept outside of it.
 */
function TextCard({ text }: { text: string }) {
  return (
    <figure className="textcard">
      <div className="textcard-body">{text}</div>
      <div className="textcard-bar">
        <CopyButton text={text} />
        <button className="ghost small" onClick={() => downloadText(`${textFileName(text)}.txt`, text, "text/plain")}>
          <Icon name="download" size={14} />
          Als .txt speichern
        </button>
      </div>
    </figure>
  );
}

/** "Sehr geehrte Frau Müller, …" → "Sehr-geehrte-Frau-Mueller" for the file name. */
function textFileName(text: string) {
  const first = text.split("\n").find((l) => l.trim()) ?? "Text";
  return (
    first
      .replace(/[äöüß]/gi, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "Ae", Ö: "Oe", Ü: "Ue" })[c] ?? c)
      .replace(/[^\w]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "Text"
  );
}

/** A sketch from the model, shown as an image so nothing inside it can run; always on paper-white. */
function SvgFigure({ svg }: { svg: string }) {
  return (
    <figure className="viz viz-svg">
      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="Grafik des Modells" />
    </figure>
  );
}

function Code({ code, lang, children }: { code: string; lang?: string; children?: ReactNode }) {
  const clean = code.replace(/\n$/, "");
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>{lang ?? "Code"}</span>
        <span className="codeblock-actions">
          <button
            className="ghost small"
            onClick={() => downloadText(`code.${EXT[lang?.toLowerCase() ?? ""] ?? "txt"}`, clean, "text/plain")}
            title="Als Datei speichern"
          >
            <Icon name="download" size={14} />
            Herunterladen
          </button>
          <CopyButton text={clean} />
        </span>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({ text, live = false }: { text: string; live?: boolean }) {
  return (
    <Live.Provider value={live}>
      <div className="prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            pre: CodeBlock,
            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
            table: ({ node: _node, ...props }) => (
              <div className="table-wrap">
                <table {...props} />
              </div>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    </Live.Provider>
  );
});
