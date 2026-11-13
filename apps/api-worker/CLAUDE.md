# @magna-carta/api-worker — CLAUDE.md

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

- `src/index.ts` — the `ExportedHandler`, kept THIN on purpose: it re-exports every Durable Object
  class (the one thing that must be synchronous at startup) and reaches everything else through one
  dynamic import of `src/event-dispatch.ts`. Deploys are validated against a startup CPU budget
  (error 10021) that the entrypoint's static module graph spends; this Worker crossed it on
  2026-08-31. Never add a static import to `index.ts` — see `docs/conventions/build-performance.md`
  (_A Worker entrypoint spends a validated startup budget_).
- `src/event-dispatch.ts` — what the Worker does when an event arrives: `resolveApp()` (the Hono app,
  built lazily on the first request), `runScheduledPass` (Cron → sweep router), and `routeQueueBatch`
  (routes each batch by `batch.queue` name to its consumer). A new consumer, sweep, or route joins
  this module's graph.
- `src/http/app.ts` — `createApp()`: the composition root. Builds the chokepoint once over the real ports
  and registers every route through it. It no longer holds the env shape or the auth instance —
  those have modules of their own so the background side can import them without importing the app.
- **Two sides, one seam.** `src/http/` is the HTTP side: the app, the chokepoint, the contracts
  helpers, the middleware and the route tree. `src/background/` is the background side: the queue
  consumers and the Cron sweeps, each under its subsystem's name (`background/files/ingest-consumer.ts`),
  with `background/scheduled.ts` as the sweep router. Everything else under `src/` is shared
  machinery both sides reach — the bindings, the Durable Objects, the subsystem directories, the
  provisioners. `src/event-dispatch.ts` is the one module that reaches both sides, because it is the
  event router. The seam is held by `test/http-background-boundary-scan.test.ts`; the one deliberate
  door from the HTTP side to a sweep is `src/http/request-path-sweep.ts`, outside the route tree.
- `src/bindings.ts` — the `Bindings` env shape, the no-barrel single home for the env type, imported by
  both sides of the Worker. `src/auth-instance.ts` holds the per-env Better Auth instance and its
  counted email port; `src/worker-logger.ts` the per-env Workers logger.
- `src/http/routes/domain-app.ts` — `createDomainApp()`, the ONE constructor for a router here (the root
  app and every domain sub-app). The 422 default hook is per instance, so a router built anywhere
  else would answer a validation failure with the library default; `test/route-hygiene-scan.test.ts`
  refuses a direct construction under `src/http/routes/`.
- The shape of the route tree is held by four fitness tests, not by review: `test/route-table.test.ts`
  (every published operation resolves through Hono's router to its own route, so a literal path a
  pattern shadows fails by name), `test/route-hygiene-scan.test.ts` (one constructor, every
  registration through the chokepoint, no cross-domain import), `test/route-shape-ratchet.test.ts` (a
  line cap and an inline-shape cap per route module, with a ledger of today's offenders that only
  shrinks), and `test/http-background-boundary-scan.test.ts` (nothing under `src/background/` imports
  Hono or `src/http/`; nothing under `src/http/routes/` imports `src/background/`). The design they
  hold is `docs/specs/2026-09-18-api-worker-domain-modules-design.md`.
- `src/http/chokepoint/` — the ordered enforcement middleware + its ports; `defineOpenAPIRoute` carries each
  route's `RouteMeta`, and `chokepointMiddleware` enforces it. No per-handler auth discipline.
- `src/http/routes/<domain>/` — one directory per domain, each a sub-app: `index.ts` exports
  `mount<Domain>(app, chokepoint, deps)`, which builds its router through `createDomainApp`, registers
  the domain's route files in the order Hono must match them, and mounts at the root;
  `operations.ts` is the committed list of operation ids the module registers (regenerate with
  `pnpm --filter @magna-carta/api-worker run emit-domain-operations`; the conformance suite mounts
  each module alone and holds it to its list); a `CLAUDE.md` beside them carries that surface's own
  rules. `src/http/routes/manifest.ts` is the ordered list app.ts iterates, and the only place a domain is
  named. `src/http/routes/shared/` holds what two domains share (the platform-admin guard, the image
  helpers, the member-provision topic) — a domain module never imports another domain's directory.
  Two route families stay in app.ts by design: the token-guarded hosts (`/wopi/*`,
  `/search-objects/*`) and the cookieless preview serve, which are outside the chokepoint and whose
  position in the registration order is load-bearing; the health probe and the plugin loop mount
  there too.
