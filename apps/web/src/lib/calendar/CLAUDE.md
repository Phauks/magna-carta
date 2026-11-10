# The calendar interface — CLAUDE.md

**Purpose.** The one calendar every surface embeds: the reads a scope makes, the window arithmetic
a view needs, the projection from the calendar's record shapes to the entries the design system's
`CalendarGrid` paints, the window an entry opens in, and the forms that record an event, a deadline
and a firm event. The backend it consumes is `packages/calendar` behind
`apps/api-worker/src/http/routes/calendar/calendar.ts`; nothing here adds a route.

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
- `availability-reads.svelte.ts` — which colleague-days the availability line has asked about, what
  came back, and what a closing form forgets; `member-availability.svelte` renders it
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
- `calendar-month-picker.svelte` — the little month pinned under the rail (the design system's compact
  `Calendar`, which names its month and jumps through `MonthJump`): where the reader is,
  and one press to be somewhere else
- `calendar-rail.svelte` — the rail those two render as: a checkbox per calendar, a three-state
  checkbox per folder, and the palette behind the colour pip. It is the CONTENT of the design
  system's navigation column and draws no column of its own
- `location-picker.svelte` — WHERE a setting is held, as the product's dropdown-with-add over four
  kinds of place: the firm's offices with their street addresses, their rooms grouped by office,
  the directory's organizations (a court, opposing counsel's firm) through the one directory search,
  and anything typed — an address, a place nobody has a record of — kept as it was typed;
  `room-location.ts` — which room a written location names, the name to write for one, and
  `OfficePlace`, the office shape the field offers
- `participant-role-field.svelte` — WHAT somebody is at a setting, as the same dropdown-with-add
  over `PARTICIPANT_ROLE_OPTIONS`, keeping a role the list has never heard of; the vocabulary and
  the collapse onto an offered spelling are `calendar-vocabulary.ts`'s
- `recurrence-field.svelte` — WHETHER a setting repeats and on what rule, over the shared grammar
  in `@magna-carta/civil-time/recurrence`; `recurrence-sentence.ts` — what that rule says in
  English, which is the one home for those words
- `day-schedule.svelte` — the day being booked, in a record form's context pane. `CalendarView` with
  a day view, no toolbar and the Calendars menu; never a second calendar
- `calendar-menu.svelte` — the rail's folders and rows as a dropdown of checkboxes, for a calendar
  with no room for a rail that still has to answer "who is busy". It reads and writes the SAME
  selection the rail does through the same controller
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
- `occurrence-change.ts` — one day of a repeating setting, opened and changed: which day was
  pressed, the record as it stands on that day, the three scopes a change can reach and their
  words, and the series-wide shift a change to every day carries
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
- `record-event-dialog.svelte` (the ONE event form — a matter's, the firm's or one staff member's —
  in four tabs), `record-deadline-dialog.svelte`, `participant-picker.svelte`,
  `record-timing-fields.svelte`, `event-type-select.svelte`, `recurrence-field.svelte`,
  `time-zone-picker.svelte` — the `ActionDialog` forms and the field groups they share with the
  entry window, over the pure draft models `event-draft.ts` (which also holds the form's tabs, the
  owner vocabulary, the all-day reading and the participant bundles), `deadline-draft.ts`,
  `firm-event-draft.ts`, `continue-draft.ts`, `draft-text.ts` (the readings of typed text every
  draft shares) and `time-zone-options.ts` (the zone list in the display vocabulary's ONE line, and
  the search over it)

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
  a cell MINIMUM rather than a fixed cell, so its weeks (four to six, only the ones the month
  touches) share the column and only a short screen makes it scroll. Its caption is drawn for
  assistive technology only when the screen passes no empty sentence: a caption sits OUTSIDE the
  table's box, so a blank one made the month the region's height plus a line, and the region
  scrolled on every screen (owner, 2026-11-09). The row is two ends (owner, 2026-11-09): the arrows
  and the window's name as the heading, which opens `MonthJump`; then Today and the ONE View menu,
  whose sections are the views, the concurrency choice where there is an hour axis, and Hide
  settled on the agenda. `flex-wrap` survives as the fallback below the width the two ends need. The RAIL's own scrollbar is not one of these: the two columns scroll independently by the
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
- **A SERIES IS PAINTED BY THE DAY AND OPENED ON THE DAY PRESSED.** Each events read is paired with
  `GET /api/v1/calendar/series` over the same window and side, which answers the days each series
  falls on; `entriesFromSeries` paints one entry per day (`repeats`, and `occurrenceOn` on the
  entry and its reference), and `withoutSeriesRows` drops the once-only row the ordinary read
  returned for it. A failed series read folds into the name of the events read beside it. The window
  shows the record AT the pressed day (`atOccurrence`), and a save or cancel on a series asks how far
  it reaches — this event only, this and all later events, all events — every time, because guessing
  is how a firm's calendar quietly moves. "All" moves the series by the days this one moved
  (`seriesWideFields`); a change to the rule refuses "this" (`seriesChangeRefusal`).
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
  events and events should be the exact same"). **Three owners over two records** (owner,
  2026-09-18, widening the 2026-09-16 ruling of two choices): A matter writes a `matter_event`; the
  firm and a staff member both write a `firm_event`, because a person's own appointment is a firm
  event with only that person on it — the `participants` audience already means exactly that — and
  a third table for one would put two records on the calendar that nothing could tell apart. The
  staff arm is `withMemberListed`: the people-listed audience with that member first, whether or
  not the reader also picked them. The control is the product's one field for a closed choice
  (`ChoicePicker`, a combobox, never a select), and the SECOND FIELD ON ITS LINE IS ONE SLOT for
  the rest of the answer — which matter, which member, or who sees a firm event — so switching
  between them moves nothing beneath (owner: "changing between firm and matter causes reflow").
  What differs by owner sits on the tab the answer belongs to and in the same slot as its
  counterpart: the court reference on Where for a matter, the office (a real foreign key, because
  it is what says which rooms are nearby) on Where for the firm. The Record menu offers two kinds,
  not three: a third item would be a second way to open one panel.
