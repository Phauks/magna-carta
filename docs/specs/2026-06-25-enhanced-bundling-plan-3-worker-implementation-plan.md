# Enhanced Bundling — Plan 3: worker orchestration (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the enhanced-bundling options into the matter download flow: accept `BundleOptions`, route each request to the right lane (plain-ZIP fast lane / heavy-unencrypted async build via the bundle container / encrypted single-file stream), and stand up the dedicated `apps/bundle-worker` that owns the bundle container and mediates its R2 access via outbound Workers.

**Architecture:** Two phases. **Phase A (main worker — fully testable in the worker pool):** extend `apps/worker/src/downloads/` and add a shared manifest type + a `bundleContainerAdapter` over a `BUNDLE_SERVICE` Fetcher binding (stubbed in tests, exactly like `containerScanAdapter`). **Phase B (dedicated worker — partly deploy-gated):** a new internal `apps/bundle-worker` mirroring `apps/scan-worker` that owns `BundleContainer extends Container`, proxies `POST /build`, and hosts the `outboundByHost` `env.R2` handler so the container reaches R2 with no credentials and no egress. The live container is a deploy-time activation (cannot run in the test pool), so Phase B's verification is its forward/handler unit tests + the Plan 2 CI image gate.

**Tech Stack:** TypeScript, Hono + `@hono/zod-openapi`, Cloudflare Workers (Durable Objects, Queues, service bindings), `@cloudflare/containers`, Vitest + `@cloudflare/vitest-pool-workers` (Miniflare). Reuses `@magna-carta/file-manager` bundling modules (already on `main`): `bundleOptionsSchema`, `validateOptionsForFormat`, `applyBundleLayout`, `bundleCacheKey`, `buildContentsManifest`.

## Global Constraints