- `src/firm-database/` — the `FirmDatabase` Durable Object (one per firm, `idFromName(firmId)`,
  self-migrating the per-firm lineage on wake) and its worker-side proxy: `firm-database-proxy.ts`
  exports `firmDatabaseFor(firmId, env)` which returns a DO-backed `SqlDatabase` handle. All ~185
  data-access statement modules resolve a firm's database through this proxy — **not** a D1 binding.
  The retired `DB_FIRM_POOL_*` bindings and `firm-binding-resolver.ts` are gone; `rpc-types.ts` holds
  the DO RPC shape.
- `src/downloads/` — the async bulk-download build (the DO coordinator, the queue consumer, the shared
  types). See the flow below.
- `src/emails/` — the email-capture consumer both entrances converge on, attachment extraction onto the
  ingest chokepoint, and `dkim-dns-resolver.ts`. That resolver makes an outbound call the capture path
  would not otherwise make: a DNS-over-HTTPS TXT lookup of a signer's `_domainkey` selector, bounded in
  time and response size, whose failures degrade the recorded DKIM verdict to `unverified` rather than
  failing the capture. Its target is deployment config (`DKIM_RESOLVER_URL`), never a user-supplied
  address, so the SSRF rule in `docs/conventions/invariants.md` does not bind — but the name it queries
  comes from the message, and is constrained to a plain domain before it can shape the request.
- `src/calendar-sync/` — a member's own calendar account at a provider: the sign-in, the store that
  opens that member's own sealed sign-in and no other, and the sync out. `connection-sync.ts` is the
  `ConnectionSync` Durable Object, one per connected account (`firmId:connectionId`), which holds who
  it is for and a retry count and runs that account's passes one at a time from its alarm.
  `outbound-pass.ts` is a pass: it reconciles the member's provider calendar with their rules and
  records each copy in `calendar_sync_link`. `provider-changes.ts` runs at the end of a pass with
  nothing left to send: it reads back only the copies the platform wrote, puts a deadline's copy back, raises a
  deleted copy as a `connection_sync_issue` for the member to answer, and hands an edited copy to
  `apply-provider-edit.ts`, which carries the edit to the event through the calendar's own service
  when the member holds `calendar:manage` and otherwise leaves it a question. One day of a series
  changed on its own is asked for last and carried as that day's own row; where it cannot be
  carried the day is written back, with no question. A deleted copy never cancels an event. `change-watch.ts` keeps the provider's standing request to say
  when the member's calendar changes: the object stores the watch and its secret, every pass that
  reaches the provider renews it, and `http/routes/calendar/provider-notices.ts` (public, one route
  per provider) hands a notice to the object, which believes it only by that secret and then only
  brings its pass forward. `shown-calendars.ts` is the other direction, run at the end of
  the same pass: it reads the calendars the member chose to be shown and makes the member's private
  table agree, leaving out the copies the platform wrote; `http/routes/calendar/account-events.ts`
  answers that table to its owner and to nobody else, and never asks the provider.
  `request-sync.ts` asks every account with a rule or a shown calendar for a
  pass; the calendar domain's router calls it behind the response of any write that could change
  what belongs in somebody's calendar. All of it returns early in a deployment with no Microsoft
  application
- `src/progress/` — push progress for job coordinators: the WebSocket frame contract
  (`job-progress-protocol.ts`) and the hibernation-aware socket helper (`job-progress-sockets.ts`)
  that `BundleBuildCoordinator` and `ConversionJob` both use. See the section below.
- `src/files/` — the ingest consumer (single-read pipeline shell over `@magna-carta/file-manager`), the
  presigner wiring, and the malware-scan wiring: `scan-port-binding.ts` (`resolveScanPort` — the
  engine-less adapter, or the remote adapter over the `SCAN_SERVICE` binding when bound) and
  `container-scan-adapter.ts` (POST→`RawScanResult`, zod-validated, throw-not-clean; the per-firm verdict
  is computed app-side from those raw facts). The scan engine itself
  runs in its own Worker (`apps/scan-worker`, service `magna-carta-scan`), which owns the `ScanContainer`
  (the `containers/scan` Rust crate); this worker reaches it over the `SCAN_SERVICE` service binding.
  **Three states, not two, and only the first two are verdicts.** No binding at all → the engine-less
  adapter's honest `unscanned`/`no-engine`. Bound and answering → a real verdict. Bound and answering
  5xx — a placeholder worker, a Container that is not up — → `ScanFaultError`, which the ingest
  consumer retries on, and which `routes/files/scan-diagnose.ts` and `routes/documents/templates.ts` both answer as a
  `503`, because a member asking whether a file is safe — or registering a template — must not be
  handed an Error ID for an engine that is simply not there. On the template path the scan runs inside
  `runIdempotentEffect`, whose callback owes a write and a response code rather than a `Response`, so
  the refusal is built one level out in the handler; a third route that scans inside an effect has the
  same shape to follow. The test pool
  **binds a stub** (`vitest.config.ts`), so `env.SCAN_SERVICE` is defined in tests and the container
  adapter — not the engine-less one — is what runs; drive the unreachable case by passing a failing
  binding in the request env, as `test/scan-unreachable-engine-seam.test.ts` does.
