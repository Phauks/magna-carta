---
worktree: C:/dev/magna-carta-worktrees/claude/calendar-ui-plan-eu523y
area: The calendar interface — one reusable CalendarView over a domain-free CalendarGrid, the firm /calendar screen, the matter section's month and agenda views, the entry window and the record forms
status: review
touches: packages/design-system/src/lib/components/calendar-grid, packages/design-system/package.json, packages/design-system/src/lib/styles/components.css, apps/web/src/lib/calendar, apps/web/src/routes/(app)/calendar, apps/web/src/routes/(app)/matters/[id]/calendar, apps/web/src/lib/navigation/destinations.ts, apps/web/src/lib/matters/calendar-api.ts, tooling/lint-one-ui/registry.json, packages/calendar/src/settings.ts, packages/calendar/package.json, apps/api-worker/src/routes/calendar.ts, apps/api-worker/openapi/openapi.json, packages/api-client/src, apps/web/src/lib/settings/settings-sections.ts, apps/web/src/lib/settings/settings-permissions.ts, apps/web/src/lib/settings/settings-definitions.ts, apps/web/src/routes/(app)/settings/calendar, docs/conventions/design-corrections.md, docs/specs, docs/user/features, docs/user/admin, roadmap.d/calendar.md, status.d, changelog.d, ROADMAP.md
---

The calendar's first interface slice, planned in
`docs/specs/2026-09-02-calendar-interface-design.md`. The design system gains `CalendarGrid`
(Month, Week, Agenda: a presentation that renders entries and never learns what they are), and
`apps/web/src/lib/calendar/` gains `CalendarView`, the one calendar component every surface embeds
with a scope. The firm-wide `/calendar` screen and the matter section's Month and Agenda views are
both that component. The entry window is a `RecordWindow`; the three record forms are
`ActionDialog`s over pure draft models.

**Files this stream owns, and would collide on:** everything under `apps/web/src/lib/calendar/`
(new), the `(app)/calendar` route tree (new), the matter section's `calendar/+page.svelte`,
`destinations.ts` (the Calendar row flips to shipped), and `apps/web/src/lib/matters/calendar-api.ts`
(moved to `$lib/calendar/calendar-api.ts` and widened; the matter page's import follows it).

**Second round, 2026-09-02:** the owner ruled that the day the week begins on is set by the firm.
That adds `packages/calendar/src/settings.ts`, `GET`/`PATCH /api/v1/calendar/settings` (with the
regenerated contract and client), the Calendar section under Settings › Practice with its
server-backed draft, and the standing rule in `docs/conventions/design-corrections.md`.

**Deliberately not touched:** the matter header and section strip (two other streams), the
data-table family, Home and the matter overview (the component lands there in slice 2 after the
owner has seen the firm calendar).
