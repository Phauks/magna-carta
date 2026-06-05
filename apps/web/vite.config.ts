import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite-plus";

// Register the SvelteKit plugin only when Vite runs from this package (dev/build), not when vp's lint pass loads every workspace vite.config.ts from the repo root — SvelteKit's configResolved sync step resolves src/app.html via process.cwd() and would fail against the wrong cwd. The oxlint probe is indistinguishable from a real build by command/mode, so cwd is the only reliable signal. Tracking: drop this once vp can scope which configs its lint pass loads (vp 0.1.x).
const runningInPackageDir = process.cwd() === import.meta.dirname;

export default defineConfig({
  plugins: runningInPackageDir ? [sveltekit()] : [],
  // dev convenience: proxy /api to a running `wrangler dev`
  server: { proxy: { "/api": "http://localhost:8787" } },
});
