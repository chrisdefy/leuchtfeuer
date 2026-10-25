import { useEffect, useRef } from "react";
import { BeaconMark } from "./BeaconMark";

const SEEN = "leuchtfeuer.intro";

/** The start sequence runs once per browser tab; reloading the page does not repeat it. */
export function introPending() {
  try {
    return !sessionStorage.getItem(SEEN);
  } catch {
    return false;
  }
}

/**
 * Start sequence: the light shines straight at you, swings to the right into its beam, the name lights up,
 * and the mark flies to its place in the sidebar while the app fades in underneath. Click or any key skips.
 * The steps before leaving are CSS animations (styles.css, "start sequence"); leaving is measured here.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const lockup = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const skip = useRef(() => {});
  // The app re-renders while it loads; the sequence must not restart with every new callback.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    try {
      sessionStorage.setItem(SEEN, "1");
    } catch {
      /* storage blocked: the intro may show again, nothing else */
    }
    document.documentElement.classList.add("intro-running");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let left = false;
    let timer = 0;

    function finish() {
      document.documentElement.classList.remove("intro-running");
      done.current();
    }

    function leave() {
      if (left || !root.current || !lockup.current || !mark.current) return;
      left = true;
      clearTimeout(timer);
      const ease = "cubic-bezier(0.22, 0.7, 0.2, 1)";
      root.current.animate([{ backgroundColor: getComputedStyle(root.current).backgroundColor }, { backgroundColor: "transparent" }], {
        duration: reduced ? 250 : 650,
        easing: "ease-out",
        fill: "forwards",
      });
      // Into the sidebar's mark, when the sidebar is on screen (on phones it is a closed drawer).
      const target = document.querySelector(".sidebar .wordmark svg")?.getBoundingClientRect();
      const from = mark.current.getBoundingClientRect();
      const box = lockup.current.getBoundingClientRect();
      const visible = target && target.width > 0 && target.right > 0 && target.left < innerWidth;
      let flight: Animation;
      if (visible && !reduced) {
        const s = target.width / from.width;
        const x = target.left - box.left - (from.left - box.left) * s;
        const y = target.top - box.top - (from.top - box.top) * s;
        flight = lockup.current.animate(
          [{ transform: "none" }, { transform: `translate(${x}px, ${y}px) scale(${s})` }],
          { duration: 750, easing: ease, fill: "forwards" },
        );
      } else {
        flight = lockup.current.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.92)" }], {
          duration: reduced ? 250 : 500,
          easing: ease,
          fill: "forwards",
        });
      }
      flight.finished.then(finish, finish);
    }

    timer = window.setTimeout(leave, reduced ? 700 : 2350);
    skip.current = leave;
    window.addEventListener("keydown", leave);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", leave);
      document.documentElement.classList.remove("intro-running");
    };
  }, []);

  return (
    <div className="intro" ref={root} onPointerDown={() => skip.current()} aria-hidden="true">
      <div className="intro-lockup" ref={lockup}>
        <div className="intro-mark" ref={mark}>
          <span className="intro-glare" />
          <BeaconMark size={96} id="intro" />
        </div>
        <span className="intro-word">
          <span>Leuchtfeuer</span>
        </span>
      </div>
    </div>
  );
}
