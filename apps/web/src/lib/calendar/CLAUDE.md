# The calendar interface — CLAUDE.md

**Purpose.** The one calendar every surface embeds: the reads a scope makes, the window arithmetic
a view needs, the projection from the calendar's record shapes to the entries the design system's
`CalendarGrid` paints, the window an entry opens in, and the forms that record an event, a deadline
and a firm event. The backend it consumes is `packages/calendar` behind
`apps/api-worker/src/routes/calendar.ts`; nothing here adds a route.

**White paper:** _Calendar and rules-based docketing_ — [`docs/Magna-Carta-White-Paper.md`](../../../../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-09-02-calendar-interface-design.md`](../../../../../docs/specs/2026-09-02-calendar-interface-design.md)
(the interface), over the two backend specs it names.

## Key files / entry points

- `index.ts` — exports `CalendarView`, the component a host embeds with a scope; registered in
  `tooling/lint-one-ui/registry.json`, so a second calendar composition anywhere fails the gate
- `calendar-scope.ts` — the closed scope union (`firm`, `mine`, `matter`, `resource`); one read
  plan each
- `calendar-window.ts` — a view plus an anchor as a civil-date window, on `CalendarDate`; the
  previous and next anchors; the window's name; the address helpers
- `calendar-api.ts` — every read and write, mirroring the contract; the shared label helpers
- `calendar-vocabulary.ts` — how each kind reads: word, tone, the type catalog by code; the
  LAYERS a reader can turn on over the firm calendar (`CALENDAR_LAYERS`: only the timeline's
  date-bearing sources, custody dates first)
- `calendar-entries.ts` — the projection to `CalendarGridEntry`, and the day order
- `timeline-presentation.ts` — how a row of the matter's federated timeline reads on the section's
  Timeline view: the kind word through the same vocabulary, the day, the declared label or none
- `calendar-reads.ts` — the read plan per scope: which reads, walked to the end or the ceiling,
  failing independently
- `calendar-controller.svelte.ts`, `calendar-context.svelte.ts` — the view state and the read-once
  context (session, catalog, the firm's matters through `$lib/time/firm-matters.svelte.ts`, and
  the firm's calendar settings)
- `calendar-settings-draft.svelte.ts` — the firm's calendar settings (the day the week begins on)
  as a server-backed draft the settings page at `(app)/settings/calendar` renders through the
  shared settings rows and footer; the one draft on that surface with no local-storage copy
- `calendar-view.svelte`, `calendar-toolbar.svelte` — the component and its one action row
- `entry-window.svelte`, `entry-reference.ts`, `entry-print-sheet.ts` — the `RecordWindow` an
  event, a firm event or a deadline opens in, its verbs, and its print projection
- `record-event-dialog.svelte`, `record-deadline-dialog.svelte`, `record-firm-event-dialog.svelte`,
  `participant-picker.svelte`, `record-timing-fields.svelte`, `time-zone-picker.svelte` — the
  `ActionDialog` forms over the pure draft models `event-draft.ts`, `deadline-draft.ts`,
  `firm-event-draft.ts`, and `time-zone-options.ts`

## Local conventions

- **A host embeds `CalendarView` with a scope and records through the dialogs. It writes no
  calendar read of its own.** A feature that needs "the next thirty days on this matter" is the
  component with a matter scope, `toolbar={false}`, `agendaDays={30}` and a `limit`, not a new
  fetch; Home's Today card and the matter overview's Coming up card are exactly that.
- **A layer is a date-bearing source, never a history source.** A custody due-back falls due, so
  it reads on a calendar; a time entry or a filed email is history and belongs to the matter
  timeline. Adding a layer is one row in `CALENDAR_LAYERS` naming the source keys the read is
  widened to and the word each kind paints as.
- **Every question the pure modules can answer is asserted in `apps/web/test/calendar-*.test.ts`
  without a browser**: the window arithmetic, the projection, the read plan over a fake fetch, the
  draft shortfalls and request shapes. A Svelte file renders those answers and decides none of them.
- **The week begins on the day the firm chose, never on a personal preference.** `CalendarView`
  reads `GET /api/v1/calendar/settings` once with the rest of its context and hands
  `weekStartsOn` to every grid; a surface never picks a week start of its own, and a member has
  no override. The setting is edited under Settings › Practice › Calendar.
- **The grid tones are the subtle status register.** `info` for a court appearance, `danger` for an
  open past-due deadline, `success` satisfied, `warning` and struck for cancelled, `accent` for a
  firm entry; neutral otherwise. Decided once in `calendar-vocabulary.ts` and `calendar-entries.ts`.

## Invariants that apply here

- **The firm-wide grid paints kinds and matter numbers, never titles.** The federated read declares
  non-privileged labels on purpose (a matter event's platform type code, a deadline's state); the
  title is fetched for the one row somebody opened. Deadlines paint from their own access-gated read
  and firm events from the firm's own listing, both of which carry titles by contract, and the
  federated read is narrowed to the event kind so nothing paints twice (`FIRM_CALENDAR_KINDS`).
- **The grid is civil.** An entry sits on the civil day its row names, in the row's own zone; the
  grid never converts a date. Only the wall-clock text carries a zone, and only where it is not the
  reader's (`formatWallClock`). "Today" is the reader's, resolved once through `Intl`.
- **Nothing here computes a date from another date**, and nothing writes "missed": `overdue` is the
  server's read-time comparison and is never re-derived client-side.
- **A read is walked to its end or to `MAX_PAGES_PER_READ`, and says which** (`truncated`). A page
  that reads as the whole month when it is not would be a silent cap, which the design refuses.
- **Every write carries an idempotency key minted per attempt** (`crypto.randomUUID()`), reused on
  a retry of the same attempt and never across two.
- **Two modal shells and never a third**: the entry window is `RecordWindow`, every form and every
  question is `ActionDialog`.

## Dependencies & contracts

- Consumes `@magna-carta/design-system/calendar-grid` (`CalendarGrid.Month`, `.Week`, `.Agenda`,
  the `CalendarGridEntry` shape) and never a second grid; `$lib/api/request.ts` for transport;
  `$lib/time/firm-matters.svelte.ts` for the firm's matters; `$lib/members/members-api.ts` for the
  roster; `$lib/directory/directory-api.ts` for the participant search.
- Consumed by `apps/web/src/routes/(app)/calendar/**` (the firm screen, the firm-events deep
  link, and `rooms/`, the room grid), `(app)/matters/[id]/calendar/` and `[id]/overview/`, Home,
  and the settings pages `(app)/settings/calendar/` and `(app)/settings/resources/`.
  The federated read's deep links are `/matters/{id}/calendar?entry=` and
  `/calendar/firm-events?entry=`; both routes read `entry` and open the window on arrival.

## Gotchas

- **There is no single-deadline read.** `GET /api/v1/calendar/deadlines` takes a matter and a
  window; a deadline reached by deep link outside the window on screen cannot be fetched by id, and
  the window says so rather than reading a matter's whole record to find it.
- **The matter's event listing is newest-first and unwindowed.** The matter scope walks it until a
  whole page starts before the window (page one for the near future); do not add a window
  parameter client-side by filtering after the walk stops early.
- **`formatRange` chooses the span separator and its spacing.** A test on a window title reads
  through them (see `calendar-window.test.ts`) so an ICU update does not fail the arithmetic.
- **The address is mirrored with `replaceState`, never `goto`.** A navigation reloads the page and
  loses the in-flight read; view, date and scope are refinements, not destinations.
