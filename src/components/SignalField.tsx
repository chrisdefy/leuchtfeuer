import { useEffect, useRef } from "react";

/**
 * The "Nachtsignal" moment: glowing signal lines drifting behind the welcome screen and empty chats.
 * Typing makes them swell, and while a model thinks a pulse runs along them. Raw WebGL (no library,
 * so the page stays small); one still frame for reduced motion; nothing at all without WebGL.
 * Paused while the tab is hidden.
 */
export function SignalField({ thinking }: { thinking: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const thinkingRef = useRef(thinking);
  thinkingRef.current = thinking;

  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext("webgl", { premultipliedAlpha: true, antialias: false });
    if (!el || !gl) return;
    const program = link(gl);
    if (!program) return;

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u("res"), uTime = u("t"), uPhase = u("phase"), uEnergy = u("energy"), uThink = u("think"), uA = u("cA"), uB = u("cB"), uGain = u("gain"), uKeys = u("keys");
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);

    // Colors follow the theme: the input and output accents of the price bars.
    let gain = 1;
    const readColors = () => {
      const css = getComputedStyle(document.documentElement);
      gl.uniform3fv(uA, rgb(css.getPropertyValue("--in")));
      gl.uniform3fv(uB, rgb(css.getPropertyValue("--out")));
      gain = css.getPropertyValue("color-scheme").includes("dark") ? 1 : 0.75;
    };
    readColors();
    const themeWatch = new MutationObserver(readColors);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", readColors);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.clientHeight * dpr);
      gl.viewport(0, 0, el.width, el.height);
    };
    resize();
    const sizeWatch = new ResizeObserver(resize);
    sizeWatch.observe(el);

    const start = performance.now();
    // Typing raises a target slowly; the visible energy glides toward it, so single keys never jolt the lines.
    let target = 0;
    let energy = 0;
    let think = 0;
    let phase = 0;
    // Each key also sends a soft ring of light outward from the middle, above the composer.
    const keys = new Float32Array(8).fill(-100);
    let nextKey = 0;
    const onKey = (e: KeyboardEvent) => {
      target = Math.min(1, target + 0.14);
      const now = (performance.now() - start) / 1000;
      if (e.repeat || now - keys[(nextKey + 7) % 8] < 0.09) return;
      keys[nextKey] = now;
      nextKey = (nextKey + 1) % 8;
    };
    window.addEventListener("keydown", onKey);

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = start;
    let frame = 0;
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      target *= Math.exp(-dt * 0.8);
      energy += (target - energy) * Math.min(1, dt * 2.2);
      // Integrated, not t * speed: a changing speed must not make the phase jump.
      phase += dt * (0.22 + energy * 0.2);
      think += ((thinkingRef.current ? 1 : 0) - think) * Math.min(1, dt * 3);
      gl.uniform2f(uRes, el.width, el.height);
      gl.uniform1f(uTime, still ? 12 : (now - start) / 1000);
      gl.uniform1f(uPhase, still ? 2.6 : phase);
      gl.uniform1f(uEnergy, energy);
      gl.uniform1f(uThink, think);
      gl.uniform1f(uGain, gain);
      gl.uniform1fv(uKeys, keys);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!still && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const onVisible = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) {
        last = performance.now();
        frame = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("keydown", onKey);
      scheme.removeEventListener("change", readColors);
      themeWatch.disconnect();
      sizeWatch.disconnect();
      // No loseContext(): StrictMode runs this effect twice on the same canvas, and a lost context stays lost.
    };
  }, []);

  return <canvas ref={canvas} className="signal-field" aria-hidden="true" />;
}

const VERTEX = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

// smoothstep needs edge0 < edge1 (otherwise undefined in GLSL ES), hence the "1.0 - smoothstep" forms.
// Fourteen lines in a band across the lower part of the screen, each a sum of two slow waves.
// A thin core plus a soft glow per line; "think" sends a bright pulse along them from left to right,
// and each key press lifts and brightens them in a ring that travels outward.
const FRAGMENT = `
precision mediump float;
uniform vec2 res;
uniform float t;
uniform float phase;
uniform float energy;
uniform float think;
uniform vec3 cA;
uniform vec3 cB;
uniform float gain;
uniform float keys[8];

void main() {
  vec2 uv = gl_FragCoord.xy / res;
  float x = uv.x * res.x / res.y;
  float speed = phase;

  // Rings from recent keys: each grows outward from the middle and fades over 2.8 s.
  float cx = 0.5 * res.x / res.y;
  float ripple = 0.0;
  for (int j = 0; j < 8; j++) {
    float age = t - keys[j];
    if (age >= 0.0 && age < 2.8) {
      float dd = abs(abs(x - cx) - age * 0.5);
      float life = smoothstep(0.0, 0.2, age) * pow(1.0 - age / 2.8, 2.0);
      ripple += exp(-dd * dd * 14.0) * life;
    }
  }
  ripple = min(ripple, 1.0);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 14; i++) {
    float f = float(i) / 13.0;
    float base = 0.16 + f * 0.2;
    float amp = 0.055 + 0.035 * f + energy * 0.04;
    float y = base + amp * sin(x * 2.4 + speed + f * 1.4) + 0.045 * sin(x * 0.9 - speed * 0.6 + f * 2.6)
      + ripple * 0.018 * (0.4 + 0.6 * f);
    float d = abs(uv.y - y) * res.y;
    float core = 1.0 - smoothstep(0.0, 1.4, d);
    float glow = exp(-d * 0.09) * 0.22;
    float pulse = think * pow(max(0.0, sin(x * 1.6 - t * 3.2 + f * 0.9)), 12.0);
    float w = (0.25 + 0.75 * sin(f * 3.14159)) * (0.6 + energy * 0.35 + pulse * 1.6 + ripple * 0.6);
    float k = (core * 0.55 + glow) * w * gain;
    col += mix(cA, cB, f) * k;
    alpha += k;
  }
  // Fade out toward the top and the edges so text above stays calm.
  float fade = (1.0 - smoothstep(0.3, 0.62, uv.y)) * smoothstep(0.0, 0.08, uv.x) * (1.0 - smoothstep(0.92, 1.0, uv.x));
  alpha = clamp(alpha * fade, 0.0, 1.0);
  gl_FragColor = vec4(min(col * fade, vec3(alpha)), alpha);
}
`;

function link(gl: WebGLRenderingContext) {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** "#8fa3ff" → [r, g, b] in 0..1. */
function rgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
