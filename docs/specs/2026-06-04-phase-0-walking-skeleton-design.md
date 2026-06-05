# Phase 0 · slice 0·1 — Walking skeleton — design

**Status:** Accepted (design) · **Date:** 2026-06-04 · **Owner:** Trevor Goldsmith
**White-paper home:** _Build roadmap_ (Phase 0 — Foundation) · _Delivery model and application architecture_ (the Worker/SPA model) · _Development guidelines, CLAUDE.md, and ADRs_ (toolchain)
**ADRs:** ADR-0069 (Worker architecture — Hono-owns-Worker + `adapter-static` SPA via Workers Static Assets; refines the white paper's `adapter-cloudflare` note) · ADR-0070 (module-reference / barrel-file policy — first applied here). Sets the stage for, but does not implement, the API contract (ADR-0066–0067) and the §9 data conventions (ADR-0061–0065).

This spec is the implementation-grade detail for the **first buildable slice of Phase 0**: the "empty but production-shaped" skeleton every later slice sits on. It is deliberately thin — a single Cloudflare Worker that boots locally on Miniflare, serves a SvelteKit SPA plus a typed `/api/health` endpoint, runs `vp check`/`vp test`/`vp build` green, and passes `wrangler deploy --dry-run` in CI. It stands up the repo, the `vp` toolchain, the monorepo skeleton, and the deploy pipeline; it does **not** build domain logic. It does not restate the white paper — it specifies the layout, the Worker model, and the test/CI plan.

Decomposition context: Phase 0 splits into ordered slices — **0·1 walking skeleton (this spec)** → 0·2 §9 data primitives (already specced, ADR-0061–0065) → 0·3 firm-scoped DAL + chokepoints → 0·4 ledger core → 0·5 auth + RBAC skeleton → 0·6 fixtures harness → 0·7 telemetry baseline → 0·8 transactional email → 0·9 security/dependency agents. Each is its own spec → plan → build.

---

## 1. Scope & deliverable

**Deliverable:** an empty, production-shaped platform a feature can be built on — one deployable Worker serving a bare SPA + a typed health endpoint, with the toolchain, monorepo, local dev, tests, and CI all green.

**In scope:** repo + `vp` toolchain + monorepo skeleton; `apps/web` (bare SvelteKit SPA); `apps/worker` (Hono `@hono/zod-openapi` Worker owning `/api/*` and serving the SPA as static assets); minimal Cloudflare bindings (control-plane D1, one R2 bucket, one Queue) proven on Miniflare; Vitest + one Miniflare integration smoke test; GitHub Actions CI through `wrangler deploy --dry-run`; git init + repo hygiene; ADR-0069 + doc updates.

**Out of scope:** see §11. In one line: no §9 primitives, no DAL/`protected()`/audit, no ledger, no auth/RBAC, no design system, no fixtures engine, no telemetry pipeline, no email, no per-firm D1 provisioning/fleet runner, no real deploy, no Tauri, no public `api.` surface.

---

## 2. Worker architecture (ADR-0069)

**Decision:** the `@hono/zod-openapi` Worker is the deployment entry point; the SvelteKit SPA is built to **pure static assets** (`adapter-static`, `ssr=false`) and bound to that Worker via **Cloudflare Workers Static Assets**. One origin, one deploy. This refines the white paper's tech-stack note (`SvelteKit in SPA mode (adapter-cloudflare)`): `adapter-cloudflare` emits its own `_worker.js` and its docs require SvelteKit endpoints to own all routes, which would force the Hono/OpenAPI surface to nest awkwardly inside SvelteKit's lifecycle. Making Hono own the Worker is Cloudflare's documented full-stack pattern and the truer expression of the platform's API-first / code-as-contract design (the OpenAPI app is _the_ server, the SPA is a dumb static bundle — which also keeps the same bundle trivially loadable inside Tauri later). Recorded as **ADR-0069**, superseding the `adapter-cloudflare` wording.

**Routing config** (`apps/worker/wrangler.jsonc`):

```jsonc
{
  "name": "magna-carta-app",
  "main": "./src/index.ts",
  "compatibility_date": "2026-06-04", // pin to a current date at build; enable nodejs_compat only if needed
  "assets": {
    "directory": "../web/build",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"],
  },
}
```

**Request behavior (verified against Cloudflare docs, June 2026):**

- `/api/*` → always invokes the Worker (Hono) — billable.
- Any path matching a built static file → served directly from assets — free, never hits the Worker.
- Any other navigation → rewritten to `index.html` (HTTP 200) for the SPA's client-side router — free.
- The Hono catch-all (`app.get('*', c => c.env.ASSETS.fetch(c.req.raw))`) is the fallback path for non-navigation misses; SPA navigations are handled by `not_found_handling` before reaching it.

This makes Hono the unambiguous server, keeps SPA navigation off the Worker's bill, and needs no second deployable. The reserved `api.magnacarta.esq` public token surface (white paper _Delivery model_) is **not** built here.

---

## 3. Monorepo layout

`vp`/Vite Task runs monorepo tasks with caching + dependency-aware scheduling off the `package.json` graph + explicit `dependsOn`, configured in a single root `vite.config.ts`; it wraps pnpm via `pnpm-workspace.yaml` and prescribes no layout. The layout below names the platform's known categories up front (a Worker fleet, Rust crates, shared TS libs) so nothing is renamed later, while only _creating_ what 0·1 needs.

```
magna-carta/
  apps/
    web/            # SvelteKit SPA (adapter-static)                         ← created now
    worker/         # Hono @hono/zod-openapi Worker: /api/* + serves web     ← created now
    # desktop/      # Tauri 2 shell                                          ← reserved
  packages/
    tsconfig/       # shared TS config preset (@magna-carta/tsconfig)        ← created now
    # api-client/   # generated typed client + Svelte Query (Hey API)        ← reserved
    # money, ids, dal, fixtures, tokens, ui, core-wasm …                     ← reserved (per-slice)
  plugins/          # one Cloudflare Worker per integration (ports/adapters) ← reserved
  crates/           # Rust Cargo workspace (tauri, tantivy, doc/discovery)   ← reserved
  docs/  …          # existing
  vite.config.ts    # single root: dev/build/test/lint/format + run.tasks
  pnpm-workspace.yaml   # globs: apps/*, packages/*, plugins/*
  package.json      # private root · workspaces · packageManager pin
  tsconfig.base.json · .gitignore · .editorconfig · README.md
```

- **`apps/`** = the product app's halves (`web` + its `worker`), plus `desktop` later. The `worker` _is_ an app (it serves the SPA _and_ the API), not a peripheral.
- **`plugins/`** = the integration-Worker fleet (white paper _Plugin / Add-on system_) — kept out of `apps/` so it never becomes a grab-bag. Gets a placeholder `README.md` now to reserve intent.
- **`crates/`** = a real top-level Cargo workspace, reserved now so Rust + the WASM-wrapper packages aren't bolted on awkwardly later. Created with the first Rust work.
- **Internal scope:** `@magna-carta/*`.
- **Task graph:** `apps/worker`'s `build`/`dev`/`deploy` tasks declare **`dependsOn: ["apps/web#build"]`** so the SPA is built before the Worker serves/bundles `../web/build`.

---

## 4. Toolchain

- **`vp` is the single entry point** (`vp install / dev / build / test / check / run`). Past alpha (v0.1.23, May 2026), MIT, now Cloudflare-owned — strongly aligned with our Cloudflare runtime. Pre-1.0, so the version is **pinned**; the OSS fallback (pnpm + Vite + Vitest + Oxlint + Prettier, all MIT) stays one config-swap away and is documented in `CLAUDE.md`.
- **`vp check`** = **Oxlint** + **tsgolint** + formatter. Formatter is **Prettier (interim)** per the white paper; **Oxfmt** is beta (100% Prettier-conformant) and a fast-follow once GA — tracked, not adopted now.
- **Module references (ADR-0070):** no convenience barrel files — the **Oxlint no-barrel rule** is enabled in `vp check`, every package sets **`"sideEffects": false`** and exposes its public API via `package.json` **`exports`** (curated, flat); deep cross-package imports are forbidden. The `dependency-cruiser`/`ts-arch` boundary + `no-cycle` fitness functions are added with the coherence-tooling slice; the Oxlint rule + `exports`/`sideEffects` discipline start now.
- **Single root `vite.config.ts`** holds dev/build/test/lint/format + `run.tasks` with shared defaults.
- **Dependency versions are centralized in a pnpm `catalog:`** (in `pnpm-workspace.yaml`) — the single source of truth, exact-pinned. Every `package.json` references shared deps as `"<dep>": "catalog:"`, so a bump is one line and versions can't drift between packages; upgrades stay deliberate (and the propose-only dependency-upgrade agent edits one place). `vite`/`vitest` are aliased to the vite-plus bundles via `overrides`.
- **Node version + package manager** pinned via `packageManager` + `vp`.

---

## 5. The Worker app (`apps/worker`)

- **`OpenAPIHono`** (`@hono/zod-openapi` ≥ 1.0, Zod 4, OpenAPI 3.1 via `doc31()` — per the _API contract & route conventions_ spec, ADR-0066; confirm ≥ 1.0 / Zod 4 at build).
- **Routes — three, only:**
  - `GET /api/health` — Zod-typed response `{ status: 'ok', version: string, time: string }`; performs a trivial `SELECT 1` against the control-plane D1 binding so the binding is proven end-to-end on Miniflare. **Unauthenticated** (the one route that opts out of the future auth model).
  - `GET /api/openapi.json` — the emitted OpenAPI 3.1 document.
  - `*` (catch-all) — `c.env.ASSETS.fetch(c.req.raw)` (asset fallback; see §2).
- **Bindings declared in `wrangler.jsonc`** (minimal, to prove the wiring): control-plane **D1** (`DB_CONTROL`), one **R2** bucket (`R2`), one **Queue** (`QUEUE`). Only `DB_CONTROL` is exercised (the health `SELECT 1`); R2/Queue are declared so Miniflare provisions them and the binding shape is real.
- **Config gotcha baked in:** `vars` and `services` are **non-inheritable** across wrangler env blocks — when staging/prod envs are added, they are fully re-specified per env (not inherited from top level).
- **Boundary:** this slice does _not_ implement the route-metadata chokepoint or per-route auth from the API-contract spec (ADR-0067) — that needs the DAL + auth and lands in a later slice. `/api/health` is a bare `createRoute` with `authenticated: false`; the full metadata model is wired in 0·3+.

---

## 6. The web app (`apps/web`)

- **SvelteKit, `adapter-static`**, `export const ssr = false` + `export const prerender = false` (app-level), SPA `fallback: 'index.html'` — a true client-side-routed SPA, output to `apps/web/build`.
- One route that **fetches `/api/health`** (same-origin) and renders the returned status/version — proving the full path (SPA → same-origin `/api` → Hono → D1 → back).
- **No design system** — Tailwind v4 + DTCG tokens (Terrazzo) + shadcn-svelte + the Storybook/Histoire catalog are substantial (white paper _Design system, UI consistency & design quality_) and are their own slice. The skeleton ships unstyled/minimally-styled markup.

---

## 7. Local development

- **`vp dev`** → `wrangler dev` (Miniflare) with **local D1 + R2 + Queues**, serving the built SPA + the Worker together — the closest local mirror of production.
- Build ordering via the §3 task graph: `apps/web#build` runs before the Worker serves `../web/build`.
- **Convenience (optional, documented):** `vite dev` on `apps/web` for fast HMR while proxying `/api/*` to the running `wrangler dev` — not required for the slice.

---

## 8. CI (GitHub Actions)

On pull request and push to `main`:

1. `voidzero-dev/setup-vp` (pinned) → `vp install`
2. `vp check` (Oxlint + tsgolint + Prettier)
3. `vp test` (Vitest, single run)
4. `vp build` (web + server)
5. `wrangler deploy --dry-run` (validates the Worker + assets config without publishing)

**Green = done.** The single switch to real deploy — add the Cloudflare API token as a GitHub secret, drop `--dry-run`, optionally attach the route/domain — is documented for when the Cloudflare account + `magnacarta.esq` are ready. The **GitHub remote** is attached when the repo is created (external step; the workflow file ships now and activates on first push).

---

## 9. Testing baseline

- **Vitest** unit layer (a placeholder unit test proving the runner; real coverage grows per slice).
- **One Miniflare integration smoke test** exercising the real Worker: `GET /api/health` → asserts **200**, the JSON shape, and that the control-plane D1 `SELECT 1` succeeded. This doubles as proof that the bindings + local D1 wiring work.
- **Playwright** (e2e + visual regression) is **deferred** to the design-system slice — there is no real UI to assert yet. The integration smoke test covers the skeleton's behavior.
- Test data discipline (domain-write-path factories, _Synthetic data & fixtures_) does not apply yet — there is no domain. The fixtures harness is slice 0·6.

---

## 10. Source control & repo hygiene

- `git init`, default branch **`main`**.
- `.gitignore` — `node_modules`, `.svelte-kit`, `apps/web/build`, `dist`, `.wrangler`, `.vite`, coverage, OS cruft, and the existing `.playwright-mcp/` scraping artifacts.
- `.editorconfig`, root `README.md` (run/build/test quickstart pointing at `CLAUDE.md`).
- No commit is made by this design step (the repo is not yet a git repo, and commits happen when the user asks / as part of the build). The build slice performs the initial commit.

---

## 11. Out of scope (later Phase 0 slices)

§9 data primitives (`money`, ids + prefix registry, idempotency, outbox + relay, Drizzle schema + fleet-migration runner — 0·2); firm-scoped DAL, `protected()` field type, audit log (0·3); append-only ledger core (0·4); Better Auth + RBAC skeleton (0·5); the fixtures/synthetic-data engine (0·6); the telemetry/diagnostics pipeline (0·7); transactional email (0·8); security/dependency maintenance agents (0·9); per-firm D1 provisioning + the fleet runner; the route-metadata enforcement chokepoint + per-route auth (API-contract spec, ADR-0067); real production deploy; the public `api.magnacarta.esq` surface; the Tauri desktop shell; the design system.

---

## 12. Definition of done

- [ ] `vp check`, `vp test`, `vp build` green locally and in CI.
- [ ] `wrangler dev` (Miniflare) serves the SPA and `GET /api/health` returns `200` with the typed body and a successful control-plane D1 `SELECT 1`.
- [ ] `GET /api/openapi.json` emits a valid OpenAPI 3.1 document.
- [ ] The Miniflare integration smoke test passes.
- [ ] `wrangler deploy --dry-run` passes in CI.
- [ ] Repo initialized; `.gitignore`/`.editorconfig`/`README` present; CI workflow committed.
- [ ] ADR-0069 logged; `ROADMAP.md`, `CHANGELOG.md`, the `CLAUDE.md` command block, and the spec index updated in the same commit (golden rule #5); the white paper's `vp` status note touched (past-alpha + Cloudflare-owned).

---

## 13. Build-time verification checklist (golden rule #11)

Confirm current at implementation, not from memory:

- `vp` latest stable version + the `setup-vp` GitHub Action version to pin.
- `@hono/zod-openapi` ≥ 1.0 with Zod 4 + `doc31()` (aligns with the API-contract spec).
- `@sveltejs/adapter-static` current API (`ssr`/`prerender`/`fallback`) for a login-gated SPA on Workers Static Assets.
- Workers Static Assets config keys (`assets.directory`, `binding`, `not_found_handling`, `run_worker_first`) and the current `compatibility_date`.
- Miniflare local D1/R2/Queues support in the pinned Wrangler.
- Oxfmt GA status (flip from Prettier when it lands).
