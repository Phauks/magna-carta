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
  consumer retries on, and which `routes/scan-diagnose.ts` and `routes/templates.ts` both answer as a
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
  `pnpm --filter @magna-carta/worker run emit-openapi`, then regenerate the client
  (`pnpm --filter @magna-carta/api-client run generate`). A byte-exact test gates drift.

## Firm scan-policy settings API

`src/routes/scan-policy.ts` exposes `GET /api/v1/firm/scan-policy` (returns the resolved `{scanPolicy, flaggedTreatment, stepUpReauthOnFlagged}`) and `PATCH /api/v1/firm/scan-policy` (writes any subset). Both require `firm:manageScanPolicy` (Owner + Admin). The route reads/writes via the `scan-policy-settings.ts` helpers in `@magna-carta/file-manager`; the ingest consumer (`src/files/`) calls those same helpers at queue-consume time, so ingest and the API always agree on defaults. The `downloads.ts` route reads `flaggedTreatment` at access time — a policy change takes effect on the next request without re-ingest.

## Local rules

- **Every `/api/v1` route goes through the chokepoint.** Register with `defineOpenAPIRoute` + a full
  `RouteMeta`; a route mounted without meta (or naming an unregistered permission) throws at startup.
  Changing a route's responses or any `x-mc-*` meta changes the contract — re-emit the snapshot and the
  client in the same commit, and update the conformance not-vacuous operation list when adding a route.
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
runbook, section 8) — a regenerable cache, so expiry only forces a later rebuild. A Container
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
routes — and is wired but **dormant** until the engines are reachable. `resolveEnginePort` in
`conversion-engine.ts` resolves **each hop of a path by its engine id**, so a multi-hop path can
cross services: an engine backed by the convert worker gets the service-binding port (which stamps
`x-engine-id` so that worker dispatches to the right Container); the `ocr` engine is its own live
service and resolves to the `OCR_SERVICE` binding instead; an engine whose Container is not built
yet (`libreoffice`, `email`, `ffmpeg`) resolves to the deferred port (`engine-not-implemented`), as
does any engine whose binding is absent — so the routes are fully functional in tests and in
production, they just cannot yet execute every conversion.

The **engines** (the pure-Rust raster service, LibreOffice headless, FFmpeg, the future Rust PDF
engine) do **not** belong in this app worker — they are the same CPU/memory-bound, untrusted-bytes,
outbound-disabled Container runtimes that scan was extracted into its own worker for. They live in a
**dedicated conversion worker** that owns the engine Container(s) and is reached from here through a
thin **service-binding adapter** that implements the same `ConversionPort` (the split is the existing
port boundary, so the DO/queue/consumer do not change). All raster work runs in the
`RasterEngineContainer` inside `apps/convert-worker` — there is no in-process codec path in this
worker.

To activate real conversions:

1. **Build and deploy the pure-Rust raster engine Container image** (`containers/raster/`) for the
   `magna-carta-convert` worker and deploy that worker. The worker scaffold and the `CONVERT` service
   binding already exist; `resolveEnginePort` returns the `serviceBindingPort` adapter automatically
   once the binding is present — no code change needed here. The engine is memory-safe by design
   (pure Rust, no C codecs — see `containers/raster/CLAUDE.md` for the invariants). The `CONVERT`
   worker owns the `RasterEngineContainer` Durable Object (the Container-backed DO); once deployed,
   it handles PNG/JPEG/WebP/TIFF/GIF/BMP conversions via the `image` crate.
2. **Add the R2 lifecycle rule** expiring the `conversions/` prefix (~24 h). Conversion results are
   transient presigned-GET artifacts; expiry forces the client to re-convert rather than accumulate
   stale files.

The dedicated-worker split is a cross-cutting decision shared with the scan, editing, and PDF-engine
subsystems (search is the exception — its index is durable per-firm data); land it as one shared
decision, coordinated via `vp run worktrees`, with `apps/scan-worker` as the working template.

Until step 2 is done, `resolveEnginePort` returns the deferred port for every convert-worker engine and all three conversion routes operate correctly (upload, submit → 202, poll → `engine-not-implemented` failure). The Container binding cannot run under the local Miniflare test pool, which is why `resolveEnginePort` is injectable and the e2e tests supply a fake engine.

## Document assembly — the PDF arm reuses the conversion edge, it does not own one

`src/assemblies/assembly-consumer.ts` files a word-processing package by default. A job whose
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
  indexed `countLiveSplitsForMatter` and a coordinator call. A merge is proportional to the corpus, so
  merging per write would be quadratic in it.
- **A re-index marks and publishes in the same batch.** `markMembersStaleForDocumentStatement` rides the
  batch that inserts the replacement split. Between the two writes a query would return the document
  twice — once from its new split and once from the merged split that still holds the old passages — so
  the window has to be zero. The stale members become per-split `excludeDocumentIds` on the query
  (`keyword-search.ts`); the next merge is passed the same ids and repacks them out of the bytes.

