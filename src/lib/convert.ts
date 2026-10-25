import { strFromU8, unzipSync } from "fflate";

/**
 * Office documents and text files to Markdown, entirely in the browser.
 * The content is taken over word for word; only layout, pictures and formatting fall away.
 * DOCX, XLSX and PPTX are ZIP archives of XML files, which is all this needs to read.
 */

export type DocType = "docx" | "xlsx" | "pptx" | "text" | "csv";

const TEXT_EXT = /\.(txt|md|markdown|json|ndjson|xml|html?|ya?ml|log|ini|toml|js|jsx|ts|tsx|py|java|c|cpp|h|cs|go|rs|rb|php|sh|sql|css|swift|kt)$/i;

export function docTypeOf(file: File): DocType | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return "xlsx";
  if (name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".csv") || name.endsWith(".tsv")) return "csv";
  if (TEXT_EXT.test(name) || file.type.startsWith("text/") || file.type === "application/json") return "text";
  return null;
}

/** Old binary Office formats cannot be read this way. */
export function isLegacyOffice(file: File) {
  return /\.(doc|xls|ppt)$/i.test(file.name);
}

export async function convertToMarkdown(file: Blob, type: DocType, name: string): Promise<string> {
  if (type === "text") return (await file.text()).trim();
  if (type === "csv") {
    const text = (await file.text()).trim();
    return "```csv\n" + text + "\n```";
  }
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error(`„${name}“ ist beschädigt oder kein ${type.toUpperCase()}-Dokument.`);
  }
  const md = type === "docx" ? docx(zip) : type === "xlsx" ? xlsx(zip) : pptx(zip);
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

// ---- helpers ------------------------------------------------------------------------

function xml(zip: Record<string, Uint8Array>, path: string): Document | null {
  const data = zip[path];
  if (!data) return null;
  return new DOMParser().parseFromString(strFromU8(data), "application/xml");
}

/** Children by local name, ignoring namespaces (w:p, a:t, …). */
const kids = (el: Element, name: string) => [...el.children].filter((c) => c.localName === name);
const all = (el: Element | Document, name: string) => [...el.getElementsByTagNameNS("*", name)];
const attr = (el: Element | undefined | null, name: string) => {
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
};

/** The r:id attribute; slides also carry a plain numeric "id", so the namespace matters. */
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rid = (el: Element) => el.getAttributeNS(REL_NS, "id") ?? "";

function relsOf(zip: Record<string, Uint8Array>, path: string) {
  const map = new Map<string, string>();
  const doc = xml(zip, path);
  if (!doc) return map;
  for (const r of all(doc, "Relationship")) map.set(attr(r, "Id") ?? "", attr(r, "Target") ?? "");
  return map;
}

/** Resolve a relationship target relative to the folder of the part that owns it. */
function resolve(base: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, "<br>").trim();

