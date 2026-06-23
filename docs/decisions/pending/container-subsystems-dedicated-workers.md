---
slug: container-subsystems-dedicated-workers
status: Accepted
date: 2026-06-23
area: Platform architecture
summary: "Heavy Container-backed subsystems that process untrusted bytes — malware scanning, file conversion, document editing, and the future PDF engine — execute in their own dedicated Cloudflare Workers, not in the main app worker, each reached over an internal service binding with no public surface and outbound networking disabled. The app worker keeps the orchestration (Durable Objects, queues, routes, firm-scoped state) and selects the engine behind an existing port boundary, so the split is transport-only and the orchestration does not change. Search (Tantivy) is the explicit exception — its index is durable per-firm data, not stateless compute. Scan (apps/scan-worker) and conversion (apps/convert-worker, slice 2·4c) are the first two; editing (2·2) and the PDF engine follow the same pattern."
---

**Heavy Container subsystems extract to dedicated workers, reached via internal service bindings.**

**Context:** several subsystems run CPU/memory-bound native engines inside Cloudflare Containers over
**untrusted, privileged** bytes with outbound networking disabled — malware scanning (clamd + yara-x +
heuristics), file conversion (native libvips, LibreOffice headless, FFmpeg, the future Rust PDF
engine), and document editing (the per-document LibreOfficeKit process). Wiring these engines directly
into the main app worker couples their deploy cadence and blast radius to the app: a Container image
rebuild, an engine crash, or an engine's scaling profile would all bleed into the request worker. Each
of these subsystems already exposes (or naturally exposes) a narrow port — `MalwareScanPort`,
`ConversionPort`, the editing host contract — so *where the adapter executes* is a transport detail,
not an architectural boundary.

**Decision:** a subsystem extracts to its **own dedicated Cloudflare Worker** when it scores on the
rubric the scan extraction established: (1) heavy native/Container runtime; (2) an independent deploy
cadence (own image, crons, deploy hook); (3) a distinct scaling profile (own `max_instances`, cannot
starve the app worker); (4) containment — untrusted bytes, outbound disabled, **no public surface**,
reachable only via service binding; (5) stateless compute (the Container DO holds zero firm state).
The dedicated worker owns the engine Container(s); the **app worker keeps the orchestration**
(Durable Objects, queues, routes, and all firm-scoped/data-access-layer state) and reaches the engine
through a thin service-binding adapter that implements the subsystem's existing port. A light in-worker
WASM fast-path may remain in the app worker where it genuinely helps (e.g. wasm-vips for small
rasters) — the port's adapter selection makes "in-worker WASM" and "container-native via service
binding" two interchangeable backends.

**Scope:** malware scanning (`apps/scan-worker` → `magna-carta-scan`) and file conversion
(`apps/convert-worker` → `magna-carta-convert`, slice 2·4c) are the first two. Document editing
(2·2) and the PDF engine follow the same pattern as they mature. **Search (Tantivy) is the explicit
exception:** its value is a durable, per-firm index — firm *data*, not stateless compute — so it fails
rubric (5) and stays inside the data plane rather than becoming a stateless engine worker.

**Consequences:** each engine subsystem gains an isolated deploy/scaling/failure domain and a tight
containment boundary, at the cost of one extra worker + service binding per subsystem and a
cross-worker hop on the (already off-hot-path, queue-driven) engine call. Because the split is at the
existing port, the orchestration code is unchanged and the seam is one adapter. The decision is cheap
to apply now — before the heavy engines land in the app worker — and expensive to retrofit later, so
new heavy-Container subsystems should adopt it from the start. Builds on the integration port
architecture (ADR-0091/0092) reused for in-house adapters, and the in-house-only conversion guarantee
(ADR-0030 and `conversion-in-house-only-single-engine`) — extraction changes *where* the engine runs,
never that bytes stay in-tenant.
