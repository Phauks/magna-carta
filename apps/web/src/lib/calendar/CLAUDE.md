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
- `calendar-sources.ts` — the CATALOG of individual calendars and the folders they are kept in: the
  firm's own two, a folder per role the firm handed out holding the members who hold it, the rooms,
  everything else that is booked, and the dates. Which are on, what a folder's own control does, and
  the colour each is dealt. Pure
- `calendar-preferences.svelte.ts` — which calendars THIS reader has open and what colour they gave
  each, per browser, on the shared persisted-preference primitive. Stores only the DEPARTURES from
  the catalog's defaults, so a calendar shipped later arrives at its own
- `calendar-month-picker.svelte` — the little month pinned under the rail: where the reader is,
  and one press to be somewhere else
- `calendar-rail.svelte` — the rail those two render as: a checkbox per calendar, a three-state
  checkbox per folder, and the palette behind the colour pip. It is the CONTENT of the design
  system's navigation column and draws no column of its own
- `location-picker.svelte` — WHERE a setting is held, as the product's dropdown-with-add over the
  firm's own offices and their rooms, grouped by office, keeping a courthouse nobody has a record of;
  `room-location.ts` — which room a written location names, and the name to write for one
- `participant-role-field.svelte` — WHAT somebody is at a setting, as the same dropdown-with-add
  over `PARTICIPANT_ROLE_OPTIONS`, keeping a role the list has never heard of; the vocabulary and
  the collapse onto an offered spelling are `calendar-vocabulary.ts`'s
- `recurrence-field.svelte` — WHETHER a setting repeats and on what rule, over the shared grammar
  in `@magna-carta/civil-time/recurrence`; `recurrence-sentence.ts` — what that rule says in
  English, which is the one home for those words
- `day-schedule.svelte` — the day being booked, in a record form's context pane. `CalendarView` with
  a day view and no toolbar; never a second calendar
- `calendar-entries.ts` — the projection to `CalendarGridEntry`, and the day order
- `calendar-reads.ts` — the read plan per scope: which reads, walked to the end or the ceiling,
  failing independently; how each read's failure is titled and described
