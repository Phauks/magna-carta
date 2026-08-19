# Performance & Concurrency

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: performance
  name: Performance & concurrency model
  scope: Deliberate compute placement (Workers / Containers+Queues / Durable Objects / Rust core / browser / desktop) plus a measure-first discipline against the load-profile harness.
  status: partial
  adrs: ADR-0039
  evidence: Placement tiers realized across apps/ and crates/; budgets/CI gates deferred by design; desktop tier not started.

- id: performance.compute-placement
  name: Compute-placement model
  scope: Each unit of work assigned to its tier; concurrency lives in the platform, not hand-threaded Workers.
  status: partial
  adrs: ADR-0039
  evidence: Dedicated container Workers, queue fan-out, and per-job Durable Objects in place; browser and desktop tiers incomplete.

- id: performance.compute-placement.lean-workers
  name: Lean streaming request handlers
  scope: Latency-sensitive CRUD/orchestration only in Workers; large data streamed, never buffered.
  status: shipped
  surface: internal
  adrs: ADR-0082
  evidence: apps/bundle-worker streaming bulk-download zip; apps/worker/src/downloads streaming paths.

- id: performance.compute-placement.containers-queues
  name: Heavy work in Containers via Queues
  scope: OCR, indexing, generation, conversion, extraction as native Rust/containers fanned out through Queues with a Durable Object per job.
  status: shipped
  surface: internal
  adrs: ADR-0122, ADR-0138
  evidence: apps/convert-worker, ocr-worker, scan-worker, file-repair-worker, recovery-worker, bundle-worker extracted to dedicated Workers.

- id: performance.compute-placement.sandbox-hardening
  name: Untrusted-input sandbox hardening
  scope: No-egress, least-privilege-per-job, ephemeral, resource-capped containers for native parsers over untrusted files; assume-escape posture.
  status: shipped
  surface: internal
  evidence: apps/scan-worker (forward-scan/identify/histogram, warm lifecycle) + docs/conventions/security.md untrusted-file-handling section.

- id: performance.compute-placement.durable-object-coordination
  name: Durable Object stateful coordination
  scope: Single-threaded DOs for correctness/serialization: live timers, job orchestration, per-firm database access.
  status: shipped
  surface: internal
  adrs: ADR-0131, ADR-0140
  evidence: Live-timer DO + per-firm-database DO (status.d/per-firm-database-durable-object.md) + per-job progress DOs in the conversion pipeline.

- id: performance.compute-placement.rust-core
  name: Shared Rust core (WASM + native)
  scope: Compute-heavy parity features as one Rust core compiled to WASM for web and native for desktop/containers.
  status: shipped
  surface: internal
  adrs: ADR-0128, ADR-0129, ADR-0161
  evidence: crates/ (pdf-core, email-core, ocr-core, decryption-core, recovery-core, engine-host) consumed via packages/{pdf,decryption,email} WASM builds.

- id: performance.compute-placement.browser
  name: Browser main-thread discipline
  scope: Web Workers for CPU-bound work, virtualization for large lists, per-route code-splitting, no client-data caching.
  status: partial
  surface: internal
  evidence: Per-route code-splitting inherent to the SvelteKit SPA. List virtualization is built as a design-system primitive — packages/design-system/src/lib/internal/virtual-list.svelte over virtua's Virtualizer, keeping a bounded DOM past roughly 200 rows — and reaches apps/web through the combobox in recipient-picker.svelte; no other large list uses it yet. No Web Worker offload exists anywhere in apps/web.

- id: performance.compute-placement.desktop
  name: Desktop local accelerations
  scope: Multi-threaded Rust in the Tauri shell for bulk ingest, local OCR, local Tantivy index — optional, with server fallback.
  status: deferred
  adrs: ADR-0002, ADR-0024
  evidence: Desktop is sequenced after the web MVP; no Tauri code in the repo.

- id: performance.resource-discipline
  name: Resource discipline defaults
  scope: Stream not buffer, paginate, batch/join in the data-access layer (no N+1), bounded Worker memory and queue concurrency; enforced in review.
  status: partial
  surface: internal
  evidence: docs/conventions/performance.md + streaming/paginated statement patterns in packages/data-access; review-enforced, no automated gate.

- id: performance.load-profile-harness
  name: Load-profile harness
  scope: Volume profiles plus a query measurement runner over the synthetic fixtures; every domain slice extends it in-area.
  status: shipped
  surface: internal
  slices: load-profile-harness
  adrs: ADR-0083
  spec: docs/specs/2026-06-11-load-profile-harness-design.md
  evidence: packages/fixtures/src/load-profile/ (generate.ts + per-domain measurements); STATUS load-profile column audits coverage.

- id: performance.budgets-ci-gates
  name: Per-tier budgets & CI performance gates
  scope: Concrete numeric budgets and CI perf gates over the harness.
  status: deferred
  adrs: ADR-0039
  evidence: Explicitly deferred until there is code to measure; the model/discipline is foundational now, the numbers arrive with the code.

- id: performance.wasm-promotion
  name: Profiling-gated Rust-WASM promotion
  scope: Hot-path client logic promoted to the Rust/WASM core only on profiling evidence from the harness.
  status: not-started
  evidence: No promotion decided by profiling yet; existing WASM engines were built as engines, not promotions.
