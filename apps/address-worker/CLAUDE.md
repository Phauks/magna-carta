# @magna-carta/address-worker — CLAUDE.md

**Purpose.** The dedicated address-autocomplete worker (`magna-carta-address`). It owns the two
Container classes that run the self-hosted address engine ([`containers/address`](../../containers/address),
over [`crates/address-core`](../../crates/address-core)), the `ADDRESS_INDEX` R2 binding the index lives
in (bucket `magna-carta-addresses`), the two non-routable hosts the engine reaches the world through,
and the daily cron that keeps the United States index current. It is reached only over a service binding
from the app worker. Boundary: it makes no lookup decisions — which country goes to which engine, the
opaque offer identifiers, and the routes all belong to `packages/address-lookup` and
`apps/api-worker/src/address-lookup/`.

**Template:** [`apps/search-worker`](../search-worker) (dedicated Container worker) and
[`apps/edit-worker`](../edit-worker) (outbound interception registered by assignment). **Design:**
[`docs/specs/2026-10-02-address-autocomplete-self-hosted-engine-design.md`](../../docs/specs/2026-10-02-address-autocomplete-self-hosted-engine-design.md).

## Key files

- `src/index.ts` — the `ExportedHandler` (version route, `GET /ready`, `POST /suggestions`,
  `POST /units`, everything else 404), the `Bindings` shape, the container + `ContainerProxy` re-exports,
  and the cron handler.
- `src/address-index-container.ts` — `AddressIndexContainer`, the query instance (`basic`, sleeps after
  15 minutes): the object host, read-only.
- `src/address-build-container.ts` — `AddressBuildContainer`, the build instance (`standard-4`, sleeps
  after 3 hours): the object host read-write, plus the source host.
- `src/object-host.ts` — `addresses.magna-carta.internal`: HEAD, ranged GET, small whole GET/PUT,
  DELETE, and the multipart upload over the R2 binding. Pure; tested against an in-memory bucket.
- `src/source-host.ts` — `openaddresses.magna-carta.internal`: the two-URL allow-list to OpenAddresses.
- `src/forward-query.ts` — the two lookup operations, the one instance name each class is addressed by,
  and the verbatim forward.
- `src/refresh-decision.ts` — the cron's decision (pointer missing or older than 30 days, and no build
  running → start one) and the check that runs it.
- `wrangler.jsonc` — both containers from one image, the DO bindings + migration, the R2 binding, and
  the cron.

## Local rules

- **This worker holds an R2 binding; the search worker must not, and the difference is the point.**
  Which bucket holds a firm's bytes is one decision made in the app worker, so `apps/search-worker`
  routes every object call there. Address data belongs to no firm, so there is no such decision to keep
  in one place, and routing reads through the app worker would add a hop to every keystroke. Do not
  copy this binding into a worker that touches firm data, and do not put firm data in this bucket.
- **The object host performs exactly the operation the engine asked for.** No read-ahead, no whole-object
  read behind a ranged one, no buffering of a split. A GET without `Range` is refused unless it asks for a
  small object by name (`x-mc-whole: small`, at most 1 MiB). The engine's read count per keystroke is the
  feature's cost model.
- **The query instance cannot write.** It is given the object host with read access only; only the
  build instance can PUT, DELETE or upload. Keep it that way — the query instance is the one that is up
  whenever anyone is typing.
- **Both intercepted hosts are allow-lists.** An unknown path, method, key shape or query string is
  refused here, not forwarded. Object keys are matched raw against `^[a-z]{2}/[a-z0-9/._-]+$` with no
  `..` and no empty segment; the source host forwards exactly `GET /api/data` and
  `GET /job/<digits>/source.geojson.gz`, builds each upstream request fresh, and forwards none of the
  container's headers.
- **One name per class.** The query instance is `address-index` (one warm cache for everyone — a
  second name would be a second cold cache, with no isolation to gain because no firm's data is in
  it); the build instance is `address-build` (two builds would race to publish the pointer).
- **No error body names a key, a query or an address**, and nothing here logs a request body. Refusals
  are a status and one word of engine vocabulary.

## Gotchas

- **The host names are duplicated on purpose** in `src/object-host.ts` / `src/source-host.ts` and in
  `containers/address` — a worker and a container cannot share a constant. A test here pins each
  literal; change both sides in one commit or every engine call becomes blocked egress.
- **`outboundByHost` is assigned in a `static {}` block, never declared as a static field.** A static
  field shadows `Container`'s setter, so the runtime intercepts the host while the library's
  `ContainerProxy` finds no handler and answers 520. `test/address-containers.test.ts` runs the library's
  real dispatch against both classes to hold this.
- **`ContainerProxy` must stay exported** from `src/index.ts`; the runtime resolves the interception
  proxy through `ctx.exports.ContainerProxy`.
- **A part upload needs `content-length`.** R2 refuses a stream of unknown length, so the object host
  wraps each part in a `FixedLengthStream` of the declared length and answers 411 without one. Every part
  but the last must be exactly 64 MiB (R2 requires equal parts; the host refuses anything larger).
  Abandoned uploads are not aborted here — R2's default lifecycle reaps incomplete multipart uploads.
- **The build container's `sleepAfter` counts from the request that started the build**, not from its
  own work, so it must outlast a whole build (about an hour; it is 3 hours). Lengthen it if builds grow.
- **The cron does not wake the build container on a fresh index.** It reads the pointer first and asks
  `GET /builds` only when the index is missing or stale, because asking starts a `standard-4` instance.
- **The tests run in the default node pool** with `cloudflare:workers` stubbed (`test/stubs/`) and
  `@cloudflare/containers` inlined (`vitest.config.ts`) — no Miniflare, no Docker. `FixedLengthStream`
  does not exist there, so the object-host tests pass the part body through unchanged.
- Nothing here is live until the bucket exists, the worker is connected to Workers Builds, and the app
  worker declares an `ADDRESS_SERVICE` binding — see [`docs/deploy-queue.md`](../../docs/deploy-queue.md).
