# search-eval

The standardized performance benchmark for the **search and discovery read path**. One command, and
output meant to be read by someone who did not write it: how fast a keyword query is, at what corpus
size, and where the read path falls over.

This is to search what [`pdf-eval`](../pdf-eval/README.md) is to the PDF engine — a measurement harness
beside the engine crate, never inside it. It reaches [`search-core`](../search-core) only through that
crate's public surface, so every number it prints came from the same code a deployed Container runs.

## Run it

```
cargo run -p search-eval --profile benchmark -- benchmark
```

Takes a few minutes and rewrites `search-benchmark-baseline.json`. Label your machine first — a
baseline is worthless without knowing what produced it:

```
MAGNA_CARTA_BENCHMARK_MACHINE="desktop, Ryzen 7950X, 64 GB, on AC" \
  cargo run -p search-eval --profile benchmark -- benchmark
```

For a fast check while changing the engine (smoke tier and two fan-out points, writes nothing):

```
cargo run -p search-eval --profile benchmark -- benchmark --quick
```

**Use `--profile benchmark`, not `--release`.** The workspace release profile optimizes for size
(`opt-level = "z"`), which is right for a wasm artifact and wrong for a measurement. Every run records
which profile produced it; runs under different profiles are not comparable.

**It is not part of any gate.** `pnpm test`, `pnpm check`, and `vp run rust-check` never run the
benchmark — it is a deliberate command, kept off the normal path for the reason in
[`docs/conventions/build-performance.md`](../../docs/conventions/build-performance.md). The crate's own
unit tests do run with the workspace, and finish in well under a second.

## What it measures, and what it cannot

It measures the **real keyword engine**: building Tantivy splits, and answering BM25 queries over them
through the ranged-read access pattern a split in R2 is designed to be read through. Nothing is stubbed.

It does **not** measure the network, the search Worker, the Container, the warm cache, the semantic
(Vectorize) half, reciprocal rank fusion, or the per-firm catalog read. The report prints that list in
full before any number, and the same list is stored inside the baseline file, so a figure cannot be
lifted out of either without its caveats. That is the point of the harness as much as the timings are:
an unlabelled number from a partial path reads as the system's speed and is worse than no number.

The one entry on that list worth repeating here, because it is a gap in the engine rather than in the
harness: **`search-core` exposes no way to reuse an opened index across queries**, and no ranged
multi-split query at all. So the warm steady-state latency the design's sub-second target rests on
cannot be measured through the crate's public surface today, and the fan-out figures are a lower bound
produced by the harness issuing one ranged query per split and merging the results itself.

## The two axes

**Axis 1 — corpus size.** The whole corpus compacted into one split, at three tiers (`smoke`,
`expected`, `large`), bracketing the thousands-to-tens-of-thousands of documents a matter under review
holds. This is the shape the compaction pass produces.

**Axis 2 — split fan-out.** The same corpus published the way the pipeline publishes it today: a split's
object key is derived from one document version ([`packages/search/src/split.ts`](../../packages/search/src/split.ts)),
and a query is handed every live split key the catalog holds
([`apps/worker/src/search/keyword-search.ts`](../../apps/worker/src/search/keyword-search.ts)). So a
matter of N indexed document versions is N splits and one query touches all of them. Cost on this axis
grows with the split count rather than the corpus, which is why it is measured separately: it is what
falls over first, and the gap between the two axes at the same document count is what compaction is
worth.

The two axes deliberately meet at 5,000 documents, so that comparison can be read straight off.

## How to read the output

- **Read counts before milliseconds.** A ranged read is an R2 range GET in a deployment, so the count
  is the figure that transfers off the machine that produced it. It is also deterministic, so a change
  in it is a real change in how much work a query does, not machine noise.
- **Milliseconds are machine-relative.** They answer "did this change make the engine faster or slower
  here", never "how fast will search be for a firm". Compare against the committed baseline on the
  same machine and nowhere else.
- **Every latency has its selectivity beside it.** The `hits` column is what the query actually matched;
  the same query text means something different against a corpus it barely matches.
- **`matrlz+qry`** is the crate's other public query path, which rebuilds the whole split into an
  in-memory directory before searching it. At the large tier that rebuild dominates completely — it is
  labelled for what it does rather than presented as a warm-cache figure.

## The baseline

`search-benchmark-baseline.json` is a committed run, small enough to diff by hand. It carries its own
conditions — timestamp, machine label, build profile, corpus seed, iteration counts — because none of
them transfer. **A baseline taken on one machine says nothing about another**; the file is a regression
anchor for the machine named inside it.

The corpus seed is a fixed constant. Changing it would rebuild a different corpus and silently
invalidate every committed baseline, so it is not an option.
