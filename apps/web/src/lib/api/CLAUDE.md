# The API seam — CLAUDE.md

**Purpose.** The one place `apps/web` reaches the server, and the one cache that holds the answers.
Everything above here reads generated options and renders three outcomes; nothing above here knows a
URL, a cursor, or how a failure is assembled.

**Spec:** [`docs/specs/2026-09-14-screen-data-loading-design.md`](../../../../../docs/specs/2026-09-14-screen-data-loading-design.md)
— what a screen writes, why the read starts in the route's load, and why enforcement is mostly not a
lint. **Contract:** [`docs/conventions/api.md`](../../../../../docs/conventions/api.md).

## Key files / entry points

- `api-client.ts` — configures the generated client and owns failure. Everything thrown out of it is
  an `ApiCallFailed` carrying a `Failure`; `failureOf()` reads one back.
- `screen-data.ts` — the one `QueryClient`, the two staleness tiers, and `warm` / `warmSessionStable`
  / `warmPaged` / `paged`.
- `problem.ts` — the `Problem` and `Failure` records every failure surface renders from.
- `request.ts` — **outgoing.** The hand-written transport, kept only until the last screen is off it.
  Do not add to it; `lint:screen-data` holds a budget that may only fall.

## Local conventions

- A screen's reads start in `+page.ts`, never in an `$effect`. That is what lets the hover preload
  already set in `app.html` buy the DATA rather than only the route chunk.
- `warm` is fired and never awaited. Awaiting holds the navigation and turns a slow read into a
  frozen click; `LoadingRegion` is the honest answer to a read in flight.
- Reference data (the session, matter types, Locations, roles, the roster) is read at
  `SESSION_STABLE`. Firm records are read at `RECORD`.
- A write updates the cache with `setQueryData` rather than the screen's own state, so every other
  surface holding the same question sees it.

## Invariants that apply here

- **Golden rule 4 — one error pipeline, redacted by default.** Reporting is structural: every failure
  passes through the error interceptor in `api-client.ts` and is noted on `platformHealth` there. No
  surface reports its own, so none can forget. The request line drops the query string
  (`requestLine`), because that is the one part of a request that can hold what a person typed.
- **Golden rule 1 — reuse before building.** The contract's 615 operations are generated and
  diff-gated by `pnpm gate`. A hand-written module mirroring one is a drift surface nothing can keep
  honest.

## Dependencies & contracts

- `@magna-carta/api-client` — the generated typed client and the `…Options` / `…InfiniteOptions`
  factories, regenerated from the committed OpenAPI snapshot and diff-gated by `pnpm gate`. Its
  `client` instance is reached through `@magna-carta/api-client/client`.
- `@tanstack/svelte-query` v6 — runes-native: `createQuery(() => options)`, an accessor, not an
  object.

## Gotchas

- **The base URL is empty, so requests are RELATIVE.** A browser resolves them against the document;
  Node cannot resolve them at all — `new Request("/api/v1/me")` throws while BUILDING the request,
  which surfaces as a transport failure carrying an EMPTY request line rather than as anything that
  names a URL. A test driving this client must set an absolute `baseUrl`
  (`apps/web/test/joining-routing.test.ts` is the worked example).
- **The client configures itself at module evaluation, not from a load.** SvelteKit runs a parent and
  a child load concurrently unless the child awaits `parent()`, so a root load calling
  `configureApiClient()` would not reliably beat the `(app)` guard's own read.
- **The generated factories throw; nothing above this directory should.** They set
  `throwOnError: true` and throw the parsed problem document — no status, no request line, and a
  refusal indistinguishable from a dead transport. The error interceptor puts that distinction back.
- **`(app)/+layout.ts` re-runs on every navigation** because it reads `url`, and that is correct — the
  guard judges every address. It is cheap only because it resolves from the cache. Do not "fix" the
  re-run; keep the read cached.
- **A test that drives a load must clear the cache first.** A cache surviving into the next case
  answers it with the previous case's session, which is the one way such a test passes while the
  guard is broken.
