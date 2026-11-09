# containers/address — CLAUDE.md

**Purpose.** The United States address autocomplete engine as a running service: a pure-Rust axum
binary that wraps [`crates/address-core`](../../crates/address-core) and binds its range-read seam to
the platform's address index in R2. It answers typed text with addresses and building groups, opens a
building into its units, and builds the index monthly from OpenAddresses. Boundary: everything about
addresses (cleaning, partitions, schema, query, ranking) is `address-core` — this crate adds a request
surface, storage, a byte-range cache and a build loop, and nothing else. It is owned by
[`apps/address-worker`](../../apps/address-worker), which is the only thing that can reach it.

**White paper:** _Core domain_ (addresses). **Spec:**
[`docs/specs/2026-10-02-address-autocomplete-self-hosted-engine-design.md`](../../docs/specs/2026-10-02-address-autocomplete-self-hosted-engine-design.md).

## Key files

- `src/lib.rs` — the router: `POST /suggestions`, `POST /units`, `POST /builds`, `GET /builds`,
  `GET /ready`, and the `Settings` that tests point at local fakes.
- `src/object_client.rs` — `ObjectStore` (reads), `ObjectWriter` (writes, build only),
  `HttpRangeReader`, the shared `RangeCache` and `CachedRangeReader`, and the multipart `Write`.
- `src/current_index.rs` — the open partitions and the pointer re-read.
- `src/build_job.rs` — the build, the licence exclusion register, `BuildRunner`.
- `src/source_client.rs` — the OpenAddresses list and gzip downloads.
- `src/pointer.rs` — the pointer, the attribution manifest, and every object key shape.
- `src/wire.rs` — request validation; every refusal is one fixed word.
- `tests/` — everything over real sockets against `tiny_http` fakes of both intercepted hosts.

## Local rules

- **This engine KEEPS state between requests — the deliberate opposite of `containers/search`.** A
  discovery split is one firm's privileged content, so that engine re-reads under each call's
  authorization and caches nothing. This index is public reference data, identical for every firm: the
  four partitions stay open across requests and the byte ranges already read stay in a bounded
  least-recently-used cache (384 MB, `CACHE_BUDGET_BYTES`). Keeping it carries no firm's authorization
  past its request, because no firm's data is here. Do not copy this pattern into an engine that holds
  firm data.
- **Never log or return a query, an address or an object key.** Not in an error body, not in a
  diagnostic line, not in a `Debug` impl. Error bodies are `{"error":"<word>"}`; logs are engine
  vocabulary and counts. The cache and the readers' `Debug` forms leave the key out on purpose.
- **The query path never writes.** It is given an `ObjectStore`, which has no write method; only the
  build job constructs an `ObjectWriter`. The worker also refuses writes from the query class.
- **One cache miss, one request.** No prefetch, no read-ahead, no whole-object fetch behind a range.
  The cache removes repeats (and concurrent duplicates) and nothing else, so the read counts
  `address-core` measures stay the counts R2 bills.
- **A failed build never moves the pointer.** The pointer is written last, after every split and the
  manifest; on failure this build's uploads are deleted and the previous index keeps answering.
- **The licence policy is `LICENCE_EXCLUSIONS` in `src/build_job.rs`** — the owner-confirmed register
  of share-alike, non-commercial and bespoke-agreement sources, each with its reason. Changing it
  changes what the next build includes; the manifest records both lists.
- **No TLS, no trust store, no egress config.** The two hosts reachable from here are non-routable
  names the address worker intercepts.

## Contracts with the address worker

- **Hosts:** `addresses.magna-carta.internal` (objects) and `openaddresses.magna-carta.internal`
  (sources). The worker's tests pin the same literals — change one, change both in the same commit.
- **Objects:** `HEAD /objects/<key>` (size from `x-mc-object-size`, else `content-length`); `GET` with a
  closed `Range` (206), or with `x-mc-whole: small` for the pointer and manifest (at most 1 MiB); `PUT`
  a small object; `POST /uploads/<key>` → `{uploadId}`; `PUT /uploads/<key>?uploadId=…&part=N` with a
  content-length, every part but the last exactly `PART_SIZE` (64 MiB) → `{etag}`;
  `POST /uploads/<key>/complete?uploadId=…` with `{parts:[{part,etag}]}`; `DELETE /objects/<key>`.
- **Sources:** `GET /api/data` and `GET /job/<digits>/source.geojson.gz`, no query string, no headers.
- **Keys:** `us/current.json`, `us/<build>/<partition>.split`, `us/<build>/attribution.json`.

## Gotchas

- **The container cannot run under any local test pool** (no Docker here). Everything is exercised by
  `cargo test` against the fakes in `tests/support/mod.rs`.
- **One native library rides in through Tantivy:** `zstd-sys`, from tantivy's default
  `columnar-zstd-compression` feature, enabled by `crates/search-core`. The address index does not use
  zstd (its store is LZ4, pure Rust), but feature unification means this crate cannot switch it off
  alone. `flate2` uses its default `miniz_oxide` backend, pure Rust.
- The Dockerfile copies the **whole** `crates/` workspace: the two path crates inherit their edition
  and lints from the workspace root, so Cargo must see it.
- **An abandoned multipart upload is not aborted** — the contract has no abort. The bucket's own
  incomplete-upload expiry clears it.
