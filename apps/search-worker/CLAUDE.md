# @magna-carta/search-worker — CLAUDE.md

**Purpose.** The dedicated worker that owns the discovery keyword-index Container
([`containers/search`](../../containers/search)) and is reached only over a service binding from the
app worker. It routes the four engine operations to the instance holding a firm's working set, keeps
that instance warm, and intercepts the engine's object calls back into the app worker. Boundary: it
makes no index decisions — the catalog, firm scoping, and every object key belong to
`apps/api-worker/src/search/`.

**Template:** [`apps/scan-worker`](../scan-worker) (dedicated Container worker) and
[`apps/edit-worker`](../edit-worker) (outbound interception). **Spec:**
[`docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md`](../../docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md).

## Key files

- `src/index.ts` — the `ExportedHandler`, the `Bindings` shape, the container + `ContainerProxy`
  re-exports, and the warm-poke cron handler.
- `src/search-index-container.ts` — the `SearchIndexContainer` Durable Object: `enableInternet = false`
  plus the `outboundByHost` entry that is the whole reason the engine can read R2 without credentials.
- `src/split-object-forwarding.ts` — the internal host constant and the verbatim forward.
- `src/search-shard.ts` — which instance a firm's calls go to.
- `wrangler.jsonc` — the container declaration, the DO binding + migration, the `APP_WORKER` service
  binding, and the (deliberately empty) cron trigger list.

## Local rules

- **This worker holds no R2, D1, Queue, or secret binding, and must not grow one.** All object I/O
  flows through the app worker's split-object host, which is what keeps "which bucket holds this firm's
  bytes" a single decision (`apps/api-worker/src/files/firm-bucket.ts`). A binding here would be a second
  answer to it.
- **The forward adds nothing and strips nothing.** The capability token rides in the engine's own
  headers and is verified on the far side; this hop carries no trust, so it must not start carrying
  one. No retries, no caching, no header rewriting — the engine's read count is the platform's cost.
- **Shard by firm, never by request.** A search instance's value is the splits it is already holding
  open, so spreading one firm's queries would give every query a cold searcher and a second copy of the
  same working set. This is the opposite of `apps/scan-worker`, which is stateless and spreads for
  parallelism. `SEARCH_SHARD_COUNT` must match `containers[0].max_instances` in `wrangler.jsonc`.
- **Sharding is routing, never isolation.** Two firms may share an instance. Nothing about correctness
  rests on them not doing so: a call reaches only the keys the app worker named, under a token minted
  for one corpus.
- **An unknown path stops here.** The service binding is the trust boundary, and a boundary that
  forwards whatever it is handed is not one — `engineOperationOf` enumerates the four operations.

## Gotchas

- **`ContainerProxy` must stay exported** from `src/index.ts`. The runtime resolves the outbound
  interception proxy through `ctx.exports.ContainerProxy`; without the re-export, starting the container
  throws `ctx.exports.ContainerProxy is undefined`. It is a `WorkerEntrypoint`, so it needs no binding
  and no migration.
- **`SPLIT_OBJECT_HOST` is duplicated on purpose** in `src/split-object-forwarding.ts` and
  `apps/api-worker/src/search/split-object-host.ts` — a worker cannot import from another worker. A test in
  each pins the literal; change both in one commit or every engine read becomes blocked egress.
- **The container cannot run under the local test pool** (it needs a live image). The tests run in the
  default node pool against a fake `{ fetch }` — no Miniflare, no Docker.
- **The warm cron is off in `wrangler.jsonc`, and the handler is wired.** Re-arming it is one line; it
  stays off while no firm has indexing enabled, because a resident `standard-1` bills 4 GiB for nothing.
- The app worker declares the `SEARCH_SERVICE` binding since 2026-11-13, so this worker receives
  real operations: the index queue's, a matter's search, the conflicts check and a discovery review
  set. A firm's files reach it only once that firm turns indexing on. What is still to check after
  that deploy is in [`docs/deploy-queue.md`](../../docs/deploy-queue.md).