- **THE FORM'S LEFT SIDE IS FOUR TABS — Details, When, Where, Who — and the tabs are the draft's.**
  One column of every question scrolled beside the day being booked (owner, 2026-09-18: "reorganize
  the left side into tabs, which allows for having individual locations for all the various items").
  `EVENT_FORM_TABS` and `eventFormTabOf` in `event-draft.ts` say which tab an answer is on, so the
  arrangement is asserted without a browser and the dialog renders it. The description's grab corner
  is off (`resizable={false}`): dragging it only pushed the tabs and the footer around.
- **ALL DAY IS THE START'S "NO TIME" ROW, AND THE RECORD STILL STORES AN EMPTY TIME FOR IT.** A
  date with no time has always meant all day; what was missing was the way to say so (owner,
  2026-09-18). It was a checkbox until 2026-11-10; it is now the first row of the Starts field's list
  of times (`allowNoTime` on the design system's `DateTimeField`), because that is where a person
  choosing an hour is looking. `readsAsAllDay` and `asAllDay` are the draft's reading;
  `record-timing-fields.svelte` reads it once when it mounts, not as a derived, because a blank form
  whose date has just been chosen has no hours yet either, and a field that turned itself all day
  then would hide the time the reader was reaching for. Choosing it clears both times, and the Ends
  field asks for a day alone.
- **ONE MOMENT IS ONE `DateTimeField`, AND THE END FOLLOWS THE START.** Starts and Ends are each one
  field holding the day and the time (owner, 2026-11-10). `withStartsOn` carries the start date to an
  end that was empty, matched the old start, or was passed by the new start; `withStartsAtTime` puts
  an empty end time an hour after the start (`DEFAULT_EVENT_MINUTES`), never wrapping past midnight
  (owner, 2026-11-09: "assume start and end date are the same"). Both are in `event-draft.ts` and
  tested in `calendar-drafts.test.ts`. `draft.startsOn` keeps its name and civil-date shape because
  the recurrence field reads it.
- **A RUN OF DAYS IS DRAWN IN THE BAND ABOVE THE HOURS, NEVER ON THE AXIS.** The grid's own rule
  (`inAllDayBand` in the design system's `day-axis.ts`): a three-day trial spans the band the way it
  spans the month, with its hours on the chip as text. It used to be cut into a piece per day and
  laid on the axis, which drew it as three full columns reaching above and below the working hours
  (owner, 2026-09-18) — and, because each piece carried a day-suffixed id, a press on one found no
  record and could not open it. The pieces are gone, so the id a chip carries is the record's own
  again and `recordKeyOf` strips only the lane.
- **A ZONE READS AS ONE LINE EVERYWHERE, AND AN HOUR CARRIES ITS CODE.** The list read "PST ·
  America / Los Angeles" beside "GMT+5:30 · Asia / Kolkata", the field at rest and the print sheet
  said "America / Los Angeles", and a chip said "(America/Los_Angeles)" (owner, 2026-09-18: "time
  zone formattings seem all different and unstandardized. you don't even have PST"). `formatTimeZone`
  in the design system's display vocabulary is the one line — "(UTC-08:00) Pacific Standard Time ·
  Los Angeles", the offset from UTC, the name on the day, the city — and `describeTimeZone` is the
  four faces behind it; `timeZoneLabel` here is that line, and `timeZoneOptions` orders the rest
  west to east with a haystack the search matches by code, name, place, offset or identifier, so
  "PST" finds Los Angeles. `formatWallClock` prints the CODE on the record's day ("5:00 PM PST")
  where the zone is not the reader's, never the identifier. The field is named **Time zone** in
  full; "Zone" alone read as a question about a place.
- **A RE-PICK OF THE CHOSEN ROW IS A CONFIRMATION, NEVER A DESELECT.** The combobox primitive's
  default clears the value when the selected item is picked again and leaves the list open, so the
  next click outside settled an empty field (owner, 2026-09-18: "if I select an item and try to
  click outside the dropdown, it reverts to an empty field"). Every picker here that clears itself
  through a row of its own — the matter, member, zone, location and participant pickers — passes
  `allowDeselect={false}`; `$lib/components/choice-picker.svelte` already did.
- **THE CHIPS ARE BUNDLED BY SOURCE, in the picker's own words: Staff, Directory, Other.** One list
  of names said nothing about which were colleagues, which the firm's records and which typed once
  (owner, 2026-09-18). `participantsBySource` in `event-draft.ts` is the grouping; an empty bundle
  is not drawn.
- **THE DAY BEING BOOKED CARRIES THE CALENDARS MENU, and it is the rail's selection.** Availability
  is a question about particular calendars, and the pane painted whatever the reader last had on
  with no way to change it without closing the form (owner, 2026-09-18). `calendar-menu.svelte`
  is the rail's folders and rows as a dropdown, reading and writing the same per-browser selection
  through the same controller, so the pane and the screen never disagree; `CalendarView` draws it
  on `calendarMenu` where there is no toolbar and the scope is the firm's side.
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
- **The rail says WHOSE calendar AND WHAT KIND.** The firm's own records are three calendars —
  Case Settings, Deadlines, Firm Events — each with its own read, row and colour, beside the Dates
  folder. A separate Kinds menu narrowed the same entries by kind on the client; it went when the
  records were split (owner, 2026-11-09), because two controls answering one question is the thing
  this screen has removed twice already. What it cost: a colleague's calendar can no longer be
  narrowed to one kind; turning a firm calendar off is a read not made, which is cheaper anyway.
- **SCHEDULING A MEETING IS RECORDING AN EVENT WITH A MEDIUM ON IT.** The form's Where tab asks one
  more question — Meeting: None, Video meeting, Audio call — and the save writes the meeting row
  beside the event, in the same batch, so the entry window offers Join from the moment the event
  exists. `MeetingChoice` and `meetingInput` are the draft's half; the request carries
  `meeting: { medium, lobby } | null`, and null rather than absent because "no meeting" and "a client
  that has not heard of meetings" must not be one answer. **The door rides with the medium and only
  with it**: `lobby` is the standing the ROOM OPENS with, which is why it is asked here rather than
  only inside a running meeting — a host changes it from inside, and nothing before the room exists
  can be changed from inside it. It rests `off`, because every participant today is a firm member
  arriving at an event they are already on. Its words are `MEETING_LOBBY_LABEL`, which the Start
  control on a recorded entry reads too: two spellings of one control is how a reader learns that
  two parts of one product were written by two people. A CORRECTION never sends it
  (`entry-updates.ts`): a meeting can be added when an event is recorded or edited from the record
  form, and it is ended through its own act — an edit that closed a room as a side effect of moving
  a hearing would be the one calendar correction that reached into a gathering. A recorded event's
  draft therefore opens on None whatever its meeting is. **What the form promises about who is told
  is the RECORD's own sentence** (`meetingGuestsSentence`): a matter event invites the colleagues on
  it, and a firm event — which is what the firm arm and a staff member's own event both write —
  tells nobody at all yet, so the line says to tell them. A form promising an invitation nothing
  sends stops a member short of the one thing that actually gets their colleagues into the room.
- **What has been asked about and what came back is `availability-reads.svelte.ts`.** The component
  renders it and decides none of it. Three facts stay apart there: "asked" (not reactive — it stops
  a second request and paints nothing), "answered", and whether the form is still open. A read that
  did NOT come back un-marks its pair, so the next pass asks again rather than leaving the line
  blank for the rest of the form's life; nothing survives the form closing, because availability is
  a claim about a particular hour of a particular day and a cached "Free" from an hour ago is the
  one answer that would be believed without being checked; and a read still in flight when the form
  closes belongs to the round that asked for it and never fills in the next one.
- **A FIRM EVENT COUNTS AS BUSY.** `availabilityEntryFromTimelineRow` is the grid's projection plus
  the firm-event arm the grid deliberately leaves out — the grid skips it because the firm's own
  listing is read beside it and carries the title, and availability has no second read to defer to.
  Dropped, a colleague sitting in a firm-wide training read as "Free". It paints the source's own
  declared label (the type and the audience, in the product's words), never a title.
- **AVAILABILITY IS A READ, AND WHAT IT PRINTS IS NEVER A TITLE.** `member-availability.ts` answers
  what each colleague on the Who tab already has at the proposed hour, from the member filter the
  server resolves in SQL — one read per colleague, for one day, only while the form is open. It
  states and never refuses, on the resource booking's own posture: two things at once is routinely
  correct. What it prints is the entry's own painted word, because the federated read declares
  non-privileged labels by contract and a matter event's title on somebody else's availability line
  would put one matter's content on another matter's form. "Asked" and "answered" are separate facts
  in the component: a colleague whose read is still in flight must not read as free.
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
  text carries a zone, as its code on that day and only where it is not the reader's
  (`formatWallClock`); `startMinute` is
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
