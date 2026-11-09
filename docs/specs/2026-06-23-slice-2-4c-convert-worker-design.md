# Slice 2·4c — the dedicated conversion engine worker (`magna-carta-convert`)

**Status:** design · **Date:** 2026-06-23 · **Area:** File conversion
**Builds on:** 2·4a (conversion core — `@magna-carta/conversion`), 2·4b (server orchestration — the
`ConversionJob` DO + `CONVERSION` queue + consumer + routes, all placement-agnostic via
`resolveEnginePort`). **Pattern:** the Container-subsystem extraction (`apps/scan-worker`).

## Why

2·4b landed the conversion orchestration in the app worker, deliberately placement-agnostic: the
consumer calls `resolveEnginePort(env).convert(...)`, which today returns the deferred port
(`engine-not-implemented`). The heavy native engines (native libvips for large rasters + formats the
in-browser wasm-vips can't do; later LibreOffice headless, FFmpeg, the Rust PDF engine) are
CPU/memory-bound runtimes that process **untrusted, privileged** document bytes with outbound
networking disabled — exactly the profile that put malware scanning in its own worker. Per the
Container-subsystems-dedicated-workers decision (ADR pending), they belong in a **dedicated worker**,
not the app worker: independent deploy cadence, isolated scaling (`max_instances`, can't starve the
app worker), and a clean containment blast-radius. The split is the existing `ConversionPort`
boundary, so the DO/queue/consumer/routes do not change — only where the adapter _executes_.

## The worker — `apps/convert-worker` (`magna-carta-convert`)

A direct transposition of `apps/scan-worker`. Stateless: no D1, R2, or Queues. **No public surface**
(`workers_dev:false`, `preview_urls:false`) — reached only via a service binding from the app worker,
which is the trust boundary (no auth in this worker).

- **`src/libvips-container.ts`** — `class LibvipsContainer extends Container` with `enableInternet =
  false` (untrusted bytes never reach the network), a `defaultPort`, a short `sleepAfter`, and a
  `pingEndpoint` (the boot-readiness probe). **Scale-to-zero, no warm cron:** the Container sleeps
  after `sleepAfter` and bills only while a conversion runs — conversions are bursty/on-demand, so an
  always-on warm instance would pay continuously to save a cold start that rarely matters (unlike scan,
  whose ~1–2 GiB resident signature DB justifies a warm-poke). The first engine Container; additional
  engines (LibreOffice, FFmpeg) become **additional `Container` DO classes** later — one per engine —
  selected by `engineId`.
- **`src/forward-convert.ts`** — `forwardConvert(request, container)`: streams the source body to the
  engine Container's `POST /convert` (preserving `duplex:"half"`), passing the target format + recipe
  as headers/query, and returns the container's response **verbatim** (converted bytes + the
  `Content-Type` the engine set, or a non-2xx status). A network failure throws (surfaced through
  telemetry), never a silent empty result. Mirrors `forwardScan`. Engine selection: the proxy maps the
  request's `engineId` to the right Container DO; for now only `libvips` is wired.
- **`src/index.ts`** — `Bindings` (the engine Container DO namespace(s)); the `fetch` handler routing
  `POST /convert` → `forwardConvert(getContainer(env.LIBVIPS_CONTAINER, "libvips"))` and `404`
  otherwise; re-exports the Container class(es). **No `scheduled` handler / no cron** — scale-to-zero
  (see `libvips-container.ts`); if cold-start latency ever bites, the lever is warming on demand
  (booting when a job is enqueued), not a blind cron.
- **`wrangler.jsonc` / `package.json` / `tsconfig.json` / `vitest.config.ts` / `worker-env.d.ts`** —
  mirror `apps/scan-worker`. The `containers` binding references `../../containers/convert/Dockerfile`
  (the image is **deploy-time**, see Out of scope); if `wrangler deploy --dry-run` requires the
  Dockerfile to exist, add a minimal placeholder Dockerfile under `containers/convert/` with a
  CLAUDE.md noting the real in-container service is deferred — otherwise omit the `containers` binding
  from the committed config and add it at deploy (whichever keeps dry-run green; decide empirically).

## The app-worker seam — `resolveEnginePort` → service-binding adapter

This **restores** the engine adapter removed in the 2·4b realignment, now pointed at the service
binding instead of a same-worker Container DO.

- **`apps/worker/src/app.ts`** — add `CONVERT?: Fetcher` to `Bindings` (optional: absent in every test
  environment and until the deploy-time service binding; a `Fetcher` is the service-binding type).
- **`apps/worker/wrangler.jsonc`** — add a `services` block binding `CONVERT` →
  `magna-carta-convert`.
- **`apps/worker/src/conversions/conversion-engine.ts`** — `resolveEnginePort(env)`: when `env.CONVERT`
  is present, return a `ConversionPort` whose `convert(input)` POSTs the source bytes + `{ from, to,
  engineId, recipeRef }` to `env.CONVERT.fetch("https://convert/convert", …)`, maps a 2xx →
  `converted(new Uint8Array(await res.arrayBuffer()), res.headers.get("content-type") ?? …)` and a
  non-2xx or a thrown transport error → `adapterError(...)` — **never throws** (the integrations
  Dispatch discipline, matching the consumer's `!result.ok` → `markFailed` + ack contract). When
  `env.CONVERT` is absent, return the deferred port (unchanged).

## Testing (the engine Container can't run under the local pool — fake it)

- `apps/convert-worker/test/forward-convert.test.ts` — fake `{ fetch }` Container: assert the proxy
  forwards `POST /convert` with the body + target/recipe, returns the container response verbatim
  (bytes + content-type), and propagates a non-2xx. Mirrors `forward-scan.test.ts`.
- `apps/worker/test/conversion-engine.test.ts` (or extend an existing conversions test) — `resolveEnginePort`
  with a fake `CONVERT` `Fetcher`: a 2xx container response → `converted` with the right bytes/mediaType;
  a non-2xx and a thrown fetch → `adapterError` (never throws); `env.CONVERT` absent → the deferred port.
- The app worker's existing conversion e2e (2·4b) already injects a fake `ConversionPort` at the
  consumer seam, so the end-to-end journey stays covered; this slice adds the adapter-level coverage.

## Out of scope (deferred / deploy-time)

- **`containers/convert/`** — the real Dockerfile + the in-container libvips HTTP service (a Rust/axum
  service exposing `POST /convert` + a `ready` probe, like `containers/scan`). Heavy, deploy-time, and
  cannot run under the test pool — a separate effort.
- The **LibreOffice headless** and **FFmpeg** engine Containers (additional `Container` DO classes +
  `engineId` routing) — added when those edges are prioritized.
- Wiring the real service binding + deploying the worker (a deploy-time step).
- The conversion **UI** (the 0·7a widget) — deferred.

## Open question for the plan

- Whether `wrangler deploy --dry-run` builds/validates the referenced container image (decides whether
  a placeholder `containers/convert/Dockerfile` is needed now, or the `containers` binding is added at
  deploy). Resolve empirically in the wiring task.
