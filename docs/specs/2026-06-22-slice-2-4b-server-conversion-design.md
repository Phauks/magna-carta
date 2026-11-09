# Slice 2·4b — Server Conversion Path + native-libvips engine — Design

**Date:** 2026-06-22
**Status:** Designed — implementation plan + build to follow.
**Scope:** The first server-side conversion sub-slice: the **orchestrator** (route → tracked job →
Container engine → result → token download) proven with **one** engine (native **libvips** in a
Container), exposed via the **general File Converter Tool's transient route** (convert → download, no
matter). **Uniform-async** (owner: lean on option 1). Reuses 2·1's Container/Queue/Durable-Object
substrate. Engines are additive behind `ConversionPort`; LibreOffice/email/FFmpeg and the
matter-attached save-as-version path are later sub-slices.

**Build scope (owner: less-work):** the orchestration **code + the Container adapter seam +
fake-tested e2e**. The **real libvips Container image + its wrangler binding/deploy** are a deploy-time
activation step — exactly the `ScanContainer` precedent (the engine cannot run under the local test
pool, so it has no test-environment binding; tests inject a fake adapter). This slice proves the
substrate; the real image lights it up at deploy.

## Architecture — the flow (uniform-async, matter-free)

1. **Upload (transient).** Client requests a presigned PUT (reuse `files/presign.ts` +
   `routes/files/uploads.ts`) and uploads the source to a **transient R2 prefix** (`conversions/<jobId>/source`).
2. **Submit.** Client POSTs `convert {sourceKey, targetFormat}` to the route (0·5 chokepoint,
   `tools:fileConverter`). The route validates the edge against the registry, mints a `jobId`, creates
   a **`ConversionJob` Durable Object** in `queued`, and **enqueues** the job on a `CONVERSION` queue.
3. **Execute (queue consumer).** The consumer marks the job `running`, resolves the engine for the
   path (libvips → the **libvips Container** via `resolveLibvipsPort(env)`), streams the source from R2
   to the Container (`env.LIBVIPS_CONTAINER.get(id).fetch(bytes + recipe)`), writes the converted bytes
   to a **transient result key** (`conversions/<jobId>/result`), and marks the job `done` (or `failed`
   with the typed `ConversionResult` reason). Queue `max_concurrency` is the per-tenant
   fairness/backpressure lever; retries + dead-letter per the relay discipline.
4. **Poll + download.** Client polls `GET /conversions/<jobId>` (the `ConversionJob` DO's status); on
   `done` it returns a **short-lived HMAC token** (the `files/preview-token.ts` pattern, over
   `AUTH_SECRET`). `GET` the result via the cookieless download path streams it from R2. An R2
   **lifecycle TTL** reaps both the source and result keys.

## Components (each mirrors a named precedent)

- **`ConversionJob` Durable Object** — per-job state (`queued`→`running`→`done`/`failed`, the source
  - result R2 keys, `firmId`, the typed failure reason). Mirrors `downloads/bundle-coordinator.ts`.
- **`CONVERSION` queue + consumer** — wired into the worker `queue()` handler; dead-letters after max
  retries. Mirrors `downloads/bundle-consumer.ts`.
- **Routes** (through the ADR-0067 chokepoint): `POST /conversions` (submit), `GET /conversions/:id`
  (status + token on done), `GET /conversions/:id/result?token=…` (download). Mirrors
  `routes/files/bundle-status.ts` + `routes/files/downloads.ts` + `routes/files/uploads.ts`.
- **`LibvipsContainer extends Container`** — `enableInternet: false` (untrusted bytes — the cross-cutting
  untrusted-input posture), `pingEndpoint`, `sleepAfter`, a warm-poke cron. Runs native libvips behind
  a tiny HTTP service (bytes + recipe in → bytes out). Mirrors `files/scan-container.ts`.
- **`resolveLibvipsPort(env)`** — the one-line seam selecting the real Container `ConversionPort`
  adapter when the binding is present, else throwing in prod. Mirrors `resolveScanPort`. Tests inject
  a **fake** that returns converted bytes.
- **Transient R2** — a `conversions/` prefix with an R2 lifecycle TTL (proposed **24h**); keys are
  server-minted and job-scoped, firm-isolated.

## Data isolation & security

- Every route is firm-scoped through the chokepoint; the `ConversionJob` DO and the R2 keys carry the
  `firmId`; a cross-firm job id or result token → **404** (the 2·3 isolation precedent).
- The Container processes untrusted bytes with `enableInternet: false` (no egress) — the converter is
  another untrusted-bytes boundary, consistent with 2·1 scanning and 2·3 safe-delivery.
- The download token is HMAC over `AUTH_SECRET`, short-lived, single-result-scoped; no matter, no
  audit attach (transient tool output).

## Testing

- **Miniflare e2e:** presign → upload → submit → (**fake** libvips adapter converts) → poll `done` →
  token download → bytes match. Tenant isolation (cross-firm job/result → 404). Failure path
  (engine error → job `failed`, typed reason surfaced).
- **Unit:** the `ConversionJob` state transitions; the queue-consumer engine resolution + R2 write;
  token mint/verify reuse.
- The conformance fitness (audited/permission/chokepoint rules) covers the new routes.
- The real Container is not exercised in tests (no local pool) — the fake adapter stands in.

## Deferred

- The **real libvips Container image** (Dockerfile + the tiny HTTP service) + its wrangler
  `containers`/`durable_objects` binding + deploy — the activation step (scan precedent).
- The **inline wasm fast-path** (small files convert in-Worker via `convertFile`) — a later, measured
  optimization (golden rule 10); local-on-device conversion is already available via the built helpers.
- **LibreOffice / email / FFmpeg** engines — additive Containers behind `ConversionPort` (their own
  sub-slices; LibreOffice aligns with 2·2's per-document container pattern).
- The **matter-attached path** (convert a matter file → save as a new version via file-manager).
- The **UI** (0·7a shell) and **role-seeding** of `tools:fileConverter`.

## Open items for the plan

- The `ConversionJob` DO storage shape + status enum; the queue message shape.
- The R2 transient TTL value + lifecycle-rule wording; whether the cron warm-poke is added now or with
  the real image.
- Whether `POST /conversions` accepts small bodies inline (skip presign) or always presign — propose
  **always presign** (uniform, no Worker body-size ceiling).
