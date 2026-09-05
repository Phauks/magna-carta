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

- `index.ts` — exports `CalendarView`, the component a host embeds with a scope, and
  `MatterCalendarList`, the matter section's List view; `CalendarView` is registered in
  `tooling/lint-one-ui/registry.json`, so a second calendar composition anywhere fails the gate
- `calendar-scope.ts` — the closed scope union (`firm`, `mine`, `matter`, `resource`); one read
  plan each; how a scope is named, and the sentence its empty grid shows
- `calendar-window.ts` — a view plus an anchor as a civil-date window, on `CalendarDate`; the
  previous and next anchors; the window's name; the address helpers, including where a scope's
  "see the rest" link points
- `calendar-api.ts` — every read and write, mirroring the contract; the shared label helpers and
  the closed lists a catalog offers (`FIRM_RESOURCE_KINDS`, `EVENT_TYPE_CATEGORIES`)
- `calendar-permission.ts` — what this account may do on the calendar, said once: the one wording
  of the calendar-manage refusal every writing surface uses
- `calendar-vocabulary.ts` — how each kind reads: word, tone, the type catalog by code; the
  LAYERS a reader can turn on over the firm calendar (`CALENDAR_LAYERS`: only the timeline's
  date-bearing sources, custody dates first); the words for a record kind and a participant kind
- `calendar-entries.ts` — the projection to `CalendarGridEntry`, and the day order
- `calendar-reads.ts` — the read plan per scope: which reads, walked to the end or the ceiling,
  failing independently; how each read's failure is titled and described
- `calendar-controller.svelte.ts`, `calendar-context.svelte.ts` — the view state and the read-once
  context (session, catalog, the firm's matters through `$lib/time/firm-matters.svelte.ts`, and
  the firm's calendar settings)
- `calendar-settings-draft.svelte.ts` — the firm's calendar settings (the day the week begins on)
  as a server-backed draft the settings page at `(app)/settings/calendar` renders through the
  shared settings rows and footer; the one draft on that surface with no local-storage copy
- `calendar-view.svelte`, `calendar-toolbar.svelte` — the component and its one action row
- `matter-calendar-list.svelte` — the matter section's List view: the two tables (deadlines lead,
  then events), each walked to its end by its own read
- `entry-window.svelte` — the `RecordWindow` an event, a firm event or a deadline opens in: the
  record pane in both modes, the verbs, and the shell around the tabs; it renders what the modules
  below decide and decides nothing itself
  - `entry-reference.ts` — which record a reference points at, the record once read, how its kind
    is named; `entry-print-sheet.ts` — its print projection
  - `entry-verbs.ts` — which verbs a record's state allows and why the others refuse; the counts
    the tab strip shows
  - `entry-updates.ts` — what a correction sends: the update projections of the create requests
  - `entry-links.ts` — which end of a link is the other one, which links were related by hand,
    and what may still be related; `entry-links-tab.svelte` — the Links tab, owning its read, its
    Relate dialog and its failures
  - `entry-rooms-tab.svelte` — the Rooms tab, owning its bookings read, its Book a Room dialog and
    its failures
- `record-event-dialog.svelte`, `record-deadline-dialog.svelte`, `record-firm-event-dialog.svelte`,
  `participant-picker.svelte`, `record-timing-fields.svelte`, `event-type-select.svelte`,
  `time-zone-picker.svelte` — the `ActionDialog` forms and the field groups they share with the
  entry window, over the pure draft models `event-draft.ts`, `deadline-draft.ts`,
  `firm-event-draft.ts`, `continue-draft.ts`, `draft-text.ts` (the readings of typed text every
  draft shares) and `time-zone-options.ts`

## Local conventions

- **A host embeds `CalendarView` with a scope and records through the dialogs. It writes no
  calendar read of its own.** A feature that needs "the next thirty days on this matter" is the
  component with a matter scope, `toolbar={false}`, `agendaDays={30}` and a `limit`, not a new
  fetch; Home's Today card and the matter overview's Coming up card are exactly that. The matter
  section's List view is the module's own `MatterCalendarList`, and the section page reads its
  session, roster and catalog through `calendarContext` like every other host (owner ruling,
  2026-09-05); there is no exception.
- **A layer is a date-bearing source, never a history source.** A custody due-back falls due, so
  it reads on a calendar; a time entry or a filed email is history and belongs to the matter
  timeline. Adding a layer is one row in `CALENDAR_LAYERS` naming the source keys the read is
  widened to and the word each kind paints as.
- **Every question the pure modules can answer is asserted in `apps/web/test/calendar-*.test.ts`
  without a browser**: the window arithmetic, the projection, the read plan over a fake fetch, the
  draft shortfalls and request shapes, which verbs a record's state allows, what a correction
  sends, which end of a link is the other one. A Svelte file renders those answers and decides
  none of them; a decision found in a `.svelte` file is moved out, not tested through the DOM.
- **One field group, rendered once.** The timing every event shares is `record-timing-fields.svelte`
  and the type question is `event-type-select.svelte`, in the record forms and in the entry window
  alike; a pane that draws its own copy of either drifts from the form within a round.
- **What this account may do is `calendar-permission.ts`'s answer.** `mayManageCalendar(session)`
  for a yes-or-no, `calendarManageRefusal(act, context)` for the sentence on a refused control;
  no surface words the refusal itself.
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
  server's read-time comparison and is never re-derived client-side. The one word for an open
  deadline past its day is `deadlineStateBadgeLabel`.
- **A read is walked to its end or to `MAX_PAGES_PER_READ`, and says which** (`truncated`). A page
  that reads as the whole month when it is not would be a silent cap, which the design refuses.
- **Every write carries an idempotency key minted per attempt** (`crypto.randomUUID()`), reused on
  a retry of the same attempt and never across two.
- **A correction never re-sends participants** (`entry-updates.ts`): the entry window's Edit sends
  the fields its pane edits and nothing else, so a window that did not touch who is at a setting
  cannot change it.
- **Two modal shells and never a third**: the entry window is `RecordWindow`, every form and every
  question is `ActionDialog`.

## Dependencies & contracts

- Consumes `@magna-carta/design-system/calendar-grid` (`CalendarGrid.Month`, `.Week`, `.Agenda`,
  the `CalendarGridEntry` shape) and never a second grid; `$lib/api/request.ts` for transport;
  `$lib/time/firm-matters.svelte.ts` for the firm's matters; `$lib/members/members-api.ts` for the
  roster; `$lib/directory/directory-api.ts` for the participant search.
- Consumed by `apps/web/src/routes/(app)/calendar/**` (the firm screen, the firm-events deep
  link, and `rooms/`, the room grid), `(app)/matters/[id]/calendar/` and `[id]/overview/`, Home,
  and the settings pages `(app)/settings/calendar/`, `(app)/settings/resources/` and
  `(app)/settings/event-types/`.
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
- **The entry window reaches its tabs' dialogs through the components' exported functions**
  (`linksTab?.openRelate()`, `roomsTab?.openBook()` via `bind:this`), because the action bar is the
  shell's and the dialog is the tab's. The tab snippets are named `…TabContent` so they do not
  shadow those handles.
- **Resolving a related link's title is one read per link.** The links read carries identifiers;
  the title is read on the other end's own path so its visibility is honoured. Widening the
  contract to carry the title would need the backend to apply the same visibility per end.
