import { execSync } from "node:child_process";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

// Register the SvelteKit plugin only when Vite runs from this package (dev/build), not when vp's lint pass loads every workspace vite.config.ts from the repo root — SvelteKit's configResolved sync step resolves src/app.html via process.cwd() and would fail against the wrong cwd. The oxlint probe is indistinguishable from a real build by command/mode, so cwd is the only reliable signal. Tracking: drop this once vp can scope which configs its lint pass loads (vp 0.1.x).
// The Tailwind plugin rides the same guard: it scans content relative to the resolved config root, so it only belongs in a real dev/build run. Tailwind before SvelteKit, per the Tailwind v4 SvelteKit guide.
const runningInPackageDir = process.cwd() === import.meta.dirname;

// Build identity for version tracing (src/lib/build-identity.ts): baked in at build time so
// every error report says exactly which build produced it. In dev the commit is read once at
// server start — close enough for tracing, free of per-request cost.
function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// The commit's own timestamp (committer time, ISO 8601) — shown beside the commit in the version
// overlay so "which build" also answers "how old". Null when git cannot answer: an honest absence
// renders as such, never as a fabricated date.
function gitCommitTime(): string | null {
  try {
    return execSync("git show --no-patch --format=%cI HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export default defineConfig({
  plugins: runningInPackageDir ? [tailwindcss(), sveltekit()] : [],
  define: {
    __MC_BUILD_COMMIT__: JSON.stringify(runningInPackageDir ? gitCommit() : "unknown"),
    __MC_BUILD_COMMIT_TIME__: JSON.stringify(runningInPackageDir ? gitCommitTime() : null),
    __MC_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // dev convenience: proxy /api to a running `wrangler dev`
  server: { proxy: { "/api": "http://localhost:8787" } },
});
