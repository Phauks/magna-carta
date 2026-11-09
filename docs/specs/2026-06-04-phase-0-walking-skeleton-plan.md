# Phase 0 · slice 0·1 — Walking Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an empty, production-shaped platform — one Cloudflare Worker that serves a bare SvelteKit SPA plus a typed `/api/health` endpoint (proving SPA → same-origin `/api` → Hono → control-plane D1), with the `vp` toolchain, monorepo, local Miniflare dev, tests, and CI all green through `wrangler deploy --dry-run`.

**Architecture:** Hono (`@hono/zod-openapi`) owns the Worker and `/api/*`; the SvelteKit SPA is built with `adapter-static` and bound as Cloudflare Workers Static Assets (`not_found_handling: single-page-application`, `run_worker_first: ["/api/*"]`). One origin, one deploy. pnpm workspace managed by `vp`; `apps/web` + `apps/worker` + `packages/tsconfig`, with `plugins/` and `crates/` reserved. (Spec: `docs/specs/2026-06-04-phase-0-walking-skeleton-design.md`; ADR-0069 Worker architecture, ADR-0070 module-reference policy.)

**Tech Stack:** Vite+ (`vp`) · pnpm · TypeScript · Svelte 5 / SvelteKit (`adapter-static`) · Hono + `@hono/zod-openapi` (Zod 4, OpenAPI 3.1 `doc31`) · Cloudflare Workers + Static Assets + D1/R2/Queues · Wrangler + Miniflare · Vitest · GitHub Actions.