- **Every `/api/v1` route goes through the chokepoint** (`apps/worker/CLAUDE.md`): register with `defineOpenAPIRoute` + a full `RouteMeta`. Changing a route's responses/meta changes the contract — **re-emit the OpenAPI snapshot and regenerate the client in the same commit** (`pnpm --filter @magna-carta/worker run emit-openapi`, then `pnpm --filter @magna-carta/api-client run generate`); a byte-exact test gates drift.
- **`files:*` capabilities bind to `resource: "matter"`** (enforced by the conformance suite). The bundle routes keep `files:organize` / `resource: "matter"` as the existing zip route does.
- **Bulk bytes never buffer in the Worker** — streaming only (R2 bodies and container responses stream through; an unknown-length archive to R2 is a multipart upload).
- **The password is never persisted** — never in a queue message, DO storage, cache key, or log. The encrypted lane holds it only for the request and streams the result; it never writes an artifact.
- **The manifest is the Rust⇄TS boundary** — the TS manifest type must stay byte-compatible with the container's `BuildRequest` (Plan 2). A change is a change on both sides.
- **Names fully spelled out** (golden rule 12); **no process-doc refs in source/tests** (golden rule 13).
- **Container code is deploy-time** — the `BUNDLE_SERVICE` binding and the live `BundleContainer` cannot run in the test pool; tests stub the Fetcher (mirror `containerScanAdapter`'s test fake). Verification of the live container is the Plan 2 CI image gate.

**Test command:** `pnpm --filter @magna-carta/worker run test -- <path>` (worker pool); `pnpm --filter @magna-carta/bundle-worker run test -- <path>` (Phase B). Run `pnpm check` before the final commit of a task.

**The TS manifest type (Task A1 creates it; mirrors Plan 2's Rust `BuildRequest`):**

```ts
// packages/file-manager/src/bundle-manifest.ts
import type { BundleOptions } from "./bundle-options.ts";

// The build request the worker sends the bundle container. Byte-compatible with the container's Rust
// `BuildRequest` (camelCase serde). Bytes never appear here — only R2 keys, plus optional inline bytes
// for a generated CONTENTS file. The password rides `options.encryption` for the streamed encrypted lane
// only and is never persisted.
export interface BundleManifestEntry {
  readonly archivePath: string;
  readonly mtimeEpochSecs: number | null;
  readonly source:
    | { readonly source: "r2"; readonly r2Key: string }
    | { readonly source: "inline"; readonly bytesBase64: string };
}
export interface BundleManifest {
  readonly jobId: string;
  readonly format: BundleOptions["format"];
  readonly compression: BundleOptions["compression"];
  readonly encryption: { readonly password: string; readonly encryptFileNames: boolean } | null;
  readonly split: { readonly maxPartBytes: number } | null;
  readonly entries: readonly BundleManifestEntry[];
  readonly outputKeyPrefix: string;
}
```

---

## Phase A — main worker (fully testable)

### Task A1: Shared manifest type + manifest builder

**Files:**

- Create: `packages/file-manager/src/bundle-manifest.ts` (the type above + `buildBundleManifest(...)`)
- Modify: `packages/file-manager/package.json` (`"./bundle-manifest": "./src/bundle-manifest.ts"`)
- Test: `packages/file-manager/test/bundle-manifest.test.ts`

**Interfaces:**

- Consumes: `BundleOptions`, `ResolvedZip`/`ZipEntry` (`./zip-composition.ts`), `applyBundleLayout` (`./bundle-layout.ts`), `buildContentsManifest`/`ManifestEntry` (`./contents-manifest.ts`).
- Produces: `BundleManifest`, `BundleManifestEntry`, `buildBundleManifest(args): BundleManifest`.

`buildBundleManifest` takes `{ jobId, resolved: ResolvedZip, options, password, manifestEntries: ManifestEntry[] (path/size/sha256 for the CONTENTS file when options.manifest), outputKeyPrefix, mtimeByR2Key: Map<string, number|null> }`, applies `applyBundleLayout`, maps each entry to an `r2` source, and — when `options.manifest` — appends an `inline` `CONTENTS.txt` entry whose `bytesBase64` is base64(`buildContentsManifest(manifestEntries)`). The password is folded into `encryption` only when `options.encryption !== null`.

- [ ] **Step 1: failing test** — assert: layout applied (wrapper/flatten reflected in `archivePath`); each file entry is an `r2` source with the right key; with `options.manifest`, a final `inline` `CONTENTS.txt` entry decodes (base64) to the `buildContentsManifest` text; `encryption` is null when options has none and carries the password+encryptFileNames when set.
- [ ] **Step 2: RED** — `pnpm --filter @magna-carta/file-manager run test -- test/bundle-manifest.test.ts`.
- [ ] **Step 3: implement** `bundle-manifest.ts` (pure; base64 via `btoa`/`Buffer`-free — use the platform `btoa` over a binary string, or a small `Uint8Array`→base64 helper consistent with the codebase). Add the export entry.
- [ ] **Step 4: GREEN + commit** — `git commit -m "feat(bundling): bundle manifest type + builder (layout + inline CONTENTS)"`.

### Task A2: `bundleContainerAdapter` over the `BUNDLE_SERVICE` Fetcher

**Files:**

- Create: `apps/worker/src/downloads/bundle-container-adapter.ts`
- Test: `apps/worker/test/bundle-container-adapter.test.ts`

**Interfaces:**

- Produces: `interface BundleServiceFetcher { fetch(request: Request): Promise<Response> }`; `interface BuildResultVolume { key: string; sizeBytes: number }`; `bundleContainerAdapter(service, requestTimeoutMs?)` returning `{ build(manifest: BundleManifest): Promise<BuildResultVolume[]>, buildStream(manifest): Promise<Response> }`.

Mirror `containerScanAdapter` (`apps/worker/src/files/container-scan-adapter.ts`): `build` POSTs `manifest` JSON to `http://bundle/build`, validates the `BuildResponse` with a zod schema (`{ ok, volumes, error }`), throws on non-200 / `ok:false` / malformed. `buildStream` POSTs to `http://bundle/build?stream=1` and returns the raw streaming `Response` (for the encrypted lane) after asserting `200`. Both use `AbortSignal.timeout`.

- [ ] **Step 1: failing test** with a fake `BundleServiceFetcher` (returns a canned `BuildResponse` JSON / a streamed body); assert `build` returns the volumes and throws on `ok:false`; `buildStream` returns the response body.
- [ ] **Step 2: RED.**
- [ ] **Step 3: implement** the adapter (zod schema for `BuildResponse`; throw-not-ok).
- [ ] **Step 4: GREEN + commit** — `"feat(bundling): bundle container adapter (build + buildStream over BUNDLE_SERVICE)"`.

### Task A3: Accept `BundleOptions` in the download route + a pure lane selector

**Scope note (ordering):** A3 is self-contained — it adds the request `options` field, the `422` validation, and a **pure `selectBundleLane` function** (unit-tested in isolation), and keeps today's plain behavior for absent/plain options. It does NOT execute the optioned lanes — that wiring lands in A4 (async) and A5 (encrypted), which consume `selectBundleLane`'s result. So A3 has no dependency on A4/A5.

**Files:**

- Create: `apps/worker/src/downloads/bundle-lane.ts` (the pure `selectBundleLane`)
- Modify: `apps/worker/src/routes/files/downloads.ts` (add `options` to the schema + `422` validation; call `selectBundleLane`; for now, an optioned lane that isn't yet wired returns a `501`/clear problem OR falls through to the existing behavior only for the plain case — see below)
- Test: `apps/worker/test/bundle-lane.test.ts` (the pure selector) + extend `apps/worker/test/...downloads...` for the `422` path

**Behavior:**

- `ZipRequest` gains `options: bundleOptionsSchema.optional()`. Absent → today's behavior unchanged.
- Present → `validateOptionsForFormat(options)` non-empty → `422` problem listing the violations.
- `selectBundleLane(options | undefined): "plain" | "heavyAsync" | "encryptedStream"` (pure): `undefined` OR (`format==="zip"` && `compression==="store"` && `encryption===null` && `split===null`) → `"plain"`; else `encryption!==null` → `"encryptedStream"`; else → `"heavyAsync"`.
- In the route this task: `"plain"` → the existing lanes unchanged. `"heavyAsync"`/`"encryptedStream"` → return a `501` problem ("bundle option not yet available") as an explicit interim, replaced in A4/A5. (This keeps A3 shippable and honest; the `501` is removed when A4/A5 land.)
- The audit `recordExport` gains `format`/`compression`/`encrypted`/`split` flags (counts/flags only, never content or password) — applied in the plain path now, extended in A4/A5.

- [ ] Steps: failing test for `selectBundleLane` (all branches) + the route `422` on invalid options → RED → implement `bundle-lane.ts` + the schema/validation/501-interim in the route → GREEN → **re-emit OpenAPI + regenerate client** (the new `options` field + `422`/`501` responses change the contract) → commit `"feat(bundling): accept BundleOptions in the download route + pure lane selector"`.

### Task A4: Heavy unencrypted async lane (coordinator + queue + consumer)

**Files:**

- Modify: `apps/worker/src/downloads/bundle-types.ts`, `bundle-coordinator.ts`, `bundle-consumer.ts`, `routes/files/bundle-status.ts`
- Test: `apps/worker/test/bundle-build-optioned.test.ts`

**Behavior:** the `BundleBuildMessage` gains `options: BundleOptions` and `manifest: BundleManifest` (the prebuilt manifest, password-free since this lane is unencrypted) and the cache key replaces `manifestHash` for optioned builds (`bundleCacheKey`). `BundleJobState` gains `volumes: BuildResultVolume[]` (the ready artifact key(s)) — single-element for a non-split bundle, N for 7z split. The consumer calls `bundleContainerAdapter(env.BUNDLE_SERVICE).build(message.manifest)` instead of `client-zip` (the manifest's `outputKeyPrefix` is `bundles/<cacheKey>`), then `markReady(volumes)`. `bundle-status` returns a fresh signed URL per volume. The plain-ZIP async path (Task A3 "plain lanes") still uses the existing `client-zip` consumer path unchanged — branch the consumer on whether `message.manifest` is present.

- [ ] Steps: failing test (a stubbed `BUNDLE_SERVICE` fake; assert the consumer writes the volumes the adapter reports and `markReady` records them; status signs each) → RED → implement type/DO/consumer/status changes → GREEN → commit `"feat(bundling): heavy unencrypted async lane via the bundle container (multi-volume)"`.

### Task A5: Encrypted single-file stream lane

**Files:**

- Modify: `apps/worker/src/routes/files/downloads.ts`
- Test: `apps/worker/test/downloads-encrypted.test.ts`

**Behavior:** for `options.encryption !== null`: build the manifest (`buildBundleManifest` with the password; `outputKeyPrefix` unused for streaming — the container streams instead of PUTting), call `bundleContainerAdapter(env.BUNDLE_SERVICE).buildStream(manifest)`, and return that streaming `Response` to the client with `content-type: application/zip|application/x-7z-compressed` and a `content-disposition` from `options.outputName`. **No coordinator, no queue, no R2 artifact, no cache** — the password and the bytes exist only for the request. `recordExport` runs with `encrypted: true` (no password in the metadata). (Validation already guarantees no `split` here.)

- [ ] Steps: failing test (stub `buildStream` to return a body; assert the route streams it back, sets the headers, never calls the coordinator, and the audit metadata carries no password) → RED → implement → GREEN → re-emit OpenAPI if responses changed + regenerate client → commit `"feat(bundling): encrypted single-file stream lane (no artifact, password in-request-only)"`.

### Task A6: Wire `BUNDLE_SERVICE` binding + finalize the contract

**Files:**

- Modify: `apps/worker/src/app.ts` (the `Bindings` type — add `BUNDLE_SERVICE: Fetcher`), `apps/worker/wrangler.jsonc` (the `services` binding to `magna-carta-bundle`), `apps/worker/openapi/openapi.json` (re-emit), the generated client.
- Test: the existing conformance suite + a Miniflare integration smoke that the route is registered.

- [ ] Steps: add the binding to `Bindings` + `wrangler.jsonc` `services`; ensure all tests pass with the binding present (tests provide a fake); **re-emit OpenAPI + regenerate client**; run `pnpm check` + the worker suite → commit `"feat(bundling): BUNDLE_SERVICE binding + contract re-emit"`.

---

## Phase B — dedicated `apps/bundle-worker` (mirror `apps/scan-worker`)

### Task B1: `apps/bundle-worker` scaffold + `BundleContainer` + `/build` proxy + outbound R2 handler

**Files:**

- Create: `apps/bundle-worker/package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.jsonc`, `src/index.ts`, `src/bundle-container.ts`, `src/forward-build.ts`
- Test: `apps/bundle-worker/test/forward-build.test.ts`

**Mirror `apps/scan-worker` exactly** (read `apps/scan-worker/{src/index.ts,src/scan-container.ts,src/forward-scan.ts,wrangler.jsonc}`):

- `src/bundle-container.ts`: `export class BundleContainer extends Container { defaultPort = 8080; requiredPorts = [8080]; sleepAfter = "10m"; pingEndpoint = "ready"; enableInternet = false; }` (R2 reached via the outbound handler, so no real egress).
- `src/index.ts`: `Bindings = { BUNDLE_CONTAINER: DurableObjectNamespace<BundleContainer>; R2: R2Bucket }`; re-export `BundleContainer`; `fetch` routes `POST /build` → `forwardBuild(request, getContainer(env.BUNDLE_CONTAINER, "bundle"))`; **set `BundleContainer.outboundByHost = { "bundle-r2": async (request, env) => { /* GET → env.R2.get(key).body ; PUT → env.R2.put(key, request.body) */ } }`** so the container's `http://bundle-r2/<key>` calls are serviced by this worker's `env.R2` (stream bodies; a GET miss → 404, a PUT → 200). A warm-poke cron (`*/8 * * * *`) hits the container `ready` within `sleepAfter`.
- `src/forward-build.ts`: forwards the manifest POST (and `?stream=1`) to the container, returns its response verbatim (the streamed archive for the encrypted lane, or the `BuildResponse` JSON otherwise). Mirror `forward-scan.ts` (streaming body, `duplex: "half"`, timeout backstop).
- `wrangler.jsonc`: `workers_dev:false`, `preview_urls:false`; `containers` (`class_name: "BundleContainer"`, `image: "../../containers/bundle/Dockerfile"`, `instance_type` sized for the max bundle, `max_instances`); `durable_objects` binding + `migrations` (`new_sqlite_classes: ["BundleContainer"]`); the `R2` bucket binding; the warm-poke cron.

- [ ] Steps: failing test for `forwardBuild` + the outbound R2 handler against a fake container/`env.R2` (assert a GET streams the stored object, a PUT stores the body, `/build` forwards and returns the container response) → RED → implement → GREEN → `pnpm check` → commit `"feat(bundle-worker): dedicated worker — BundleContainer, /build proxy, outbound R2 handler"`.

### Task B2: Register the worker in the monorepo + deploy notes

**Files:**

- Modify: `pnpm-workspace.yaml` (already globs `apps/*` — confirm), the root build pipeline if it enumerates apps, and `docs/conventions/operations.md` (a deploy section mirroring the scan worker: build the `containers/bundle` image, deploy `magna-carta-bundle`, bind `BUNDLE_SERVICE` from the app worker).
- Test: `pnpm --filter @magna-carta/bundle-worker run test` green; `pnpm --filter @magna-carta/bundle-worker exec wrangler deploy --dry-run` validates.

- [ ] Steps: confirm workspace pickup; add the operations.md deploy section; dry-run validate → commit `"build(bundle-worker): workspace registration + deploy runbook section"`.

---

## Self-review

- **Spec coverage:** options accepted + validated + lane-routed (A3); manifest contract (A1); container adapter build + stream (A2); heavy unencrypted async multi-volume (A4); encrypted single-file stream, no artifact/cache/queue, password in-request-only (A5); binding + contract re-emit (A6); the dedicated bundle-worker with the outbound-Workers R2 handler (B1) + registration/deploy (B2). Matches the design notes' three lanes and the resolved encrypted-delivery decision.
- **Already done (not in this plan):** the pure bundling model + `validateOptionsForFormat`'s `zip.supportsSplit=false` and `encryption+split` rules (on this branch); the container itself (Plan 2).
- **Verifiability:** Phase A is fully testable in the worker pool with `BUNDLE_SERVICE` stubbed (mirroring `containerScanAdapter`). Phase B's container is deploy-time (CI image gate, Plan 2); its forward/outbound logic is unit-tested with fakes.
- **Contract discipline:** A3/A5/A6 re-emit the OpenAPI snapshot + regenerate the client in the same commit (the byte-exact drift test enforces it).

## Follow-on

- **Plan 4 — UI:** the bundle-options surface (design system + Bits UI) gating off `FORMAT_CAPABILITIES`, with split disabled for ZIP, split and encryption mutually disabled, and the masked-password "never stored, share out-of-band, unrecoverable" notice.
- **Deferred:** encrypted + split (the ephemeral-async lane), deliver-to-portal/email, a stored-password delivery record (opt-in, own ADR).
