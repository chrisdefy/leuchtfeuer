import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Relative paths: the same build works at a domain's root and in a subfolder (GitHub Pages: /leuchtfeuer/).
  base: "./",
});
