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

## To formalize (later)

- Concrete per-tier resource budgets and CI performance gates, once there is code to measure against.
