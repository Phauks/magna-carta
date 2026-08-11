# claude/calendar-slice-2

**Scope.** Build calendar slice 2 per the merged design
(`docs/specs/2026-08-07-calendar-slice-2-firm-events-and-resources.md`), all three build slices in
one pass: firm events with the `visibilityAnchor` federation contract (2·1), firm resources and
bookings with warn-and-allow conflicts and derived liveness (2·2), and event links plus honest
continuance chains (2·3). Five new per-firm tables, one additive column, one new timeline source,
no new permissions.

**Files expected to touch.**

- `packages/identifiers/src/registry.ts` (+ `types.ts`) — `firmEvent`, `firmEventParticipant`,
  `firmResource`, `firmResourceBooking`, `calendarEventLink`
- `packages/database/src/per-firm-schema.ts` — the five tables + `matter_event.status_reason`
- `packages/database/drizzle/per-firm/20260807T070000_calendar-firm-events-resources-links.sql`
  - snapshot refresh
- `apps/worker/src/per-firm-migrations.ts`
- `packages/calendar/src/` — `types.ts`, `validation.ts`, `notifications.ts`,
  `sources/registry.ts`, `sources/build.ts`, `sources/all.ts`, `timeline.ts`,
  `event-shape.ts` (new, shared shape asserts), `firm-event-statements.ts` / `firm-event-service.ts`
  (new), `resource-statements.ts` / `resource-service.ts` (new), `booking-statements.ts` /
  `booking-service.ts` (new), `link-statements.ts` / `link-service.ts` (new),
  `continuance-service.ts` (new), `deadline-statements.ts` (trigger-linked open-deadline lookup),
  `packages/calendar/CLAUDE.md`
- `packages/calendar/test/` — new suites + extensions of the fitness passes; the five load-profile
  bound assertions over the section 9 corpus
- `packages/data-access/src/pii-registry.ts` — classify the five new tables
- `apps/worker/src/routes/calendar.ts`, `contracts/problem-types.ts`, regenerated OpenAPI +
  api-client artefacts, `apps/worker/test/calendar-routes.test.ts`, `conformance.test.ts`
- Fragments: `changelog.d/calendar-slice-2.md`, `status.d/6-1-case-calendar.md` (calendar slice
  status), `roadmap.d/calendar.md`,
  `docs/decisions/pending/calendar-firm-events-resources-links-continuance.md` (flip to Accepted),
  `docs/user/` guides for firm events, rooms, and continuing a hearing

**Migration tags.** `20260807T070000`, idx 50 (journal head on main is idx 48; the fee-models
stream holds idx 49 / `20260807T060000`; whoever merges second retags dense).
