# file-surface-web

**Scope:** Build the user-facing **file surface** — the shared multi-view shell + the headerless file
body (collection region + capability detail pane) — and stand it up on **real data**, Matter host first.
This is "stream three" of the Matter File Manager design, built on top of the app shell rather than
waiting for it to land on `main`.

Design (converging into one home):

- [`docs/specs/2026-07-09-matter-file-manager-design.md`](../specs/2026-07-09-matter-file-manager-design.md) — the approved matter surface (shared shell, modular views, streams).
- [`docs/specs/2026-07-09-file-inspector-workbench-design.md`](../specs/2026-07-09-file-inspector-workbench-design.md) — the headerless-body / hosts / `FileSource` reframe. The inspector is the Tools host of the same surface; its capability pane is the shared detail panel.

## Base & integration

- Branched from `slice-0-7b-app-shell` (the only branch with `apps/web`).
- Merged `file-manager-primitives` (Dropzone / Tree / FileIcon / Breadcrumb / ContextMenu) — reuse, not reinvent.
- Merged `file-manager-contract` (folders.list, enriched FileSummary, uploads.get, dev R2 upload route). Generated api-client conflicts were resolved by regeneration, not hand-merge (`emit-openapi` → `generate-client`). One-time wasm build (`decryption-core`) was needed for the worker to load; do the same in any fresh worktree.

## Progress

- **Shared multi-view shell + persisted-preference primitive — built.** `apps/web/src/lib/view-shell/` (headerless: `createViewShell` controller + `view-switch` + `view-shell-body` + pure types; registrable views, regions record, shared selection) and `apps/web/src/lib/preferences/` (`createPersistedPreference` over a codec). Six preference call sites migrated onto the primitive; `/tools` ported onto the shell as the proving consumer. `appearance-axes` deliberately NOT migrated (theme persists through the design-system boot-script seam — one home). svelte-check clean, web unit tests green.

## Real-data path (no fixtures baked into the UI)

The surface binds to the typed `@magna-carta/api-client` TanStack Query hooks. Real-vs-mock is a transport
choice behind that seam — nothing to rip out later.

1. Contract integration (above) so the folder browser + upload outcome have a contract.
2. `seed-dev-firm` script — firm + matter + files + user, so there is real data.
3. Login page + Better Auth dev session, so typed calls carry a session instead of 401.
4. `vp run worker-dev` (Miniflare local D1/R2/Queues) — real backend locally.
5. Build the **Matter Files host** against that real data. The **Tools host** reuses the same body with an
   ephemeral `FileSource` swapped in once its scratch backend exists; until then its gaps are typed absence,
   not fixtures.

## Running locally

Stand up real seeded data and sign in — the whole loop is three steps:

1. **Start the local app** (Miniflare-backed D1/R2/Queues):

   ```
   vp run worker-dev
   ```

2. **Seed the dev firm** (in a second terminal) — provisions a firm, an owner user, a matter, two
   folders, and a handful of files (including a re-scan-flagged one and a quarantined one), then
   prints the credentials:

   ```
   pnpm run seed-dev-firm
   ```

   The command first triggers the scheduled handler (`/cdn-cgi/handler/scheduled`) to apply the
   control-plane migrations — wrangler dev does not auto-run Cron, so a fresh Miniflare database has
   no schema and the seed would otherwise 500 with `no such table: firm` — then calls the
   development-only seed route `POST /api/__dev/seed` (`apps/worker/src/routes/dev-seed.ts`). That
   route is gated exactly like the dev R2 upload route — it serves only when the real R2 S3
   credentials are absent, so it is a bare 404 in production and is never in the OpenAPI contract.
   Both steps are idempotent (a re-run resumes the same tenant). Override the Worker URL with
   `WORKER_URL=…` if it is not on the wrangler default (`http://127.0.0.1:8787`).

3. **Sign in.** Open the app, land on `/login`, and enter the printed credentials
   (`owner@dev.magnacarta.test` / `local-dev-password`). The `(app)` route group's `+layout.ts` guard
   sends unauthenticated visitors to `/login`; on success Better Auth sets the session cookie and the
   typed API calls carry it instead of 401-ing.

## E2E tests

Playwright drives the login flow and the `(app)` session guard against a REAL running Worker
(Miniflare-backed D1/R2/Queues), covering behaviour the node-environment unit tests cannot reach —
guard redirect, successful sign-in + session cookie, bad-credentials error, and the open-redirect
(`next`) guard. Run:

```
pnpm --filter @magna-carta/web run test:e2e
```

Config: `apps/web/e2e/playwright.config.ts`. Its `webServer` boots `vp run worker-dev` (builds the SPA,
then wrangler dev on `http://localhost:8787`) — allow ~2 min on a cold start. A `setup` project runs
before the specs: it triggers the scheduled handler (`/cdn-cgi/handler/scheduled`) to apply the
control-plane migrations (wrangler dev does not auto-run Cron, so a fresh Miniflare D1 has no schema),
then POSTs to `/api/__dev/seed` and writes the tenant to `apps/web/e2e/.seeded/credentials.json` (git-
ignored) for the specs. Chromium only. Deliberately NOT part of `vp test` — the worker-dev boot is
heavy, the same reason the design-system visual-regression sweep is separate. If Chromium is missing,
`pnpm --filter @magna-carta/web exec playwright install chromium`.

## Files expected to be touched

- `apps/web/src/lib/` — the multi-view shell (regions record, view registry, shared selection), the file
  body (collection region + capability detail pane), the persisted-preference primitive (extracted; 5 call
  sites migrate).
- `apps/web/src/routes/(app)/matters/[id]/files/` (Matter host) and `apps/web/src/routes/(app)/tools/file-inspector/` (Tools host).
- `apps/web/src/routes/(app)/tools/` — port `/tools` onto the shell as the proving consumer.
- A `seed-dev-firm` script + a dev login route.
- On contract integration: generated `apps/worker/openapi/openapi.json`, `packages/api-client/src/*.gen.ts`.

**Never edited:** `packages/file-manager/src/ingest-core.ts`.

## Overlaps

- Owns `apps/web` file-surface work; coordinate with `slice-0-7b-app-shell` (shared `apps/web`) — this branch
  is built on top of its tip.
- Consumes `file-manager-contract` and `file-manager-primitives`; those land to `main` independently.
