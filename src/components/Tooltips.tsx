import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * One styled hint for the whole app. Any element with a `title` (or an icon-only
 * button with an `aria-label`) shows its text after a short pause, on hover or keyboard focus.
 * The native title is moved to `data-tip` so the browser's own tooltip does not double it.
 */

const DELAY_MS = 450;
const TARGETS = "[title], [data-tip], button[aria-label], a[aria-label]";

function tipFor(el: HTMLElement): string | null {
  const title = el.getAttribute("title");
  if (title) {
    el.setAttribute("data-tip", title);
    el.removeAttribute("title");
  }
  const tip = el.getAttribute("data-tip");
  if (tip) return tip;
  // Buttons with visible text explain themselves; icon-only ones fall back to their label.
  const label = el.getAttribute("aria-label");
  return label && !el.textContent?.trim() ? label : null;
}

interface Tip {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | null>(null);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function hide() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      current.current = null;
      setTip(null);
    }

    function show(el: HTMLElement, immediate = false) {
      if (current.current === el) return;
      hide();
      const text = tipFor(el);
      if (!text) return;
      current.current = el;
      timer.current = window.setTimeout(
        () => {
          if (!el.isConnected || current.current !== el) return;
          const r = el.getBoundingClientRect();
          const below = r.top < 56;
          setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
        },
        immediate ? 0 : DELAY_MS,
      );
    }

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as HTMLElement).closest<HTMLElement>(TARGETS);
      if (el) show(el);
      else if (current.current) hide();
    };
    const onOut = (e: PointerEvent) => {
      if (current.current && !current.current.contains(e.relatedTarget as Node)) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>(TARGETS);
      // Only for keyboard focus; a mouse click should not pop a hint.
      if (el && (e.target as HTMLElement).matches(":focus-visible")) show(el);
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      hide();
    };
  }, []);

  const ref = useRef<HTMLDivElement>(null);
  // Keep the bubble inside the window, measured before it is painted.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return;
    el.style.setProperty("--shift", "0px");
    const r = el.getBoundingClientRect();
    const overRight = r.right - (window.innerWidth - 8);
    const overLeft = 8 - r.left;
    el.style.setProperty("--shift", `${overRight > 0 ? -overRight : overLeft > 0 ? overLeft : 0}px`);
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      className={`tooltip${tip.below ? " below" : ""}`}
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  );
}
