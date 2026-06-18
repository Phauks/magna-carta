---
number: 39
slug: performance-performance-concurrency-model-deliberate-compute
status: Accepted
date:
area: Performance
---

**Performance & concurrency model — deliberate compute placement + measure-first discipline** (not generic multi-threading). **Workers** = lean request handlers (stream, never buffer; concurrency is the platform's); **heavy/CPU work** = native Rust in **Containers** + **Queues** + per-job **Durable Objects**; **Durable Objects** = single-threaded coordinators; a **shared Rust core (WASM + native)** for compute-heavy parity features; the **browser** keeps the UI main thread free (Web Workers, list virtualization, code-splitting); **Tauri** runs real multi-threaded local Rust. Resource discipline: stream / paginate / no-N+1 / bounded Worker memory. Optimize against the **fixtures load profile**; promote hot-path logic to Rust→WASM only on profiling evidence. **Concrete per-tier budgets and CI perf gates deferred** until there is code to measure — model & discipline are foundational now. **Build in vertical slices.** Rejected: speculative pre-threading / premature micro-optimization.
