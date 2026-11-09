---
number: 311
slug: the-search-engine-reads-r2-through-the-app-worker-not-through-credentials
status: Proposed
date: 2026-08-14
area: Search
summary: "The keyword engine's RangeReader is bound to real per-firm R2 through container outbound interception rather than through storage credentials held by the engine: the Tantivy Container issues an ordinary HTTP range GET against a non-routable internal host, SearchIndexContainer.outboundByHost forwards it over a service binding into the app Worker, and a cookieless token-guarded split-object host there resolves the firm's bucket through the existing single home and performs exactly one R2 operation per call — so the engine reads a firm's index without ever holding a key to it, and enableInternet stays false. The capability token is HMAC-signed per firm from AUTH_SECRET, minted per operation, read-only for a query and write-capable only for an index or compaction pass, and authorizes ONE corpus: the allowed key prefix is derived from the token's corpus rather than carried, so a token cannot name another corpus's splits even though the request line chooses which split inside it (a query reads several, so the key cannot come from the token the way a WOPI file id does). The host refuses an unranged GET outright rather than serving an object whole, making the read count the engine was measured on structurally the read count a deployment bills. The engine keeps no split cache between calls: a cached searcher would answer from bytes authorized on a previous call, and residency is deferred to the slice that has a real resident corpus to size it against. apps/search-worker and containers/search are built; activation (image build, service binding, warm cron) stays a deploy step."
---

**A search engine that can read a firm's index must not be a process that holds the key to it.**

**Context:** `crates/search-core` had the whole keyword engine — the split format, a read-only Tantivy
`Directory` over a `RangeReader` seam, a `SplitSearcher` that holds a split open, a ranged multi-split
query, and a segment-level compaction merge — all unit-tested against an in-memory reader. The app
Worker had the other half: the per-firm split catalog, the query composition, the write pipeline, the
compaction coordinator and its queue consumer, and a `SearchIndexPort` that already resolved to a
service-binding adapter when a search binding was present. Neither half could reach the other, because
the `RangeReader` had no production implementation and there was no worker to host one. Every operation
answered `engine-not-implemented`.

Binding that seam is not a matter of writing an adapter in the obvious place, because there is no
obvious place. Three constraints intersect:

- **The engine cannot run in an isolate.** `search-core` has no wasm target, and Tantivy builds a
  segment in an on-disk scratch directory. It runs natively, in a Container.
- **A Container here has no egress.** Every Container in this platform runs `enableInternet = false`,
  because they process untrusted bytes. So the engine cannot range-GET object storage over the network.
- **Giving it credentials would be worse than the egress.** It would make the search Container the first
  in the platform to hold a firm's storage keys, and the blast radius of a compromised index engine
  would become the whole bucket rather than the splits it was asked for.

**Decision:** The adapter is three parts, and the middle one is the point.

The Rust `RangeReader` issues an ordinary HTTP request — a HEAD for the split's size, then one closed
`Range` GET per read the engine makes — against `splits.magna-carta.internal`, a host that resolves
nowhere. `SearchIndexContainer.outboundByHost` intercepts it inside the Workers runtime and forwards it
over a service binding to the app Worker, which mounts a cookieless split-object host beside the WOPI
one. That host verifies a capability token, resolves the firm's bucket through the existing single home
for that decision, and performs exactly one R2 operation. This is the topology the Collabora editor
already uses to reach the WOPI host from a no-egress container; search is its second instance, and it
generalizes correctly because the property it buys — a container that can reach one host and holds no
credential for it — is exactly what an index engine needs.

**The token is a capability over one corpus, not over a bucket.** HMAC-signed with a per-firm key
derived from `AUTH_SECRET`, minted fresh for each engine operation, and short-lived because its life is
that operation. It is read-only for a query and write-capable only for an index or compaction pass, so a
query cannot overwrite the splits it is reading. Crucially the allowed key prefix is **derived** from the
token's corpus rather than carried in it: a query reads the several splits the catalog named, so unlike
a WOPI callback the key cannot come from the token — and constraining the request line to the token's
own derived prefix is what keeps that choice inside one corpus.

**An unranged GET is refused, not served whole.** `crates/search-eval` measured per-query ranged reads
holding between 37 and 59 across a 97x growth in index size, and every one of those is an R2 range GET
in a deployment. That measurement is only transferable if the adapter issues exactly the reads the
engine asked for, so the expensive shape is made inexpressible rather than merely discouraged, on both
sides: the host answers 416, and the container's test double does the same, so a reader that started
fetching objects whole fails a test rather than quietly costing money.

**Considered and rejected:** **Presigned range URLs handed to the container**, so it could talk to R2's
S3 endpoint directly — it needs real egress (an allow-listed host is still a route out of the sandbox),
it puts a signing decision on the query path, and it moves "which bucket holds this firm's bytes" out of
the one module that owns it. **An R2 binding on the search worker** — simpler, and it splits that same
decision across two workers, which is precisely the failure `firm-bucket.ts` exists to prevent.
**Compiling `search-core` to wasm and running the engine in the app Worker** — Tantivy's build path
wants a filesystem, and it would put a CPU-bound merge on a request isolate. **Passing split bytes in
the request body** — that is a whole-object fetch with extra steps, and it discards the entire reason the
split format exists. **A warm split cache in the container**, which the design does call for — deferred,
below.

**Consequences:** The keyword path is now complete as code from a document through to a ranked hit, and
what remains between it and real hits is a deploy rather than a design: build the container image,
declare the `SEARCH_SERVICE` binding on the app worker, and arm the warm cron. Until that happens
`resolveSearchIndexPort` returns the deferred port exactly as before, every index job still parks in its
`deferred` state, and nothing about the dormant behaviour changes — the seam does not read as live while
it is not.

**One deliberate gap, named rather than shipped quietly:** the engine holds no split cache between
calls, so the warm NVMe layer the design describes does not exist yet. Two reasons. A cached searcher
answers from bytes whose authorization was checked on a previous call, which moves the per-read
authorization off the read path and would have to be re-designed rather than added. And the sizing
question — how much of a working set an instance should hold, under what eviction — is a measurement
against a resident corpus, which cannot be taken until one is resident. Within a single call the split
IS held open across the query, which is where the multi-hit saving actually is. The consequence is that
a first query pays its opens against object storage rather than local disk; the read counts are
unchanged either way, which is why the benchmark does not move.

Builds on **ADR-0207** (splits in per-firm R2 as a stateful service) and **ADR-0167** (dedicated
Container workers); serves **ADR-0003** (firm-scoped data access) by keeping bucket resolution in its one
home. Spec:
[`docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md`](../specs/2026-07-17-discovery-search-index-stateful-service-design.md).
