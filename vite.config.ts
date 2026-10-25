/// <reference types="node" />
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Desktop edition: one self-contained Leuchtfeuer.html that runs by double-click (file://).
 * Browsers refuse to load module scripts from files next to it, so script, styles,
 * fonts and icon all go inline.
 */
function singleFile(): Plugin {
  return {
    name: "router-single-file",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.type === "asset" && f.fileName.endsWith(".html"));
      if (!html || html.type !== "asset") return;
      let page = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk") {
          // "</script" inside the code would end the inline script early.
          const code = file.code.replace(/<\/script/gi, "<\\/script");
          const tag = new RegExp(`<script[^>]*src="[^"]*${escape(file.fileName)}"[^>]*></script>`);
          page = page.replace(tag, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.fileName.endsWith(".css")) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${escape(file.fileName)}"[^>]*>`);
          page = page.replace(tag, () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        }
      }
      const icon = readFileSync(new URL("./public/favicon.svg", import.meta.url));
      page = page.replace(/href="[^"]*favicon\.svg"/, () => `href="data:image/svg+xml;base64,${icon.toString("base64")}"`);
      html.source = page;
      html.fileName = "Leuchtfeuer.html";
    },
  };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default defineConfig(({ mode }) => {
  const desktop = mode === "desktop";
  return {
    plugins: [react(), ...(desktop ? [singleFile()] : [])],
    server: { port: 5173 },
    base: desktop ? "./" : "/",
    build: desktop
      ? {
          outDir: "dist-desktop",
          // Fonts become data URLs inside the CSS.
          assetsInlineLimit: Number.MAX_SAFE_INTEGER,
          cssCodeSplit: false,
          copyPublicDir: false,
          modulePreload: false,
          chunkSizeWarningLimit: 10_000,
        }
      : {},
  };
});
