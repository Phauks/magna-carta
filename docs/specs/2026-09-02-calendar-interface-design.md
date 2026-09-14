# Calendar interface — design and plan

**Date:** 2026-09-02
**Status:** Built through the sixth round (section 10). The owner flags in section 12 are
recommendations this build proceeds on, not open architecture; **C3 was reversed by the owner on
2026-09-14** — see the flag.
**Scope:** The user interface over the calendar the two backend slices built: one reusable calendar
component every surface that needs a calendar reaches for, the firm-wide `/calendar` screen it
powers, the matter's Calendar section re-based on it, the window an entry opens in, and the forms
that record an event, a deadline and a firm event from a screen. Excludes, as the backend specs
did: rule-based deadline computation, notification wiring, recurring events, external calendar
synchronization, and matterless personal appointments. The room grid and the bookings surface, the
event-links surface and the continuance-chain reader are named slices here (section 10), not
excluded.
**Backend specs this consumes:**
[`2026-08-05-case-calendar-design.md`](2026-08-05-case-calendar-design.md) (the event and deadline
model, the federated read, the label discipline) and
[`2026-08-07-calendar-slice-2-firm-events-and-resources.md`](2026-08-07-calendar-slice-2-firm-events-and-resources.md)
(firm events, resources and bookings, links, continuance; its section 7 names the read shapes a
surface consumes, and this document is the surface).
**Design standards this composes:** the page archetypes
([`2026-06-12-page-archetypes.md`](2026-06-12-page-archetypes.md)), the design language, the
owner's standing rulings ([`../conventions/design-corrections.md`](../conventions/design-corrections.md)),
and the UI working model ([`../conventions/ui-design.md`](../conventions/ui-design.md)).

---

## 1. What this design is, in one paragraph

The calendar is built **once**, as a component, and every surface that needs one embeds it with a
_scope_: the firm-wide screen is the component with a firm scope, the matter's Calendar section is
the component with a matter scope, and the dashboard's "today" widget, a room's schedule and a
directory entity's appearances are the same component with narrower scopes when those slices land.
The component owns the reads, the window arithmetic, the view state and the entry window, so a
feature that "reaches into the calendar" writes one tag and no calendar code. Underneath it, the
design system gains a domain-free month, week and agenda presentation (the EventRail precedent: a
component that renders entries and never learns what they were about), so a second calendar
rendering cannot be hand-rolled in an app screen. Both are registered in the one-implementation
registry the moment their contract is agreed, which is this document.

## 2. What exists, and what each read can and cannot show

The backend is complete for everything in slices 1 and 2 of this plan. What matters for the
interface is not the route list but **what each read carries**, because it decides what a grid can
paint.

