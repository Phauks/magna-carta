# Enhanced Bundling — Plan 3 (worker orchestration) design notes

_Pre-plan design notes, grounded in the current worker code. The full implementation plan is written once
the encrypted-delivery fork (below) is decided. Dated 2026-06-25._

## Architecture (settled)

Mirror the dedicated-worker pattern the scan engine already uses (the "Container subsystems extract to
dedicated workers" standing rule):

- **`apps/bundle-worker`** (new) — a standalone, internal worker (`workers_dev:false`, reached only via a
  service binding), mirroring `apps/scan-worker`. It owns `BundleContainer extends Container`
  (`defaultPort=8080`, `pingEndpoint="ready"`, a generous `sleepAfter`; `enableInternet=false` — R2 goes
  through the outbound handler, not real egress), re-exports the class, and its `fetch` proxies
  `POST /build` to the container via `getContainer()`. Crucially it **also hosts the outbound-Workers R2
  handler** (`BundleContainer.outboundByHost = { "bundle-r2": (req, env) => … env.R2.get/put … }`), so the
  container's `GET/PUT http://bundle-r2/<key>` is serviced by this worker's `env.R2` binding — the
  container holds no credentials and needs no egress. This worker has the R2 binding; the main app worker
  reaches it via a `BUNDLE_SERVICE` Fetcher binding (like `SCAN_SERVICE`).
- **Main worker `apps/worker/src/downloads/`** — extended:
  - `routes/files/downloads.ts`: the `ZipRequest` schema gains an optional `options: BundleOptions` (reuse
    `bundleOptionsSchema` from `@magna-carta/file-manager/bundle-options`); validate with
    `validateOptionsForFormat`; apply `applyBundleLayout` to the resolved entries; choose the lane.
  - A `bundleContainerAdapter` (mirrors `containerScanAdapter`) over the `BUNDLE_SERVICE` Fetcher:
    POSTs the manifest, parses the `BuildResponse`, throws on non-200.
  - `bundle-types.ts` / `bundle-coordinator.ts` / `bundle-consumer.ts`: carry `BundleOptions` + the
    multi-volume artifact key list; the unencrypted build consumer calls the adapter instead of
    `client-zip`.
  - `routes/files/bundle-status.ts`: return the set of signed volume URLs when ready.
  - Cache key: `bundleCacheKey(entries, options)` (already built) instead of `bundleManifestHash` for
    optioned bundles. The CONTENTS manifest, when requested, is generated in the route from the
    `file_version` SHA-256 (`buildContentsManifest`) and passed as an inline entry in the manifest.
  - `wrangler.jsonc`: add the `BUNDLE_SERVICE` service binding (+ the new `bundle-worker` package).

## The three delivery lanes

1. **Plain ZIP, store, no encryption, no split** — unchanged: single-file 302, else inline `client-zip`
   stream, else the existing async `bundles/<hash>.zip` build. No container involved.
2. **Heavy, unencrypted** (compression / 7z / split, no password) — async via the existing coordinator +
   `bundle-build` queue, but the consumer calls `bundle-worker /build` with the manifest; artifact(s)
   cached at `bundles/<cacheKey>[.NNN]`; the poll endpoint signs each volume. Deterministic, cacheable.
3. **Encrypted** — see the fork below.

## OPEN FORK — encrypted-bundle delivery (needs a decision before the plan)

Constraints, all hard: the password is **never persisted** (so not in a durable queue message, not in DO
storage, not in a cache key); encrypted output is **non-deterministic** (random salt/IV) so it is **never
cached**; and an HTTP request **should not block for minutes** on a large build. These pull against each
other. Options:

- **A — Synchronous stream, no R2 artifact (recommended for the common case).** The route calls
  `bundle-worker /build` in "stream" mode: the container encodes and streams the single encrypted archive
  straight back through the worker to the client (like the inline `client-zip` lane, but via the
  container). The password lives only for the request; nothing is stored. **Limit:** works for a single
  artifact (no split) within the request/subrequest time budget — so encrypted is **single-file only, no
  multi-volume**, and very large encrypted bundles may time out. Simplest, strongest secret posture.
- **B — Ephemeral async with an in-memory password (no durable persistence).** Keep the password only in
  the bundle-worker's container memory for the duration of one build kicked off synchronously (the route
  calls `/build` which returns quickly with a job handle held in the container instance, not a DO/queue);
  the client polls; the artifact is written to R2 with a **short TTL** and a one-time signed URL, then the
  build state evaporates with the instance. Supports split + large bundles, but the password transits the
  bundle-worker request and the build state lives in a single container instance (no durability — a crash
  loses the job, which is acceptable: the user re-requests). More moving parts; weaker-but-still-sound
  posture (password never written to disk/D1/R2/queue/logs).
- **C — Encrypted bundles are size-capped + synchronous (no split, no async).** Like A, but explicitly
  cap encrypted bundles at a size that always builds within the request budget; over the cap, the UI tells
  the user to use 7z split (which would then need B) or an unencrypted bundle. Smallest scope.

Recommendation: **A** for v1 (single encrypted artifact, streamed, never stored) — it is the strongest
confidentiality story and covers the common "email a password-protected archive" case; \*\*defer encrypted

- split\*\* to a later iteration (option B) and have the capability surface reflect that (encrypted disables
  split in the UI, and vice versa). This keeps Plan 3 shippable and the secret posture airtight.

### DECISION (resolved 2026-06-26): option A — stream, never store

Confirmed: passwords are **never stored** (user-supplied only; storing would defeat the encryption for
the external-delivery use case and add a standing secret liability — re-bundling on demand covers any
"re-download/lost password" convenience). Encrypted bundles take lane **A**: the container streams the
single encrypted archive back through the worker to the client, **no R2 artifact, no cache, no queue**;
the password lives only for the request. **Encrypted is single-file only in v1 — encrypted + split is
invalid** (deferred to a later ephemeral-async iteration). A stored-password "delivery record" remains a
possible future opt-in feature (encrypted vault + access control + its own ADR), explicitly out of v1.

Immediate consequence realized now (ahead of the full plan): `validateOptionsForFormat` rejects
`encryption != null && split != null`, and the UI mutually disables split and encryption. The rest of
Plan 3 (the worker tasks above) is now fully specified and ready to write.

## Out of scope for Plan 3

UI (Plan 4). The live `bundle-worker` container deploy + `BUNDLE_SERVICE` activation are deploy-time
(billing-gated), like the scan/edit containers — the adapter is stubbed in tests (mirroring
`containerScanAdapter`), so Plan 3 is fully testable in the worker pool without a live container.