**Critical discipline (golden rule #11):** the toolchain is pre-1.0/fast-moving. Every task that pins a version or uses a CLI surface includes a **verify-current** step. Do not assume a command/flag — confirm it against `--help` or current docs, then use it. Where this plan shows a command for an alpha tool (`vp`, `setup-vp`), treat the shown form as the expected one and reconcile against `vp --help` output from Task 0.

**Module-reference discipline (ADR-0070):** no convenience barrels. Each package's public API is its `package.json` `exports` + `"sideEffects": false`; import specific source modules within a package; never deep-import another package's internals. The Oxlint no-barrel rule is enabled in Task 1.

**Dependency management (pnpm catalog):** all dependency versions are pinned exactly and centralized in the `pnpm-workspace.yaml` `catalog:` — the single source of truth. Every `package.json` references shared deps as `"<dep>": "catalog:"`, never an inline version, so a bump is a one-line edit in the catalog and no two packages can drift to different versions. The catalog already holds the pins for everything this plan creates (toolchain, Cloudflare, Hono/Zod, SvelteKit). **Where a task snippet below shows a `<PIN>`/inline version, write `"catalog:"` instead** (the version lives in the catalog; add it there if missing). `vite`/`vitest` are aliased to the vite-plus bundles via `overrides`, not the catalog.

---

## File Structure

Created in this slice:

```
magna-carta/
  package.json                 # private root: workspaces, packageManager pin, scripts
  pnpm-workspace.yaml          # apps/*, packages/*, plugins/*
  vite.config.ts               # single root: test/lint/format/run.tasks + shared defaults
  tsconfig.base.json           # strict TS base
  tsconfig.json                # root solution refs (optional)
  .gitignore · .editorconfig · README.md · .node-version (or .nvmrc)
  oxlintrc.json                # lint config incl. no-barrel rule  (name verified in Task 0)
  .github/workflows/ci.yml     # CI: vp check/test/build + wrangler dry-run
  packages/
    tsconfig/                  # @magna-carta/tsconfig — shared TS presets
      package.json · base.json · worker.json · svelte.json
  plugins/README.md            # reserves the integration-Worker fleet home
  apps/
    web/                       # SvelteKit SPA (adapter-static)
      package.json · svelte.config.js · vite.config.ts · tsconfig.json
      src/app.html · src/http/routes/+layout.ts · src/http/routes/+page.svelte
      src/lib/health.ts        # tiny typed fetch of /api/health
    worker/                    # Hono @hono/zod-openapi Worker
      package.json · wrangler.jsonc · tsconfig.json · vite.config.ts (vitest)
      src/index.ts             # OpenAPIHono app: /api/health, /api/openapi.json, asset fallback
      src/http/app.ts               # the app factory (testable without the Worker entry)
      test/health.test.ts      # Miniflare integration smoke test
```

Reserved (NOT created now): `apps/desktop`, `packages/api-client|money|ids|dal|fixtures|tokens|ui|core-wasm`, `plugins/<vendor>`, `crates/`.

---

## Task 0: Toolchain verification & version pinning

**Files:** none (records findings into the later config files). Produces a short note of pinned versions used in Tasks 1–6.

- [ ] **Step 1: Confirm `vp` is installed and capture its CLI surface**

Run: `vp --version` and `vp --help` (install per current VoidZero docs if absent — Vite+ is MIT, past-alpha v0.1.23+).
Expected: a version ≥ `0.1.23`; a help listing including `install`, `dev`, `build`, `test`, `check`, `run`. **Record the exact subcommand names/flags** — if any differ from this plan (e.g. `vp lint`/`vp fmt` vs `vp check`), use the actual ones and note the mapping.

- [ ] **Step 2: Pin the package manager + Node**

Run: `pnpm --version`, `node --version`. Record both. These become `packageManager` in the root `package.json` and `.node-version`.

- [ ] **Step 3: Verify current versions of the runtime libraries**

Check (npm/docs) and record exact versions to install:

- `@hono/zod-openapi` (must be ≥ 1.0 for Zod 4 + `doc31`), `hono`, `zod` (v4).
- `@sveltejs/kit`, `svelte` (5.x), `@sveltejs/adapter-static`, `@sveltejs/vite-plugin-svelte`.
- `wrangler` (confirm Miniflare local D1/R2/Queues support) and `@cloudflare/workers-types`.
- `voidzero-dev/setup-vp` GitHub Action tag.
  Expected: a written list of `name@version` pins. **If `@hono/zod-openapi` < 1.0 / no Zod 4**, stop and flag (the API-contract spec assumes ≥ 1.0).

- [ ] **Step 4: Verify the Workers Static Assets config keys**

Confirm against current Cloudflare docs that `assets.directory`, `assets.binding`, `assets.not_found_handling: "single-page-application"`, and `assets.run_worker_first` are current keys, and the current `compatibility_date` to use.
Expected: keys confirmed; a `compatibility_date` value chosen (e.g. today's date).

No commit (no repo yet).

---

## Task 1: Repo + root scaffold

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `vite.config.ts`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`, `.node-version`, `README.md`, `oxlintrc.json`, `packages/tsconfig/*`, `plugins/README.md`

- [ ] **Step 1: Initialize git**

Run:

```bash
git init
git branch -M main
```

Expected: empty repo on `main`.

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
.svelte-kit/
apps/web/build/
dist/
.wrangler/
.vite/
coverage/
*.log
.DS_Store
# pre-existing scraping artifacts
.playwright-mcp/
docs/research/trust-rules/_tmp_*
```

- [ ] **Step 3: Write `.editorconfig`**

```ini
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
```

- [ ] **Step 4: Write `.node-version`** — the Node version recorded in Task 0 (e.g. `22`).

- [ ] **Step 5: Write root `package.json`** (private, workspaces, pin from Task 0)

```json
{
  "name": "magna-carta",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@<PIN_FROM_TASK_0>",
  "workspaces": ["apps/*", "packages/*", "plugins/*"],
  "scripts": {
    "check": "vp check",
    "dev": "vp dev",
    "build": "vp build",
    "test": "vp test"
  }
}
```

(If `vp` requires `pnpm-workspace.yaml` rather than the `workspaces` key, keep both — pnpm reads the yaml.)

- [ ] **Step 6: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "plugins/*"
```

- [ ] **Step 7: Write `tsconfig.base.json`** (strict; the shared base packages extend)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 8: Write `oxlintrc.json` with the no-barrel rule (ADR-0070)**

Confirm the exact rule id via `vp`/Oxlint docs in Task 0; the intent:

```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "rules": {
    "import/no-barrel-file": "error"
  }
}
```

If Oxlint's no-barrel rule id differs, use the actual id and note it. (Cross-package boundary + no-cycle via dependency-cruiser is a later coherence-tooling slice — not built here.)

- [ ] **Step 9: Write root `vite.config.ts`** (single config home; `run.tasks` graph)

```ts
import { defineConfig } from "vite";

export default defineConfig({
  // vp reads test/lint/format defaults from here; run.tasks declares the monorepo graph.
  // Confirm the exact `run`/`test` config shape against `vp` docs (Task 0).
  // @ts-expect-error vp augments the Vite config with `run`; type may not be published yet
  run: {
    tasks: {
      // apps/worker build/dev/deploy depend on the SPA being built first
      "apps/worker#build": { dependsOn: ["apps/web#build"] },
      "apps/worker#dev": { dependsOn: ["apps/web#build"] },
    },
  },
});
```

If `vp`'s task-graph config lives elsewhere (e.g. per-package `dependsOn` in `package.json`), implement it the documented way and delete this block.

- [ ] **Step 10: Write `packages/tsconfig` (`@magna-carta/tsconfig`)**

`packages/tsconfig/package.json`:

```json
{
  "name": "@magna-carta/tsconfig",
  "version": "0.0.0",
  "private": true,
  "sideEffects": false,
  "exports": {
    "./base": "./base.json",
    "./worker": "./worker.json",
    "./svelte": "./svelte.json"
  }
}
```

`packages/tsconfig/base.json`:

```json
{ "extends": "../../tsconfig.base.json" }
```

`packages/tsconfig/worker.json`:

```json
{
  "extends": "./base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types"], "lib": ["ES2022"] }
}
```

`packages/tsconfig/svelte.json`:

```json
{
  "extends": "./base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM", "DOM.Iterable"] }
}
```

- [ ] **Step 11: Write `plugins/README.md`** (reserve the fleet home)

```markdown
# plugins/

One Cloudflare Worker per integration (ports-and-adapters — white paper _Plugin / Add-on system_).
Empty until the first integration slice. Do not put product apps here (those live in `apps/`).
```

- [ ] **Step 12: Write `README.md`** (quickstart pointing at CLAUDE.md)

```markdown
# Magna Carta

Legal practice-management platform on Cloudflare. See [`CLAUDE.md`](CLAUDE.md) and [`docs/`](docs/).

## Quickstart

- `vp install` — install deps
- `vp dev` — run locally (Miniflare: local D1/R2/Queues) at the printed URL
- `vp check` — format + lint + type-check
- `vp test` — unit + integration tests
- `vp build` — build web + worker
```

- [ ] **Step 13: Install and verify the empty workspace**

Run: `vp install` then `vp check`.
Expected: install succeeds; `vp check` passes (no source yet → trivially green, or only config files linted).

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo root (vp, pnpm workspace, tsconfig, oxlint no-barrel)"
```

---

## Task 2: `apps/web` — bare SvelteKit SPA

**Files:**

- Create: `apps/web/package.json`, `apps/web/svelte.config.js`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/app.html`, `apps/web/src/routes/+layout.ts`, `apps/web/src/routes/+page.svelte`, `apps/web/src/lib/health.ts`

- [ ] **Step 1: `apps/web/package.json`** (versions from Task 0)

```json
{
  "name": "@magna-carta/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "scripts": { "build": "vite build", "dev": "vite dev", "check": "svelte-check" },
  "devDependencies": {
    "@sveltejs/kit": "<PIN>",
    "@sveltejs/adapter-static": "<PIN>",
    "@sveltejs/vite-plugin-svelte": "<PIN>",
    "svelte": "<PIN>",
    "svelte-check": "<PIN>",
    "vite": "<PIN>"
  }
}
```

- [ ] **Step 2: `apps/web/svelte.config.js`** (adapter-static, SPA fallback)

```js
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ fallback: "index.html", pages: "build", assets: "build" }),
  },
};
```

- [ ] **Step 3: `apps/web/vite.config.ts`**

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  // dev convenience: proxy /api to a running `wrangler dev` (optional, see Task 4)
  server: { proxy: { "/api": "http://localhost:8787" } },
});
```

- [ ] **Step 4: `apps/web/tsconfig.json`**

```json
{
  "extends": "@magna-carta/tsconfig/svelte",
  "compilerOptions": { "allowJs": true, "moduleResolution": "bundler" },
  "include": ["src/**/*.ts", "src/**/*.svelte", ".svelte-kit/types/**/*.ts"]
}
```

(If SvelteKit generates its own `.svelte-kit/tsconfig.json` to extend, extend that and add the base via `compilerOptions`. Verify after first `vite dev`/`svelte-kit sync`.)

- [ ] **Step 5: `apps/web/src/app.html`** (standard SvelteKit shell)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body>
    %sveltekit.body%
  </body>
</html>
```

- [ ] **Step 6: `apps/web/src/routes/+layout.ts`** (true SPA — no SSR/prerender)

```ts
export const ssr = false;
export const prerender = false;
```

- [ ] **Step 7: `apps/web/src/lib/health.ts`** (typed fetch — specific module, no barrel)

```ts
export type Health = { status: "ok"; version: string; time: string };

export async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
}
```

- [ ] **Step 8: `apps/web/src/routes/+page.svelte`** (Svelte 5 runes; renders health)

```svelte
<script lang="ts">
  import { fetchHealth, type Health } from '$lib/health.ts'

  let state = $state<{ kind: 'loading' } | { kind: 'ok'; data: Health } | { kind: 'error'; msg: string }>({ kind: 'loading' })

  $effect(() => {
    fetchHealth()
      .then((data) => (state = { kind: 'ok', data }))
      .catch((e) => (state = { kind: 'error', msg: String(e) }))
  })
</script>

<main>
  <h1>Magna Carta</h1>
  {#if state.kind === 'loading'}
    <p>Checking API…</p>
  {:else if state.kind === 'ok'}
    <p>API: {state.data.status} · v{state.data.version} · {state.data.time}</p>
  {:else}
    <p>API error: {state.msg}</p>
  {/if}
</main>
```

- [ ] **Step 9: Build the SPA**

Run: `pnpm --filter @magna-carta/web build` (or `vp build` filtered — confirm syntax in Task 0).
Expected: `apps/web/build/index.html` and assets exist; `apps/web/build/index.html` is the SPA fallback.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): bare SvelteKit SPA (adapter-static) calling /api/health"
```

---

## Task 3: `apps/worker` — Hono Worker (TDD)

**Files:**

- Create: `apps/worker/package.json`, `apps/worker/wrangler.jsonc`, `apps/worker/tsconfig.json`, `apps/worker/vitest.config.ts`, `apps/worker/src/app.ts`, `apps/worker/src/index.ts`, `apps/worker/test/health.test.ts`

- [ ] **Step 1: `apps/worker/package.json`** (versions from Task 0)

```json
{
  "name": "@magna-carta/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "scripts": {
    "build": "wrangler deploy --dry-run --outdir dist",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "dependencies": { "hono": "<PIN>", "@hono/zod-openapi": "<PIN_GTE_1>", "zod": "<PIN_V4>" },
  "devDependencies": {
    "wrangler": "<PIN>",
    "@cloudflare/workers-types": "<PIN>",
    "@cloudflare/vitest-pool-workers": "<PIN>",
    "vitest": "<PIN>"
  }
}
```

(`@cloudflare/vitest-pool-workers` runs Vitest inside Miniflare so the integration test gets real bindings — confirm current package + config in Task 0.)

- [ ] **Step 2: `apps/worker/wrangler.jsonc`** (Approach-B routing + bindings)

```jsonc
{
  "name": "magna-carta-app",
  "main": "./src/index.ts",
  "compatibility_date": "<FROM_TASK_0>",
  "assets": {
    "directory": "../web/build",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"],
  },
  "d1_databases": [
    {
      "binding": "DB_CONTROL",
      "database_name": "magna-carta-control",
      "database_id": "local-dev-placeholder",
    },
  ],
  "r2_buckets": [{ "binding": "R2", "bucket_name": "magna-carta-files" }],
  "queues": { "producers": [{ "binding": "QUEUE", "queue": "magna-carta-jobs" }] },
}
```

Note: `database_id` is a placeholder for local/dry-run; real provisioning (`wrangler d1 create`) is the deploy switch. Verify `--dry-run` accepts the placeholder in Task 6; if it rejects, create a throwaway D1 and paste its id.

- [ ] **Step 3: `apps/worker/tsconfig.json`**

```json
{ "extends": "@magna-carta/tsconfig/worker", "include": ["src/**/*.ts", "test/**/*.ts"] }
```

- [ ] **Step 4: Write the failing integration test** (`apps/worker/test/health.test.ts`)

```ts
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  // prove the control-plane D1 binding exists and is queryable in Miniflare
  await env.DB_CONTROL.prepare("SELECT 1").first();
});

