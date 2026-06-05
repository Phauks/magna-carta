import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";
import path from "node:path";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
// Guard against the SvelteKit plugin running when this config is loaded from outside
// apps/web (e.g. vp check loads all workspace vite configs from the repo root).
// SvelteKit's sync step resolves src/app.html via process.cwd(), which would be wrong.
const runningInPackageDir = path.resolve(process.cwd()) === path.resolve(thisDir);

export default defineConfig({
  plugins: runningInPackageDir ? [sveltekit()] : [],
  // dev convenience: proxy /api to a running `wrangler dev`
  server: { proxy: { "/api": "http://localhost:8787" } },
});
