import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import { resolveCommitIdentity } from "../../packages/build-identity/scripts/commit-identity.mjs";

// Register the SvelteKit plugin only when Vite runs from this package (dev/build), not when vp's lint pass loads every workspace vite.config.ts from the repo root — SvelteKit's configResolved sync step resolves src/app.html via process.cwd() and would fail against the wrong cwd. The oxlint probe is indistinguishable from a real build by command/mode, so cwd is the only reliable signal. Tracking: drop this once vp can scope which configs its lint pass loads (vp 0.1.x).
// The Tailwind plugin rides the same guard: it scans content relative to the resolved config root, so it only belongs in a real dev/build run. Tailwind before SvelteKit, per the Tailwind v4 SvelteKit guide.
const runningInPackageDir = process.cwd() === import.meta.dirname;

// Build identity for version tracing (src/lib/build-identity.ts): baked in at build time so
// every error report says exactly which build produced it. In dev the commit is read once at
// server start — close enough for tracing, free of per-request cost. The resolution (git first,
// the build runner's commit variable second) is the shared one every Worker stamp uses, so a
// runner whose tree git cannot answer for still ships a build that can name its commit.
const commitIdentity = runningInPackageDir
  ? resolveCommitIdentity()
  : { commit: null, commitTime: null };

export default defineConfig({
  plugins: runningInPackageDir ? [tailwindcss(), sveltekit()] : [],
  define: {
    __MC_BUILD_COMMIT__: JSON.stringify(commitIdentity.commit ?? "unknown"),
    __MC_BUILD_COMMIT_TIME__: JSON.stringify(commitIdentity.commitTime),
    __MC_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // dev convenience: proxy /api to a running `wrangler dev`
  server: { proxy: { "/api": "http://localhost:8787" } },
  build: {
    // Source maps ship with the production bundle, so a stack frame in a member's browser names
    // the Svelte file, line and function rather than a hashed chunk and a minified identifier —
    // the sign-in crash of 2026-09 was diagnosed from `De.get (naXSyiPE.js:5:816)`, which says
    // nothing. magna-carta-web is an assets-only Worker, so the `.map` files are public assets;
    // the maps therefore carry mappings, paths and original names but NOT the source text
    // (owner ruling, 2026-09-07). A stack trace resolves in full; what a fetched map does not give
    // away is the code and its comments, which in this repository record design reasoning and
    // what is not yet built. The DevTools Sources panel on the deployed site shows the minified
    // chunk, not the original file — the price of keeping the text off the public internet.
    sourcemap: true,
    rollupOptions: { output: { sourcemapExcludeSources: true } },
  },
  // Web Workers (the upload hasher) bundle through their own Rollup pass, which does not inherit
  // the output options above; without this line their maps ship the source text.
  worker: { rollupOptions: { output: { sourcemapExcludeSources: true } } },
});