describe("GET /api/health", () => {
  it("returns 200 with the typed body", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok" });
    expect(typeof (body as { version: string }).version).toBe("string");
    expect(typeof (body as { time: string }).time).toBe("string");
  });

  it("emits an OpenAPI 3.1 document", async () => {
    const res = await SELF.fetch("https://example.com/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect((doc as { openapi: string }).openapi).toMatch(/^3\.1/);
  });
});
```

Also write `apps/worker/vitest.config.ts` per `@cloudflare/vitest-pool-workers` docs (points at `wrangler.jsonc` so the test gets the real bindings). Confirm exact config shape in Task 0/at write time.

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/worker test`
Expected: FAIL — `src/index.ts`/`src/http/app.ts` not implemented (module not found / 404).

- [ ] **Step 6: Implement the app factory** (`apps/worker/src/app.ts`)

```ts
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

export type Bindings = {
  ASSETS: Fetcher;
  DB_CONTROL: D1Database;
  R2: R2Bucket;
  QUEUE: Queue;
};

const Health = z
  .object({ status: z.literal("ok"), version: z.string(), time: z.string() })
  .openapi("Health");

const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  responses: {
    200: { description: "Service health", content: { "application/json": { schema: Health } } },
  },
});

export function createApp() {
  const app = new OpenAPIHono<{ Bindings: Bindings }>();

  app.openapi(healthRoute, async (c) => {
    // prove the control-plane D1 binding works end-to-end
    await c.env.DB_CONTROL.prepare("SELECT 1").first();
    // skeleton timestamp; Temporal.Instant adoption is §9.1 / a later slice
    return c.json({ status: "ok" as const, version: "0.0.0", time: new Date().toISOString() }, 200);
  });

  app.doc31("/api/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Magna Carta API", version: "0.0.0" },
  });

  // everything not handled above falls through to static assets (SPA)
  app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
```

