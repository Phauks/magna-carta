# containers/search — CLAUDE.md

**Purpose.** The discovery keyword-search engine as a running service: a pure-Rust axum binary that
wraps [`crates/search-core`](../../crates/search-core) and binds its `RangeReader` seam to real
per-firm object storage. It builds splits, range-reads them, merges them, and answers BM25 queries.
Boundary: the engine domain is `search-core` — this crate adds a request surface and storage, and
nothing else. It is owned by [`apps/search-worker`](../../apps/search-worker), which is the only thing
that can reach it.

**White paper:** _Core domain_ (discovery). **Spec:**
[`docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md`](../../docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md).
**Benchmark:** [`crates/search-eval`](../../crates/search-eval/README.md).

## Key files

- `src/lib.rs` — the router and the four operations (`/index`, `/query`, `/remove`, `/compact`) plus
  `/ready`. Each engine operation runs on a blocking task.
- `src/object_client.rs` — `HttpRangeReader` (the production `RangeReader`) and `put_object`. This is
  the file the cost model lives in.
- `src/dto.rs` — the wire shapes, mirroring `packages/search/src/port.ts` field for field.
- `tests/object_reads.rs` — the adapter against a real HTTP object host over a real socket.

## Local rules

- **One engine read, one request, no more.** No prefetch, no read-ahead, no whole-object fetch behind a
  range, no local copy of a split, no cache. A ranged read is a billed object-store operation, and the
  read counts `crates/search-eval` reports are only transferable to a deployment while that holds. If a
  change here alters how many requests leave the process for the same query, it is a cost change and
  needs a measurement, not a review comment.
- **The engine never chooses a key.** Both the splits it reads and the key it writes come from the
  caller, which owns the per-firm catalog and firm scoping. Deriving a key here would put a tenancy
  decision in a process that knows nothing about tenants.
- **No firm state between calls.** No split cache, no searchers carried across requests. A cached
  searcher answers from bytes authorized on a previous call, which moves authorization off the read
  path. Within one call the split IS held open across the query (`SplitSearcher`), which is where the
  multi-hit saving is. Adding residency is a design change with a measurement behind it, not a tweak.
- **Nothing that leaves this process carries firm content.** A hit is pointers — document id, chunk id,
  score — never passage text; the caller re-reads text under its own authorization. Error strings are
  engine vocabulary and must never include an object key or a token.
- **No TLS, no trust store, no egress config.** The one host reachable from here is a non-routable
  internal name the Workers runtime intercepts. A certificate bundle or an endpoint setting in this
  crate would imply a route out of the sandbox that does not exist.

## Contracts with the other two halves

The adapter only works as three parts, and two of them are elsewhere:

- **`apps/search-worker/src/search-index-container.ts`** intercepts `splits.magna-carta.internal` and
  forwards it into the app worker. The host name is duplicated in
  `apps/search-worker/src/split-object-forwarding.ts` and
  `apps/worker/src/search/split-object-host.ts` — change one, change all three in the same commit, or
  every read becomes blocked egress.
- **`apps/worker/src/search/split-object-host.ts`** verifies the capability token, resolves the firm's
  bucket, and performs the R2 operation. Its `x-mc-split-size` header is what `HttpRangeReader::open`
  reads to find the footer; its 416-on-unranged-GET is what keeps the whole-object shape unreachable.

## Gotchas

- **The container cannot run under any local test pool** (no Docker here, and a Container-backed
  Durable Object needs a live image). Everything in this crate is exercised by `cargo test` against a
  `tiny_http` object host; the worker side is exercised against fakes.
- **`ureq` is built with `default-features = false`** — no TLS backend, deliberately (plain HTTP to an
  intercepted host, and no transitive C dependency for a stack that would never be used).
- The Dockerfile copies the **whole** `crates/` workspace, not just `search-core`: the crate inherits
  its edition and dependency versions from the workspace root, so Cargo must see the root manifest.
