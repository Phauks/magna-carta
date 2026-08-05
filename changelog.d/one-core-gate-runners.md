---
category: Changed
---

**The gate's short jobs run on GitHub's 1-vCPU Linux runner.** `changes`, `format`, `governance`,
`contracts`, both `test-node` shards and the `gate` roll-up moved from `ubuntu-latest` to
`ubuntu-slim` — 1 vCPU / 5 GB at $0.002 a minute against the 2-core runner's $0.006, a third of the
rate for identical work. Each of those jobs measured two minutes or less and none is meaningfully
parallel; the per-job comments in `.github/workflows/gate.yml` record the measurement behind each
choice. `lint`, `typecheck`, `test-worker`, `test-stories`, `rust`, `containers` and `wasm` stay on
the 2-core runner: they either want the cores, exceed the slim runner's hard 15-minute job cap, need
more than 5 GB, or need a Docker daemon the slim runner's unprivileged container does not provide.
Nothing about what the gate checks changes.
