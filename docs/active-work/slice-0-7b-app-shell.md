---
branch: slice-0-7b-app-shell
worktree: C:/dev/magna-carta-worktrees/slice-0-7b-app-shell
area: UI (Fable) — App Shell, auth UI, appearance settings
status: building
touches: apps/web, packages/design-system
---

# slice-0-7b-app-shell — the real App Shell, auth UI, appearance settings

**Stream:** UI (Fable). Stage 1 of the UI roadmap (ROADMAP.md, "UI roadmap — the
deferred-surface build order"): the assembled App Shell as real routes in `apps/web` (chrome
parts from the design system; nav registry + permission filtering app-side), then the login/2FA
UI over the slice 0·4 backend, then the appearance-settings surface over the wired
theme/mode/density/motion axes.

**Files touched:** `apps/web/**` (routes, shell composition, app.css/app.html already carry the
boot + cascade), `packages/design-system/**` (small part additions as the shell demands — TopBar
parts, register polish), design-lab mockups (untracked working artifacts in this worktree).

**Added 2026-07-06 — matter detail screen skeleton** (spec:
`docs/specs/2026-07-06-matter-detail-skeleton-design.md`): new routes under
`apps/web/src/routes/(app)/matters/[id]/` (header + section nav layout, overview, twelve
section pages), matter fixtures + header/nav components in `apps/web/src/lib/`. Fixture-driven
only — no worker/schema/data-access edits.

**Added 2026-07-08 — Tools listing page** (spec:
`docs/specs/2026-07-08-tools-listing-page-design.md`): new `apps/web/src/routes/(app)/tools/`
listing page + `apps/web/src/lib/tools/` presentation seam (descriptor + maturity stage per
tool, subject-group labels). Renders `packages/tools` `CATALOG` via `toolsByGroup`; domain
package untouched. Flips the `tools` destination to shipped in `navigation/destinations.ts`.
Listing only — no drop zone, per-tool pages, or run surface.

**Added 2026-07-10 — Network Speed Test page** (spec:
`docs/specs/2026-07-09-network-speed-test-design.md`): the first per-tool page, at
`apps/web/src/routes/(app)/tools/network-speed-test/` with its logic/components under
`apps/web/src/lib/tools/speed-test/`. Cloudflare's `@cloudflare/speedtest` engine on their default
ladder; live download/upload line charts with a 90th-percentile rule, an AIM quality score,
latency small-multiples, an authenticated round-trip probe, a low-internet-usage mode + auto-start
in an overflow menu, and a downloadable plain-text report. Stage `alpha`.

**Coordination:** backend is read-only for this stream (UI brief); auth consumes the committed
contract as-is. One exception, recorded rather than left contradicted: the Network Speed Test adds
two additive, read-only worker routes — `GET /api/v1/tools/connection` (reads only `request.cf`,
the edge's view of the caller) and `GET /api/v1/tools/turn-credentials` (mints short-lived
Cloudflare Realtime TURN credentials for the packet-loss relay; 503 when the TURN secrets are
absent) — plus a per-firm seed migration granting the `tools:speedTest` permission. No schema
table, no data-access layer, and no existing handler is touched. Beyond that, no cross-cutting
edits expected apart from this note, ROADMAP stage updates, and the STATUS 0·7b row.

**Worktree note:** this directory is the former `slice-0-7a-design-system` worktree, repurposed
after 0·7a merged — the folder name lags the branch (`slice-0-7b-app-shell`).
