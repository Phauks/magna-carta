# Matter data seam + client-side mock mode — plan

**Status:** plan (design agreed, not yet built)
**Branch:** `slice-0-7b-app-shell` (worktree `magna-carta-worktrees/slice-0-7a-design-system`)
**Date:** 2026-07-08

## Goal

Two connected pieces the owner chose ("do a and b", right over fast):

- **(a) Wire the matter section pages to fetch through the real data layer** — replace the
  hardcoded `$lib/matters/fixtures.ts` import with the generated api-client, so the matter
  screen exercises the real components, real query lifecycle (loading / empty / error), and the
  real response contracts. This is the app's _first_ data-layer integration.
- **(b) A client-side mock mode, toggled from the developer console**, that makes those real
  routes populate without a backend — pure `vp dev`, no Worker, no D1 — by swapping the
  api-client's transport for an in-browser mock that answers with contract-typed data.

Explicitly out of scope (the earlier ramble): a `/demo/` route, and any v-sync work. Deferred to
a later pass: the full-stack Miniflare-D1 seed path, and wiring mutations (create/edit).

## What the investigation established

- **The load-profile generators are node/database-side.** `generatePracticeVolume`,
  `seedDemoFirm`, et al. (in `@magna-carta/fixtures/load-profile/`) take a `BatchDatabase` and
  write through real domain services (`createMatter`, `commitVersion`, `postEntry`) on
  `node:sqlite`. They **cannot run in a browser**. So a client-side mock is fed by _its own_
  data source, not by calling these generators at runtime.
- **The web app has no data layer yet.** `apps/web/package.json` depends only on
  `@magna-carta/design-system` + `@magna-carta/design-tokens`. Adding `@magna-carta/api-client`
  and `@tanstack/svelte-query`, and standing up a `QueryClient`, is part of this work.
- **The api-client is the seam.** It is hey-api generated: every call is
  `(options?.client ?? client).get(...)`, and the default `client` is a configurable singleton
  (`client.setConfig({ baseUrl, fetch })`). TanStack query-option helpers are already generated
  (`mattersGetOptions`, `filesListOptions`, `timeEntriesListOptions`, `costsListOptions`, …). So
  pages query through those helpers directly; **mock vs. real is only which `fetch`/`baseUrl` the
  one client uses.** No hand-written repository wrapper is needed (it would be redundant
  indirection that drifts from the generated contract).
- **Endpoint shapes for the matter screen:**
  - `mattersGet({ path: { id } })` → `MatterDetail` (header + overview)
  - `filesList({ query: { matterId } })` → `FileListResponse` (`FileSummary[]`)
  - `timeEntriesList({ query: { matterId } })` → `TimeEntryListResponse` (`TimeEntrySummary[]`)
  - `costsList({ query: { matterId } })` → `CostListResponse` (`CostSummary[]`)
  - `matterTypesList` / `locationsList` for overview labels as needed
    Files/time/costs are **top-level list endpoints filtered by `matterId`**, not nested under the
    matter — the seam calls reflect that.

## Architecture

```
 page component  ──createQuery(filesListOptions({query:{matterId}}))──►  @tanstack/svelte-query
                                                                              │
                                                          resolves via  ◄─────┘
                                                                              │
                                              @magna-carta/api-client default `client`
                                                                              │
                        ┌──────────────── client.config.fetch ───────────────┤
              mock ON   │                                                     │  mock OFF
                        ▼                                                     ▼
             lib/dev/mock/mock-fetch.ts                          real network → /api/v1
             (path+method → typed Response)                      (worker-dev / prod)
                        │
              lib/dev/mock/dataset.ts  (deterministic, seeded, contract-typed)
```

The developer-console "Mock data" toggle flips `client.setConfig({ fetch })` and then
`queryClient.invalidateQueries()` so open queries refetch through the new transport. Toggle state
persists and follows across the pop-out window exactly like the existing static-skeletons and
motion-override toggles (reuse that pattern — `storage`-event mirror, DOM/config-only, no
ping-pong).

### Mock data source — decision

The mock must return **api-client response types** (`MatterDetail`, `FileSummary`, …). Three ways
to produce them; recommendation first:

1. **(Recommended) Hand-authored, contract-typed builders with a fixed faker seed.** Browser-safe,
   zero new heavy deps, and TypeScript breaks the builders the moment a contract changes so it
   _can't_ silently drift. The three curated matters from today's `fixtures.ts` become the named,
   stable entries; a seeded generator adds volume around them. This is the honest client-side
   analog of the load-profile generators — same faker discipline, producing API responses instead
   of DB rows.
2. **(Later fidelity upgrade) Build-time snapshot from the real generators.** Run
   `generatePracticeVolume` in a Node build step, capture API-shaped JSON, ship it as a static
   module the mock serves. Higher fidelity, more machinery; revisit if hand-authored drifts from
   real responses in practice.
3. **(Rejected) Browser SQLite (sql.js / wa-sqlite) running the generators.** Pulls a
   C-compiled-to-WASM SQLite into the browser bundle — against golden rule 14, and far too heavy
   for a dev affordance.

Go with **(1)** now; leave a note pointing at **(2)** as the upgrade path.

## Phased task breakdown

Each phase is independently reviewable; the app keeps building throughout.

### Phase A — Data-layer foundation (no visible change)