- `calendar-controller.svelte.ts`, `calendar-context.svelte.ts` — the view state and the read-once
  context (session, catalog, the firm's matters through `$lib/time/firm-matters.svelte.ts`, and
  the firm's calendar settings)
- `calendar-settings-draft.svelte.ts` — the firm's calendar settings (the day the week begins on)
  as a server-backed draft the settings page at `(app)/settings/calendar` renders through the
  shared settings rows and footer; the one draft on that surface with no local-storage copy
- `calendar-view.svelte`, `calendar-toolbar.svelte` — the component and its one action row. The row
  sits at the top of the CONTENT column, over the grid it moves, in every arrangement; the `header`
  snippet carries the host's masthead DOWN into the layout and never carries the row up
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
- `record-event-dialog.svelte` (the ONE event form, matter or firm), `record-deadline-dialog.svelte`,
  `participant-picker.svelte`, `record-timing-fields.svelte`, `event-type-select.svelte`,
  `recurrence-field.svelte`,
  `time-zone-picker.svelte` — the `ActionDialog` forms and the field groups they share with the
  entry window, over the pure draft models `event-draft.ts`, `deadline-draft.ts`,
  `firm-event-draft.ts`, `continue-draft.ts`, `draft-text.ts` (the readings of typed text every
  draft shares) and `time-zone-options.ts`

## Local conventions

- **The firm calendar is the design system's two-sided screen, and this module frames none of it.**
  Where the rail stands, `CalendarView` renders `NavigationLayout` — the rail in its navigation
  column, the toolbar and the grid in its content column — so the measure, the two independent
  scroll regions, the reserved gutters, the cancelled canvas inset and the full height under the top
  bar are the design system's, exactly as they are on Settings, Magnus, Tools and Reports. A width,
  a scrollbar or a column written here is the drift the one component exists to end. That layout
  takes the full height under the top bar, so **a host's masthead is handed DOWN as the `header`
  snippet** and drawn at the top of the content column rather than above the tag; the Magnus
  workspace does the same, for the same reason. The rail's rows stay CHECKBOX rows rather than
  `NavigationLayout.Row`: the shared row renders its own anchor or button, and a switch cannot be
  nested inside one. What the columns share is the frame and the indent stagger.
- **The screen's name spans both columns; the date controls sit over the grid.** The masthead is
  handed to `NavigationLayout`'s own `header`, which is a band across the whole canvas, so the title
  stands over the screen rather than over one column of it — which is what it always named (owner,
  2026-09-16). The view switch and the window navigation then sit at the top of the CONTENT column,
  directly over the grid they move, in every arrangement. That is one place instead of two: the
  2026-09-14 ruling seated them in the masthead's actions beside New, which was right while the
  masthead sat over the grid's own column and wrong the moment it spanned both. `CalendarView`'s
  `header` prop is therefore a plain `Snippet` and hands nothing back.
- **ONE SCROLL REGION UNDER THE ACTION ROW, AND THE ROW HOLDS ONE LINE.** The owner read the screen
  on a laptop (2026-09-17: "calendar is very tight on my laptop, and has multiple scrollbars") and
  ruled AGAINST moving the controls into the screen header in the same breath — a header is a
  screen's name and its actions, and these controls move the grid they stand over, so they stay and
  they fit. What that costs the content column: the region around the grid is the one scroller for
  a month, a week and a day, which are tables that scroll nothing of their own; the AGENDA is
  already a named, focusable scrolling region by its own recipe, so there the wrapper stands aside
  rather than nesting a second bar around it. The month fills the height it is given (`h-full`) over
  a cell MINIMUM rather than a fixed cell, so six weeks share the column and only a short screen
  makes it scroll. The row fits by measure rather than by wrapping: the window's name takes the
  slack the other groups leave up to its old cap, Show Everything is the Kinds menu's own last item
  so narrowing cannot widen the row, and the glyph controls are the small square the rest of the row
  already stands at. `flex-wrap` survives as the fallback below the width the groups themselves
  need. The RAIL's own scrollbar is not one of these: the two columns scroll independently by the
  layout's design, and what is ours there is the row height, not the bar.
- **A folder in the rail FOLDS, and the month picker under it does not scroll.** A firm with twenty
  rooms scrolled past all twenty to reach the folder beneath them. The disclosure is the folder's
  name — chevron and name are one button — and it is not the Accordion component, because that
  component's trigger is its whole header and this header already holds the three-state checkbox,
  which cannot be nested in a button. What folds is the LIST, so every calendar stays reachable
  through the folder's own switch whether it is open or shut: hiding must never remove capability.
  A shut folder shows how many of its calendars are on, because that is the one fact its hidden rows
  were carrying. `calendar-month-picker.svelte` rides the layout's `navigationFooter`, outside the
  rail's scroll region, and moves the ANCHOR without changing the view — somebody reading a week who
  presses a Thursday means that Thursday's week (`goToDay`), which is why it is not `showDay`.
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
  widened to and the word each kind paints as. A layer is also a ROW IN THE RAIL now, under Dates;
  the word `layers` survives in the controller and the address because the address has carried it
  since the toolbar had them, and a link somebody was handed is a promise about what they will see.
- **THE GRID NEVER WAITS FOR THE FIRM'S MATTERS.** It used to: `context.ready` included
  `firmMatters`, and the read plan refuses to issue anything until that is true — so the calendar
  stayed blank until a walk of up to ten pages, two requests each, run one after another, had come
  back. Time to first paint scaled with how many matters the firm had ever opened, which is the
  wrong thing for it to scale with and gets worse every year a firm uses the product. What the walk
  contributes to the grid is a matter NUMBER on a chip, and that is the one thing on a chip that
  does not arrive with its own row. So `ready` now waits only for what a chip cannot be painted
  WITHOUT — the type catalog and the week start, two parallel reads of fixed size — and `numbered`
  (calendar-entries.ts) fills the number in from the controller's own derived when the matters land.
  Nothing is read a second time. `detailIsMatterNumber` is what makes that safe: it marks the chips
  whose detail wanted a number, so a later pass cannot overwrite a detail that was already complete
  — a matter's OWN calendar says "Hearing · Department 12", because every row there shares the
  matter and the number is the one fact worth saying nowhere.
- **An empty picker means two things, and it must not say the wrong one.** A form can now open
  before the matters land, so `MatterPicker` takes `reading`: "Reading the firm's matters" while the
  walk is in flight, "No matters were read" only once it has come back empty. The caller holds the
  read, so the caller says which — `context.mattersReading`.
- **A calendar that is ON is a read; a calendar that is OFF is no read at all.** That is what keeps
  the request count the reader's own choice rather than the roster's size, and it is why the read
  plan is a plan PER CALENDAR (`readOneCalendar`) rather than one read narrowed afterwards. A
  member calendar is the member filter the server already resolves in SQL; a room calendar is the
  availability read; a date calendar is the federated read narrowed to that layer's own sources.
- **Adding a calendar is one arm of `CalendarSourceKind` and one read in `calendar-reads.ts`.** The
  catalog builds the rows from what the context already read, so a hire or a new room appears with
  nothing told about it. A calendar with nothing behind it yet is LISTED, marked Soon and refused
  (`soonReason`) — the standing rule for a designed-but-unwired capability — and `selectableSources`
  is what keeps it out of the read plan.
- **The same record on two calendars is ONE record that knows it is on both.** The reads tag every
  entry with the calendar it came from and `mergeByRecord` unions them, so a month never paints a
  shared hearing twice. The DAY deliberately does: `perLane` expands one entry per column it is on,
  because a column that left a shared hearing out of one attorney's day would be lying about that
  attorney's afternoon. Both copies reach the one record through `recordKeyOf`.
- **Which calendars are on is PERSONAL and lives in the browser; the week start is the FIRM's and
  lives on the server.** They look like the same kind of setting and are not: two members looking at
  the same week must see the same seven columns, and nobody else is affected by which of the firm's
  twenty calendars a particular person has open.
- **Every question the pure modules can answer is asserted in `apps/web/test/calendar-*.test.ts`
  without a browser**: the window arithmetic, the projection, the read plan over a fake fetch, the
  draft shortfalls and request shapes, which verbs a record's state allows, what a correction
  sends, which end of a link is the other one. A Svelte file renders those answers and decides
  none of them; a decision found in a `.svelte` file is moved out, not tested through the DOM.
- **A repeat is an ANSWER on the draft and a line only at the send.** The draft holds a
  `RecurrenceRule` and `recurrence-field.svelte` edits it; `formatRecurrence` writes the RFC 5545
  line once, in the draft's request projection. Nothing in this module parses or spells the
  standard: the grammar is `@magna-carta/civil-time/recurrence`, which both this form and the
  calendar service depend on so the server can refuse a line it could not itself have written. What
  the rule MEANS in English is `recurrence-sentence.ts` and is the same sentence the form shows
  under its controls, the record pane shows, and the print sheet carries — three copies of those
  words would drift, and a person checks a repeat against exactly those words before saving.
- **A rule this product cannot present is SAID, never half-shown.** `parseRecurrence` answers null
  for a line another calendar wrote with parts the form does not offer, which is the same null a
  one-off carries — so the surface that saw the stored line tells the control (`unreadable`), and it
  states that the rule was recorded elsewhere. Rendering it as "does not repeat" is the one wrong
  answer: saving would then make that true.
- **ONE record form for an event, and its first question is who the event belongs to.** There were
  two — `record-event-dialog.svelte` and a firm-event form beside it — until 2026-09-16, which meant
  a reader had to know before opening anything whether the thing they were recording was firm
  business, and had to close one panel and open the other on finding out they had guessed wrong.
  They asked nearly the same questions in nearly the same order and drifted anyway (owner: "firm
  events and events should be the exact same"). **Two choices and no third** (owner ruling): Matter
  writes a `matter_event`, Firm writes a `firm_event`, and there is no None because there is no
  third table for one to land in — a personal appointment is a firm event with only the one person
  on it, which is what the `participants` audience already means. What the choice reveals is only
  what genuinely differs: Matter reveals the matter picker beside it; Firm reveals the audience and
  the office (a real foreign key there, because it is what says which rooms are nearby) and hides
  the court reference, which a firm meeting has no court for. The Record menu offers two kinds, not
  three: a third item would be a second way to open one panel.
- **A SHORTFALL KNOWS WHICH FIELD IT IS ABOUT, and the field says it too.** The commit's refusal
  was one sentence at the weak end of the bar, which tells a reader what is wrong and leaves them to
  find the field — a glance on a short form, a hunt on one asking about a matter, a title, a type,
  two dates, two times, a zone, a repeat, a location, a court reference, a link, a description and a
  list of people (owner, 2026-09-16). Every draft's shortfalls are now `Shortfall[]`
  (`shortfall.ts`): a field and a sentence. The bar shows the first sentence, unchanged, and the
  field it names carries the SAME sentence beneath it with `aria-invalid` on the control — written
  once in the draft and rendered twice, so the two can never disagree. `shortfallSentences` is what
  a caller that only wants the bar reads. **Nothing is marked before a save was asked for**
  (`saveAttempted`): a form that opens with every unanswered field already marked has told the
  reader they are wrong for not having typed yet. `field-refusal.svelte` renders the sentence in the
  design system's own `mc-form-errors`, so a refused field here and a refused field on a validated
  form read the same; it renders nothing when there is nothing to say, so the form's spacing never
  moves as answers arrive.
- **The rail says WHOSE calendar; the Kinds control says WHAT KIND.** Two halves of one question, and
  the second had nothing on the screen asking it (`schedule-narrowing.ts`). It narrows what was
  already read and makes no request — so it reaches exactly as far as the window on screen, which is
  why it sits beside the window's own navigation rather than beside a search that would imply the
  whole record. **A narrowing is never a read**: turning a calendar off in the rail stops a request,
  turning a kind off does not, and keeping them apart is what stops a reader thinking they have made
  the screen cheaper when they have made it shorter. An untouched control means EVERY kind, so the
  first press removes one rather than isolating one; turning every kind off shows the whole window
  rather than an empty grid, because the one thing a calendar must not do is look empty when it is
  not.
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
- **The week and the day are TIME GRIDS; the month and the agenda are lists of days.** A timed
  entry on a time grid is a block from its start to its end (owner ruling, 2026-09-14), which is why
  `endMinute` matters: the projection sets it for every source that has one, and an entry arriving
  without one — the federated read declares a time of day and no duration — is drawn at the grid's
  minimum block rather than given a guessed hour. **How concurrent entries are drawn is the
  reader's**, held per browser beside the colours (`calendar-preferences.svelte.ts`) and offered on
  the toolbar only where there is an hour axis to be concurrent on. Widening the federated read to
  carry an end would make those entries stretch too, and is the one thing standing between a firm's
  week and a complete picture of it.
- **AN OFFERED VOCABULARY IS NOT A CLOSED ONE, and a role is the second field here to learn it.**
  The participant's role was a bare text box, which failed in the way a blank box always fails: a
  reader met a field called Role and had nothing telling them what belonged in it. It is now the
  same control the location beside it is — the offered spellings, then the add row — because the
  standing rule in `docs/conventions/design-corrections.md` is that a vocabulary which is neither
  closed nor free is this one control in every such field. **A closed list was the other option and
  is the wrong one**: a special master, a Rule 30(b)(6) designee and a check interpreter are all
  ordinary, and a fixed list missing the role somebody needs makes them pick a wrong-but-adjacent
  one — which corrupts the consistency the list existed for, invisibly, because an entry from a
  fixed set looks clean. What the list buys instead is `settledParticipantRole`: a role matching an
  offered spelling in any casing settles to the OFFERED spelling, so "court reporter" stops founding
  a second role. The field's own name stays **Role** and not something more explanatory, because
  `Combobox.AddOption` reads it into a sentence — `Add role` works and `Add attending as` does not.
- **A room is offered under the office it is in, and named by it where the firm has more than one.**
  `room-location.ts` is the one home for both halves — the grouping the picker draws and the written
  name it stores — because the module that WRITES a location is the module that reads it back to
  book the room, and two answers would drift within a round. A bare name two offices both answer to
  matches neither: booking one of two rooms nobody chose between is worse than booking none.
- **HOLDING A ROOM IS THE LOCATION FIELD'S GESTURE, at the record AND at the correction.** Booking
  when an event is recorded landed on 2026-09-14; the correction was still not doing it, so an event
  MOVED from the Boardroom to Conference Room B kept the Boardroom held and never held Conference
  Room B — after one edit the two room calendars disagreed with the record and with each other, and
  Location and Book a Room still read as two features (owner, 2026-09-16). `reconcileRoomBooking`
  is the pure answer: release a booking for a room the location no longer names, book the one it now
  does, and touch NOTHING else — a pool car, or a second room somebody held from the Rooms tab, was
  never named by this field and is not swept away by an edit to it. It runs AFTER the record saved,
  because the location it reconciles to is the one that landed, and a booking it could not move does
  not unwind the correction: the window says which half did not happen. **The Book a Room verb has
  left the action bar** — a second control for the act the Location field performs is the
  duplication the owner named — and the Rooms tab keeps it, because a second room is a real thing to
  hold and nothing else can.
- **A setting held in one of the firm's own rooms HOLDS that room.** Location stores TEXT (a
  courthouse, a department number, opposing counsel's office are none of them records this product
  holds), and a room's calendar reads BOOKINGS — so choosing a room from the location picker used to
  reach nothing, which is why an event held in a room never appeared on that room's calendar
  (owner, 2026-09-14). `room-location.ts` matches the text back to an active room of the `room`
  kind, by an exact trimmed case-folded name, and the record forms book it. The match is exact on
  purpose: anything looser books a room off a guess. The booking is a SECOND write because it needs
  the event's id, so it can fail after the event landed; the event is never unwound and the form
  says which half did not happen.
- **The grid tones are the subtle status register.** `info` for a court appearance, `danger` for an
  open past-due deadline, `success` satisfied, `warning` and struck for cancelled, `accent` for a
  firm entry; neutral otherwise. Decided once in `calendar-vocabulary.ts` and `calendar-entries.ts`.
  **The CALENDAR'S COLOUR is a different fact and never shares a property with it**: the tone paints
  the chip, the colour paints a rule down its leading edge, and putting both in one fill would lose
  whichever was written second.

## Invariants that apply here

- **The firm-wide grid paints kinds and matter numbers, never titles.** The federated read declares
  non-privileged labels on purpose (a matter event's platform type code, a deadline's state); the
  title is fetched for the one row somebody opened. Deadlines paint from their own access-gated read
  and firm events from the firm's own listing, both of which carry titles by contract, and the
  federated read is narrowed to the event kind so nothing paints twice (`FIRM_CALENDAR_KINDS`). It
  does carry the HOUR (`timeOfDay`/`timeZone`), which is not a departure: a time of day says nothing
  about a case and everything about where somebody has to be, so it rides the projection exactly as
  the civil-date sort key always has, and it is what a day grid places by. A title never will.
- **The grid is civil, and so is the HOUR.** An entry sits on the civil day its row names, at the
  hour its row names, in the row's own zone; the grid never converts either. Only the wall-clock
  text carries a zone, and only where it is not the reader's (`formatWallClock`); `startMinute` is
  the same clock as a number, in the record's own zone, because a day grid cannot read one back out
  of somebody else's formatting. Converting would move a nine o'clock hearing to the eleven o'clock
  row for a reader two zones east, which is the one thing a calendar of court settings must never
  do. "Today" is the reader's, resolved once through `Intl`.
- **Nothing here computes a date from another date**, and nothing writes "missed": `overdue` is the
  server's read-time comparison and is never re-derived client-side. The one word for an open
  deadline past its day is `deadlineStateBadgeLabel`.
- **A read is walked to its end or to `MAX_PAGES_PER_READ`, and says which** (`truncated`). A page
  that reads as the whole month when it is not would be a silent cap, which the design refuses.
- **Every write carries an idempotency key minted per attempt** (`crypto.randomUUID()`), reused on
  a retry of the same attempt and never across two.
- **A correction sends participants only where it edited them** (`entry-updates.ts`): the entry
  window's Edit sends the fields its pane edits and nothing else, so a window that did not touch who
  is at a setting cannot change it. The window SAYS whether it touched them (`participantsEdited`)
  rather than the projection comparing lists — a draft's participants carry local keys and display
  names the server never sent, so a comparison would report a change on every open. An edited list
  is sent WHOLE, empty included: taking the last person off a setting is a real correction, and a
  projection that dropped an empty list would make it the one edit that silently does nothing.
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