- [ ] **Step 7: Implement the Worker entry** (`apps/worker/src/index.ts`)

```ts
import { createApp } from "./app.ts";

export default createApp();
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/worker test`
Expected: PASS (both health and openapi cases).

- [ ] **Step 9: Type-check & lint**

Run: `vp check`
Expected: PASS (no barrels, strict types satisfied).

- [ ] **Step 10: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): Hono @hono/zod-openapi app — /api/health (D1 SELECT 1) + openapi.json + asset fallback"
```

---

## Task 4: Local dev wiring (Miniflare end-to-end)

**Files:** none new (exercises Task 1–3 output; may add a `dev` task note to `vite.config.ts`).

- [ ] **Step 1: Build the SPA so the Worker has assets to serve**

Run: `pnpm --filter @magna-carta/web build`
Expected: `apps/web/build/` populated.

- [ ] **Step 2: Run the Worker locally with Miniflare**

Run: `pnpm --filter @magna-carta/worker dev` (i.e. `wrangler dev`).
Expected: a local URL (default `http://localhost:8787`); Miniflare provisions local D1/R2/Queues from the bindings.

- [ ] **Step 3: Verify the API end-to-end**

Run: `curl -s http://localhost:8787/api/health`
Expected: `{"status":"ok","version":"0.0.0","time":"…"}` (HTTP 200 — the D1 `SELECT 1` ran).
Run: `curl -s http://localhost:8787/api/openapi.json | head`
Expected: a JSON doc with `"openapi":"3.1.0"`.