- Add `@magna-carta/api-client` (workspace) and `@tanstack/svelte-query` (catalog) to
  `apps/web/package.json`.
- Stand up a `QueryClient` and provider in `routes/(app)/+layout.svelte` (SPA, `ssr=false`, so a
  single client-side instance is fine). Reasonable defaults (staleTime, no refetch-on-focus for a
  desktop-app feel).
- Configure the api-client default `client` base URL from an env value
  (`import.meta.env.VITE_API_BASE_URL` → same-origin `/api/v1` under `vp run worker-dev`), leaving
  `fetch` unset (real network) by default.
- Gate: `pnpm --filter @magna-carta/web check` clean; app still builds and renders.

### Phase B — Mock transport + dataset + dev toggle

- `apps/web/src/lib/dev/mock/dataset.ts` — deterministic, seeded dataset built once, exposing the
  contract-typed objects keyed for lookup (matters by id; files/time/costs by matterId). Includes
  the three curated matters (open / consultation / closed) so every header + page state stays
  reviewable at stable ids, plus seeded volume.
- `apps/web/src/lib/dev/mock/handlers.ts` — a method+path table (`GET /api/v1/matters/{id}`,
  `GET /api/v1/files`, `GET /api/v1/time-entries`, `GET /api/v1/costs`, `GET /api/v1/matters`, …)
  → functions returning a typed body; unmatched routes return a 404 `Problem` so gaps are obvious.
- `apps/web/src/lib/dev/mock/mock-fetch.ts` — a `fetch`-compatible shim that parses the request,
  dispatches to `handlers`, and returns a `Response` with the JSON body. Small artificial latency
  option so loading states are visible.
- Dev-console module `lib/developer/modules/mock-data/` + registry entry (co-located with Motion /
  Performance / Sitemap / Fixtures). A `Switch` "Mock data" that persists + cross-window-syncs
  (reuse the static-skeletons module pattern) and, on change, calls `client.setConfig({ fetch })`
  and `queryClient.invalidateQueries()`.
- Tests: vitest over `handlers` (path matching + that each handler's body satisfies its response
  type) — cheap and catches contract drift.

### Phase C — Rewire the matter pages to the seam

- `routes/(app)/matters/[id]/+layout.svelte` — query `mattersGetOptions({ path: { id } })`; put the
  resulting matter into context for the header + child pages; render loading / not-found (404-style
  in-chrome) / error from the query state. Retire the fixture load in `+layout.ts`.
- `overview`, `files`, `time`, `costs` `+page.svelte` — query their slice via the matching
  `*ListOptions({ query: { matterId } })`; keep the existing table + empty-state presentation, now
  fed by contract types (`FileSummary`, `TimeEntrySummary`, `CostSummary`). Money via
  `DataTable.formatMoney` on the `amount_minor` fields.
- The nine unbacked sections stay stubs (unchanged).
- Retire `$lib/matters/fixtures.ts`; its curated content moves into the mock dataset.
- Verify with mock ON: each page renders; loading and empty states show; an unknown id 404s in
  chrome. Verify with mock OFF against `vp run worker-dev` that the same pages hit the real API
  (even if the local firm is empty — the point is the wiring resolves).

### Phase D — Dev-console reconciliation (small)

- The Fixtures tab's matter entry points now open the real `[id]` routes, which light up only when
  mock mode is on — note that in the Fixtures module copy. Sitemap is unchanged (still the static
  routes; dynamic `[id]` stays out of it by design).

### Phase E — Docs + gate

- ADR: "Web reads through the api-client seam; dev-only client-side mock transport" (record the
  transport-swap decision and the rejected browser-SQLite option). Pending fragment under
  `docs/decisions/pending/`.
- Changelog fragment under `changelog.d/`.
- Update / add the `docs/active-work/<branch>.md` note (scope + files touched) and run
  `vp run worktrees` before touching any shared file.
- Full gate: `pnpm --filter @magna-carta/web check`, `vp check --fix` on touched paths,
  `pnpm run lint:process-refs` (ignore the known pre-existing unrelated-package false positives).

## Risks / watch-items

- **Runtime transport swap.** `client.setConfig({ fetch })` mutates the singleton; the
  `invalidateQueries()` after the flip is what makes already-mounted pages refetch. Verify a
  toggle with a matter page open actually re-resolves (not a stale cache).
- **Contract drift.** Because pages use the generated query-options and the mock returns the
  generated response types, a contract regen surfaces breakage at compile time in both — that's the
  intended safety, but it means a regen may require touching the mock dataset. Cheap and loud,
  which is correct.
- **DEV-only.** Mock mode is gated behind `import.meta.env.DEV` + the DEV-only dev console; it must
  never ship in a production bundle.
- **Empty real backend.** With mock OFF and a fresh local firm, real pages will legitimately show
  empty states — that's the wiring working, not a bug. (The full-stack seed button that fixes this
  is the deferred path.)

## Deferred (named, not built here)

- **Miniflare-D1 seed button** — a dev-console action that runs the _real_ `seedDemoFirm` /
  `generatePracticeVolume` against the local `worker-dev` database for full-stack fidelity. This is
  the true generator reuse; it belongs after reads are wired.
- **Mutations** (create / open / close / edit) through the seam — reads only for now.
- **Snapshot-from-generators** mock source (fidelity upgrade #2 above).