The coordinator is keyed by **corpus**, not by pass: two concurrent passes over one corpus would each
merge overlapping splits and leave every document in the overlap live in two merged splits at once.
Thresholds and merge bounds are per-firm settings (`@magna-carta/search/settings`), never constants.

## Human verification — built, wired, and dormant until a secret exists

`src/human-verification/` gates the two anonymous WRITES — `POST /api/v1/registrations` and `POST
/api/v1/invitations/redemptions` — on a Cloudflare Turnstile solution presented in the
`X-Human-Verification-Token` header. `resolveHumanVerificationPort(env)` selects by the presence of
`TURNSTILE_SECRET_KEY`, on the same terms `resolveScanPort` selects an engine; absent (every
environment today) it returns `verifierNotConfigured` and both endpoints serve exactly as before.
Activation steps and their ordering live in [`docs/deploy-queue.md`](../../docs/deploy-queue.md).

Local rules for this surface:

- **Three outcomes, and only two of them are about the caller.** `verified`/`refused` are verdicts;
  `unavailable` is a fact about this deployment. Never collapse the third into either — as a pass it
  makes any outbound failure a bypass, as a refusal it blames a visitor for our outage.
- **The gate is called from the HANDLER, not mounted as route middleware.** Route-specific middleware
  runs ahead of the chokepoint, so a gate there would make an outbound call before the IP-keyed rate
  limit had a say. Adding it to a third route means one call at the top of that handler.
- **Never a 500.** A refusal is `403`; a live verifier that will not answer, or that rejects our
  secret, is a retryable `503`. An Error ID for a fault the caller cannot act on is the failure mode
  this replaced.
- **A dormant gate is counted, not silent.** Every decision — the unprotected passes most of all —
  records one `human_verification.decided` point. Adding a path that returns without recording is the
  one change that would put this back where it started.
- **The token never reaches a log, a counter dimension, an error message, or a URL.** It is a bearer
  credential; the telemetry catalogs give it no field, and nothing should add one.
- **Better Auth's `/api/auth/*` endpoints are deliberately not gated** — the shipped sign-in screen
  mints no token, so gating them would break a working surface.

## Release channels — the two doors and the flag catalog

A firm's `release_channel` (`stable | beta | alpha`) is stored on the control-plane `firm` row and is read into every session. Two routes write it:

- **Beta door:** `PUT /api/v1/firm/release-channel` — accepts only `{ stable, beta }`; backed by `firm:manageReleaseChannel` enforced at the chokepoint; requires an explicit consent payload recorded in the per-firm `audit_log`.
- **Alpha door:** a secret-guarded platform endpoint (same lane as `POST /v1/firms`); writes any channel value; no firm-session required; audit goes to the control-plane `auth_audit`.

**Adding a feature flag.** To gate a new feature behind a release channel:

1. Add an entry to `FLAG_CATALOG` in `@magna-carta/feature-flags` — keyed by the flag key, with `defaultValue` (the safe default = stable behavior), `stage: "alpha" | "beta" | "stable"`, and a `description`.
2. Add a matching boolean flag in the Flagship dashboard with a targeting rule: `channel in [beta, alpha]` (or `[alpha]` for alpha-only), optionally with a `%` rollout.
3. Call `getBooleanValue(flagKey, false, context)` (or `evaluateCatalog`) in the route or session handler. Stable behavior is always the default — the second argument must equal what a `stable` firm would see.

**The `FLAGS` binding is a production deploy-time wiring step.** The local Miniflare test pool does not support the Flagship binding shape. The `env.FLAGS` binding is declared **optional** in `wrangler.jsonc`; when absent, `resolveFlagEvaluator` returns the `defaultOffEvaluator` (all flags off, the safe stable default). Tests that need a specific flag on inject a `FlagEvaluator` fake directly — no Flagship account required. This means the fail-safe is structural: any test environment or local dev session silently sees stable behavior for every flag unless a fake is injected.

## Gotchas

- A declared queue **consumer** with no exported handler fails the deploy; a declared **producer** does
  not. The DO binding likewise needs its class exported from `src/index.ts`.
- Tests run in `@cloudflare/vitest-pool-workers` (Miniflare) with real bindings from `wrangler.jsonc`; a
  DO test uses `runInDurableObject`. R2 `put` of an unknown-length stream stores nothing — confirmed
  against Miniflare — which is why the bundle build uses multipart.
- **Fire-and-forget work goes through `src/background.ts`** — `runInBackground` from a handler,
  `trackBackgroundWork` where the promise is handed to `waitUntil` directly. A path that skips it is
  invisible to the test harness's teardown barrier and will eventually fail a run in a file that
  passed; the rule and the reasoning are in
  [`docs/conventions/testing.md`](../../docs/conventions/testing.md) (_Work that outlives the test_).
