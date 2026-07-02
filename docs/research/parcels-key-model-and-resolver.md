# Parcels — Key Model & Portal-Key Resolver (design)

**Date:** 2026-06-16
**Scope:** How `@magna-carta/parcels` should model the difference between the parcel id a user holds and the key a county deep-link actually needs, and the async resolver that bridges them. Companion to [`nevada-parcel-apn-system.md`](nevada-parcel-apn-system.md).
**Status:** **Considered and declined (2026-06-16) — see Decision.** This note records _why_ a large share of counties stay search-only, and the resolver design we evaluated and chose not to build.

## Decision (2026-06-16): cap at search-only — no resolver

For an **internal enrichment** tool, the resolver is not worth it. The whole machinery below (a `keySource` flag, an async resolve layer, per-platform portal-scraping strategies, a runtime cache, a legal review, and ongoing maintenance) buys only the gap between "open the right county search page with the parcel ready to paste" and "land directly on the parcel" — a small gain that does not justify scraping dozens of fragile, often bot-blocked government portals.

**What this means concretely:**

- **Portal-key counties stay `searchOnly`** — they open the correct county search page; the user finishes the lookup there. This is already the behavior; the decision is that it is the _ceiling_, not a temporary state.
- **No model change** — no `keySource`, no resolve port, no orchestrator, no runtime store. The pure `assessorUrl` builder and the existing platform adapters are unchanged.
- **Deep-links remain only where the public parcel id is itself the URL key** (Nevada-style, Maricopa, Hawaii-via-TMK). Expect the deep-link rate to stay low nationally; the product value is "route to the exact right county search page," with direct deep-links a welcome minority.
- **The liveness checker (if ever built) stands alone** — it no longer shares an engine with a resolver, but the "fetch a portal, run its search, parse a result" capability is still the thing it would need.

The analysis below is retained as the record of the two-id problem and the option we passed on.

---

(Original design — considered, not adopted.)

## The problem the data forced

Encoding NV/AZ/DE/HI/WA/UT/ID exposed a wall the original model can't cross: **the deep-link key is often not the public parcel id.** There are two distinct identifiers, and only the first is what a user types:

- **Public parcel id** — APN / serial / Oregon Map-Tax-Lot / Hawaii TMK. What the caller has.
- **Portal key** — what the deep-link URL needs. Sometimes equals the public id; often an internal account the public id can't be derived into.

Worked examples:

| State / system                           | Public id (user has)         | Portal key (URL needs) |
| ---------------------------------------- | ---------------------------- | ---------------------- |
| Oregon — Helion PSO, Tyler PA, AscendWeb | Map-Tax-Lot `1S1E34AB 01000` | Account `R325018`      |
| Washington — Harris PropertyAccess       | APN                          | internal `prop_id`     |
| Utah — Tyler Eagle `taxweb`              | serial `12:345:6789`         | internal `accountNum`  |
| Idaho — Aumentum publicaccessnow         | parcel                       | internal `a=` account  |

