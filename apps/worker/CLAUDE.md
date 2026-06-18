# @magna-carta/worker — CLAUDE.md

**Purpose.** The Cloudflare Worker that serves the API and hosts the platform's background machinery: the
Hono + `@hono/zod-openapi` app, the single enforcement **chokepoint** every `/api/v1` route traverses
(tenancy → authn → RBAC → idempotency → rate-limit), the queue consumers, the Cron-driven sweeps, and
the codebase's first Durable Object. Business logic lives in the domain packages; this app is the
composition root and the runtime edge — it wires ports (auth, presigner, scan, email, telemetry) and
routes requests through the chokepoint into those packages.

**White paper:** _Authentication & encryption_, _Core domain_, _Observability & diagnostics_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). **Deploy runbook:**
[`docs/conventions/operations.md`](../../docs/conventions/operations.md). **API standard:**
[`docs/conventions/api.md`](../../docs/conventions/api.md).

## Key files / entry points

- `src/index.ts` — the `ExportedHandler`: `fetch` (the Hono app), `scheduled` (Cron → sweep router), and
  `queue` (routes each batch by `batch.queue` name to its consumer). Also re-exports every Durable Object
  class so the runtime can instantiate the classes named in `wrangler.jsonc`.
- `src/app.ts` — `createApp()` + the `Bindings` env shape (the no-barrel single home for the env type).
  Builds the chokepoint once over the real ports and registers every route through it.
- `src/chokepoint/` — the ordered enforcement middleware + its ports; `defineOpenAPIRoute` carries each
  route's `RouteMeta`, and `chokepointMiddleware` enforces it. No per-handler auth discipline.
- `src/routes/` — one module per surface; each is a route-bundle registered in `app.ts`.
- `src/downloads/` — the async bulk-download build (the DO coordinator, the queue consumer, the shared
  types). See the flow below.
- `src/files/` — the ingest consumer (single-read pipeline shell over `@magna-carta/file-manager`), the
  presigner wiring, the scan-port binding.
- `wrangler.jsonc` — bindings (D1/R2/Queues/DO/Analytics/Email), the `secrets.required` deploy gate, the
  queue producers/consumers, the Cron triggers, and the `durable_objects` + `migrations` ledger.
- `openapi/openapi.json` — the committed contract snapshot. **Never hand-edit;** run
  `pnpm --filter @magna-carta/worker run emit-openapi`, then regenerate the client
  (`pnpm --filter @magna-carta/api-client run generate`). A byte-exact test gates drift.

## Local rules

- **Every `/api/v1` route goes through the chokepoint.** Register with `defineOpenAPIRoute` + a full
  `RouteMeta`; a route mounted without meta (or naming an unregistered permission) throws at startup.
  Changing a route's responses or any `x-mc-*` meta changes the contract — re-emit the snapshot and the
  client in the same commit, and update the conformance not-vacuous operation list when adding a route.
- **A `files:*` capability binds to `resource: "matter"`** (file objects are matter-rooted), enforced by
  the conformance suite — even for a firm-scoped read like the bundle-status poll.
- **Bulk bytes never buffer in the Worker.** Streaming only: R2 bodies flow straight through `client-zip`
  and out; an archive of unknown length is written to R2 as a **multipart** upload, never a single
  length-bound `put`.

## Async bulk-download flow (slice 2·1 Plan 3 — the codebase's first Durable Object)

Past the live-download threshold (`liveMaxFileCount` **or** `liveMaxTotalBytes`), the bulk download is
built in the background instead of streamed inline:

1. **`POST /api/v1/downloads/zip`** (`routes/downloads.ts`) resolves the selection to version-pinned
   clean entries, content-addresses them into a **manifest hash** (`bundleManifestHash`), and `HEAD`s
   `bundles/<hash>.zip`. If the artifact exists → `200` with a fresh signed URL. Otherwise it asks the
   coordinator to build and returns `202 { jobId: hash, status }`. (Single file → `302`; under threshold
   → inline ZIP stream — both unchanged.)
2. **`BundleBuildCoordinator`** (`downloads/bundle-coordinator.ts`) is the single-flight coordinator,
   keyed `firmId:manifestHash`. The first `requestBundle` persists `building`, arms a 10-minute stuck
   alarm, and enqueues the `bundle-build` message exactly once; identical concurrent requests share it.
3. **The `bundle-build` consumer** (`downloads/bundle-consumer.ts`) streams each entry's R2 body through
   `client-zip` into `bundles/<hash>.zip` (multipart), then `markReady`; a throw `markFailed`s + retries
   (dead-letters after max attempts). A build that never reports back is failed by the alarm.
4. **`GET /api/v1/downloads/bundles/{manifestHash}`** (`routes/bundle-status.ts`) polls the coordinator;
   a ready job mints a fresh short-TTL signed GET. The DO name carries the **session** firm id, so a firm
   can only ever read its own job — never another firm's by guessing a hash.

**Per-firm isolation, artifact lifecycle, cost:** the manifest hash and the DO name are firm-scoped; the
artifact lives in the firm's own bucket and is expired by a `bundles/` R2 lifecycle rule (the deploy
runbook, section 8) — a regenerable cache, so expiry only forces a later rebuild. Notifications-push
delivery (instead of polling) and a Container escalation for outlier-large bundles are named seams.

## Gotchas

- A declared queue **consumer** with no exported handler fails the deploy; a declared **producer** does
  not. The DO binding likewise needs its class exported from `src/index.ts`.
- Tests run in `@cloudflare/vitest-pool-workers` (Miniflare) with real bindings from `wrangler.jsonc`; a
  DO test uses `runInDurableObject`. R2 `put` of an unknown-length stream stores nothing — confirmed
  against Miniflare — which is why the bundle build uses multipart.