| Read                                                                 | Carries                                                                                                                                                                                                                                | Does not carry                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `GET /api/v1/calendar/events?from&to&scope&kind&matterId&memberId`   | One merged, windowed page across every source: kind, civil-date sort key, matter id, a declared non-privileged label (a matter event's platform type code; a deadline's state; a firm event's type name and audience), and a deep link | **Titles.** A person's name. Anything free-text. |
| `GET /api/v1/calendar/deadlines?matterId&state&from&through&overdue` | Every deadline the member can see, soonest first, with its title, authority, state, and read-time `overdue`                                                                                                                            | Nothing a deadline surface needs                 |
| `GET /api/v1/matters/{matterId}/events`                              | The matter's own events with titles, times, zones, places, continuance neighbours; newest first, cursor-paged                                                                                                                          | A date window (it is the whole record, walked)   |
| `GET /api/v1/events/{eventId}`                                       | One event with its participants                                                                                                                                                                                                        |                                                  |
| `GET /api/v1/firm-events?from&to&status&eventTypeId`                 | The firm's own events with titles, over a required window                                                                                                                                                                              |                                                  |
| `GET /api/v1/firm-events/{firmEventId}`                              | One firm event with its participants                                                                                                                                                                                                   |                                                  |
| `GET /api/v1/calendar/event-types`                                   | The type catalog, for the record forms and for turning a type code into a name                                                                                                                                                         |                                                  |
| `GET /api/v1/calendar/resources` · `/{id}/availability`              | The resource catalog and a resource's window, conflicts pre-paired                                                                                                                                                                     | Titles, by rule                                  |
| `GET /api/v1/matters/{matterId}/timeline`                            | The federated matter history, newest first, every source                                                                                                                                                                               | Titles, by rule                                  |

The consequence is the first design decision, and it is not negotiable because the backend made it
on purpose: **the firm-wide grid paints kinds and matters, never titles.** A cell on the firm
month grid reads "Hearing · 2026-0042" and the title lives in the window that opens when it is
pressed, fetched for that one row. That is exactly the shape the backend design asked for ("the
detail is one extra request for the ONE row somebody opened, rather than a redaction problem on
every row of every page"). Deadlines are the exception in practice rather than in principle: their
listing is already access-gated per row and carries titles, so a deadline on the grid reads
"Response due · 2026-0042" from the deadlines read, and the federated read's `deadline` kind is
narrowed out so it is not painted twice.

Writes: every recording, editing, cancelling, satisfying, vacating, superseding and continuing
operation the two specs list is built, idempotency-keyed, and behind `calendar:manage`. Reads are
behind `calendar:read`. Nothing here adds a route.

## 3. The two-layer component contract

Two homes, one component each, on the same division the platform draws between EventRail (design
system, domain-free) and the surfaces that hand it events.

### 3.1 `CalendarGrid` — the presentation (NEW-DS)

_Four presentations since 2026-09-14: Month, Week, **Day** and Agenda. The Day is the one with a
time axis — an hour per row, a CALENDAR per column — and it takes two facts the others do not read:
`startMinute`/`endMinute` (the numeric twin of the already-formatted `time`, because a grid cannot
get a number back out of somebody else's formatting) and `lane` (which column an entry sits in). A
member-chosen `color` rides beside the `tone` on every presentation and never shares a property with
it: the tone paints the chip, the colour paints a rule down its leading edge._

**Home:** `packages/design-system/src/lib/components/calendar-grid/`, exported as
`@magna-carta/design-system/calendar-grid` in the house namespace shape (`CalendarGrid.Month`,
`CalendarGrid.Week`, `CalendarGrid.Agenda`, plus the prefixed aliases). Registered in
`tooling/lint-one-ui/registry.json`.

**What it knows:** civil dates, a week's shape, and a closed entry type. **What it never learns:**
what a hearing is, what a matter is, what a firm is. The entry shape is deliberately domain-free:

```ts
interface CalendarGridEntry {
  /** Stable identity, the render key. */
  id: string;
  /** The civil day the entry sits on, YYYY-MM-DD. Never an instant: the day never shifts under the viewer's zone. */
  date: string;
  /** The last civil day of a span; absent for a point. A span paints on every day it covers. */
  endDate?: string;
  /** What it says: "Hearing", "Response due", "Firm meeting". */
  label: string;
  /** The second line: a matter number, a place, an audience. */
  detail?: string;
  /** The wall-clock time as the CALLER formatted it (the EventRail rule: the presenter never formats a domain's time). */
  time?: string;
  /** The colour register, always the subtle one on a work surface. */
  tone: "neutral" | "accent" | "info" | "success" | "warning" | "danger";
  /** Struck through: a cancelled setting, a vacated deadline. Shown, never hidden. */
  struck?: boolean;
  /** Where activating it goes, when it goes somewhere. A caller that opens a window handles `onActivate` instead. */
  href?: string;
}
```

The three parts:

- **`Month`** — a seven-column grid over the weeks a month spans (leading and trailing days from the
  neighbouring months rendered dimmed, so every row is a full week). Each cell carries its day
  number, the entries on that day ordered as handed over, and past a cap a "+N more" control that
  hands the day back to the caller (`onShowDay`). Today is marked. The grid is a real `<table>`
  with a caption and column headers, because that is the accessible answer for a fixed-shape grid
  and it costs no ARIA at all; each entry is a button (or a link when `href` is given) so it is
  focusable in DOM order. The table holds its height (the list-screen ruling): a month with nothing
  in it is the same grid, empty, and the empty statement sits in the caption region rather than
  replacing the grid.
- **`Week`** — the same cell grammar over exactly seven days, one row, taller cells, no overflow
  cap. Slice 1 ships this civil-day form of the week rather than a time-axis form (owner flag C3).
- **`Agenda`** — a day-grouped list over any span: a day heading carrying the full date, then the
  day's entries as rows with the time at the reading edge. It is the view that survives a narrow
  canvas and the one the dashboard and the matter section embed at small size. Days with nothing on
  them are omitted; a span with nothing at all renders the caller's empty statement.

Every part takes `entries`, `label` (its accessible name), `loading` (placeholder cells, `aria-busy`),
`emptyMessage`, and `onActivate(entry)`. `Month` and `Week` additionally take `anchor` (a civil date
inside the month or week), `weekStartsOn` (0 for Sunday, the default; 1 for Monday: the FIRM's
setting, which `CalendarView` reads once with the rest of its context), and `today` (a civil date the caller supplies, because "today" is a fact about a zone and
the presenter has no zone). Nothing in the family reads a clock.

**States:** loading, empty, dense (a day with twelve entries in the month cap), struck entries, and
a span crossing a month boundary. Each is a story and a behaviour test.

### 3.2 `CalendarView` — the one calendar (NEW-APP)

**Home:** `apps/web/src/lib/calendar/calendar-view.svelte`, with its model beside it. Registered in
`tooling/lint-one-ui/registry.json`. This is the component the user's brief asked for: the thing a
feature reaches into the calendar through.

```svelte
<CalendarView
  scope={{ kind: "firm" }}                 <!-- or { kind: "matter", matterId }, { kind: "mine", memberId } -->
  view="month"                             <!-- "month" | "week" | "agenda"; bindable -->
  bind:anchor                              <!-- a civil date, YYYY-MM-DD; bindable -->
  toolbar={true}                           <!-- the view switch and the navigation; false to embed headless -->
  address={true}                           <!-- mirror view, date and the open entry into the page's query string -->
  openEntry={entryIdFromAddress}           <!-- open this entry's window on arrival: the deep-link contract -->
  onRecorded={...}                         <!-- fired after a write lands, so a host can re-read its own panels -->
/>
```

What it owns, so that no host has to:

- **The scope model** (`calendar-scope.ts`): a closed discriminated union. `firm` reads the whole
  firm; `mine` is the firm scope with `memberId` set to the session member, which the backend
  resolves in SQL as participant-or-responsible-or-all-members; `matter` reads one matter. Slice 3
  adds `resource`. A scope maps to exactly one read plan, written once.
- **The window arithmetic** (`calendar-window.ts`): a view plus an anchor is a civil-date window
  (`from`, `to`), the grid's weeks, and the previous and next anchors. All of it on
  `@internationalized/date`'s `CalendarDate`, never on `Date`, so a month that crosses a
  daylight-saving change has the right number of days. The firm read's 366-day refusal is respected
  by construction: no view asks for more than six weeks.
- **The read plan and the projection** (`calendar-api.ts`, `calendar-entries.ts`): the firm scope
  reads the federated window narrowed to the event and firm-event kinds plus the deadlines read over
  the same window; the matter scope walks the matter's own event listing until it passes the window
  (page one for the near future, which is the common case) plus the deadlines read for the matter.
  Both project into `CalendarGridEntry` through one vocabulary (`calendar-vocabulary.ts`): a kind
  to a label and a tone, a type code to a name through the catalog, a matter id to its number
  through the docket read the matters screen already makes.
- **The view state** (`calendar-controller.svelte.ts`): view, anchor, scope, the entries and their
  failure, navigation (previous, next, today), and optional mirroring into the page's query string.
  The white paper's rule decides what goes where: view and date are ephemeral refinement and live in
  the query; the scope's identity (which matter) lives in the path, which is why the matter section
  passes the scope rather than reading it.
- **The entry window** (`entry-window.svelte`): the one `RecordWindow` an event, a firm event or a
  deadline opens in, fetched on open by its own read. Its left pane is the record; its tabs are
  Participants, Links (continued from and to, related), and History (the event rail over the
  entry's own audit trail once that read exists; a Soon tab until then). Its action bar carries the
  entry's verbs: Cancel, Continue for a scheduled matter event; Satisfy, Vacate, Supersede for an
  open deadline; Cancel for a firm event. Edit is the window's own control and edits in place. A
  member without `calendar:manage` sees each control disabled with that reason, never absent.
- **The record forms** (`record-event-dialog.svelte`, `record-deadline-dialog.svelte`,
  `record-firm-event-dialog.svelte`): three `ActionDialog` forms over pure draft models
  (`event-draft.ts`, `deadline-draft.ts`, `firm-event-draft.ts`) that hold the field state, the
  shortfalls, and the request shape, so the validation that decides whether the commit is available
  is asserted without a browser. The event and firm-event forms share `participant-picker.svelte`:
  a firm member from the roster, a directory entity through the directory search, or an external
  name typed once, each a chip with an optional role. The time zone is a combobox over
  `Intl.supportedValuesOf("timeZone")` with the reader's own zone and the firm's office zones
  offered first (`time-zone-options.ts`).

## 4. The screens

### 4.1 `/calendar` — the firm calendar (List/Index archetype, calendar-shaped)

The masthead reads **Calendar**. Its inline-end half carries one primary action, **Record**, as a
menu (an event on a matter, a deadline on a matter, a firm event), on the "one primary action with a
menu" ruling. Beneath the masthead, one action row at the reading edge: the scope toggle
(**Mine** / **Everyone**, a segmented control whose active side is unmistakable), the view switch
(month, week, agenda, icon buttons held pressed), and the navigation (previous, **Today**, next,
with the window's name as text between them). The grid takes the remaining height and keeps it.

No explanatory prose anywhere on the screen. What a kind means is the label on the chip; what the
platform will not do (compute a deadline) is stated in the user guide, not here.

Query string: `view`, `date` (the anchor, YYYY-MM-DD), `scope` (`mine` | `everyone`), `entry`
(the open entry). `/calendar/firm-events?entry=` is the deep link the federated read already emits
for a firm event; it renders the same screen with the firm side of the scope and opens the entry.

### 4.2 `/matters/{id}/calendar` — the matter's Calendar section

The section keeps everything it has (the past-due alert, the deadlines table, the events table:
these are the matter's record, and the tables are the reviewed surface) and gains a view switch at
the section's action row: **Month**, **Agenda**, **List**, where List is the two tables as they
stand. Month and Agenda are `CalendarView` with the matter scope, its toolbar carrying the navigation
but not the view switch (the section's own row carries that), mirroring `view` and `date` into
the query. The two disabled "Record" controls
become live: they open the record dialogs with the matter fixed. The deep link
`?entry=` the federated read emits for a matter event opens the entry window on arrival.

The section's own read stays as it is; the component makes its own. Two reads of the same record on
one screen is a deliberate cost here rather than a coupling: the tables are a listing walked to the
end, the grid is a window, and folding one into the other would make the section's list depend on
the calendar's window.

### 4.3 Where the component goes next (not slice 1)

- **Home** — a "Today" card (built in the second round): the agenda over today and tomorrow, `mine`
  scope, headless, six rows and a line to the rest at `/calendar`. It is the dashboard's first
  widget, above the empty state the rest of the grid still shows; its place on the finished
  dashboard is the owner's to move.
- **Matter overview** — the "Recent activity" tile the overview reserved is now "Coming up": the
  matter's agenda over the next thirty days, the same component with `toolbar={false}`, six rows
  and a line to the Calendar section (built in the second round).
- **A directory entity** — every event the person or organization appears in, once the participant
  read is filterable by entity (a small backend addition the entity page's own slice makes).
- **A resource** — the room grid at `/calendar/rooms` (built in the third round): the component
  with the resource scope, opening on the week, over the availability read with conflicts painted
  from the pre-paired ids. A booking paints as the event it belongs to and opens that event's
  window; the picker names the room and mirrors it into the address.

## 5. What the grid paints, and the vocabulary

One table, in `calendar-vocabulary.ts`, decides how every kind reads:

| Source / kind               | Label                                                       | Detail                            | Tone                                                                                                         |
| --------------------------- | ----------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Matter event (firm scope)   | The type's name from the catalog, else "Event"              | The matter number, else its title | neutral; `info` for a hearing, trial, or deposition                                                          |
| Matter event (matter scope) | The event's own title                                       | The type's name · the place       | as above; cancelled is struck, warning                                                                       |
| Deadline                    | The deadline's title                                        | The matter number (firm scope)    | `danger` when open and past due; `success` satisfied; neutral open; struck and neutral vacated or superseded |
| Firm event                  | The type's name, else "Firm event"; the title in its window | "Everyone" for `all_members`      | `accent`, because a firm entry is an edge, not a work surface                                                |

Cancelled settings are shown struck, never hidden: a setting that was called off and one that never
existed are different facts, which is the rule the matter section already states. The reader can
narrow them out of "what is coming" in the agenda by its own state filter in slice 2.

Times render through the existing `formatWallClock`, which shows the zone only where it is not the
reader's own; the calendar keeps that rule.

## 6. The state set, per view

| State                | Month and Week                                                                           | Agenda                                      |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| Loading              | The grid, cells carrying skeleton rows, `aria-busy`                                      | Skeleton day groups                         |
| Empty                | The grid, no chips, one line in the caption region: "Nothing recorded in September 2026" | The empty statement, with the record action |
| Filtered, no results | Same as empty with the narrowing named ("Nothing on your calendar in …")                 | Same                                        |
| Error                | The grid stays; a `FailureNotice` above it with the Error ID and Retry                   | Same                                        |
| Dense                | The overflow cap with "+N more" opening the day in the agenda                            | Long days scroll inside the region          |
| Sample matter        | The matter section's existing statement: no firm, nothing to read                        | Same                                        |

A failed deadlines read does not blank the events, and the reverse; the two reads fail
independently and the notice names which one did.

## 7. The rulings this composes, named

- **A screen with no way to create the thing it lists is not built** (Custodian, 2026-09-01): the
  record forms ship in slice 1, and the matter section's two disabled controls go live. The earlier
  deferral ("waits on the participant picker") is answered by building the picker.
- **No info lines; a heading carries no sub-text; one compact action row** (matters list, safe
  viewer, 2026-08-30/31).
- **A toggle's active side is unmistakable; what acts like a link looks like a link; a control
  that undoes a state exists only while that state is in play** (the Today control is always
  drawn, because "today" is a destination rather than an undo).
- **Only `soon` wears a maturity mark**: the sidebar's Calendar entry flips to shipped, stage alpha,
  which presents as nothing.
- **A capability the backend does not serve yet still renders, disabled, with the Soon badge**: the
  History tab in the entry window until the per-record audit read exists; the room booking on an
  event until slice 3.
- **Two modal shells and never a third**: the entry window is `RecordWindow`, every form and every
  question is `ActionDialog`. The kind table decides the primitive; nothing here composes a Dialog.
- **A list of records is the product's one grid**: the matter section's tables are untouched.
- **Status colour in the subtle register on a work surface**: chip tones are the subtle trio; the
  one solid moment is the past-due alert the matter section already carries.

## 8. Time and zones, the two rules the interface adds

1. **The grid is civil.** A cell is a civil day and an entry sits on the civil day its row names,
   in the row's own zone. The grid never converts: a hearing on the 14th in Los Angeles is on the
   14th for a reader in New York, because the record says the 14th. Only the wall-clock text carries
   the zone, and only when it differs from the reader's.
2. **"Today" is the reader's.** The today mark and the Today control resolve the reader's zone
   through `Intl`, once, in the controller. The overdue flag on a deadline is the server's, in the
   deadline's own zone, and the two are never compared client-side.

## 9. Testing

- **Pure modules, asserted without a browser** (`apps/web/test/calendar-*.test.ts`): the window
  arithmetic (a month's week rows for a Sunday and a Monday start, February in a leap year, the
  window never exceeding the read's cap, previous and next anchors across a year boundary); the
  projection (each kind's label, detail and tone; a cancelled setting struck; an open past-due
  deadline `danger`; a firm event's audience line; a matter id resolved to its number and an
  unresolved one falling back honestly); the scope-to-query mapping; each draft model's shortfalls
  and request shape (a time without a zone refused; an end before a start refused; a deadline's
  authority optional; the participant shapes).
- **The presentation, in the catalog** (`packages/design-system/src/stories/calendar-grid.stories.svelte`):
  one story per state per part, `play` assertions that a struck entry carries the strike, that the
  overflow control reports the hidden count, that today is marked once, and the per-story axe pass.
- **The one-implementation gate**: `CalendarGrid` and `CalendarView` in the registry, so a second
  month grid or a second calendar composition fails `pnpm run lint:one-ui`.
- **Browser verification** on the deployed site, per the standing direction: the firm calendar in
  both modes and two themes, the matter section's three views, the entry window, each form's refusal
  states.

## 10. Slices

| Slice | Delivers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Branch                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **1** | `CalendarGrid` (Month, Week, Agenda) with stories; the `apps/web/src/lib/calendar/` module (scope, window, api, entries, vocabulary, controller, `CalendarView`, entry window, the three record forms, the participant picker); `/calendar` and `/calendar/firm-events`; the matter section's view switch and live record controls; the sidebar entry flipped to shipped; the user guides re-based on the screens; tests; the firm's week-start setting (`/settings/calendar` over `GET`/`PATCH /api/v1/calendar/settings`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `claude/calendar-ui-plan-eu523y` (this)         |
| **2** | Layers on the firm calendar (custody dates: due-backs and review dates, the timeline's date-bearing sources; its history sources stay in the timeline) and a "hide settled" filter on the agenda; the Home "Today" card and the matter overview's "Coming up" agenda, both the one component capped at six rows; a colleague picker on the firm scope beside Mine/Everyone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `claude/calendar-ui-plan-eu523y` (second round) |
| **3** | The room grid at `/calendar/rooms` (the resource scope over the availability read, a week at a time, conflicts painted danger with a "Double-booked" line), the Rooms tab on an event's window (its bookings through the new `GET /api/v1/events/{id}/bookings` and `/firm-events/{id}/bookings` reads, Book a Room as a verb, Release per row), and the resource catalog under Settings › Practice › Rooms and Resources. Event links (related) as a reader in the Links tab moved to slice 4 with the links list read it needs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `claude/calendar-ui-plan-eu523y` (third round)  |
| **4** | The event-type catalog under Settings › Practice › Event Types (a platform type recategorized or retired, a firm type added, renamed or retired; retiring is one way, as the contract is); related links on the entry window's Links tab over the new `GET /api/v1/events/{id}/links` and `/firm-events/{id}/links` reads, with Relate (a setting on the same matter, or a firm event within six months) and Remove. The matter timeline as a Calendar-section view was dropped from this round: the Activity section (#464) is that read's one screen. A time-axis week view waits on the owner using the civil-day form                                                                                                                                                                                                                                                                                                                                                                                                          | `claude/calendar-ui-plan-eu523y` (fourth round) |
| **6** | The owner's review round of 2026-09-14, eleven corrections. The firm calendar's calendars become a CATALOG in folders (`calendar-sources.ts`) with a per-browser selection and colour (`calendar-preferences.svelte.ts`) drawn as a rail; the read plan becomes a plan per calendar; `CalendarGrid.Day` adds the fourth presentation, an hour axis crossed with a column per calendar, fed by the `timeOfDay`/`timeZone` the federated projection now carries; the eleven member-chosen colours move to one home (`packages/design-system/src/lib/palette/`); double-clicking an empty day or hour opens the event form on it; Where becomes Location as the dropdown-with-add over the firm's offices and rooms; a conference link gets its own field and its own nullable column on both event tables; the times become time fields with the zone beside them as a shortcode; the day being booked stands in each record form's context pane; the matter stops being required; and the empty-month sentence comes off every grid | `claude/modest-knuth-lvlzpt` (sixth round)      |
| **5** | The interface taken apart along its own rules, behaviour preserved: the entry window's decisions into tested pure modules (`entry-verbs.ts`, `entry-updates.ts`, `continue-draft.ts`, `entry-links.ts`, `calendar-permission.ts`, `draft-text.ts`); the Links and Rooms tabs as their own components; the window's panes over the shared timing fields and a shared type select; the matter section's List view into the module and the page onto the shared context (owner ruling 2026-09-05); the view's per-scope sentences and addresses down into scope, window and reads; tests for the pure modules that had none                                                                                                                                                                                                                                                                                                                                                                                                           | `claude/calendar-ui-plan-eu523y` (fifth round)  |

## 11. File ownership in slice 1

Each file has one owner during the build; two agents never touch the same file in a round.

| Owner                    | Files                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinator              | `docs/specs/2026-09-02-calendar-interface-design.md`, `docs/active-work/claude/calendar-ui-plan-eu523y.md`, `apps/web/src/lib/calendar/{calendar-scope,calendar-window,calendar-api,calendar-entries,calendar-vocabulary,time-zone-options,event-draft,deadline-draft,firm-event-draft}.ts`, `apps/web/test/calendar-*.test.ts`, `tooling/lint-one-ui/registry.json`, the docs, ledger and status fragments |
| Design-system builder    | `packages/design-system/src/lib/components/calendar-grid/**`, `packages/design-system/src/stories/calendar-grid.stories.svelte`, the export line in `packages/design-system/package.json`, the import line in `packages/design-system/src/lib/styles/components.css`                                                                                                                                        |
| Calendar surface builder | `apps/web/src/lib/calendar/{calendar-controller.svelte.ts,calendar-view.svelte,calendar-toolbar.svelte,entry-window.svelte}`, `apps/web/src/routes/(app)/calendar/**`, `apps/web/src/lib/navigation/destinations.ts`                                                                                                                                                                                        |
| Record-forms builder     | `apps/web/src/lib/calendar/{record-event-dialog,record-deadline-dialog,record-firm-event-dialog,participant-picker}.svelte`, `apps/web/src/routes/(app)/matters/[id]/calendar/+page.svelte`                                                                                                                                                                                                                 |

## 12. Owner flags

Recommendations this build proceeds on; each is one line to reverse.

| Flag   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | **The firm calendar opens on Everyone, not Mine.** A calendar surface's first job is the firm's day; a member narrows to their own with one press and the address remembers it. Recommended because "Mine" is the narrower answer, and a screen that opens narrow teaches a reader that the rest is elsewhere.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **C2** | **The week begins on the day the firm chose, and that is a FIRM setting, never a personal preference** (owner ruling, 2026-09-02; it replaces the earlier "Sunday until the preference exists"). The week is the unit a firm plans in, and two members of one firm looking at the same week must see the same grid. Sunday by default, because United States legal practice reads a Sunday-start week. Held in the per-firm setting table as `calendar.weekStartsOn` (`packages/calendar/src/settings.ts`), read by every member through `GET /api/v1/calendar/settings`, moved by a member holding `calendar:manage` through `PATCH` on the same route with an audit row, and edited under Settings › Practice › Calendar. `CalendarView` reads it once with the rest of its context and hands it to every grid. |
| **C3** | **~~The week view is seven civil-day columns, not a time axis.~~ REVERSED IN PART, owner ruling 2026-09-14.** The recommendation stands for the WEEK, which is still seven civil-day columns; what it got wrong was assuming no view needed hours. "There should be a daily view, especially considering that a day with a lot of attorneys may have a lot of parallel scheduling." So the time axis arrives as its own view rather than as the week's shape, and its columns are CALENDARS rather than days — which is the part the original flag could not have seen, because there was one calendar to draw when it was written. The week keeps its civil-day columns and loses nothing.                                                                                                                       |
| **C4** | **The firm grid shows kinds and matter numbers, never titles.** Not a choice this document makes: the backend's label discipline, restated so nobody asks the surface to "just show the title" and undoes it on the read. **It shows the HOUR as of 2026-09-14**, which is not a departure: a time of day says nothing about a case and everything about where somebody has to be, so it rides the projection exactly as the civil-date sort key always has. A title never will.                                                                                                                                                                                                                                                                                                                                  |
| **C5** | **Cancelled settings render struck by default on every view.** Hiding them is a filter the reader applies ("Hide settled", on the agenda only, mirrored into the address), never the default, on the matter section's existing rule. The month and the week always paint them struck.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **C6** | **The matter section keeps its tables as the List view.** Replacing a reviewed surface with a grid would cost the owner a second review; adding the grid beside it costs one row of controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
