---
branch: claude/search-perf-stats
worktree: .claude/worktrees/search-perf-stats
area: a standardized, owner-readable performance benchmark for the search and discovery read path
status: review
touches: crates/search-eval, crates/Cargo.toml, docs/conventions/performance.md, changelog.d/, docs/decisions/pending/
---

Builds the search/discovery read-path benchmark the owner can run from one command and read without
having written it: `cargo run -p search-eval --release -- benchmark`. It measures the real keyword
engine (`crates/search-core` — Tantivy, BM25, the split format, the ranged-read access pattern) at
three corpus tiers, reports latency percentiles with the corpus size, split size, and query count
behind each figure, and records a committed baseline labelled with the machine it was taken on.

The benchmark is deliberately honest about its boundary. The engine half runs locally and is measured
for real; the transport half (the search Worker's Container, R2 range GETs, the warm NVMe cache) and
the semantic half (Vectorize) cannot run on a local machine, so the report names them as unmeasured
rather than benchmarking a stub and presenting the number as the system's speed. The TypeScript
`SearchIndexPort` resolves to the deferred `engine-not-implemented` port everywhere off a deployment,
which is exactly the stub the report refuses to time.

New crate plus its documentation and fragments. The only shared files touched are `crates/Cargo.toml`
(one member entry and an additive `benchmark` cargo profile) and one bullet in
`docs/conventions/performance.md` pointing at the crate README, which is the single home for how to
run the benchmark and how to read it. No existing measurement module, profile, or baseline is edited,
so this stream does not collide with the load-profile harness or any domain slice: it does not touch
`packages/fixtures/`, the `ledgerVolume` profile, or `packages/fixtures/baselines/`.

**Not built here:** UI (deferred to the owner), and any change to `crates/search-core` itself — the
benchmark measures that crate through its public surface and does not modify it. The two engine gaps
the harness surfaced (no reuse of an opened index across queries; no ranged multi-split query) are
recorded as findings in the decision fragment, deliberately not fixed under a benchmark's cover.

## Overlaps

None declared. No other stream in the registry touches `crates/` or the search subsystem.
