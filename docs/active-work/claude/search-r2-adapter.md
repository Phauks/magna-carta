---
branch: claude/search-r2-adapter
worktree: /home/user/magna-carta/.claude/worktrees/search-r2-adapter
area: Wire the discovery keyword engine to real R2 — the RangeReader's R2 adapter, the split-object host, and the dedicated search Worker
status: building
touches: crates/search-core, containers/search, apps/search-worker, apps/worker/src/search, packages/object-dimensions, docs/deploy-queue.md, roadmap.d/discovery.md, status.d/discovery-search-index.md
---

`crates/search-core` has the split format, the range-reading Tantivy `Directory`, `SplitSearcher`, the
ranged multi-split query, and the compaction merge — all unit-tested, none of it reachable from a
deployment. This stream builds the missing joint: a `RangeReader` whose reads are real R2 range GETs,
and the worker/container that holds it.

## What I found before writing code (the shape the adapter has to take)

The three-part answer, because no single component can hold it:

1. **The engine is native Rust, not WASM.** `crates/search-core` has no `wasm-bindgen` dependency and
   no wasm target, and Tantivy builds a segment in an on-disk scratch directory (`tempfile`). It runs
   in a Container, the way `containers/scan` and `containers/recovery` do — not in an isolate.
2. **A Container has no R2 credentials and no egress.** Every Container in this repo runs
   `enableInternet = false`. So the container cannot range-GET R2 itself, and giving it S3 credentials
   would be the first Container in the repo holding a firm's storage keys.
3. **The precedent for exactly this already exists** — `apps/magna-carta-edit`. Collabora also has to
   reach an object host from inside a no-egress container, and does it through
   `Container.outboundByHost`: the container issues ordinary HTTP to a non-routable `.internal` host,
   the Durable Object intercepts it and forwards it over a service binding into a Worker, and the
   Worker re-derives firm scope from a short-lived HMAC token on every call
   (`apps/worker/src/editing/wopi-guard.ts`). No egress opens, and the forwarding hop carries no trust
   of its own.

So the R2 adapter is: a Rust `RangeReader` that issues one HTTP range GET per read → container
outbound interception → a token-guarded split-object host in the app Worker that resolves the firm's
bucket through the existing single home (`apps/worker/src/files/firm-bucket.ts`) and stamps
`@magna-carta/object-dimensions` on every write.

## The search Worker is in this slice, not after it

The brief asked whether the worker is a follow-on. It is not separable: the adapter's middle hop —
`outboundByHost` — is a property of a Container-backed Durable Object, and there is no Container
without a Worker to own it. What stays out is **activation**: the image build, the service binding,
and the warm cron are deploy steps (`docs/deploy-queue.md`), and until they run
`resolveSearchIndexPort` keeps returning the deferred port exactly as it does today.

## Also found: the brief's item 2 is already done

`apps/worker/src/search/search-engine.ts` already resolves `SearchIndexPort` to a service-binding
adapter when `SEARCH_SERVICE` is bound and to the deferred port when it is not, and already calls
`/index`, `/query`, `/remove`, `/compact`. Nothing about that resolution needs to change; what it
calls has to start existing.

## Files expected to be touched

- `containers/search/` (new) — the Rust service: `search-core` plus an HTTP `RangeReader`.
- `apps/search-worker/` (new) — the Worker owning `SearchIndexContainer`, its outbound interception,
  and the warm-poke cron.
- `apps/worker/src/search/split-object-host.ts` + `split-object-token.ts` (new) — the token-guarded
  object host and its per-firm HMAC token; mounted in `apps/worker/src/app.ts`.
- `packages/object-dimensions/src/dimensions.ts` — one new object class for a split.
- `docs/deploy-queue.md`, `roadmap.d/discovery.md`, `status.d/discovery-search-index.md`,
  `changelog.d/`, `docs/decisions/pending/`.

## Overlaps

Owns `apps/worker/src/search/` for the duration. Does not touch the compaction coordinator, the index
consumer, or the catalog statements — those are built and correct; this stream only makes the port
they call reach something.
