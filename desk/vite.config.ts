import { defineConfig } from "vitest/config";

// The dashboard is plain Preact, bundled into web-dist/ and served by the Yap Machine desk server.
export default defineConfig({
  root: "web",
  base: "/",
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  test: { root: ".", include: ["src/**/*.test.ts", "web/src/**/*.test.ts"] },
  build: { outDir: "../web-dist", emptyOutDir: true, assetsDir: "assets", sourcemap: false },
});
