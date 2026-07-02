import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

// Register the SvelteKit plugin only when Vite runs from this package (dev/build), not when vp's lint pass loads every workspace vite.config.ts from the repo root — SvelteKit's configResolved sync step resolves src/app.html via process.cwd() and would fail against the wrong cwd. The oxlint probe is indistinguishable from a real build by command/mode, so cwd is the only reliable signal. Tracking: drop this once vp can scope which configs its lint pass loads (vp 0.1.x).
// The Tailwind plugin rides the same guard: it scans content relative to the resolved config root, so it only belongs in a real dev/build run. Tailwind before SvelteKit, per the Tailwind v4 SvelteKit guide.
const runningInPackageDir = process.cwd() === import.meta.dirname;

export default defineConfig({
  plugins: runningInPackageDir ? [tailwindcss(), sveltekit()] : [],
  // dev convenience: proxy /api to a running `wrangler dev`
  server: { proxy: { "/api": "http://localhost:8787" } },
});
