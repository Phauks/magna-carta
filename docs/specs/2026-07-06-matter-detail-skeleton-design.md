# Matter Detail Screen — skeleton (design)

**Date:** 2026-07-06 · **Stream:** `slice-0-7b-app-shell` · **Status:** approved, building

## Purpose

Give the matter — the file of record — its screen: a persistent matter header, a section
nav covering everything a matter will hold, an overview landing page, and honest skeleton
pages for each section. Fixture-driven presentation only; API wiring, the matters list,
and matter creation are explicitly out of scope (they arrive with the list stream).

## Decisions

1. **Detail screen only.** The matters list page keeps its stage-1 empty state. Review
   navigates directly to fixture URLs.
2. **Sub-routes under a persistent header.** Each section is its own route under
   `matters/[id]/` — deep-linkable; each future slice fills in one page.
3. **Thirteen sections.** Overview, Files, Time, Costs, Parties, Notes, Billing, Trust,
   Custodian, Messaging, Emails, Calendar, Other. Sections without a backend are present
   in the nav, marked with a quiet "soon" badge, and land on an honest stub.
4. **Fixtures, no API plumbing.** All pages render from a local fixtures module. Three
   fixture matters cover the lifecycle: open (numbered), prospective (consultation,
   unnumbered), closed.
5. **Tab strip + overflow.** Horizontal, route-driven tab strip under the header; core
   sections stay visible, the rest fold into a trailing "More" menu, measurement-driven
   at narrow widths.

## Routes

All under `apps/web/src/routes/(app)/matters/`:

| File | Role |
| --- | --- |
| `[id]/+layout.ts` | Resolve the matter from fixtures; unknown id → 404 |
| `[id]/+layout.svelte` | Matter header + section nav + page slot |
| `[id]/+page.svelte` | Overview (landing) |
| `[id]/<section>/+page.svelte` | The twelve section pages |

Fixture ids: `matter-fixture-open`, `matter-fixture-consultation`, `matter-fixture-closed`.

## Matter header

The ceremonial edge of the matter — Engraved Ledger register (serif masthead, small-caps
labels). Composition:

- **Number + title.** Matter number in the ledger voice above the serif title. A
  prospective matter is unnumbered by design: it shows a "Consultation" designation
  where the number would sit.
- **Status seal.** `prospective / open / closed` as a small-caps badge treatment; closed
  reads as archived-but-additive, not dead.
- **Meta line.** Small-caps: client display name, matter type, responsible attorney,
  location.
- **Actions.** Edit + the lifecycle action for the current status (Open / Close /
  Reopen), rendered disabled at fixture stage with explanatory titles, plus an overflow
  menu placeholder.

## Section nav

Route-driven links styled as a tab strip (`aria-current="page"` marks the active
section), built on design-system primitives (tabs styling; dropdown-menu for the
overflow). Core sections — Overview, Files, Time, Costs, Billing, Parties — stay
visible; the remainder folds into a trailing "More" menu. Overflow is measurement-driven
(container width), not a fixed breakpoint. "Soon" sections carry a quiet small-caps
badge in both the strip and the menu, and remain navigable.

## Pages

- **Overview:** key-facts panel (number, status, opened/closed dates, type, location,
  responsible attorney, client, e-billing flag), the description, then quiet skeleton
  tiles for what accrues later (unbilled time, trust balance, recent activity) marked
  soon.
- **Backed sections (Files, Time, Costs):** fixture tables that teach the real shape —
  a few rows of plausible data; amounts in the ledger money voice.
- **Soon sections (Parties, Notes, Billing, Trust, Custodian, Messaging, Emails,
  Calendar, Other):** a shared skeleton pattern — section title, one paragraph of "what
  lives here" in the product's voice, the quiet soon note. No fake chrome.

## Register & constraints

- Engraved Ledger at the ceremonial edge (the header); work surfaces stay calm.
- All styling through `@magna-carta/design-system` + tokens; Lucide icons; no raw CSS.
- No process-artifact references in source (`pnpm run lint:process-refs`).

## Verification

`pnpm check` clean; browser review of: all three lifecycle states, tab overflow at
narrow width, each section page, light + dark theme.

## Out of scope

Matters list DataTable + saved views, matter creation, API wiring (get/patch/lifecycle),
custom-fields rendering, and every section's real implementation.