- [ ] **Step 4: Verify the SPA + SPA-fallback**

Open `http://localhost:8787/` in a browser → the page renders "API: ok · v0.0.0 · …".
Open `http://localhost:8787/some/deep/route` → still serves the SPA (200, `index.html`), not a 404.
Expected: both succeed (SPA fallback via `not_found_handling`).

- [ ] **Step 5: Verify the one-command dev path**

Run: `vp dev`
Expected: builds `apps/web` first (task graph `dependsOn`), then serves the Worker; the URL behaves as Steps 3–4. If `vp dev` does not yet chain web→worker, document the two-command sequence in `README.md` and the `dependsOn` config to revisit.

- [ ] **Step 6: Commit** (only if files changed, e.g. README dev notes)

```bash
git add -A
git commit -m "chore(dev): document/verify local Miniflare dev (SPA + /api end-to-end)"
```

---

## Task 5: CI — GitHub Actions through dry-run deploy

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`** (pins from Task 0)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: voidzero-dev/setup-vp@<PIN_FROM_TASK_0>
      - run: vp install
      - run: vp check
      - run: vp test
      - run: vp build
      - name: Validate Worker + assets config (no publish)
        run: pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run
```

If `setup-vp` is unavailable, fall back to `pnpm/action-setup` + `actions/setup-node` (from `.node-version`) + `npm i -g @vite-plus/cli@<PIN>` (confirm the published package name in Task 0).

