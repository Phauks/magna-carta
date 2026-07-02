# Performance conventions

**Status:** Active (principles + discipline apply now; concrete budgets/CI gates land with the code to measure).

**Scope (single home for):** how performance is achieved in practice — where each kind of work runs, the resource-discipline rules, and the measure-first profiling habit. Performance is a **golden rule** (root [`CLAUDE.md`](../../CLAUDE.md)) and a guiding principle.

**Authoritative context:** the white paper's _Performance & concurrency model_ (the design). This file is the practitioner's how-to.

## Compute placement — put work in the right tier

- **Request handlers (Workers):** lean CRUD/orchestration only; stay within the per-request CPU/memory budget; **stream, never buffer** large data. Don't try to "thread" a Worker — the platform runs many isolated instances.
- **Heavy / CPU-bound:** native Rust in **Containers** + **Queues** fan-out + a **Durable Object per job** for progress (OCR, indexing, conversion, doc-gen, discovery extraction).
- **Coordination:** **Durable Objects** (single-threaded) for timers, doc sessions, job orchestration.
- **Browser:** keep the UI main thread free — **Web Workers** for CPU-bound work, **virtualize** large lists, rely on per-route code-splitting.
- **Desktop (Tauri):** real multi-threaded Rust for local accelerations.

## Resource discipline (RAM/CPU)

- Stream don't buffer · paginate · **no N+1** (batch/join in the DAL) · bounded Worker memory (offload past the budget) · bounded queue concurrency.

## Measure-first

- **No speculative pre-threading or micro-optimization.** Optimize against evidence.
- The fixtures **load profile** (white paper _Synthetic data & fixtures_; ADR-0083) is the standing performance/scaling harness: `pnpm --filter @magna-carta/fixtures run measure` produces the committed baselines; the CI smoke keeps it green. Numbers are relative (local `node:sqlite`, not production D1) — regressions and plan shapes, not absolute latencies.
- Promote hot-path logic to Rust→WASM only when profiling demands it.
- **Transfer weight on constrained networks is measured here too.** A slow-network / per-route transfer-weight profile extends this harness (lands with the first real SPA routes); it is the baseline the per-route transfer budget is checked against. The _behaviour_ rules for constrained networks — resumable transfer, no-cache-bust backoff, last-known-value rendering, the budget itself — live in [`network-resilience.md`](network-resilience.md); this file stays the single home for how that weight is **measured**.

## To formalize (later)

- Concrete per-tier resource budgets and CI performance gates, once there is code to measure against (including the per-route transfer budget gate above, once the transfer-weight profile has a measured baseline).