- `wrangler.jsonc` — bindings (D1/R2/Queues/DO/Analytics/Email), the `secrets.required` deploy gate, the
  queue producers/consumers, the Cron triggers, and the `durable_objects` + `migrations` ledger.
- `openapi/openapi.json` — the committed contract snapshot. **Never hand-edit;** run
  `pnpm --filter @magna-carta/api-worker run emit-openapi`, then regenerate the client
  (`pnpm --filter @magna-carta/api-client run generate`). A byte-exact test gates drift.

## Per-surface rules live beside their module

The rules that bind one surface are in that domain's own note: `src/http/routes/firm/CLAUDE.md` (the
scan-policy settings, the release-channel doors and the flag catalog), `src/http/routes/files/CLAUDE.md`
(upload readiness), `src/http/routes/notifications/CLAUDE.md` (the two tiers and their permissions),
`src/http/routes/session/CLAUDE.md` (human verification on the anonymous writes), and
`src/http/routes/timekeeping/CLAUDE.md` (the two time-entry guards). This note keeps what binds the whole
Worker.

## Local rules

- **A test that reaches no Workers runtime API runs in plain Node.** To opt in, put `// @node-runtime` among its header comments (`vitest.node-runtime.ts` reads it). Each file in the Workers project costs about 25 s of VM boot and app preload, while a Node file costs milliseconds. Opt a file in only when it passes under Node: `crypto.subtle.timingSafeEqual`, `DigestStream`, WebAssembly imports and `cloudflare:*` exist only in workerd. The config rejects a directive on a file that imports `cloudflare:*`.
- **Every `/api/v1` route goes through the chokepoint.** Register with `defineOpenAPIRoute` + a full
  `RouteMeta`; a route mounted without meta (or naming an unregistered permission) throws at startup.
  Changing a route's responses or any `x-mc-*` meta changes the contract — re-emit the snapshot and the
  client in the same commit, and regenerate the domain's `operations.ts` when adding a route
  (`pnpm --filter @magna-carta/api-worker run emit-domain-operations`).
- **A meeting guest is the one principal with no session, and it has a lane of its own.** A route
  declaring `guestLane: "invitation" | "grant"` is admitted by a signed credential in the
  `x-meeting-guest` header (or, on the socket upgrade alone, the `Sec-WebSocket-Protocol` pair
  `meeting-guest, <grant>`, answered `meeting-guest` so the credential never returns in a header; the
  `guest` query parameter is accepted there too, for a page still open from before) INSTEAD of
  the session, member-active and permission steps; the handler is handed a firm and the credential's
  names through `requireChokepointGuestGrant` and never a user id, so a member handler pointed at a
  guest route throws. Registration refuses a guest route that names a permission, is authenticated,
  or sits anywhere but `surface: "app"` / `resource: "firm"`, and a guest credential presented to any
  other route is answered the reserved 404 before a session is looked for. The routes are
  `src/http/routes/communications/meetings-guest.ts`; the credential format is `meetings/guest-token.ts`.
- **A `files:*` capability binds to `resource: "matter"`** (file objects are matter-rooted), enforced by
  the conformance suite — even for a firm-scoped read like the bundle-status poll.
- **Every object written into a firm's bucket carries its dimensions.** Build them with
  `@magna-carta/object-dimensions` — `matterScopedObjectDimensions` when the object belongs to exactly
  one matter, `firmScopedObjectDimensions` when it belongs to none — and pass them as `customMetadata`
  (Workers binding) or through the presigner, which signs them as `x-amz-meta-*` headers so a browser
  upload cannot drop one. The key is deliberately scope-free, so an unstamped object is one nothing can
  place, and the repair is a metadata rewrite of the whole bucket. `r2-object-dimension-scan.test.ts`
  fails any new write path that omits them; a genuine exception carries an inline
  `fitness:allow-no-dimensions` marker with its reason. Objects that predate the stamp are repaired by
  `files/dimension-backfill-sweep.ts` on the daily storage pass.
