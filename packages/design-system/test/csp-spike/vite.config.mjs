// Vite config for the CSP spike probe ONLY (invoked by the `csp-spike` package script).
// Static build (no dev server): the probe must run without script-src 'unsafe-eval' so the
// header matches production fidelity — Vite's dev server injects CSS through <style> elements
// and evaluates modules in ways that would confound a style-src/script-src probe.
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default {
  root: import.meta.dirname,
  // configFile: false — do not walk up to the package svelte.config.js; the probe is
  // self-contained and needs no preprocessing (plain Svelte 5 with lang="ts" scripts).
  plugins: [svelte({ configFile: false })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
};
