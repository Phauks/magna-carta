# Screen data loading — design

**Date:** 2026-09-14
**Status:** Accepted 2026-09-14 by the owner ("generated client sounds better. Let's get this
functionality up and running… then lint to maintain items in these empty states, unless there is a
better alternative to linting"). **Built** in the same stream: the seam, the cache, the load helper,
the `(app)` guard, the Grid's own empty state, `NoResults`, `lint:screen-data`, and `/matters` as the
worked example.
**Scope:** how a screen in `apps/web` gets its data — what it reads through, where the read starts,
what holds the answer, and what an empty answer says.
**Excludes:** what the server answers (the contract, `docs/conventions/api.md`); how a region says its
data has not arrived ([`2026-09-05-loading-region-design.md`](2026-09-05-loading-region-design.md));
what a failure surface renders (`docs/conventions/error-logging.md`).

**Binding inputs:** ADR-0066 (spec-first codegen: the typed client + Svelte Query v6 factories, for
the first-party app); golden rules 1, 4, 10 and 12; the owner's rulings in
[`../conventions/design-corrections.md`](../conventions/design-corrections.md) — _No info lines_, and
the 2026-09-14 ruling that an empty list says "No Results" and nothing else.

---

## 1. What was wrong

Two problems with one cause: the app had no shared idea of a read.

**Reads started too late.** Of 98 screens, 5 route loads fetched data; the other 93 fetched from an
`$effect` after mount. So every navigation was a waterfall — fetch the route chunk, parse it, mount
the component, and only then ask the server. `app.html` has carried
`data-sveltekit-preload-data="hover"` since it was written and its comment names exactly what it was
for: "the ~200-400ms between hover and click is exactly the round trip it was paying after the click
instead." But hover-preload runs the route's **load function**, and on 93 screens that function read
nothing. The mechanism was installed and had nothing to preload.

**The same answers were read over and over.** `(app)/+layout.ts` reads `url`, so SvelteKit re-runs it
on every navigation — correct, since the guard must judge every address, and it meant a fresh
`/api/v1/me` per navigation. Thirty-eight surfaces then read the same bootstrap again on mount. That
call is a control-plane read, a firm Durable Object wake, an effective-permissions join, the channel
and flags, the firm name and the membership state. A navigation to `/matters` cost six requests, five
of them re-reads of session-stable facts. Five hand-rolled "read once and share" singletons existed —
`sessionPermissions`, `firmRoster`, `firmMatters`, `anchorMatters`, `unreadCount` — each
reimplementing the same `#inFlight` join, and 51 hand-rolled run-once guards across 17 components.

**And the transport was hand-written.** 48 modules, 12,389 lines, 459 exported types mirroring
`apps/api-worker/openapi/openapi.json` by hand — beside a generated client covering all 615 operations
that CI already regenerates and diff-fails on.

## 2. The decision in one paragraph

**A screen reads generated options, through one cache, starting in its load.** The contract's shapes
come from `@magna-carta/api-client`; the answers are held by one module-scoped TanStack `QueryClient`;
and the read is started by `+page.ts` so the hover preload reaches it. The three are one decision:
a prefetch only helps if it warms what the screen then reads, so prefetching and caching are the same
mechanism, and the generated client is what makes both free rather than 98 hand-written call sites.

## 3. What a screen writes

```ts
// +page.ts — runs on hover, in parallel with the route chunk
export const load: PageLoad = () => warm(mattersListOptions());
```

```svelte
// +page.svelte — hits the warm cache, renders populated
const matters = createQuery(() => mattersListOptions());
```

`warm` is fired and **not awaited**. Awaiting would hold the navigation until the data landed, so a
slow read would look like a frozen click; firing gives an instant navigation that shows
`LoadingRegion`'s shape, and — because the same call ran on hover — usually no shape at all. It is
`prefetchQuery` rather than `ensureQueryData` for the same reason a load here must not throw: a
listing that fails settles in the cache and the region renders its own failure notice with Retry,
never an error page over the whole screen.

| Call                     | For                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `warm(...)`              | A screen's own reads, at the record staleness (30 s).                                                                   |
| `warmSessionStable(...)` | The session and the firm's vocabularies (10 min).                                                                       |
| `warmPaged(...)`         | A cursor-paged listing's **first** page only — the pages after it are what the reader asks for by scrolling.            |
| `paged(...)`             | Teaches a generated infinite listing where its next page is; the one place our `nextCursor` convention is written down. |

## 4. Failure, and the one real cost of the generated client

The generated factories set `throwOnError: true` and throw the **parsed problem document** — which
loses the status, loses the request line, and collapses "the server refused" into the same `catch` as
"nothing answered". That distinction is the one that changes what a person should do about it, and
`request.ts` was built on it deliberately.

So it is restored once, in an **error interceptor** on the generated client
(`src/lib/api/api-client.ts`), which has the response and the request the thrown body does not, and
reassembles the existing `Failure` record before the exception leaves the transport. Everything thrown
out of this client is an `ApiCallFailed` carrying that record; `failureOf()` reads it back. Reporting
stays structural rather than remembered — every failure passes through one interceptor, so no surface
has to report its own and one that forgot would be invisible.

Two mechanics worth knowing. Configuration happens at **module evaluation**, not from a load function:
SvelteKit runs a parent and child load concurrently unless the child awaits `parent()`, so a root load
could not reliably beat the `(app)` guard's own read. And the base URL is empty so calls stay
same-origin — which makes the request path relative, which a browser resolves against the document
and **Node cannot resolve at all**: a test driving this client sets an absolute `baseUrl`, or it sees
a transport failure with an empty request line rather than anything naming a URL.

## 5. Empty lists

**"No Results", in title case, for both the empty record and the filtered-empty one.** One wording
serves both because it is true of both: "no matters yet" is a lie about a filtered table, and a
sentence naming which filters are set is a second copy of what the header already shows. No
description under it, and no sentence naming the create control — that control is in the masthead's
action row on every screen by the product's own grammar, so prose naming it duplicates a label that is
free to change without the prose changing with it. Where a narrowing is what emptied the table, the
way back is a **control** beside the words (Clear All Filters), never more words.

What the empty states carried instead was a definition of the domain term — "A packet is the physical
thing the firm holds and moves: an envelope, a deed box, a sealed wallet…" — which is the explanatory
prose _No info lines_ already forbids everywhere else, and whose home is `docs/user/`. Across the app:
93 `EmptyState` uses, 76 with a description, 49 over 20 words, the longest 50.

Three states stay distinct, because each states a fact about the **subject** rather than about the
result set: a sample matter, a firm that has not enabled something, and a read that failed — which is
`FailureNotice`, and was never an empty state.

## 6. Enforcement — unrepresentable first, lint only for the rest

The owner asked for a lint and for a better alternative if one existed. There is one, and it is used
wherever it reaches: **make the wrong thing impossible to say.**

- **`DataTable.Grid` has no `empty` snippet.** The Grid renders "No Results" for both branches. That
  retired 27 bespoke empty states across 14 surfaces, and the compiler found every call site — there
  is nothing left to lint, because a surface cannot supply what the component does not accept.
- **`NoResults` takes no props.** A component that accepts no text cannot grow a paragraph back.
- **The generated client owns the contract's paths.** When the last screen is off `request.ts`, the
  budget below reaches zero and that file is deleted; the rule becomes a ban.

`lint:screen-data` covers only what types cannot see — a negative and a placement:

1. **No contract path spelled by hand** outside the seam. A ratchet at today's 56 files, which may
   only fall.
2. **A screen's reads start in its load.** A `+page.svelte` that calls `createQuery` needs a sibling
   load that warms it. This is the whole performance property, and a screen that regresses it
   type-checks perfectly and is simply slower — the regression nobody catches in review.
3. **One cache.** A second `QueryClient` answers the same questions and shares nothing.

It reads code, not comments: block, line and markup comments are blanked first, because a gate that
trips on a comment explaining the seam is a gate somebody turns off.

## 7. What is built, and what is not

Built: the seam, the cache and its staleness tiers, `warm`/`warmSessionStable`/`warmPaged`/`paged`,
the `(app)` guard on the cache, the Grid's own empty state, `NoResults`, `lint:screen-data` and its
fitness-sweep member, and `/matters` migrated as the worked example.

Not built, deliberately: the other 97 screens. Three streams were in flight over
`apps/web/src/routes/(app)/settings/`, `apps/web/src/lib/file-manager/` and the custodian surfaces
when this landed, and migrating a screen under another stream's feet turns a fast parallel pass into a
serial repair job. The budget in `lint:screen-data` is the tracker; each screen is a `+page.ts`, a
`createQuery`, and the deletion of a hand-written module.

Also not built: the ~40 non-Grid list surfaces still holding their own `EmptyState` prose. They need
`NoResults` and a judgment per site about whether the surface is a list at all (a 404 page, a "select
a file" prompt and a refusal are not). The Grid's 27 were the ones a prop removal could take.
