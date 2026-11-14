import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type PluginOption, type Rollup } from "vite-plus";
import {
  resolveCommitIdentity,
  resolveRepositoryUrl,
} from "../../packages/build-identity/scripts/commit-identity.mjs";

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

// Where the source lives, so the Build Information panel can link a commit to the commit itself
// rather than only naming it. Resolved on the same terms as the commit above, and null when it
// cannot be established — the panel then renders the commit as plain text, never as a dead link.
const repositoryUrl = runningInPackageDir ? resolveRepositoryUrl() : null;

/*
 * What the production bundle keeps of its source (owner ruling, 2026-09-07). Three things decide
 * what a stack frame in a member's browser reads and what a stranger can learn from the assets:
 *
 * - `sourcemapExcludeSources`: the `.map` files carry mappings and paths, not the source text, so a
 *   frame resolves to the Svelte file and line while the code and its comments — which in this
 *   repository record design reasoning and what is not yet built — stay off the public internet.
 * - `mangle: false`: identifiers keep their names. The minifier's map does not record the original
 *   of a renamed identifier, so with renaming on a frame read `De.get (naXSyiPE.js:5:816)` even with
 *   the map beside it; the sign-in crash of 2026-09 was diagnosed from exactly that line. Compression
 *   and whitespace removal still apply, so the cost is the longer identifiers: measured on the
 *   2026-09-07 build, 897 KB to 1.12 MB gzipped over the whole app, per chunk a fraction of that.
 *   Keeping only module-level names (`mangle: { toplevel: false }`) costs 8% instead of 25% but
 *   leaves some frames renamed, which is the surprise this exists to remove. Readable names in the
 *   bundle are the point, not a leak: the logic was always recoverable.
 *
 * magna-carta-web is an assets-only Worker, so nothing here can be gated by a session.
 */
// Typed as the output options rather than inferred: an inferred literal type here made the
// type-checker give up comparing the whole config against `UserConfig` ("excessive stack depth"),
// which read as a plugins error two lines down.
const PRODUCTION_OUTPUT: Rollup.OutputOptions = {
  sourcemapExcludeSources: true,
  minify: { mangle: false, compress: true, codegen: { removeWhitespace: true } },
};

// The Tailwind and SvelteKit plugins are typed against the Vite release they were built for, not
// the one vite-plus re-exports. The two plugin types are the same shape at runtime, but comparing
// them structurally runs the type-checker past its depth limit ("excessive stack depth"), so the
// array is asserted to the vite-plus type rather than compared.
const PLUGINS = (runningInPackageDir ? [tailwindcss(), sveltekit()] : []) as unknown as PluginOption[];

export default defineConfig({
  plugins: PLUGINS,
  define: {
    __MC_BUILD_COMMIT__: JSON.stringify(commitIdentity.commit ?? "unknown"),
    __MC_BUILD_COMMIT_TIME__: JSON.stringify(commitIdentity.commitTime),
    __MC_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __MC_SOURCE_REPOSITORY__: JSON.stringify(repositoryUrl),
  },
  // dev convenience: proxy /api to a running `wrangler dev`
  server: {
    proxy: { "/api": "http://localhost:8787" },
    // The WebAssembly engines (packages/pdf, email, pdf-compose and the rest) are fetched by URL
    // from their own package directories, which SvelteKit's default serving list leaves out; without
    // this the development server answers 403 and every in-browser engine fails to load.
    fs: { allow: ["../../packages"] },
  },
  build: {
    // Source maps ship with the production bundle (PRODUCTION_OUTPUT above says what they carry).
    sourcemap: true,
    rollupOptions: { output: PRODUCTION_OUTPUT },
  },
  // Web Workers (the upload hasher) bundle through their own Rollup pass, which does not inherit
  // the output options above; without this line their maps ship the source text.
  worker: { rollupOptions: { output: PRODUCTION_OUTPUT } },
});