**Scope:** roughly **46 of the 152 counties encoded so far** (WA ~13, UT 7, ID 3, OR ~23) are gated behind this — and the share grows nationally. Today they are correctly left **search-only**; this design is how they become deep-linkable. (Hawaii's TMK is _not_ this problem — it is a pure reformat of the public id, already handled by the `hawaiiTmk` key format.)

## Where today's model stops

`assessorUrl(site, { apn })` substitutes the normalized input straight into the deep-link. That assumes **the user's input is the portal key** — true for NV / AZ-Maricopa / HI, false for the 46. So the resolver is the missing layer, not a rewrite.

## Design — separate the two ids, add an async resolve layer (keep the pure core pure)

Three concepts and three layers.

**Concepts:** public parcel id · portal key · a resolver that maps one to the other via the county's own search.

**Model change.** A deep-link declares its **key source**:

- `keySource: "publicId"` (default) — the portal key _is_ the public id; build directly, as today.
- `keySource: "resolved"` — the portal key must be looked up; without it, fall back to the search page.

**Layers:**

1. **Pure core (unchanged):** `assessorUrl(site, { key })` — builds the URL from a _known_ portal key. Sync, no network, fully tested. For `publicId` sites, `key` = normalized public id (today's exact behavior).
2. **Resolve port (new, async):** `resolvePortalKey(site, publicId) → Promise<string | null>` — per-platform strategies that hit the county portal's search and extract the portal key. Returns `null` on no-match, bot-block, or failure.
3. **Orchestrator (new, async):** `assessorLink(site, { publicId }) → Promise<string>`:
   - `publicId` site → `assessorUrl(site, { key: normalize(publicId) })` (sync, no network).
   - `resolved` site → `key = await resolvePortalKey(...)`; if `key` → `assessorUrl(site, { key })`, else → `site.searchUrl`.

**The floor guarantee is preserved:** the orchestrator always returns a usable URL; the deep-link is strictly best-effort, the search page is the floor. Nothing regresses.

**Portal-key normalization (separate concern).** Once a portal key is known (resolved or direct), per-county URL formatting still applies. Existing `stripSeparators` / `keepSeparators` plus two new formats Oregon needs: **`tylerRPrefix`** (keep a literal leading `R`, e.g. `R325018`) and **`zeroPadAccount(width)`** (per-county zero-pad, e.g. Clackamas 8, Lane 7). These are pure key-format rules applied to the portal key.

**Caching.** `publicId → portalKey` is stable-ish; cache it (runtime KV or D1, keyed by `jurisdictionId` + public id) so the portal is hit once per parcel, not per view. Invalidate on a liveness failure.

## The efficiency insight (why design this now, together with maintenance)

The **resolver** and the deferred **liveness checker** are the _same capability_: fetch a county portal, run its search, parse a result. Build one **portal-probe** layer and both fall out of it:

- **Resolver:** `search(publicId) → portal key` (to deep-link).
- **Liveness:** `search(canary publicId) → did it land on the expected parcel?` (health).

Both need the same per-platform fetch+parse strategies, the same bot-block handling, and the same runtime store. Designing them as one layer is the time/energy saving the work asked for — and it means the resolver and the maintenance trio (`verifiedAt`/`confidence`, canaries, liveness) share one engine.

## Resolve strategies, ranked by ROI (deferred)

- **Helion PSO** — 17 Oregon counties (plus others nationally); a structured search endpoint (`/PSO/search?searchOption=Map&searchValue=…`) returns results the account is parseable from. **Build first, measure resolvability.**
- **Tyler Public Access**, **Aumentum AscendWeb / publicaccessnow**, **Harris PropertyAccess**, **Tyler Eagle `taxweb`** — each its own search→key strategy, in ROI order.
- **Not all are resolvable** (reCAPTCHA, POST-only forms, session cookies, disclaimer gates). Those stay honestly **search-only**.

## Honest limits

Resolution is networked scraping of government portals: bot-blocking and ToS make it partial, fragile, and per-platform. Internal-only use lowers the risk, but a legal read is a prerequisite before any resolve strategy ships. Measure realistic resolvability per platform before committing engineering — and keep the search-page floor so coverage never regresses.

## Recommended phasing (when we build)

1. **Model fields** — add `keySource` and the `tylerRPrefix` / `zeroPadAccount` key formats. Cheap, no behavior change; lets Oregon be _encoded correctly_ (portal-key deep-links marked `resolved`) even before the resolver exists, so they sit as search-only with the right metadata rather than as fake deep-links.
2. **Portal-probe layer** — the shared fetch+parse engine (resolver + liveness).
3. **Helion PSO strategy** first; measure.
4. Expand by ROI; non-resolvable platforms stay search-only.
5. Wire the liveness checker on the same probe layer.

## Open questions

- `keySource` on the deep-link (recommended — it is a property of the link) vs the site.
- Resolve at request time (UX latency) vs pre-resolve + warm cache (recommended: cache + request-time fallback).
- Runtime store: KV vs D1 for the cache and health state — the same static-vs-runtime split flagged in the maintenance discussion.
- Legal posture for portal scraping under internal-only use.