- **A new top-level path family is a `wrangler.jsonc` change AND a zone-route operator step.** Two
  mechanisms route around this Worker's handlers, and both fail the same way — the caller gets the
  SPA shell with a 200 and the handler never runs. In production, the app's hostname is split by
  **route patterns on the zone** (since 2026-08-31): `magna-carta-web` serves every path except the
  families routed here, so a family with no zone route never reaches this Worker at all — adding
  the route is an operator step ([`docs/conventions/operations.md`](../../docs/conventions/operations.md)).
  Locally and on this Worker's own URL, Workers Static Assets routes asset-server-FIRST: every path
  `assets.run_worker_first` does not name is looked for among the SPA's files, and a miss answers
  `/index.html` with a 200. So `run_worker_first` lists every family this Worker serves (`/api/*`,
  `/wopi/*`, `/search-objects/*`, `/__dev/*`) and doubles as the in-repository mirror of the zone's
  route list — adding a fifth family means a line there in the same commit plus the zone route.
  `test/worker-first-routing-scan.test.ts` reads the array against the app's live Hono dispatch
  table and fails when they disagree — the local test pool cannot catch it any other way, because
  `SELF.fetch` reaches the Worker without crossing the asset server. The `assets` block itself is
  the local-dev vehicle and rollback fallback, not how the deployed site serves the interface; the
  note on it in `wrangler.jsonc` says what must exist before anyone removes it.
- **Bulk bytes never buffer in the Worker.** Streaming only: R2 bodies flow straight through `client-zip`
  and out; an archive of unknown length is written to R2 as a **multipart** upload, never a single
  length-bound `put`.

## Async bulk-download flow (slice 2·1 Plan 3 — the codebase's first Durable Object)

Past the live-download threshold (`liveMaxFileCount` **or** `liveMaxTotalBytes`), the bulk download is
built in the background instead of streamed inline:

1. **`POST /api/v1/downloads/zip`** (`routes/files/downloads.ts`) resolves the selection to version-pinned
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
4. **`GET /api/v1/downloads/bundles/{manifestHash}`** (`routes/files/bundle-status.ts`) polls the coordinator;
   a ready job mints a fresh short-TTL signed GET. The DO name carries the **session** firm id, so a firm
   can only ever read its own job — never another firm's by guessing a hash.

**Per-firm isolation, artifact lifecycle, cost:** the manifest hash and the DO name are firm-scoped; the
artifact lives in the firm's own bucket and is expired by a `bundles/` R2 lifecycle rule, applied to
that bucket at provisioning by `firm-resource-provider.ts` (the shared platform bucket's copy of the
same rule is the deploy runbook's, section 8) — a regenerable cache, so expiry only forces a later
rebuild. A Container
escalation for outlier-large bundles is a named seam.

## Push progress — the hibernation WebSocket surface

`BundleBuildCoordinator` and `ConversionJob` each expose a **subscribe** endpoint beside their poll
endpoint: `GET /api/v1/downloads/bundles/{manifestHash}/events` and
`GET /api/v1/conversions/{jobId}/events`. A client that upgrades receives the job's current state
immediately and every transition as it happens; polling is unchanged and remains the fallback. The
frame contract and the working rules are in [`docs/conventions/api.md`](../../docs/conventions/api.md)
(_Push progress over WebSocket_); `src/progress/job-progress-protocol.ts` is the one home for the
frames themselves.

Local rules for this surface:

- **Nothing about a subscription may live on the Durable Object instance.** Class properties do not
  survive hibernation. The job state is read from `ctx.storage` and the subscription's context (the
  firm bucket a signed URL is minted against) from the socket's `serializeAttachment`. That is why
  `JobProgressSockets` is constructed per call rather than held as a field.
- **Every state write ends in a `broadcast()`.** A transition that skips it is a client left waiting
  on a socket that will never move. The early-return paths (a shared build, an idempotent submit)
  deliberately do not broadcast — nothing transitioned.
- **Poll and push must resolve through the shared resolver** (`downloads/bundle-progress.ts`,
  `conversions/conversion-progress.ts`). Adding a field to one and not the other is how the fallback
  stops being a fallback.
- The upgrade is a chokepoint route like any other: the object is addressed by the **session** firm
  id, never a path value, so subscription is scoped exactly as the poll is.

## Conversion subsystem — orchestration here, engines in a dedicated worker

The server-side file conversion path (`src/conversions/`) holds the **orchestration** — the
`ConversionJob` Durable Object (keyed `firmId:jobId`), the `CONVERSION` queue + consumer, and the
routes — and is **live** for the engines the convert worker carries. `resolveEnginePort` in
`conversion-engine.ts` resolves **each hop of a path by its engine id**, so a multi-hop path can
cross services: an engine backed by the convert worker (`libvips`, `image-pdf`, `libreoffice` —
the `CONVERT_WORKER_ENGINE_IDS` set is the authoritative list) gets the service-binding port (which
stamps `x-engine-id` so that worker dispatches to the right Container); the `ocr` engine is its own
live service and resolves to the `OCR_SERVICE` binding instead; an engine whose Container is not
built yet (`email`), or one this port deliberately leaves out (`transcode`, below), resolves to the deferred port (`engine-not-implemented`), as does any
engine whose binding is absent — which is every engine under the local Miniflare test pool, whose
`CONVERT` stub satisfies startup validation only.

