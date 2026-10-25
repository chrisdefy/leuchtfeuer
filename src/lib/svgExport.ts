/**
 * Saves a drawn chart as an .svg file that looks the same outside Leuchtfeuer: theme colors and fonts
 * (CSS variables) are written into each element, and the panel color becomes the background.
 */
export function downloadSvg(svg: SVGSVGElement, title: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll<SVGElement>("*")];
  const to = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  from.forEach((el, i) => {
    const css = getComputedStyle(el);
    for (const p of ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight"]) {
      to[i].style.setProperty(p, css.getPropertyValue(p));
    }
  });
  const width = svg.width.baseVal.value;
  const height = svg.height.baseVal.value;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const panel = svg.closest(".viz");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", panel ? getComputedStyle(panel).backgroundColor : "#ffffff");
  clone.insertBefore(bg, clone.firstChild);

  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(title || "Grafik").replace(/[\\/:*?"<>|]+/g, "").slice(0, 60).trim() || "Grafik"}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