function table(rows: string[][]) {
  const width = Math.max(...rows.map((r) => r.length));
  if (!width) return "";
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")].map(cell);
  const [head, ...body] = rows.map(pad);
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

// ---- Word -----------------------------------------------------------------------------

function docx(zip: Record<string, Uint8Array>) {
  const doc = xml(zip, "word/document.xml");
  if (!doc) throw new Error("Im Word-Dokument wurde kein Text gefunden.");
  // Style ids are localized ("berschrift1"); the built-in names ("heading 1") are not.
  const headings = new Map<string, number>();
  const styles = xml(zip, "word/styles.xml");
  if (styles) {
    for (const s of all(styles, "style")) {
      const name = attr(kids(s, "name")[0], "val")?.toLowerCase() ?? "";
      const level = name === "title" ? 1 : /^heading (\d)$/.exec(name)?.[1];
      if (level) headings.set(attr(s, "styleId") ?? "", Number(level));
    }
  }

  const runText = (p: Element) => {
    let out = "";
    const walk = (el: Element) => {
      for (const c of el.children) {
        if (c.localName === "t") out += c.textContent ?? "";
        else if (c.localName === "tab") out += "\t";
        else if (c.localName === "br" || c.localName === "cr") out += "\n";
        else if (c.localName !== "pPr" && c.localName !== "rPr" && c.localName !== "instrText" && c.localName !== "del") walk(c);
      }
    };
    walk(p);
    return out;
  };

  const paragraph = (p: Element) => {
    const text = runText(p).trim();
    if (!text) return "";
    const pPr = kids(p, "pPr")[0];
    const style = attr(pPr && kids(pPr, "pStyle")[0], "val") ?? "";
    const level = headings.get(style);
    if (level) return `${"#".repeat(Math.min(level + 1, 6))} ${text}`;
    const numPr = pPr && kids(pPr, "numPr")[0];
    if (numPr) {
      const depth = Number(attr(kids(numPr, "ilvl")[0], "val") ?? 0);
      return `${"  ".repeat(depth)}- ${text}`;
    }
    return text;
  };

  const blocks: string[] = [];
  const body = all(doc, "body")[0];
  const visit = (el: Element) => {
    for (const c of el.children) {
      if (c.localName === "p") {
        const line = paragraph(c);
        if (line) blocks.push(line);
      } else if (c.localName === "tbl") {
        const rows = kids(c, "tr").map((tr) => kids(tr, "tc").map((tc) => kids(tc, "p").map((p) => runText(p).trim()).filter(Boolean).join("\n")));
        if (rows.length) blocks.push(table(rows));
      } else if (c.localName === "sdt" || c.localName === "sdtContent" || c.localName === "customXml") visit(c);
    }
  };
  if (body) visit(body);
  // Consecutive list items stay together; everything else gets a blank line.
  return blocks.reduce((out, b, i) => (i && /^\s*- /.test(b) && /^\s*- /.test(blocks[i - 1]) ? `${out}\n${b}` : out ? `${out}\n\n${b}` : b), "");
}

// ---- Excel ----------------------------------------------------------------------------

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function excelDate(serial: number) {
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return serial % 1 === 0 ? date : serial < 1 ? time : `${date} ${time}`;
}

const tidyNumber = (n: number) => String(Number.isInteger(n) ? n : parseFloat(n.toPrecision(15)));

function xlsx(zip: Record<string, Uint8Array>) {
  const book = xml(zip, "xl/workbook.xml");
  if (!book) throw new Error("In der Excel-Datei wurden keine Tabellenblätter gefunden.");
  const rels = relsOf(zip, "xl/_rels/workbook.xml.rels");

  const shared: string[] = [];
  const sst = xml(zip, "xl/sharedStrings.xml");
  if (sst) for (const si of all(sst, "si")) shared.push(all(si, "t").map((t) => t.textContent ?? "").join(""));

  // Cell styles → how numbers are meant: date, percent or plain.
  const formats: ("date" | "percent" | "number")[] = [];
  const styles = xml(zip, "xl/styles.xml");
  if (styles) {
    const custom = new Map<number, string>();
    for (const f of all(styles, "numFmt")) custom.set(Number(attr(f, "numFmtId")), attr(f, "formatCode") ?? "");
    const xfs = all(styles, "cellXfs")[0];
    for (const xf of xfs ? kids(xfs, "xf") : []) {
      const id = Number(attr(xf, "numFmtId") ?? 0);
      const code = (custom.get(id) ?? "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
      formats.push(
        BUILTIN_DATE_FORMATS.has(id) || /[dy]|m{3,}|h{1,2}:m/i.test(code)
          ? "date"
          : id === 9 || id === 10 || code.includes("%")
            ? "percent"
            : "number",
      );
    }
  }

  const colIndex = (ref: string) => {
    const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
    return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  };

  const out: string[] = [];
  for (const sheet of all(book, "sheet")) {
    const name = attr(sheet, "name") ?? "Tabelle";
    const target = rels.get(rid(sheet));
    const doc = target && xml(zip, resolve("xl/workbook.xml", target));
    if (!doc) continue;
    const rows: string[][] = [];
    for (const row of all(doc, "row")) {
      const values: string[] = [];
      for (const c of kids(row, "c")) {
        const t = attr(c, "t");
        const raw = kids(c, "v")[0]?.textContent ?? "";
        let v = "";
        if (t === "s") v = shared[Number(raw)] ?? "";
        else if (t === "inlineStr") v = all(c, "t").map((x) => x.textContent ?? "").join("");
        else if (t === "b") v = raw === "1" ? "WAHR" : "FALSCH";
        else if (t === "str" || t === "e") v = raw;
        else if (raw !== "") {
          const n = Number(raw);
          const kind = formats[Number(attr(c, "s") ?? 0)] ?? "number";
          v = Number.isNaN(n) ? raw : kind === "date" ? excelDate(n) : kind === "percent" ? `${tidyNumber(n * 100)} %` : tidyNumber(n);
        }
        values[colIndex(attr(c, "r") ?? "A")] = v;
      }
      if (values.some((v) => v && v.trim())) rows.push(Array.from(values, (v) => v ?? ""));
    }
    if (!rows.length) continue;
    // Drop columns that are empty everywhere (common with formatted but unused columns).
    const width = Math.max(...rows.map((r) => r.length));
    const used = Array.from({ length: width }, (_, i) => rows.some((r) => r[i]?.trim()));
    const trimmed = rows.map((r) => r.filter((_, i) => used[i]));
    out.push(`## ${name}\n\n${table(trimmed)}`);
  }
  if (!out.length) throw new Error("Die Excel-Datei enthält keine ausgefüllten Zellen.");
  return out.join("\n\n");
}

// ---- PowerPoint -----------------------------------------------------------------------

function pptx(zip: Record<string, Uint8Array>) {
  const pres = xml(zip, "ppt/presentation.xml");
  if (!pres) throw new Error("In der PowerPoint-Datei wurden keine Folien gefunden.");
  const rels = relsOf(zip, "ppt/_rels/presentation.xml.rels");
  const paragraphs = (el: Element | Document) =>
    all(el, "p")
      .map((p) => all(p, "t").map((t) => t.textContent ?? "").join("").trim())
      .filter(Boolean);

  const out: string[] = [];
  all(pres, "sldId").forEach((s, i) => {
    const path = resolve("ppt/presentation.xml", rels.get(rid(s)) ?? "");
    const slide = xml(zip, path);
    if (!slide) return;
    let title = "";
    const body: string[] = [];
    for (const shape of all(slide, "sp")) {
      const ph = all(shape, "ph")[0];
      const type = attr(ph, "type");
      const lines = paragraphs(shape);
      if (!lines.length) continue;
      if (!title && (type === "title" || type === "ctrTitle")) title = lines.join(" ");
      else body.push(...lines.map((l) => `- ${l}`));
    }
    for (const frame of all(slide, "graphicFrame")) {
      const rows = all(frame, "tr").map((tr) => all(tr, "tc").map((tc) => paragraphs(tc).join("\n")));
      if (rows.length) body.push(table(rows));
    }
    // Speaker notes often hold what the slide only hints at.
    const slideRels = relsOf(zip, path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels"));
    const notesTarget = [...slideRels.values()].find((t) => t.includes("notesSlide"));
    const notes = notesTarget ? xml(zip, resolve(path, notesTarget)) : null;
    const noteLines = notes
      ? all(notes, "sp")
          .filter((sp) => attr(all(sp, "ph")[0], "type") === "body")
          .flatMap((sp) => paragraphs(sp))
      : [];
    out.push(
      [`## Folie ${i + 1}${title ? `: ${title}` : ""}`, body.join("\n"), noteLines.length ? `Notizen: ${noteLines.join(" ")}` : ""]
        .filter(Boolean)
        .join("\n\n"),
    );
  });
  if (!out.length) throw new Error("In der PowerPoint-Datei wurden keine Folien gefunden.");
  return out.join("\n\n");
}
