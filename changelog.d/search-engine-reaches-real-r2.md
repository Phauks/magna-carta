---
category: Added
audience: internal
---

Discovery search — the keyword engine now reaches real per-firm R2. The `RangeReader` seam
`crates/search-core` was built against has a production implementation, and the worker and container
that hold it exist.

**The engine reads a firm's index without holding a key to it.** `containers/search` is a pure-Rust
service over `search-core`; its `HttpRangeReader` issues one HEAD for a split's size and then exactly
one closed-`Range` GET per read the engine makes, against `splits.magna-carta.internal` — a host that
resolves nowhere. `SearchIndexContainer.outboundByHost` intercepts it and forwards it over a service
binding into the app worker, where a new cookieless split-object host (`/search-objects/*`) verifies a
capability token, resolves the firm's bucket through `files/firm-bucket.ts`, and performs one R2
operation. `enableInternet` stays false and the container holds no credential — the same topology the
Collabora editor uses to reach the WOPI host.

**The token is a capability over one corpus.** HMAC-signed per firm from `AUTH_SECRET`, minted per
operation, read-only for a query and write-capable only for an index or compaction pass, and its allowed
key prefix is derived from its corpus rather than carried — so the request line chooses which split (a
query reads several) but cannot leave the corpus the token names.

**An unranged GET is refused rather than served whole.** `crates/search-eval` measures per-query ranged
reads, and every one is an R2 range GET in a deployment; that number only transfers if the adapter
issues exactly the reads the engine asked for. The host answers 416, the container's test double does
the same, and the container reports the ranged-read count it actually issued on every query response, so
the measured number and the billed number can be compared rather than assumed equal.

A published split is stamped `object_class: search-split` with its corpus as the matter dimension — a new
class in `@magna-carta/object-dimensions`, so a reader of the bucket can tell an index from a document.

`apps/search-worker` (`magna-carta-search`) shards by firm rather than by request, because an instance's
value is the splits it is already holding open. Its warm-poke cron handler is wired and the trigger is
deliberately off until a firm has indexing enabled.

**Still dormant, and unchanged:** `resolveSearchIndexPort` returns the deferred port until
`SEARCH_SERVICE` is bound, so every index job still parks in `deferred` and no query reaches an engine.
Activation is a deploy step — see `docs/deploy-queue.md`. The container keeps no split cache between
calls: a cached searcher would answer from bytes authorized on a previous call, and the residency sizing
is a measurement that needs a resident corpus.
