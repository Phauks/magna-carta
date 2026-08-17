---
number: 308
slug: a-benchmark-names-the-path-it-could-not-measure
status: Proposed
date: 2026-08-13
area: Search
summary: "The search and discovery read path gets its own standing benchmark, as a `search-eval` harness crate beside the engine on the `pdf-eval` pattern, rather than an extension of the TypeScript load-profile harness — the load profile measures per-firm database reads through node:sqlite and cannot reach a Rust Tantivy engine at all, and the two meet by sharing a percentile convention rather than a runtime. The binding rule is that the benchmark measures only paths that genuinely execute and states the rest as unmeasured: it runs against crates/search-core itself so no engine behaviour is simulated, and it refuses to time the deferred SearchIndexPort, the Container hop, R2 range GETs, the warm cache, Vectorize, or reciprocal rank fusion, printing that list before any figure and storing it inside the baseline file so a number cannot be quoted apart from its caveats. Every figure carries the corpus size, index size, hit count, and query count behind it, and the target beside it. Two axes are measured separately because they scale on different variables — corpus size with the corpus compacted into one split, and split fan-out with one split per document version as the pipeline publishes today — and their meeting point at equal document counts quantifies compaction: 45 ranged reads compacted against 186,293 for the same 5,000 documents uncompacted. The benchmark stays out of every gate as a deliberate command, under its own cargo profile because the workspace release profile optimizes for size and would understate the engine."
---

**A performance report is only worth the boundary it draws: this benchmark measures the real engine,
and names every part of the read path it could not reach rather than substituting a stub for it.**

**Context:** "How fast is search?" had no answer anyone could produce on demand. The pieces to answer it
existed and pointed in different directions. The keyword engine is real and local — `crates/search-core`
builds Tantivy splits and answers BM25 queries, and its ranged-read directory is exactly the access
pattern a split in R2 is designed for. But the path around it is mostly not: the TypeScript
`SearchIndexPort` resolves to a deferred port returning `engine-not-implemented` anywhere off a
deployment, the search Worker's Container is not deployed, Vectorize is a deployed-only binding, and
reciprocal rank fusion is TypeScript that no local run executes.

That asymmetry is the trap. A harness driven from the TypeScript side would have produced a latency
figure by timing the deferred port — a number describing a function that returns a constant, presented
as the speed of search. A harness that quietly simulated the Container, or modelled an R2 round trip
with a sleep, would have been worse still: plausible, precise, and invented. The standing load-profile
harness cannot arbitrate this either, because it measures per-firm database reads through `node:sqlite`
and has no way to reach a Rust engine.

**Decision:** A separate harness crate, `crates/search-eval`, on the `pdf-eval` precedent — a
measurement binary beside the engine, reaching it only through its public surface, never inside it. It
composes with the load-profile harness by sharing that harness's percentile convention exactly, so a
"p95" printed by either means the same statistic; it does not share a runtime, because they cannot.

Three rules bind it.

**Measure only what executes.** Every number comes from `search-core` running. Nothing is stubbed,
modelled, or extrapolated. The deferred `SearchIndexPort` is deliberately not timed.

**State the boundary before the numbers.** The unmeasured list — the network, the search Worker and its
Container, the warm cache, the semantic half, fusion, the per-firm catalog read, extraction throughput,
and the unimplemented footer pruning — is printed above every table and stored as a field inside the
baseline file, so a figure cannot be lifted out of either without travelling with its caveats.

**No figure without its scope.** Corpus size, index size, hit count (the query's actual selectivity),
and the number of queries behind the percentile appear beside every latency, and the target beside that.
Read counts are presented ahead of milliseconds, because a ranged read is an R2 range GET in a
deployment: the count transfers off the machine and is deterministic, while the milliseconds are
machine-relative and mean nothing elsewhere.

**Two axes, measured separately because they scale on different variables.** Corpus size, compacted into
one split — the shape compaction produces. And split fan-out, one split per document version — the shape
the pipeline publishes today, since a split's object key is derived from `(document, version)` and a
query receives every live split key the catalog holds. The axes meet at an equal document count so the
cost of not compacting is a subtraction rather than an argument.

**Considered and rejected:** **Extending the load-profile harness** — the natural first instinct, and it
cannot execute a Rust engine; the seam it could reach, the catalog read, is one indexed SELECT and not
where search's cost lives. **Timing the port end to end for realism** — it would have timed
`engine-not-implemented`. **Modelling the missing hops** with an assumed R2 latency to produce a
"projected" production figure — a number nobody could later distinguish from a measured one, which is
the specific failure this decision exists to prevent. **Folding it into `pnpm test`** so it never rots —
it builds and queries corpora of hundreds of thousands of passages; the crate's fast unit tests carry
the anti-rot duty instead. **Reusing `--release`** — the workspace profile optimizes for size, which
understates the engine and makes runs under different profiles incomparable, so the crate adds a
`benchmark` profile and records in every baseline which one produced it.

**Consequences:** There is now a number for the read path, and it is honest about being partial. The
first run says the compacted engine holds up — per-query ranged reads stayed between 37 and 59 across a
97x growth in index size, which is the split model's central claim confirmed — and that the uncompacted
shape does not: 186,293 ranged reads for one query over 5,000 per-document splits, against 45 for the
same documents compacted. That makes compaction a viability requirement for the read path rather than a
later optimization, on evidence instead of intuition.

The harness also surfaced two absences in the engine, which are recorded here as findings rather than
fixed under a benchmark's cover: `search-core` offers no way to reuse an opened index across queries, so
the warm steady-state latency the sub-second target depends on cannot be measured through its public
surface at all; and it has no ranged multi-split query, so the fan-out figures are an explicit lower
bound produced by the harness merging per-split results itself. Both are seams the deployed Container
will need, and both are now named with a measurement showing why they matter.

The standing cost is that the sub-second target remains **unverified**, and deliberately so. It cannot
be closed from a local machine, and the report says which measurement would close it: the same query
classes timed against the deployed search Worker and its Container.