The **engines** (the pure-Rust raster service, LibreOffice headless, the pure-Rust transcode
engine, the future Rust PDF engine) do **not** belong in this app worker — they are the same CPU/memory-bound, untrusted-bytes,
outbound-disabled Container runtimes that scan was extracted into its own worker for. They live in a
**dedicated conversion worker** that owns the engine Container(s) and is reached from here through a
thin **service-binding adapter** that implements the same `ConversionPort` (the split is the existing
port boundary, so the DO/queue/consumer do not change). All raster work runs in the
`RasterEngineContainer` inside `apps/convert-worker` — there is no in-process codec path in this
worker.

The convert worker is **deployed** (`apps/convert-worker`, service `magna-carta-convert`, since
2026-08-21) and owns two Container-backed Durable Objects: `RasterEngineContainer`
(`containers/raster/` — pure Rust, no C codecs; PNG/JPEG/WebP/TIFF/GIF/BMP and image-to-PDF via the
`image` crate) and `LibreOfficeEngineContainer` (the office edges, docx-to-pdf among them). Turning
on a NEW engine there is two steps in this order: land its Container class in the convert worker
and deploy, then add its id to `CONVERT_WORKER_ENGINE_IDS` — the id is what actually turns the
engine on, so it goes last (the worker answers 501 for an id it does not recognise, which fails the
job as adapter-error).

