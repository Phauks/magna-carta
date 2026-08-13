---
category: Added
audience: internal
---

Search and discovery — a standardized, owner-readable performance benchmark for the read path, as the
new `crates/search-eval` harness beside the engine crate, on the `pdf-eval` pattern. One command
(`cargo run -p search-eval --profile benchmark -- benchmark`), and output written to be interpreted by
someone who did not build it: latency percentiles with the corpus size, index size, hit count, and
number of queries behind every figure, and the target stated beside it.

**It measures the real engine, and says plainly what it could not reach.** Queries run against
`crates/search-core` itself — Tantivy building splits and answering BM25 queries through the ranged-read
access pattern a split in R2 is designed for — so nothing is stubbed. What cannot run on a local machine
is named rather than approximated: the network, the search Worker and its Container, the warm cache,
Vectorize and the whole semantic half, reciprocal rank fusion, and the per-firm catalog read. That list
is printed before any number and is stored inside the baseline file, so a figure cannot be lifted out of
either without its caveats. Timing the deferred `SearchIndexPort` — which returns `engine-not-implemented`
anywhere off a deployment — is refused on purpose: an unlabelled number from a stub reads as the
system's speed and is worse than no number.

**Two axes, each varying one thing.** Corpus size, with the corpus compacted into one split at 250 /
5,000 / 25,000 documents, which is the shape compaction produces. And split fan-out, which is the shape
the pipeline publishes today — a split's object key is derived from one document version, and a query is
handed every live split key the catalog holds, so a matter of N indexed versions is N splits and one
query touches all of them. The axes meet at 5,000 documents so the comparison can be read directly.

**What the first run found.** Compacted, the engine holds up exactly as the split model claims: at
25,000 documents (200,000 passages, a 13.0 MiB index) an ordinary review query ran in 0.072 ms median /
0.163 ms p95, and per-query ranged reads stayed between 37 and 59 across a 97x growth in index size — the
round trips a query costs are set by what it asks for, not by how large the matter grew. Uncompacted, it
does not: the same 5,000 documents as 5,000 per-document splits cost **186,293 ranged reads for one
query** against 45 for the identical documents compacted, about 4,140x the round trips for the same
answer. Every one of those is an R2 range GET in a deployment, so that shape cannot reach a sub-second
query however fast the engine is. Compaction is not an optimization for this read path; it is what makes
it viable, and there is now a number saying so.

**Two gaps in the engine the harness surfaced rather than papered over.** `search-core` exposes no way to
reuse an opened index across queries, so the warm steady-state latency the sub-second target rests on
cannot be measured through its public surface at all — the per-query index-open cost is broken out
instead. And it has no ranged multi-split query: the multi-split entry point takes in-memory slices only,
so the harness issues one ranged query per split and merges the results itself, which makes the fan-out
figures an explicit lower bound rather than a measurement of the deployed path.

A committed baseline (`crates/search-eval/search-benchmark-baseline.json`) carries its own timestamp,
machine label, build profile, corpus seed, and iteration counts, because none of those transfer between
machines. The benchmark is deliberately out of every gate — `pnpm test`, `pnpm check`, and
`vp run rust-check` never run it; the crate's own unit tests do, and finish in a fraction of a second. A
`benchmark` cargo profile is added because the workspace release profile optimizes for size, which
understates the engine and makes two runs incomparable.
