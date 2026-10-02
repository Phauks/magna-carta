---
number: 462
slug: a-screen-reads-through-the-generated-client-and-one-cache
status: Proposed
date: 2026-09-14
area: Web
summary: "apps/web reads the API through @magna-carta/api-client and one TanStack Query cache instead of 48 hand-written modules, executing the half of ADR-0066 that was never built: that ADR chose Hey API to generate the typed client AND the Svelte Query v6 factories for the first-party app, and the app went on hand-writing 12,389 lines mirroring 459 contract types the generator already emits. Reads move from an on-mount $effect into the route's load, which is what finally makes the data-sveltekit-preload-data=hover already set in app.html buy DATA rather than only the route chunk; the (app) session guard's /api/v1/me, previously read on every navigation and again on mount by 38 surfaces, resolves from the cache. The generated factories throw, which collides with the app's deliberate three-outcome no-throw contract, so one error interceptor reassembles the Failure record and reports it centrally — every failure surface, the platform notice and the Error ID are unchanged. Enforcement is by construction first (DataTable.Grid has no empty snippet, NoResults takes no props) and by a lint:screen-data ratchet only for what types cannot see: no hand-spelled contract path, no second QueryClient, and no screen reading on mount with nothing warming it from its load."
---

**A screen reads through the generated client and one cache, and starts reading before it mounts.**

**Context.** ADR-0066 chose `@hono/zod-openapi` with spec-first codegen and said, in terms, that Hey
API would generate "the typed TS client + Svelte Query v6 hooks **for the first-party app**". The
generator was wired up, its output committed, and CI given a drift gate that regenerates it and fails
on a diff. The app never consumed it. Instead `apps/web` grew 48 hand-written transport modules —
12,389 lines exporting 459 types that mirror `apps/api-worker/openapi/openapi.json` by hand, a fact
`src/lib/api/request.ts` states in its own header. Nothing can keep that honest: the generated client
is diff-gated against the contract and the hand-written mirror is gated by nobody, so it drifts and
the drift is found by a member hitting it.

**The performance half is the same decision.** Of 98 screens, 5 route loads fetched data; the other 93
fetched from an `$effect` after mount. That makes every navigation a waterfall — chunk, parse, mount,
*then* the read. `app.html` has carried `data-sveltekit-preload-data="hover"` since it was written,
and its comment names the prize: the 200–400 ms between the pointer settling and the click is exactly
the round trip being paid after the click. But hover-preload runs the route's LOAD, and on 93 screens
the load read nothing, so it bought the JavaScript and nothing else. A prefetch only helps if it warms
what the screen then reads, which makes prefetching and caching one mechanism rather than two — and is
the reason this is the generated client plus TanStack Query rather than a bespoke resource type. A
hand-rolled one would have had to implement `ensureQueryData`, which is cache-keying, in-flight
joining, staleness and collection: TanStack, written worse, against a generated client that ships 55
infinite-query factories for the contract's cursor-paged listings already.

**Decision.** (1) `apps/web` depends on `@magna-carta/api-client` and `@tanstack/svelte-query`; the
generated `…Options` factories are what a screen reads. (2) One module-scoped `QueryClient`, which is
correct here and would not be under SSR — the app is `ssr = false` on `adapter-static`, so there is one
client, one member, and no request whose data could leak into another's. (3) A screen's reads start in
`+page.ts` via `warm(...)`, fired and not awaited: awaiting would hold the navigation and turn a slow
read into a frozen click, while firing gives an instant navigation that shows `LoadingRegion`'s shape
— and, on a hover, usually no shape at all. `prefetchQuery` rather than `ensureQueryData` so a failed
listing settles in the cache for the region to render, never an error page over the whole screen.
(4) The `(app)` session guard keeps re-running per navigation (it reads `url`, and it must judge every
address) but now resolves from the cache, so the second and later navigations cost nothing.

**The one real integration cost, and where it is paid.** The generated factories set
`throwOnError: true` and throw the parsed problem document — which loses the status, loses the request
line, and collapses "the server refused" into the same `catch` as "nothing answered". That distinction
is the one that changes what a person should do about it, and every failure surface in the app is built
on it. So it is restored once, in an error interceptor on the generated client, which reassembles the
existing `Failure` record and reports it through `platformHealth`. Reporting stays structural rather
than remembered: no surface reports its own failures and one that forgot would be invisible, which is
what golden rule 4 asks for. `Problem`, `Failure`, `FailureNotice` and the Error ID are untouched.

**Enforcement, strongest mechanism first.** Making the wrong thing unrepresentable beats forbidding it,
so that is used wherever it reaches: `DataTable.Grid` has no `empty` snippet for a surface to pass and
`NoResults` takes no props, which retired 27 bespoke empty states across 14 surfaces and left nothing
to lint. What that cannot reach is a negative and a placement, so `lint:screen-data` covers exactly
three things: no contract path spelled by hand outside the seam (a ratchet at today's 56 files, which
may only fall, and becomes a ban at zero), no second `QueryClient`, and no screen reading on mount with
nothing warming it from its load. That last one is the whole performance property, and a screen that
regresses it type-checks perfectly and is simply slower — the kind of regression nobody catches in
review.

**Considered and rejected.** A bespoke `Resource` primitive: smaller per-screen diff and a native fit
with the three-outcome model, but it leaves 12,389 hand-mirrored lines drifting against a contract CI
already generates, and it reimplements a cache badly at exactly the point — prefetch — where the cost
of getting it wrong is the feature. Keeping reads on mount and prefetching separately: a prefetch that
warms something the screen does not read is dead code, and the two cannot be separated.

**Migration.** The seam is additive; `request.ts` stays until the last screen is off it, and the two
coexist because both are `fetch`. `/matters` is migrated as the worked example. The budget in
`lint:screen-data` is the tracker.