Still an operator step **for the shared platform bucket**: add the R2 lifecycle rule expiring its
`conversions/` prefix (~24 h) — conversion results are transient presigned-GET artifacts, and until
the rule exists they accumulate ([`docs/deploy-queue.md`](../../docs/deploy-queue.md)). A firm's OWN
bucket no longer needs the step: `firm-resource-provider.ts` applies the `bundles/` and
`conversions/` expiries, the `meeting-recordings/` staging expiry (eight days: a day past the
recording sweep's seven-day retention, because lifecycle age runs from the object's creation and the
sweep's from the recording settling), an abandoned-multipart abort on every one of them, and a
seven-day abort on `files/` that never expires an object — at provisioning, unconditionally on every
run that reaches the bucket step. **The lifecycle PUT replaces the bucket's whole rule set**, so a
rule added by hand is gone on the next run: every rule a firm bucket needs lives in `LIFECYCLE_RULES`.
In the same step it applies the **browser-upload CORS policy** from
`src/files/browser-upload-cors.ts`, without which the file-manager upload's presigned PUT dies at the
preflight and the firm cannot upload at all. Buckets provisioned before 2026-09-03 take that policy
by hand: `pnpm run emit-r2-cors` prints it as the dashboard's JSON (the deploy runbook, section 15).

**The playable copy reaches the transcode engine by STREAMING, not through this port.** The
`ConversionPort` reads a whole source into memory, which a recording would exhaust, so `transcode` is
deliberately absent from `CONVERT_WORKER_ENGINE_IDS`. A copy of a video every browser plays is asked
for at `POST /api/v1/files/{id}/playable-copy` (`routes/files/playable-copy.ts`), rides the same
`CONVERSION` queue as a `PlayableCopyMessage` (it carries `kind`, which a `ConversionMessage` never
does), and `background/conversions/playable-copy-consumer.ts` pipes the R2 body into the convert
worker and the engine's answer into a length-bound put (the engine always sends a Content-Length).
The copy is FILED: it is reserved as a new file in the original's folder (`initiateUpload`), written
to that version's key, completed and handed to the ingest like any server-written document, and the
original's version records the file in `playable_copy_file_id`.
Its state lives on the version's own row (`packages/file-manager/src/playable-copy.ts`), not in a
`ConversionJob`, so it has no coordinator and no alarm: a fault throws and the queue retries, and a
request left pending past its stale window may be asked for again. One queue invocation is cut off at
fifteen minutes, which is the longest conversion this path can finish.

The dedicated-worker split is a cross-cutting decision shared with the scan, editing, and PDF-engine
subsystems (search is the exception — its index is durable per-firm data), with `apps/scan-worker`
as the working template.

The Container binding cannot run under the local Miniflare test pool, which is why
`resolveEnginePort` is injectable at every consumer's seam and the e2e tests supply a fake engine;
under the pool every convert-worker engine resolves to the deferred port and the routes still
operate correctly (upload, submit → 202, poll → `engine-not-implemented` failure).

## Document assembly — the PDF arm reuses the conversion edge, it does not own one

`src/background/assemblies/assembly-consumer.ts` files a word-processing package by default. A job whose
`outputFormat` is `pdf` hands the **merged** bytes to `runConversion("docx", "pdf", …)` with
`resolveEnginePort(env)` — the registry's own edge in `packages/conversion/src/registry.ts`, executed
by whichever service that resolver names for the `libreoffice` engine. Rules for this arm:

- **Nothing here may grow a second way to make a PDF.** No engine, no adapter, no registry entry
  belongs to document automation. The office suite is the platform's one renderer of a word-processing
  package, and a second path would be a second answer to what a firm's letterhead looks like on paper.
- **A conversion that cannot be done FAILS the job (`conversion-failed`); nothing is filed.** Filing
  the word-processing package and warning would hand a member who asked for a PDF something that reads
  as the document they wanted and is discovered to be wrong when the seal refuses it. The code is
  terminal, so the message is acked — a deployment where the suite is unreachable must not become a
  queue burning attempts.
- **The requested format is on the row, not read off the object.** `document_assembly.output_format`
  answers for a job still queued and for a job that failed, neither of which has a filed object; the
  poll returns it so a caller knows whether the produced document is in the shape
  `POST /api/v1/documents/seal` accepts. That route is stateless over PDF bytes and is unchanged.
- **The engine resolver is injectable on `documentAssemblyQueue`**, on the same terms the conversion
  consumer takes it: the engine Container cannot run under the local test pool.

## Document assembly — the two template kinds, and the one place the finish is decided

`document_template_version.kind` is `wordProcessing` or `pdfForm`, and the assembly job branches on it in
**exactly one place**. Everything before the branch — the version read, the gate check, the byte read and
its cache, the manifest, the dictionary the firm has today, the batched merge-context resolution, the
protected-field chokepoint — runs identically for both. Everything after it — the absence accounting, the
frozen-field list, the ingest chokepoint, the provenance row, the telemetry — is shared again.

- **`src/assemblies/pdf-form-engine.ts` is the only wiring of the PDF engine into assembly**, and it is
  three functions: read the AcroForm field set, scrub an uploaded form, fill one. The domain package
  declares each as a seam and holds no WebAssembly, which is what keeps the fill DECISION testable
  without a PDF. Nothing here may grow a second filler, for the reason nothing may grow a second way to
  make a PDF: a firm's court form has one appearance.
- **`FILLED_FORM_FINISH` is the platform's one answer to whether a filed form is interactive or
  flattened, and today it is `interactive` because the owner has not decided.** Flattening is
  irreversible — a flattened form cannot be corrected — so the non-destructive option is what sits behind
  the open question. When it is answered, this constant changes or becomes a read of a per-template
  column, and nothing downstream has a default of its own to unpick: `fillFormTemplate` takes the finish
  as a required parameter.
- **A form template produces a PDF and only a PDF.** The submit route defaults its `outputFormat` to
  `pdf` and REFUSES `docx` with a 422, where the caller can act on the answer; the consumer carries
  `output-format-unavailable` as well, because it must never file the other format instead. A filled form
  never crosses the office-suite conversion edge — it is already the firm's own document with its boxes
  filled, and re-rendering it would be a different document under the same name.
- **The registration route branches before the pipeline, not inside it.** `POST /api/v1/templates/upload`
  takes `?kind=` and signs the matching content type into the presigned PUT; `POST /api/v1/templates`
  (and the versions route) take `kind` plus `fieldMappings`, the human confirmation of what each box on
  the form means. The mappings go to the firm's existing `document_template_field_mapping` library in the
  same commit as the version they bound.
- **Registration writes the object BEFORE the rows, and what that leaves behind is COUNTED on the
  daily cron — not deleted.** A committed row pointing at bytes that were never written is a template
  that fails on a filing deadline; a written object with no row is only wasted storage — so the
  ordering stays. `assemblies/template-orphan-sweep.ts` runs beside the other storage passes and
  reports an object under `templates/` as an orphan when no version row **anywhere in the fleet**
  names its key, it is not under `TEMPLATE_STAGING_PREFIX`, and it has been unnamed for longer than a
  24-hour grace period — the window in which a registration's row is still committing. **It deletes
  nothing, and adding the delete is not a line to uncomment.** The fleet-wide retention set is not
  convenience: a template key carries no firm and every firm resolves to the same bound bucket, so a
  per-firm complement would delete another firm's live template. And the fleet set cannot be shown
  complete — a `FirmDatabase` addressed under a name it does not answer to self-migrates and returns
  zero rows, which is indistinguishable from a firm that holds no templates, and the residency seam in
  `firm-database-proxy.ts` makes that reachable. So a retention read that FAILS disarms the whole pass,
  and a read that merely returns nothing cannot be caught at all. Arming the delete wants each object
  stamped with the firm that wrote it, so the complement is taken against one firm's rows; that is an
  open owner question on the ledger's `document-automation.template-storage-reclamation` node. Reaping
  abandoned staged uploads is a separate half and is deliberately not here — it wants an R2 lifecycle
  rule ([`docs/deploy-queue.md`](../../docs/deploy-queue.md)).

## The split-object host — how the search engine reads R2 without credentials

`src/search/split-object-host.ts` mounts `/search-objects/*`: cookieless, capability-token guarded,
**outside the chokepoint**, for the same reason `/wopi/*` is — the caller is the keyword-search
Container, which holds no session and no R2 credentials. The engine issues an ordinary ranged GET
against a non-routable internal host, the search worker's container outbound interception forwards it
here over a service binding, and this handler performs exactly one R2 operation. The engine is in
`containers/search`; the worker that owns it is `apps/search-worker`.

- **One request in, one R2 operation out.** No prefetch, no read-ahead, no buffering of a body being
  passed through, and **an unranged GET is refused with 416 rather than serving the split whole**.
  Every ranged read is a Class B operation in a deployment, and the read counts `crates/search-eval`
  reports only transfer to production while that holds — a helpful optimization here changes the cost
  model with nothing measuring it.
- **The token decides whose bytes are reachable, never the request line.** `split-object-token.ts`
  mints a per-operation HMAC token carrying the firm and the corpus; the allowed key prefix is
  **derived** from that corpus rather than carried. A query reads several splits, so the key has to come
  from the path — constraining it to the token's own prefix is what keeps that choice inside one
  corpus. Write capability is a separate claim, so a query cannot overwrite what it is reading.
- **The firm's bucket comes from the verified token through `files/firm-bucket.ts`**, like every other
  object path here. A firm with no provisioned bucket is a refusal, not a fall-back to the bound handle.
- **Four literals are duplicated across three packages** (the internal host, the path prefix, the token
  header, the size header) because a worker cannot import from another worker. Each side pins them in a
  test; change one and change all of them in the same commit, or every engine read becomes blocked
  egress.
- **The search service is bound in the test pool to a stub that refuses every operation**
  (`vitest.config.ts`), because `wrangler.jsonc` binds `SEARCH_SERVICE` and the pool will not boot
  with a binding that resolves to nothing. So `env.SEARCH_SERVICE` is defined in a test, the port
  over the binding is what `resolveSearchIndexPort(env)` returns, and it answers `adapter-error`.
  A test that wants an engine injects a port. A test of the deployment with no binding passes
  `{ ...env, SEARCH_SERVICE: undefined }`, which is the only way to reach the deferred port and the
  "not connected" answers.
- The PUT route registers its path as a **literal string** so the object-dimension fitness scan can tell
  a route registration from a bucket write; a published split is stamped `object_class: search-split`
  with its corpus as the matter.

## Search split compaction — the ordering rules that make it safe

`src/search/compaction-*.ts` merges a corpus's many per-document splits into one. Three local rules, all
about ordering, and breaking any of them is a correctness bug rather than a performance one:

- **A pass publishes object, then catalog, then nothing.** Write the merged split to R2; commit ONE
  batch that inserts its row, inserts its `index_split_member` rows, and marks every source superseded;
  then stop. **Never delete a source object in the pass that superseded it** — a query resolves its split
  keys and then reads them, so that is the one ordering that can hand a live query a key to bytes that
  are gone. Retirement is `runSearchCompactionSweep` on the daily cron, after a grace period.
- **The write path may count; it may never merge.** The compaction trigger in `index-consumer.ts` is one
  indexed `countLiveSplitsForCorpus` and a coordinator call. A merge is proportional to the corpus, so
  merging per write would be quadratic in it.
- **A re-index marks and publishes in the same batch.** `markMembersStaleForDocumentStatement` rides the
  batch that inserts the replacement split. Between the two writes a query would return the document
  twice — once from its new split and once from the merged split that still holds the old passages — so
  the window has to be zero. The stale members become per-split `excludeDocumentIds` on the query
  (`keyword-search.ts`); the next merge is passed the same ids and repacks them out of the bytes.

The coordinator is keyed by **corpus**, not by pass: two concurrent passes over one corpus would each
merge overlapping splits and leave every document in the overlap live in two merged splits at once.
Thresholds and merge bounds are per-firm settings (`@magna-carta/search/settings`), never constants.

## Two corpora, one pipeline — the review-set index lane

`index_split` is keyed by **corpus** (`corpus_kind` + `corpus_id`), not by matter, and every scope read
in `@magna-carta/data-access/index-split-statements` matches on it. That is what makes a matter query
structurally unable to name a discovery review set's splits: a query resolves its keys from the catalog
and from nowhere else. `matter_id` is still on the row and is PROVENANCE — which matter the work was
done under, and the dimension the split object is stamped with — so nothing may go back to enumerating
by it.

A review document enters through `enqueueReviewDocumentForIndexing` (`search/enqueue-index.ts`), called
by the discovery processing consumer once a document is `processed`. Local rules for that lane:

- **It never re-extracts.** The consumer reads the review document's already-written text object and
  its metadata sidecar, and turns them back into passages in `search/review-document-passages.ts`.
  Handing an opposing party's bytes to a second parser would give the corpus two answers about what
  the document says, and the one a firm certified in its manifest is the one on disk.
- **Only the PRIMARY of a duplicate group is enqueued**, which is the whole economic argument for
  deduplicating. The duplicates keep their rows, their Custodians of Record and their occurrences.
- **A review set never feeds the natural-language corpus.** The feed write in `indexOne` is skipped
  explicitly for a review-set corpus, not left to the feed's own allow-list: that surface's audience is
  the matter team, and a review set's access list is narrower.
- **A deferred or failed outcome is recorded on the review document's own ROW** (`index_state`), never
  as a `review_document_exception` — the exception vocabulary is a court-facing closed list about what
  could not be READ. The one exception it does file is `source-bytes-missing`, when the corpus's own
  derived text is gone.
- The message carries the corpus as two optional fields with `matter` as the ABSENT default
  (`indexMessageCorpus`), so a message in flight across the deploy that introduced them still routes
  where it was going. The same shape is on the compaction message.

## The kept text — what a file result quotes from

`src/search/extracted-text-store.ts` is the two bucket operations over the format in
`@magna-carta/search/extracted-text`: the index job writes one object per indexed version of a
matter's file, and `src/search/matter-file-contents.ts` reads one passage of it by range.

- **The write is inside the job's outcome and before the catalog commit.** The two best-effort steps
  after the commit (the feed write, the compaction count) may fail quietly; this one may not,
  because once the catalog names the split nothing about the document looks unindexed and no later
  pass would repair a missing object.
- **The read is after the search's own statement, and checks again.** `excerpts` is asked only for
  rows the search is about to show. `listQuotableIndexedVersions` then answers which version the
  index holds, and only for a file on that matter, not deleted, whose version is clean.
- **A quote never fails a search and never reaches a log.** `excerpts` does not throw. A fault is
  reported once, by its kind: not the question, not the passage, and not the key, which names a
  client's file.
- **Never the whole object.** One ranged read for most documents, two for a long one and three for
  one of several thousand pages, with the passage itself capped. A request does not hold a deposition to quote a sentence from it.

## Gotchas

- A declared queue **consumer** with no exported handler fails the deploy; a declared **producer** does
  not. The DO binding likewise needs its class exported from `src/index.ts`.
- Tests run in `@cloudflare/vitest-plugin` (Miniflare) with real bindings from `wrangler.jsonc`; a
  DO test uses `runInDurableObject`. R2 `put` of an unknown-length stream stores nothing — confirmed
  against Miniflare — which is why the bundle build uses multipart.
- **Fire-and-forget work goes through `src/http/deferred-work.ts`** — `runInBackground` from a handler,
  `trackBackgroundWork` where the promise is handed to `waitUntil` directly. A path that skips it is
  invisible to the test harness's teardown barrier and will eventually fail a run in a file that
  passed; the rule and the reasoning are in
  [`docs/conventions/testing.md`](../../docs/conventions/testing.md) (_Work that outlives the test_).
- **The interactive ingest lane scans on the warm shard, and a failed message retries with a
  backoff.** `ingestQueue` reads the lane off `batch.queue`: the interactive lane sends NO shard key,
  so the scan worker routes to the one instance its warm-poke keeps resident; the bulk lane keeps the
  per-file key for the fan-out. A throw retries with `delaySeconds` growing per attempt (ten seconds,
  capped at a minute) under a ten-retry budget in `wrangler.jsonc` — three immediate retries used to
  meet the same cold engine three times running and dead-letter a file a member was watching, who
  then waited for the five-minute redrive.
- **A member's re-scan request (`FILE_RESCAN_ACTION`, `routes/files/file-scans.ts`) is the one re-scan
  that ignores engine staleness and the dedup cache.** The access-triggered and per-matter re-scans
  run only when the version's recorded engine is stale and reuse a cached result for the same bytes;
  a request carries its audit id, keys its idempotency on it, and scans the bytes afresh, so
  "check again" means the engine looked again. Its result row carries the same `requestId`, which
  is how the Safety tab pairs a request with its verdict.