- [ ] **Step 2: Verify the pipeline locally (act as CI)**

Run each line locally in order: `vp install && vp check && vp test && vp build && pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run`.
Expected: all succeed; the dry-run prints the would-be upload (Worker + assets) without publishing. If dry-run rejects the placeholder `database_id`, create a throwaway D1 (`wrangler d1 create magna-carta-control`) and paste its id into `wrangler.jsonc`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml apps/worker/wrangler.jsonc
git commit -m "ci: vp check/test/build + wrangler dry-run deploy"
```

---

## Task 6: In-commit doc updates (golden rule #5) & finalize

**Files:**

- Modify: `CLAUDE.md` (the Commands block), `CHANGELOG.md`, `ROADMAP.md`, `docs/Magna-Carta-White-Paper.md` (the `vp` status note)

- [ ] **Step 1: Update `CLAUDE.md` Commands block**

Replace the "Phase 0 scaffold is not yet built" note and command stubs with the now-real commands (`vp install/dev/check/test/build`, `wrangler dev`, the filtered package commands), reflecting `apps/web` + `apps/worker`. Keep it accurate to what Tasks 1–5 actually created.

- [ ] **Step 2: Update `CHANGELOG.md`**

Add an entry under `[Unreleased]` (Keep-a-Changelog format): "Phase 0 · slice 0·1 walking skeleton — monorepo + `vp` toolchain; Hono Worker serving the SvelteKit SPA + `/api/health`; local Miniflare dev; CI through `wrangler deploy --dry-run`. (ADR-0069, ADR-0070.)"

- [ ] **Step 3: Update `ROADMAP.md`**

Move slice 0·1 from "Now/Next" to "Recently shipped"; set "Now" to the next slice (0·2 — §9 data primitives, already specced).

- [ ] **Step 4: Update the white paper `vp` status note**

In _Development guidelines, CLAUDE.md, and ADRs_ (and the stack-at-a-glance if needed), update the `vp` description from "alpha pending an early-2026 public preview" to "past alpha (v0.1.x), MIT, Cloudflare-owned (VoidZero acquisition, 2026)" — keep the OSS-fallback framing.

- [ ] **Step 5: Run the full gate one more time**

Run: `vp check && vp test && vp build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: update CLAUDE.md commands, changelog, roadmap, white-paper vp status (slice 0·1)"
```

---

## Task 7: Definition-of-done verification

**Files:** none.

- [ ] **Step 1: Walk the spec §12 DoD checklist and confirm each item**, capturing evidence (command + output):
  - `vp check`, `vp test`, `vp build` green locally.
  - `wrangler dev`: `GET /api/health` → 200 typed body + D1 `SELECT 1`; SPA + deep-route fallback render.
  - `GET /api/openapi.json` → valid 3.1 doc.
  - Miniflare integration test passes.
  - `wrangler deploy --dry-run` passes.
  - Repo initialized; `.gitignore`/`.editorconfig`/`README` present; CI workflow committed.
  - ADR-0069/0070 logged (already); CLAUDE.md/ROADMAP/CHANGELOG/white-paper updated.

- [ ] **Step 2: Confirm reserved homes exist and are documented** — `plugins/README.md` present; `crates/` intentionally absent (documented in the spec). No empty domain packages created (YAGNI).

- [ ] **Step 3: Final commit if any evidence/notes were added**

```bash
git add -A
git commit -m "chore: slice 0·1 walking skeleton — DoD verified"
```

---

## Notes for the implementer

- **Verify before you type** for `vp`, `setup-vp`, `@hono/zod-openapi` (≥1.0/Zod 4), `adapter-static`, and Workers Static Assets keys — these were correct at design time (June 2026) but are fast-moving. Task 0 pins them; later tasks consume the pins.
- **No barrels (ADR-0070):** every `package.json` here sets `"sideEffects": false` and an `exports` map; imports target specific modules (`$lib/health.ts`, `./app.ts`). Do not add an `index.ts` re-export hub.
- **Real deploy is deliberately out of scope** — CI stops at `--dry-run`. Flipping to real deploy (CF API token secret + drop `--dry-run` + attach domain) is a one-line follow-up when the account is ready.
- **Scope discipline:** if a step tempts you toward auth, the DAL, the ledger, the design system, or §9 primitives — stop. Those are later Phase 0 slices (spec §11).
