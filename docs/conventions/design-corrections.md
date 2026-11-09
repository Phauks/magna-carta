# Design corrections — the owner's standing rulings

**Scope (single home for):** design judgments the owner has already made, written down once so the
next screen inherits them instead of re-earning them. Append-only. Every entry is a ruling that was
issued against a specific surface and then generalized; the generalization is the part that binds.

**Why this file exists.** Design review here happens in rounds: a surface is built, the owner walks
it, and corrections come back. Those corrections used to live only in the round they were issued in
— a transcript, a mockup revision, a task description. The next surface then reproduced the same
mistake, because nothing an agent reads carried the ruling. The sign-in flow went through fifteen
mockup revisions before anyone noticed that most of what those revisions decided was not about
sign-in at all.

**How to use it.**

- **Building a screen:** read this file before you compose anything. Everything under _Standing
  rules_ applies to every surface, not only the one it was first issued against.
- **Receiving a correction:** append it. A correction that is not written here will be issued again.
  Record what was said, then state the rule it generalizes to — those are two different sentences
  and the second one is the deliverable.
- **Promoting a rule:** when a standing rule becomes machine-checkable, move it into a gate and
  leave a line here pointing at the gate. A rule enforced by a test does not need a reviewer.

This file is the _accumulated judgment_. The system it applies to is
[`ui-design.md`](ui-design.md) (how UI is built), the design language
([`docs/specs/2026-06-12-design-language.md`](../specs/2026-06-12-design-language.md)) and the page
archetypes ([`docs/specs/2026-06-12-page-archetypes.md`](../specs/2026-06-12-page-archetypes.md))
(what it is built to). When this file and a spec disagree, the newer ruling wins and the spec gets
updated in the same commit.

---

## Per-surface ledgers

A surface under active review accumulates more rulings than belong in the standing list — most of
them specific to that screen and not yet generalizable. Those live in their own ledger, linked here,
and graduate into _Standing rules_ above when they turn out to bind everywhere.

- **Matter file manager** — [`file-manager-rulings.md`](file-manager-rulings.md). Machine-checkable
  entries are asserted by [`tooling/file-manager-rulings/`](../../tooling/file-manager-rulings/),
  which opens the surface in a browser and exercises each one.
- **File Workbench** — [`file-workbench-rulings.md`](file-workbench-rulings.md). The Tools surface an
  unfiled file is brought to. Two rounds so far; the rulings that generalize beyond it are promoted
  into _Standing rules_ below.
- **The money surfaces** — [`time-tab-rulings.md`](time-tab-rulings.md). Time, Fees, Costs and
  Billing, on the matter and firm-wide alike: they share one anatomy, so they share one ledger.
- **Settings** — [`settings-rulings.md`](settings-rulings.md).
- **Conflicts** — [`conflicts-rulings.md`](conflicts-rulings.md).
- **The matter record** — [`matter-rulings.md`](matter-rulings.md). Its header, status seal and
  status window; the financial tabs and the Conflicts section have their own ledgers above.
- **Magnus** — [`magnus-rulings.md`](magnus-rulings.md).

### Rounds staged and not started (2026-09-09 to 2026-09-11)

The owner staged six rounds ahead of the work, and asked that none of it start until they say so.
Every row in them is `open` **by fact**, not by oversight, and each carries the research the round
will need:
[`file-manager-rulings.md`](file-manager-rulings.md) R22 (the Upload dialog),
[`settings-rulings.md`](settings-rulings.md) R1,
[`conflicts-rulings.md`](conflicts-rulings.md) R1,
[`matter-rulings.md`](matter-rulings.md) R1,
[`time-tab-rulings.md`](time-tab-rulings.md) R12 (the firm's money screens),
[`magnus-rulings.md`](magnus-rulings.md) R1,
and the messaging correction dated 2026-09-11 in _Standing rules_ below.

**They are one complaint said six ways, and the cheapest order of work follows from that.** Four
themes run through every round:

1. **A screen's chrome must stop duplicating its table.** The messaging tabs, the money screens'
   three differently-worded period dropdowns, and the conflicts panel's settings are the same
   finding on four surfaces — and all of them meet the same obstacle, that a filter narrowing only
   the loaded page is not a filter. Settle that once, in the table, and four screens simplify.
2. **The shared part exists and the screens do not use it.** `settings-page.svelte` is written and
   rendered by no route; `ScreenSearch` is "the product's one control" and no money screen imports
   it; `DataTable.Grid` runs every register in the product except the five in Settings. Most of
   this round is adoption, not invention.
3. **A default belongs in the component, not at the call site.** `align="end"` is written out 95
   times because neither `Select.Content` nor `Combobox.Content` sets one, and the two context-menu
   parts are the only floating surfaces still on a z-layer below `modal` — which is why a
   right-click menu is unusable inside a dialog.
4. **Two screens are waiting on one thing that does not exist.** The Offices screen
   ([`settings-rulings.md`](settings-rulings.md) O1) is the whole of the matter status window's
   Location ruling ([`matter-rulings.md`](matter-rulings.md) W1) and of firm branding (F2), and its
   backend is already built — `packages/locations/`, `/api/v1/locations`, letterhead logo included.
   Build Offices first and three rows resolve together.

---

## Standing rules

These bind every surface. Each carries the surface it was first issued against, because the example
is usually the fastest way to understand the rule.

### Copy

- **Headers are title case.** "Sign In", "Enter Your Password", "Enter Your 2-Factor Code", "Reset
  Password". Not sentence case, not all caps. _(auth flow, 2026-08-07)_
- **No em dashes in user-facing copy.** They read as machine-written. Restructure the sentence or
  use a colon. Internal documents are unaffected. _(auth flow, 2026-08-07)_
- **"Filed" means filed WITH A COURT. Nothing else may say it.** Adding a document to a matter's own
  record is adding it; an email arriving on a matter is saved to it; a version is uploaded. This
  platform files nothing with a court, so a screen that says a document was filed is telling a lawyer
  something that did not happen, in the one vocabulary where being wrong has consequences. The word
  is correct in exactly its own sense — a filing fee, a filing deadline, e-filing — and the test is
  whether a court is on the other end of it. Source keys and column names that already carry the word
  (`documentFiled`, `emailFiled`) are wire contracts and stay; what a person READS is decided at the
  presentation layer, which is why the two are separate files. _(matter activity, 2026-09-02)_
- **Short explanatory copy is one flowing paragraph.** A few sentences split across stacked
  paragraph elements read as a hard line break in the middle of one thought; join them unless the
  sentences genuinely address different subjects. _(WHOIS Lookup tool page, 2026-08-31)_
- **Durations render from configuration, never hard-coded in a string.** A screen that says "30
  days" reads the number from the value that actually governs the behavior, so the copy cannot drift
  from the system. _(auth flow, 2026-08-07)_
- **Error copy is per-channel and specific.** One generic failure message across channels that fail
  differently is wrong: only authenticator codes rotate, so only their message says so. _(auth flow,
  2026-08-07)_
- **A surface states findings; it does not explain itself to the reader.** No standing note beside a
  result telling somebody what the product does or why it is good ("Every file that arrives here is
  scanned before anything else touches it"). It is read once, skipped ever after, and it takes room
  from the answer the reader came for. A fact that a reader must have to read the result correctly
  is part of the result, in its own row. _(file workbench, 2026-08-31)_
- **A failed act states itself where it happened, with the way to try again beside it.** A download
  that fails gets "Download failed" and a **Retry** button on its own row, on the Downloads page and
  in the top-bar tray alike, never only in a toast: a toast vanishes, and the reader who watched it
  go has nothing left to press. _(downloads, 2026-09-03)_
- **Nothing is saved until the commit is pressed, and a panel never says otherwise.** The Upload
  dialog opens before any byte moves and sends only on **Upload**; "Closing keeps what has already
  landed in EWAAAE" was the line that made the owner afraid something had been saved behind their
  back, and it had. The commit carries the act's own verb ("Upload", not "Save"), a failure reads as
  one ("Upload failed", not "did not land"), and a panel carries no running commentary about what
  it is doing on the reader's behalf. _(file manager upload, 2026-09-03)_
- **A transfer the reader started outlives the panel that started it, and shows itself in the top
  bar.** An upload is handed to the app's own queue the moment it is pressed; the panel stays as a
  report and Close leaves the bytes moving; the top-bar upload tray carries every batch with its
  tally, its failures, a Retry that resends only what failed, and the way to where the files landed.
  Uploads and downloads are two trays, not one: the download shelf is a durable register on the
  member's record, an upload is live state in this tab, and one list mixing the two would make every
  item ambiguous about what closing the tab does to it. Leaving the screen with files chosen and not
  yet sent asks first; a running transfer asks nothing inside the app and lets the browser ask
  before the tab closes. _(file manager upload, 2026-09-06)_
- **A panel never re-flows when its act begins.** Controls stay where they are and are disabled; a
  list stays the same list and changes only the column that reports; a line that reported the
  choice reports the progress in the same place at the same height. The Upload dialog swapped both
  panes the instant the transfer began and moved under the pointer. _(file manager upload,
  2026-09-06)_

### Lists and tables

- **Numbers in text sort as they are read.** A table's text column compares a run of digits as the
  number it is, so `3333-2` comes before `3333-10`, `9999-1` before `10000-1`, and "Exhibit 2"
  before "Exhibit 10". Nobody is asked to pad a number with zeros so that a list will order it.
  _(client and matter numbering, 2026-11-09)_
- **A list OFFERS more columns than it SHOWS, and the difference is where the design lives.** A
  register is read for a different reason on a different day — sorted by surname to work down it,
  narrowed to one place to see who is local, scanned for whether a fact was ever recorded — and a
  table carrying every one of those at once is unreadable on the day somebody wanted only the names.
  So the column model declares every column the rows can answer, the few a reader most often wants
  start visible, and the rest start hidden and are turned on from the header menu's Columns
  submenu. A reader asking for one more column is then a press, not a screen change, and the
  question "why is this not a column" has one place to be answered. _(the directory index,
  2026-09-08)_
- **A list screen shows its whole record by default, and the table is the only thing that narrows
  it.** A second control offering the same slices the Status column already offers — a scope
  dropdown reading "the working docket / open / closed / consultations" — is removed, not moved.
  Two mechanisms answering one question is how a reader ends up staring at an almost-empty table
  with a narrowing set on a control they are not looking at. Where the whole record costs an extra
  read (a listing whose default omits a status), pay for the read. _(matters docket, 2026-08-30)_
- **A row's own gesture opens it.** Double-click anywhere on a row activates it, and Enter does the
  same for the focused row. A link inside a cell is an addition — it buys the browser's own
  gestures — never the only way in. Nobody should have to hit an underlined cell. _(matters docket,
  2026-08-30)_
- **A placeholder row is not a row, and takes none of a row's treatment.** The empty,
  filtered-empty and loading placeholders sit inside the table so the frame holds its height, but
  the row hover means "this is a thing you can select and open" and there is nothing there to
  select. So an empty table does not light up under the pointer — stretching the hover across the
  whole frame would be worse, because it invites a click that does nothing. Absence is the signal.
  **Reissued 2026-09-05, because the ruling was recorded and only half carried out.** The
  placeholders were still `<tr class="mc-table-row">` in the same body as the records, so the row
  hover found them: an empty table answered the pointer with a grey band as tall as its message and
  no taller, leaving the rest of the frame white — which the owner read, correctly, as a hover that
  gives out partway down the table. It is not enough for the placeholder's CELL to be marked; the
  treatment the ruling withholds is the ROW's, so the row is what says it holds no record —
  `data-placeholder="true"`, which the shared recipe passes over for both the fill and the pointer
  cursor, and which the loading rows need too (they carry a skeleton per column and no placeholder
  cell at all). _(matters docket, 2026-08-30; the empty table, 2026-09-05)_
- **A placeholder's content centres in the FRAME, not in the table.** A placeholder row spans every
  column, so its cell is as wide as the table — wider than what the reader can see the moment the
  columns overflow, and far wider once anybody has widened one. Content centred in that cell lands
  off past the inline end, heading and watermark included. The frame's own width is the only width
  that means anything here, and the block holding the content is stuck to the frame's leading edge
  so scrolling the table sideways carries the state along. Two things quietly beat a rule written to
  say so, and both were found by measuring rather than looking: the cell's own inline padding, and
  the transparent border every row's first cell reserves for the selection rail. _(every list
  surface, 2026-09-02)_
- **Prose is the row's second line, never a column.** A description, a narrative, a message: the one
  field on a row that is far longer than everything beside it put together. As a column it is either
  truncated to a few words — which is not a description — or wide enough to push the facts off the
  screen, and both are worse than the answer, which is the row's own full width underneath the facts,
  wrapping there. The mechanism is the one table's `rowDetail`, so a surface adopting it inherits the
  hover, the selection and the pinned columns rather than building a second row. _(the time sheet;
  reissued for the call log, 2026-09-08: "the description should be in a line beneath the other
  information, consider how we do that for time entries")_
- **Every rung of a record's life draws a number, on a run of its own, and keeps it.** An enquiry is
  numbered the moment it is written down, a consultation when it graduates, a matter when it opens —
  and each number stands beside the last rather than replacing it, so a note filed under any of them
  still resolves. The runs are separate because a run is only readable if it counts one thing: a
  consultation run pitted with declined enquiries cannot be told apart from one with records
  missing. What a surface SHOWS is the newest number the record has drawn, and what a surface
  SEARCHES is all of them. _(2026-09-14: "everything should have a number, intake would have a
  number as well"; generalizing the consultation sequence of 2026-08-31.)_
- **A record a person quotes out loud carries a NUMBER, and the number is a column.** A handle is
  what the platform joins on; it is not something anybody can read back down a telephone or write on
  a slip. Where a record is referred to out loud — a matter, an entry, an invoice, a call — it draws
  a human number, that number leads the row, and the screen's search matches it first. A number that
  carries the day it belongs to is legible without a lookup, and scoping its sequence to that day is
  what keeps it short enough to say. _(the call log, 2026-09-08: "all calls and logs should have a
  number, which we can identify in the log ... should incorporate date")_ Enforced by
  `pnpm run lint:modal-headers`, which asks it of every panel handed a record's number.
- **A control that undoes a state exists only while that state is in play.** The clear-filters
  control appears when something is narrowing the view and is absent otherwise, so its absence is
  itself the answer to "is anything hidden". _(matters docket, 2026-08-30)_
- **A control that recurs on every table is a table component, not a snippet each surface writes.**
  The clear-filters control was built seven times in three shapes, the labelled figures strip five
  times (one already in the opposite reading order), and the load-more control three times in two
  places. Each is now one component — `DataTable.ClearFilters`, `DataTable.GridFigures`,
  `DataTable.LoadMore` — and what a surface still varies is where it puts it, never what it looks
  like. The clear control lives in the control row above the table, where the filters were set; the
  undo and redo pair lives in the footer. _(every list surface, 2026-09-03)_
- **Every scroll region we own wears the app's scrollbar, corner included.** A themed track and
  thumb still leave the corner where a horizontal and a vertical bar meet painted by the user
  agent, and a table wide enough to scroll sideways is where it shows first. _(matters docket,
  2026-08-30)_ — **and it is every region, not every table.** One class: the `mc-scrollbar` recipe,
  or `mc-scrollbar-hidden` with a `ScrollEdgeHint` where a scrollbar appearing would reflow the
  strip it sits in. A region wearing neither gets the operating system's, which is the only chrome
  on the screen we did not draw and which appears exactly when content outgrows its box — on real
  data, and never in the state the screen was built in. It binds where the overflow comes from a
  recipe as much as from a utility: `.mc-modal-frame-pane` scrolls in CSS and named no recipe, so
  every panel in the product had it, and so did `Dialog`, `AlertDialog`, `Sheet` and
  `RecordWindow`. Enforced by `pnpm run lint:scrollbar`, which derives what scrolls from the
  Tailwind utilities and from the design system's own stylesheets rather than from a list.
  _(the New Check panel, 2026-09-08)_
- **A column's controls are summoned from the column, not from a control anywhere else.**
  Right-clicking a column heading opens that column's menu, and everything a column can be ASKED is
  in it: filter it, hide it, pin it, and — one arrow to the right — the full roster of columns,
  where a hidden column (which has no heading to point at) is brought back. A `Columns` button in
  the action row is removed, not moved: it asked the reader to leave the thing they were looking
  at, find a control, and then find the column again in a list. The in-header filter funnel goes
  the same way, for the narrower version of the same reason — a control parked in a data cell,
  hunted for on hover, when the column it belongs to is the thing already under the pointer. What
  the header still does by DIRECT gesture it keeps and the menu does not repeat: clicking the label
  sorts, the grip resizes and double-click fits. A surface's own display settings ride the same
  Columns submenu, beside the columns they change. _(every list surface, 2026-08-31)_
- **A state stays visible where a control was removed; it just stops being pressable.** Taking the
  funnel out of the header cell must not take with it the answer to "is this column narrowed" —
  that is the reader's, not the control's. So the cell keeps a MARK in the same reserved slot, in
  the same accent-subtle treatment, drawn only while a filter is in play and carrying nothing to
  press. Absence is still the signal; presence is still unmistakable. _(every list surface,
  2026-08-31)_

- **A column a screen declares is a column the reader sees.** Seven of the Directory's columns
  started hidden, on the reasoning that the assembled name is what a reader reads and the rest is
  for a particular day. The owner added them and reported them missing — "it did not populate in,
  even with blank data" — which is the verdict on that reasoning: the one way to reveal a hidden
  column is the header's right-click menu, which nothing on the screen advertises, so a column that
  starts hidden does not exist for anyone who did not write it. Declare what the screen shows, let
  the table scroll sideways where it must, and let the header menu be where a reader HIDES what
  they do not need today. _(the Directory, 2026-09-17)_

- **Where a DATA TABLE will hold the rows, the table renders first — header row over an empty
  body — and the words about the emptiness go in that body.** The 2026-09-14 ruling reached prose
  standing where a structure should; a component standing there was left alone, and `EmptyState`
  walked straight through the gap on fourteen surfaces. It does not any more: the header row is the
  shape being promised, and a register whose columns only appear once a member has exported
  something teaches them nothing before their first export. One line, in the table's muted register
  — `DataTable.EmptyRow` for a hand-composed table, and `DataTable.Grid`, which says its own "No
  Results" without being asked. _(Downloads and Uploads, 2026-09-18: "data tables will still appear
  before data is in the area. this prepares users for the proper shape"; held by the
  `table-behind-absence` rule in `tooling/lint-structured-empty/`)_
- **A refusal and a failure are not an absence of data, and neither draws a frame.** A member who
  may not see the table, and a read that broke, are not tables waiting to fill; an empty frame drawn
  for either promises a shape the screen has no intention of producing. The same goes for a panel
  with no subject and a report nobody has asked for yet — the allowances stand on exactly those,
  each carrying its reason beside the code. _(2026-09-18)_

- **Folders sort separately from files, and the boundary is not a sort key.** Wherever a list
  carries places and the things inside them, the folders form their own run above the files and the
  reader's chosen column orders each run on its own, in the chosen direction — so sorting by name
  descending reverses the names within each run and never lifts a file over a folder, and the same
  holds on size, on a date, and on a column added next year. The ordering is one pure function
  handed the grid's own comparator through its `orderRows` seam, never a special case in the name
  column, because a second comparison rule inside the list is a rule that will one day disagree
  with the header it is sorted by. _(the matter file manager, 2026-09-18: "regardless of how files
  are sorted, folders should always sort separately from files")_

### Data entry

- **Creating a record is ONE screen with a left side and a right side.** Not a wizard, not a long
  column: the entry on the left, segmented into tabs where it needs segmenting, and the gate the
  entry has to pass on the right, permanently in view. Wider and shorter, so the whole thing fits a
  screen and nothing scrolls. A gate behind a tab is a gate somebody has to remember to go and look
  at. _(new matter, 2026-08-30)_
- **A creation screen's sections may stand as a rail inside its own dialog.** The one-rail ruling
  under Controls is about the app shell: a second vertical navigation beside the shell's own makes
  the member ask which one they are in. A dialog is not the canvas, and the sections of a record
  being created are not module navigation; the owner chose the side rail for New Person from a
  canvas of four directions on 2026-09-03, with a count on each section and the gate beside it.
  _(new person, 2026-09-03)_
- **A form whose result is invisible reads back what it will do.** Where a form configures machinery
  the reader cannot watch — a search, an import, a run — it ends in plain sentences saying what
  pressing the commit will actually do, composed from the SAME values the request is composed from,
  so it can never describe one thing and send another. It is the only honest answer to "what does
  this setting do" when the setting's effect is a query nobody sees. _(the New Check panel,
  2026-09-08)_
- **A default a field will take is that field's placeholder, never a footnote.** A blank number that
  falls back to a firm setting shows the setting's own value inside its own box. Stating it once at
  the bottom of a form — "an empty field takes the firm's own setting", over a block of shorthand —
  puts the fact somewhere other than where the decision is made, and leaves the reader to work out
  which number belongs to which box. _(the New Check panel, 2026-09-08)_
- **Do not ask somebody to classify their own act when the record already knows.** A field whose
  right answer is derivable from what the surface already holds is a field with a wrong answer and
  no way to tell you that you gave it. The conflicts panel stopped asking whether a check was
  preliminary or comprehensive: both name WHEN the check ran, and whether the firm has taken the
  matter on is a fact the record carries. _(the New Check panel, 2026-09-08)_
- **A record needs a name, not the parts of one somebody expects it to have.** Refusing to record a
  person without a family name refuses a person who has one name, which is the ordinary form of a
  name in much of the world; the record then gets filed under something they are not called, or in a
  note where nothing can find it. Require the one thing the record cannot be without — something to
  call it — and state the rest as a WARNING beside the commit, which records exactly what is on
  screen. A warning is not a refusal and must never read as one. _(new person, 2026-09-08)_
- **A vocabulary that is not closed but is not free either is the product's dropdown-with-add.** A
  courtesy title, a post-nominal, a payee, a document type: the firm writes the same twenty and will
  one day need a twenty-first. A free-text box gives one file "Mr", "Mr." and "mr." and makes the
  firm's own spelling undiscoverable; a closed dropdown refuses the rank nobody put on the list. The
  Combobox over the offered spellings with `AddOption` at the end of the list is the answer, and it
  is the same control in every such field. _(new person, 2026-09-08)_
- **A field holds as many values as the fact has.** A person is "Jr." and "Esq." at once; a field
  that holds one of them loses the other, and the record then states something false about somebody
  by omission. Where the fact is plural, the chosen values stand as their own removable rows above
  the control that adds another. _(new person, 2026-09-08)_
- **An entry row is the last row of its list, under the same rule as every other row.** A bordered,
  raised box around the add row makes one section read as two things — a list, and a form beneath it
  — when it is one list that ends in an empty line. The box also has to be styled, and every section
  that draws one draws it slightly differently. _(the directory record, 2026-09-08)_
- **A recorded value is CORRECTED, never deleted and retyped.** Delete-and-retype is not a
  correction: the removal is its own fact on the record, and everything attached to the value — the
  permission, the preference, the confirmation, the history — goes with it, to fix one mistyped
  character. Every list of recorded values offers a pencil that loads the row back into the fields it
  was entered in, and the row it left says it is being corrected so nobody thinks a second copy is
  about to be added. _(the directory record, 2026-09-08)_
- **An address is a form whose shape is the country's, and it gets its own section.** Which boxes an
  address has, what each is called and what order they read in are properties of the COUNTRY:
  Ireland has no state, Japan writes the code first, Germany puts the code before the town, Brazil
  carries a neighbourhood line. One form asking every country for "State" and "ZIP Code" produces
  addresses that do not deliver. So there is ONE address component
  (`@magna-carta/design-system/address-fields`), the country is its first field because it decides
  the rest, changing it re-labels and re-orders without ever moving a value between fields, and a
  value the new country has no line for is STATED rather than silently dropped. It never stands as
  one option in a dropdown beside one-line fields: it is six to nine boxes and they are one, and
  putting them under one control makes them read as alike. _(the directory record, 2026-09-08)_
- **A data-entry surface carries no helper prose.** Every visible line is a label, a value, or the
  one honest sentence a Soon capability owes about what it waits on. A block with nothing in it is
  not drawn at all rather than announcing its own emptiness. _(new matter, 2026-08-30)_
- **A field that holds a chosen person or thing shows what it holds at rest.** Arriving in the
  field is what starts a fresh search; leaving it returns the field to naming the selection. A
  filled seat that renders its ghost text reads as an empty field with nobody in it. _(new matter,
  2026-08-30)_
- **A record is MADE in the same window it is read in.** Starting one is a modal act: the record
  window opens with nothing in it and its fields already open. A form that unfolds inside the list
  it will join is a second place to learn where a record's fields live, and the list loses its own
  shape while somebody is typing. _(matter notes, 2026-09-01)_
  - **Sharing the FIELDS is not sharing the window.** A dialog that renders the same field component
    the record window renders still disagrees with it about everything around the fields — tabs,
    printing, where the commit sits, what the heading says — and every one of those is a thing a
    reader has to learn twice. The two states differ in what the window opened WITH, and in nothing
    else: a record being made opens in its fields and asks the questions that are only asked once
    (where it belongs); a record already stored opens in its values, and the acts that move it
    between queues live in the action bar. _(the call log, 2026-09-08: "we now have two modals for
    creating a call which is weird")_
  - **A record with no window yet GETS one; it does not get a panel instead.** Where a record is
    read as a row and changed in that row, the answer is the record window, not an action dialog for
    making one and the row for changing it. Reaching for the panel is the tempting half-step and it
    produces exactly the defect the ruling above names — one surface to read a record, another to
    edit it — with the extra cost that the panel and the row then disagree about the record's own
    fields. A task was moved to the panel and then to its own window in the same afternoon, and only
    the second half was the fix. _(tasks, 2026-09-14: "creating a new task should be a modal, not
    in-line", then "do the edit one too. I dislike having two screens, one to read information, and
    one to edit it")_
  - **A task moves along four rungs — To Do, In Progress, On Hold, Done — and they are the action
    bar.** One control group, not four scattered verbs, because they answer one question: where is
    this. The rung the task is on renders pressed and does nothing, so a reader sees where it stands
    without reading a badge. Beside them are the only two other things that happen to a task, and
    they differ in exactly one thing the copy has to say: **archiving keeps the data, deleting takes
    it.** Archiving is not a fifth rung — a task is archived FROM wherever it stood, and putting it
    back returns it there. _(tasks, 2026-09-14: "Action Bar should be To Do, In-Progress, On-Hold,
    Done. Besides that, tasks can be deleted or archived")_
    - **The reason an archive carries is OPTIONAL, and that is the whole lesson of the state it
      replaces.** Cancelling required one, on the reasoning that the decision is the record. Nobody
      ever used it: somebody clearing work that is simply not happening is not composing a memo, and
      a required field at that moment is a reason to reach for delete instead — which loses the
      record entirely. Offer the sentence where it is cheap to give; do not demand it. _(the owner,
      2026-09-14: "archived would be similar to cancelled, but we will never use that because no one
      uses cancelled")_
    - **A list carries the one act a list is for, not the whole group.** Done belongs on a row,
      because clearing finished work off a list is what a list is for; the other three rungs live in
      the record's own window with the rest of its acts. Four controls deep on every row of work
      somebody is only scanning is a row nobody can read. _(tasks, 2026-09-14)_
  - **A list row states values and offers acts; it never becomes a form.** Nothing unfolds inside a
    list: not a composer above the rows, not a row that turns into fields, not a picker for what to
    attach, not the reason a thing is being cancelled. Each of those is a second place to learn
    where a record's fields live, and each takes the list's own shape away — its count, its
    ordering, what is overdue — while somebody types in the middle of it. What a row keeps is the
    one act a LIST is for: ticking a thing off, and putting it back. _(tasks, 2026-09-14)_
  - **A record that is quoted out loud is identified BEFORE it is saved.** Where a record carries a
    reference number a person reads back — to a caller, onto a message slip — the window states the
    number the next one would draw while it is still being filled in, and says that it is a preview
    rather than a reservation. The save is too late for the sentence the person entering it is in the
    middle of. _(the call log, 2026-09-08: "all calls and logs should have a number, which we can
    identify in the log, before it has been created")_
- **A form that schedules something shows the day it is scheduling.** Choosing a time is a question
  about other people's afternoons, and a form that asked it with nothing on screen was asking the
  reader to remember. The day being booked stands in the panel's context pane, as the product's own
  calendar with a day view and no toolbar — never a second rendering of one — following the date
  field as it is answered and saying so before a date is chosen rather than showing today as if that
  were an answer. _(the calendar's record forms, 2026-09-14)_ The day it shows is whose the reader
  chooses: the pane carries the calendars menu, which is the rail's own selection as a dropdown,
  never a second selection that could disagree with the screen's. _(2026-09-18)_
- **A long form's left side is tabs, and a choice that swaps a field swaps it in ONE slot.** Twelve
  questions in one scrolling column beside a context pane become groups with a place each; and
  where the first answer decides which second field is asked, the second field takes the same slot
  whichever it is, so choosing moves nothing beneath it. _(the event form, 2026-09-18: "changing
  between firm and matter causes reflow"; "reorganize the left side into tabs")_
- **A time zone reads as one line, the same for every zone: the offset from UTC, the name on the
  day, the city.** "(UTC-08:00) Pacific Standard Time · Los Angeles" — never a code on one row and
  an offset on the next, never the identifier, and never a field that says "Zone" when it means the
  time zone. The code ("PST") is what a person searches by and what a chip prints beside an hour,
  and both are worked out on the record's own day. _(the calendar's time zone field, 2026-09-18)_
- **A run of days is drawn in the band above the hours, not on the axis.** A three-day trial is a
  fact about days; laid on the hour axis it was three full columns, reaching past the working hours
  the grid draws. Its hours ride on the chip as text. And All Day is a switch a person can set, not
  only a blank they have to know to leave. _(the week and day grids, 2026-09-18)_
- **A re-pick of the chosen row confirms it; it never clears the field.** A dropdown's primitive may
  deselect on a second pick and leave the list open, so the next click outside settles an empty
  field. Clearing is a row of its own where a field offers one, and every picker refuses the
  primitive's deselect. _(the matter picker, 2026-09-18)_
- **A discard question is its heading.** "Discard Your Changes?" over Keep Editing and Discard
  Changes; the sentence restating that entries would be thrown away and nothing else had changed is
  struck. _(the record forms' close, 2026-09-18)_
- **People added to a record are listed under where they came from.** Staff, Directory, Other —
  the same words the picker offers — so a reader can tell a colleague from a contact from a name
  typed once. And a source is named plainly: "Staff", not "Firm member"; "Other", not "Someone
  else". _(the participant picker, 2026-09-18)_
- **A moment is a date, a time FIELD, and its zone as a shortcode, on one line.** The day, the hour
  and the zone that hour is read in are one fact (the one-moment-one-line rule, applied): a platform
  time control rather than a box hoping for `HH:MM`, and "PST" rather than "America / Los Angeles",
  because a field wide enough for a continent pushes the time it belongs to onto the next line. The
  abbreviation is worked out on the RECORD'S OWN DAY — the same zone is PST in January and PDT in
  July — and is never stored, because CST is three different zones. Where a record has ONE zone, the
  second line STATES it rather than offering a second control that could only ever disagree with the
  first. _(the calendar's record forms, 2026-09-14)_
- **Where a thing is JOINED is a different field from where it is HELD.** A meeting can be in a room
  and on a call at once, and a form with one field for both loses the room the moment somebody types
  the link. A conference link is a URL and never a provider plus a room number: every service
  expresses a meeting as a link, and a closed list of providers is a list this repository would
  maintain on somebody else's release schedule. _(the calendar's record forms, 2026-09-14)_
- **A record that belongs to no parent is not refused, it is a different record.** Where a form
  stands refused until somebody picks a parent — "A matter is needed." — ask whether the thing with
  no parent is real, and where it is, make the no-parent row a CHOICE that says what it writes and
  write that record instead. A reader should not have to know which of two menu items to have
  started from. _(the calendar's event form, 2026-09-14)_
- **A field's label is the plain word for what it holds.** "Date", not "When It Happened"; a label
  that reads as a sentence is a question the surface is asking rather than a name for the value. A
  field whose meaning genuinely needs a sentence gets the sentence beside it, and keeps the plain
  label. _(matter notes, 2026-09-01)_
- **One moment is one line.** A date and the time on that date are a single fact, so they sit side
  by side; stacking them reads as two separate questions and doubles the height of every record that
  carries one. The same holds for a value and its unit, and a quantity and its currency. _(matter
  notes, 2026-09-01)_
- **What a record will carry is on screen before it is saved, generated fields included.** Who is
  writing, what it will be filed against, the instant it will be stamped with. They are stated, not
  editable — but a person writing a record that may be read years later must never have to guess
  what is being stored beside their words. _(matter notes, 2026-09-01)_
- **A record takes its attachments while it is still being written.** The files ride the record from
  the first draft: chosen in the window, held, and written the moment the record itself is. Making
  somebody save, find the record again and reopen it to attach the document they were writing about
  is the same work done twice. _(matter notes, 2026-09-01)_
- **A source a surface cannot actually use is not offered.** A picker, dropzone or button with
  nothing behind it swallows the gesture in silence: the person watches their file go in, sees
  nothing happen, and cannot tell that from a failure. Either wire it or leave it out — a control
  that does nothing is worse than an absent one. _(matter notes, 2026-09-01)_
- **A screen that consolidates other screens' records names nothing itself.** Every word on a row
  of a consolidation — a chronology, a search result, a dashboard tile — is declared by the
  subsystem that owns the row, beside that subsystem's own code, and the consolidating screen draws
  what it is told. The moment the consolidation decides what a file or a hearing is called, it is a
  second file manager and a second calendar, each a little wrong, and every new subsystem becomes a
  change to it. Enforced by a pairing test against the server's registry and a coverage lint against
  the section registry, so it cannot be forgotten. _(matter activity, 2026-09-02)_
- **A type column names the thing's REAL type, never our category word for it.** "Document" on
  every row of a document register is the column repeating its own heading. A file's type is what
  the file manager identifies it as — its document type where one is set, else the identification
  the file manager itself draws from the content type and the name — and never a name suffix
  standing in for that identification. Where a subsystem knows a more exact word than the surface
  does, the surface takes it. _(matter activity, 2026-09-02)_
- **Filtering belongs to the columns, never to a bar above them.** Narrowing to one kind is a set
  filter on the Kind column; narrowing to last month is the Date column's range; narrowing to one
  person is Who. A row of chips over a table that can already do all three is a second filter to
  learn and a second place for the two to disagree. _(matter activity, 2026-09-02)_
- **A signed-in member is not a stranger, and a screen must not withhold from them.** Where the
  record already decides who may see a matter, its own rows carry no further secret: a row that says
  only that "a document was added" is a row a reader has to open something else to understand. State
  what the thing IS. Where a narrower permission genuinely exists — a note behind `notes:read` — the
  screen honours it by reading through that subsystem's own gate, which refuses on its own, rather
  than by keeping every reader in the dark to cover one. _(matter activity, 2026-09-02)_
- **A field whose empty state is a real value offers that value, rather than a sentence explaining
  its absence.** Two paragraphs saying the firm has no codes turned on is the product apologising
  for a configuration that is both common and correct; a `(None)` row makes the field work, states
  the same fact, and lets the entry be filed. Reserve the explanatory line for a genuine inability —
  this account may not read the catalogue, or the read failed. _(Time record window, 2026-09-03)_
- **Two options that mean the same thing are one option.** Offering both makes a reader choose
  between them, and there is no right answer to that choice. _(Time record window, 2026-09-03)_
- **A public note and its private twin sit together, stacked, in that order.** They are one act of
  writing that differs only in who reads it; separating them turns the private half into a second,
  equal fact about the record and strands it wherever it landed. _(Time and Cost record windows,
  2026-09-03)_
- **A record's attachments can be gathered before the record exists.** "Save it first" is a true
  statement about a route and a wrong one about the work: the person has the document open in front
  of them. Hold the picks and apply them when the record is written. _(Time record window,
  2026-09-03)_
- **Every closed choice is a combobox, never a select.** Wherever a person picks from a set the
  product wrote — a type, a direction, a country, a reason — the field accepts typing and narrows as
  they type. A two-row list loses nothing by it; a two-hundred-row one is unusable without it; and a
  reader should not have to discover which lists take typing before they know whether to reach for
  the keyboard. The field is `$lib/components/choice-picker.svelte`, on the design system's one
  Combobox, and it shows what it holds at rest like every other picker. _(the call log, 2026-09-08)_
- **Changing an answer must not move the form.** A field the chosen type does not apply to stands
  REFUSED, with the reason on its hover, rather than being removed: a control that vanishes reflows
  the form under the hand of the person filling it in, and the fields they have not reached yet jump
  to new places. This is the narrow exception to "a disabled control implies a choice is being
  withheld" — here the fact itself does not exist (a text has no length), which is what the hover
  says. _(the call log's duration, switching between a call and a text, 2026-09-08)_
- **A value the form can work out is OFFERED, not imposed — and only where it really is the same
  question.** A form that can compute an answer fills the empty field with it and never overwrites
  one somebody typed. The rule was written the other way round on 2026-09-08 (the call's duration
  derived from its start and its end, read-only) and the owner reversed it the same week: "you
  should be able to type in the length of time for the call, and this doesn't need to match
  calculation, considering people can be put on hold." The lesson generalizes past the call. Before
  deriving one field from two, ask whether the two really answer the same question — an hour on the
  line and twenty minutes of call are two true facts about one call, and a form that computes either
  from the other asserts they are the same number. Where they can honestly differ, store both, and
  say what the difference MEANS in a line beneath them rather than warning about it. _(the call
  log's duration, 2026-09-08, correcting the same round)_
- **One question is one field, however many kinds of answer it has.** "Where does this belong" is a
  matter, or a reason there is no matter, or nobody has decided — so it is ONE searchable field
  carrying all three, not a category control that reveals a second field once it is answered.
  Answering a question in two steps makes a reader answer it twice. _(the call log's Belongs to,
  2026-09-08)_
- **A record that starts from a phone number is built around the number.** The number is usually
  the only fact the person taking a call has, so it leads the form, what was said comes straight
  after it (where somebody still on the line is typing), and when it happened folds to one line
  because it is almost always now. Everything that FOLLOWS from the number — who it belongs to,
  their open matters, earlier calls with it — sits beside the form as the window's Identification
  and History tabs, and asks nothing until the number is whole. A contact on many matters gets a
  search over them rather than a long list (a public defender's office can have a hundred). _(the
  call log, 2026-11-09: "most of the information people get is the phone number, and maybe a caller
  ID"; "i like how we can gain some information ... look up information once number is set")_
  - **Two fixed words are pressed, not picked.** Call / Text and Incoming / Outgoing are buttons in
    a group, the pressed one marked (`$lib/components/button-choice.svelte`). This narrows the
    typed-into rule above to lists that can grow: a two-word answer that never changes is faster
    pressed. _(the call log, 2026-11-09: "make the call text, incoming/outgoing as a toggle")_
  - **Several calls at once, listed down the left.** A second call arriving while the first is
    being written down gets its own entry in the same window; saving one, or starting an intake from
    one, leaves the others standing, and the window closes on the last. _(the call log, 2026-11-09:
    "handle multiple numbers coming in at the same time"; "calls should be on the leftside, not above
    it"; "save and start an intake needs to be a safe operation for the other calls")_
  - **Start An Intake is in the header's menu, and the commit is Save.** A second commit-shaped
    button beside Save was pressed in its place; the intake is a rarer act and reads as one from the
    menu. The previewed number under the heading is the number alone, in italics. _(the call log,
    2026-11-09)_
  - **Activity, in formal words, with spam among them.** What happened on a call is its own
    pressed choice, per direction: Answered, Transferred, Message Taken, Spam for a call taken;
    Connected, Voicemail Left, No Answer for one placed. A transfer names the colleague, who becomes
    the member on the call; a message names who it is for, what was asked, by when and whether it
    is urgent, and becomes a task in their list; spam names its kind and files the call as spam by
    itself. The caller's own name is a separate optional field, "Caller ID (optional)", never a
    Directory record. _(the call log, 2026-11-09: "what happened and associated buttons beneath are
    so informal. Change it to Activity"; "add a way to show it was spam")_
- **A telephone number's ghost text is its country's own grouping** — `(XXX) XXX-XXXX` here, and
  whatever the chosen country writes anywhere else. It is the ONE placeholder in the product that is
  not simply its field's name: the grouping cannot be said anywhere else, it is what tells a reader
  the field wants a national number rather than a `+1` one, and it changes under them when they
  change the country. It is derived from libphonenumber's example number, never authored per field.
  _(the call log, 2026-09-08)_
- **A field whose height the panel has already decided carries no grab corner.** Dragging it only
  pushes the form's own footer around, so `resizable` comes off. A textarea in a scrolling stack
  keeps it. _(the call log's description, 2026-09-08)_
- **New beside a picker comes off where the field is one of many in a dense form.** The 2026-09-05
  ruling below still governs every field that says nothing — a way to add a record that only appears
  after a failed search is a way you find by accident — but on a form of eight fields a control per
  field is chrome, and the add row inside the list is where people were adding the record anyway.
  `createBeside={false}` is the exception, stated per field. _(the call log's contact field,
  2026-09-08)_
- **A field that chooses a record can MAKE one, from where it stands, through a top-level New.**
  Wherever a person or an organization is picked — a client, a payee, a conflicts subject, an
  event's participant — a New control stands beside the field before anything is typed, and the
  list ends with an add row for what was. It opens the record's own creation window (the same
  window, the same duplicate gate) over the surface the field is on, seeded with what was typed,
  and the new record lands in the field. Sending somebody to the Directory to add the caller and
  then back to the matter they were opening is the same work twice and loses the sentence they were
  halfway through. A reader who may not create sees the control refused with the reason, never
  absent. _(the intake desk's client field, and every picker over the directory, 2026-09-05)_

### Controls and patterns

- **A settings-heavy panel splits along "what I am asking" and "how the engine answers".** The
  primary pane takes the fields a member fills in every time; the context pane takes the machinery.
  In one column the two read as equals, and a form asking for two names and eleven engine settings
  reads as a control panel for something nobody can name. _(the New Check panel, 2026-09-08)_
- **A surface over many of something offers them as a RAIL of rows in FOLDERS, not as a filter.** A
  firm has a calendar per attorney, per paralegal, per room and a few that are dates; a dropdown
  offering one at a time is the wrong shape for that, and so is a row of toggles. Each row turns on
  and off on its own, each folder turns its rows on and off together, and the folder's own control
  carries the THIRD STATE — two of six on is neither on nor off, and pressing the middle state
  completes the folder, which is what somebody who turned two on and reached for the folder meant.
  **The folders are the firm's own vocabulary and never the product's**: a folder is a role the firm
  handed out, so nothing here decides who counts as support staff. _(the calendar's rail,
  2026-09-14)_
- **A thing a member can colour is coloured from the product's ONE palette.** The eleven colours a
  folder offers and the nine a calendar offers are one list in one home
  (`packages/design-system/src/lib/palette/`), with each surface stating which subset it offers
  rather than writing a second list in a second order — two lists are two reds. Where nothing has
  been chosen, deal the palette by POSITION rather than by a hash of the key: position spreads the
  colours evenly, and two of the first four coming out the same colour is exactly the failure the
  colours exist to prevent. _(the calendar's rail, 2026-09-14)_
- **A member's chosen colour and the product's status register are two facts, and they never share a
  property.** The status register paints the thing (a cancelled setting is struck and warning-toned
  whoever owns it); the member's colour paints an edge. Putting both in one fill loses whichever was
  written second. _(calendar chips, 2026-09-14)_
- **A direct-manipulation gesture is an ACCELERATOR, never the only path.** Double-clicking an empty
  day or hour starts a record on it, and the screen still carries the one create control every
  screen carries, because a gesture is mouse-only and a keyboard and a touch device have to reach
  the same act. It never fires from a press on an existing record: opening a thing and making one
  beside it are different intentions. _(the calendar grid, 2026-09-14)_
- **A grid that is empty says so by being empty; a LIST says it in words.** Thirty empty squares have
  already told the reader, and a line above them spends a sentence on a fact they can see. An empty
  list is a blank rectangle, which reads as something that failed to load, so it keeps its sentence.
  _(the firm calendar, 2026-09-14)_
- **A control that tunes something invisible carries its sentence in place, not on hover.** A hover
  title does not exist on a touch device and a screen reader reaches it only by asking, so a setting
  whose whole meaning lives in a `title` has no meaning for most readers. It goes under the control,
  in the reader's words. _(the New Check panel, 2026-09-08)_
- **Name the thing, not the dial, and say the capability out loud.** A label naming a mechanism
  ("Strictness", "Imputation", "Closure cap") asks the reader to have built the engine. Name what it
  searches instead ("Name matching", "The firm's own people", "Related parties to reach"), and where
  a capability already runs and is mentioned nowhere — sound-alike name matching, which the owner
  asked for as a new feature — say so on the control. A capability that is not on the screen does not
  exist. _(the New Check panel, 2026-09-08)_
- **A panel does not explain its own subject, and a refusal does not lecture.** The subtitle names
  what is being acted on; it is not the place for a paragraph on what the subsystem is for. A
  refusal states what to do in as few words as that takes — "Name at least one party.", not a
  sentence about what a check is. Enforced by `pnpm run lint:modal-headers`, and by the type: the
  subtitle slot takes a `RecordSubject`, so a paragraph cannot be passed as a string at all.
  _(the New Check panel, 2026-09-08)_
- **A modal says two things: what it DOES, and WHICH RECORD it does it to.** The heading names the
  act in the imperative — "Write Off a Balance" — a panel that MAKES a record says "New &lt;Noun&gt;"
  with the create control's own noun, and a panel that asks for nothing is `kind="reading"` and names
  the thing it shows. No heading ends in a question mark: the panel is what makes it a question, and
  a destructive kind already takes the alertdialog role and traps the decision. Interior articles and
  short prepositions stay lower case — "File a Copy", never "File A Copy". The subtitle is the
  RECORD, by the number somebody would read back down a telephone, plus the few facts about that
  record worth stating beside it. Both lines are asserted by `pnpm run lint:modal-headers`, whose
  verb vocabulary is a closed set: a new act adds one reviewed line rather than a noun quietly
  becoming a heading. _(2026-09-14, generalizing the two rulings of 2026-09-08 above and below)_
- **A record a panel was HANDED the number of is a record that panel names.** Being given a record's
  number is being told which record the panel is about, so it appears in the heading (where the
  number IS the record's name — a bill opens as "Invoice 2026-0147") or in the subtitle's reference,
  and never only in the record pane or on the printed sheet. The scan reads the platform's record
  numbers out of the schema's own `*_number` columns rather than a list somebody keeps, so a record
  kind that grows a number is asked this question the day its column lands; a number that is a number
  of something else — a telephone, a vehicle, a parcel of land — is recorded as such with its reason.
  _(2026-09-14)_

- **A screen makes something new through ONE control, and it is the same control on every screen.**
  The design system's `CreateControl`: a primary button reading "New" and one noun ("New Fee",
  "New Matter", "New Packet"), pressing straight through or opening a menu in the same footprint,
  held at a token width (`size.create-control`) so it never changes size as the label changes.
  On a matter it sits in the header beside the search and its label follows the section from the
  registry (`sections.ts` answers `createNoun` for every section, or declines with a line);
  the section's page claims the behaviour while it is mounted. Elsewhere it sits in the
  masthead's action row, after the search. Nothing else on the screen makes the record: the
  action-row buttons and the empty-state buttons that used to are removed, not moved. (The rest of
  that sentence — "and an empty state names the control at the top instead" — was **reversed on
  2026-09-14**; see _An empty list says "No Results", and nothing else_ below. An empty state names
  nothing now.) When nothing can be made right now the control is
  disabled with the reason as its title; it never leaves the row. Enforced by
  `pnpm run lint:matter-create-control`. _(the matter screens, 2026-09-03)_
- **The verb is New, and a control that opens a MENU reads the bare "New".** New is the word this
  product makes things with; a screen that invented its own — the firm calendar's "Record" — reads
  as a different kind of control in the one place every screen puts the same one. And where the
  control offers several kinds, the noun goes on the MENU ITEMS, each carrying the verb with it
  ("New Event", "New Deadline", "New Firm Event"): a button naming one of three things is wrong
  about the other two, and the item is where the choice is actually made. A control that does one
  thing still names it ("New Fee"). On a matter the registry says which sections make several kinds
  (`CREATE_SEVERAL_KINDS` in `sections.ts`) rather than the control reading it off the claim, so
  the label does not change under the reader as the page mounts. It holds on every menu-bearing
  control, not only the one it was raised on: Files reads "New" over New Document, New Folder and
  Upload Files (it read "New File", naming one of the three), and the directory's items read "New
  Person" and "New Organization". **Supersedes the label half of the file manager's N30**, which
  named "New File" there; N30's placement stands. _(the calendar, 2026-09-06)_
- **A control in a chrome band names itself on hover — one name, not a sentence.** The top bar's
  cluster answers one question on hover: what is this? So the four read "Notifications", "Time
  Sheet", "Downloads", "Build Information", and nothing more. Three of them had no hover text at
  all and the fourth explained what pressing it would do, which made four controls in one band read
  as four kinds of thing. The hover is the design system's Tooltip on every one of them, never a
  native `title` beside a real tooltip: two hover behaviours in one band differ in delay, in
  placement and in look. Where the control is already somebody else's trigger — a popover's — the
  two share ONE button through `Tooltip.Trigger`'s `child` snippet. _(the app header, 2026-09-06)_
- **The search and the create control travel together, search first.** A screen that carries one
  carries the other, in that order at the row's inline end: the search grows toward the inline
  start, so the control after it is the one place the field's growth cannot reach. The custody
  register had the create control and no search; it has both now. _(the Custodian register,
  2026-09-03)_
- **A destination opens beside the reader's work only through one gate, for a named reason.** A
  link navigates in place; a new tab is the exception, and an exception each screen decides for
  itself is how a product ends up with fifteen `target="_blank"`s in three spellings and no rule
  anybody can state. Every opening beside the reader goes through `$lib/navigation/open-beside`,
  naming why the destination cannot open in place from a closed set — it leaves the product, it is
  a file, it is a separate working session, or it is opened from a surface holding unsaved work —
  and a source scan refuses any other `_blank`. Adding a reason is a reviewed change to that file.
  _(new matter, 2026-09-02)_
- **A directory record is one window, wherever it opens.** A person or an organization has no
  screen of its own: it opens in the entity window, in the New Person screen's shape — the record's
  sections as a rail on the left, the chosen section beside it, what stands about the record on the
  right — over whatever the reader was doing, and closes back to it. So a party opened from a
  matter never leaves the matter, and the header's way back on every screen keeps meaning the
  screen above. A related record opened from inside the window swaps its subject rather than
  stacking a second window; one opened from another window stacks once. The address of a record is
  the directory's, carrying which record to open, so a pasted link still lands on it. Chosen over an
  origin-aware way back ("hard to keep track of over time") and over a breadcrumb trail. _(the
  directory record, 2026-09-05)_
- **A directory record is one scrolling document, entered and read alike.** Every section of a
  person stands on one page that scrolls, on the New Person screen and in the entity window both;
  the side rail is a table of contents that jumps to a section and lights the one the reader is in,
  never a switch that swaps one section in at a time. A pane-at-a-time rail put a person's phone
  number and address two presses from their name and left Tab unable to walk the record. A section
  holding one answer is folded into a neighbour (pronouns and life dates are one About section);
  the record's own facts stand in the header under its name; the right-hand pane holds only what
  the host knows (a matter's roles for a party) and is absent otherwise; a long list shows its
  first rows and Show All, so it cannot bury the sections after it. The New Person screen's right
  side reads the entry back as values, never counts. Chosen over tabs and over an Overview page
  that summarised the sections in cards. Supersedes the "chosen section beside it" half of the side
  rail and one-window rulings above; the rail itself stands. Composed through
  `apps/web/src/lib/directory/record-sections.svelte`. _(the person screen, 2026-11-09)_
- **A pane toggle is a quiet chrome affordance, and it ends the row.** Showing or hiding a details
  panel is not an act on the record, so it never wears a button's border or fill: it is the ghost
  icon control the file manager uses, reading its state through its glyph, and it sits last among a
  surface's controls. Four ledgers each drew it differently, which is how a reader learns that two
  screens are two products. _(the financial ledgers, 2026-09-02)_
- **A pane toggle is a quiet chrome affordance, and it ends the counts strip.** Showing or hiding a
  side pane is not an act on the record, so it never wears a button's border or fill and it does not
  belong where a surface's verbs are: it is the ghost glyph, reading its state through `aria-pressed`
  alone, at the inline end of the strip beneath the table — after the surface's figures, last on the
  line, on every surface that has a pane. It is not free and does not need to be: measured, the strip
  grows from 32 points to 41 to seat the control, against the 41 the row above the table cost — a net
  32 points back to the table, and one less band between the reader and the records. On the four
  financial ledgers that row had no other occupant most of the time. A surface with a
  toolbar it draws anyway is not an exception — the file manager's two toggles came down to the strip
  as well, so a reader never has to remember which screen keeps the answer at the top. One component
  (`$lib/records/pane-toggle.svelte`), because four ledgers each drawing their own is how a reader
  learns that two screens are two products. _(the financial ledgers, 2026-09-02; placement corrected
  2026-09-03)_
- **A row above a table renders only when something has to be in it.** Not an empty band a reader
  meets before they meet the records. The corollary of moving the pane toggle off it: what is left on
  the ledgers is the way out of a filter, and Costs' Review where the firm runs review, so an
  unfiltered ledger draws no row at all and its table starts at the top of the screen.
  _(the financial ledgers, 2026-09-03)_ **Amended 2026-09-05:** the rule stands; what changed is
  that the money sections now always have something to put in the row. The money toolbar carries
  where the reader is within Money and the siblings one click away (the section strip shows only
  "Money" with the gold bar, so nothing else on the screen named the sub-part), the surface's acts,
  and the two view settings. A row with a standing occupant is not the empty band this rule was
  issued against. _(the money sections, 2026-09-05)_
- **A resizable divider carries no grip handle.** The whole edge drags and the separator takes the
  keyboard, so a centred grip is a second affordance for a gesture already answered — and it reads
  as a control parked in the middle of the screen. The hairline that thickens under the pointer is
  the whole of it. _(the financial ledgers, 2026-09-02)_
- **Controls sitting in one band wear one chrome.** A border drawn round one of three controls in
  the top bar does not emphasise it, it reclassifies it: the reader takes it for a status readout,
  or for a control of a different kind. Whatever a control has to say, it says with its own content.
  _(the top bar, 2026-09-02)_
- **A calendar's week begins on the day the firm chose, and that is a firm setting, never a
  personal preference.** The week is the unit a firm plans in, so two members of one firm looking
  at the same week must see the same columns: a deadline "next week" has to name the same seven
  days to everybody who reads it. Sunday by default, because United States legal practice reads a
  Sunday-start week. It lives under Settings › Practice › Calendar, behind the calendar's own
  manage right, and no per-member override exists. _(the calendar, 2026-09-02)_
- **Only a surface nobody can open yet wears a maturity mark.** A screen a member can reach does
  not announce how finished it is: "Alpha" beside a working tab is a fact about the build, not
  about the matter, and once eight of fourteen tabs carry one the navigation reads as a release
  plan instead of the sections of a file. The labelled pill also cost each tab about as much width
  as its own label, which is what pushed most of a section strip into an overflow menu. `soon` is
  the one stage that still marks, because it states something a reader must know before they click
  — there is nothing behind this yet — and it is the same device the standing "designed-but-unwired
  ships visible and marked Soon" rule depends on. The stages themselves survive and still decide
  whether a destination is a live link or a stub; reaching one just stopped being something the
  product says out loud. Enforced in the model: `alpha` and `beta` present as null in
  `packages/design-system/src/lib/components/maturity/maturity.ts`, exactly as `ready` does. _(matter section strip,
  2026-08-31)_
- **Find which column sets a band's height before you spend design shrinking one.** Where two
  columns share a band, the taller one owns the height and work on the other is invisible. The
  matter chrome's inline-end column was the overflow control stacked over the section strip —
  40px + 8px + 41px — and it floored the band at 90px, so three identity treatments that look
  nothing alike measured at exactly 90px, and putting the whole identity on one line bought nothing
  at all. Moving the control onto the strip's row made that column 41px and the identity block
  mattered again. Measure the columns, not the thing you were about to change. _(matter chrome,
  2026-09-01)_
- **Drop a row before you shrink a face.** A row is twenty-odd pixels; a type step is a few, and it
  is spent out of the scale contrast the register depends on. The matter's ledger line and status
  seal moved down to lead the citation, which bought a whole row and cost the number nothing it
  could not say from there — while the type step that would have matched it took the display face
  close enough to the citation that the masthead stopped reading as one. Take the structural
  saving first and the type step only if it is still needed. _(matter chrome, 2026-09-01)_
- **The display step comes from the recipe, never a utility on the element.** A screen that needs a
  smaller masthead title asks for a density on `Masthead.Root`; it does not put `text-2xl` on the
  Title. The masthead is the one door to the display serif, and a call site that can set the step
  itself has taken that door off its hinges — the next screen picks a different size and the
  register is gone. Add the variant to the recipe instead. _(matter chrome, 2026-09-01)_
- **A control sharing a row with navigation sits above the rule, not on it.** The rule under a
  section strip belongs to the sections — their active mark draws on it — so a bordered control on
  the same row stops short of it. Sitting on the rule, the control reads as one more tab.
  _(matter chrome, 2026-09-01)_
- **A vertical navigation rail belongs to the app shell, and there is only one.** A page that needs
  more room does not answer it by standing a second rail inside the work canvas beside the shell's
  own: two vertical navigations on one screen make the member ask which one they are in. Module
  navigation stays in the page's own chrome, horizontal, however tight that gets. The section rail
  proposed for matters was rejected on exactly this ground: it oversteps what the main shell does.
  _(matter chrome arrangements, 2026-08-31)_
- **The inline-end half of a masthead is a column, not a slot.** Where a page's chrome would
  otherwise spend a whole row on navigation beneath the masthead, that navigation moves into the
  empty half beside the title: actions on the title's row, the strip beneath them, packed to the
  end and flush against the band's bottom rule so the active mark still lands on a rule. One band
  instead of two. _(matter chrome, 2026-08-31)_
- **A chrome band holds one height at every canvas width.** A band whose contents can wrap is a
  band that grows as the window narrows, and an arrangement adopted to RECOVER vertical space that
  grows past the one it replaced has done the opposite of its job. Whatever shares the row with
  navigation truncates instead: the title and the citation each take an ellipsis, with the full
  text on the element's `title`. Measure it at the narrow canvas before believing it — this one was
  only visible at 1024 and cost 27px there while saving 42px at desk width. _(matter chrome,
  2026-08-31)_
- **A reveal toggle is the Lucide eye / eye-off icon, centered in a square hit target** — never a
  text toggle. _(auth flow, 2026-08-07)_
- **Every non-initial step of a multi-step flow carries the same Back control**, from one component,
  in the same position. A flow where step 3 has a different back affordance than step 2 is a bug.
  _(auth flow, 2026-08-07)_
- **A back control shows an arrow and NAMES THE DESTINATION — never "Back to …".** "Sign In", "Your
  Code", "Your Choices". The chevron already says "back"; spelling it out again spends the widest
  part of the control on the one thing the icon cannot get wrong and buries the actual destination
  at the end of a sentence in lower case. A screen that is a full stop takes the same control in the
  same place rather than a full-width button at the foot. _(auth flow, 2026-09-09)_
- **A resend action uses the countdown-button pattern:** the timer starts at the first send, the
  remaining time is visible, and the control is disabled until it expires. Never a bare "Resend"
  that silently rate-limits. _(auth flow, 2026-08-07)_
- **What acts like a link looks like a link.** A text affordance that navigates or loads content
  when activated wears the standard hyperlink register (the app's link color, underline, pointer),
  even where containment demands it be a button under the hood — the safe viewer's outbound
  addresses load in its own viewport and are buttons, and they still read as links. _(safe website
  viewer, 2026-08-31)_
- **A toggle's active side is unmistakable at a glance.** A segmented or two-state control shows
  which side is selected through fill/register, not only a subtle border. _(safe website viewer
  Static/Live toggle, 2026-08-31)_
- **An advance control validates before it enables.** Where the next step cannot succeed without a
  well-formed input, the control is disabled and an inline hint says what is wrong. Do not let the
  user press it and receive a server error that was predictable on the client. _(auth flow,
  2026-08-07)_
- **Prefer an inline hint to a placeholder.** A placeholder disappears exactly when the user needs
  it and is not an accessible label. _(auth flow, 2026-08-07)_
- **A capability the backend does not serve yet still renders**, disabled, with the "Soon" badge and
  one honest line naming what it waits on. This is the standing rule from
  [`ui-design.md`](ui-design.md); it is repeated here because it is the one most often skipped.
- **A Soon seam ships where it is legible at rest, never behind a glyph.** The rule above says a
  designed-but-unwired capability stays VISIBLE, and an overflow menu is the one place that quietly
  breaks it: the matter header's `...` held exactly one item, the status's lifecycle action,
  disabled and marked Soon, so the menu had to be opened before a reader could learn there was
  nothing in it to press. That is a control's width of chrome spent to say nothing, and the seam it
  was protecting stopped being visible the moment it went in the drawer. A single unwired action
  belongs on the row as a named disabled control, or it waits until it is wired. _(matter chrome,
  2026-09-01)_
- **A menu earns its glyph from what opening it offers.** An overflow is a container for a set that
  is genuinely too long or too secondary for the row — not a place to put one thing so the row
  looks tidy. Count the live items before drawing the trigger: at one, the item goes on the row; at
  zero, neither the item nor the trigger is drawn. _(matter chrome, 2026-09-01)_
- **A navigation strip that does not fit is GROUPED, not folded.** A measured overflow decides by
  pixel arithmetic which half of a member's destinations they can see, and width is not a statement
  about importance: the matter strip put Trust and Calendar behind More because of where they
  happened to sit in a list, while seven others held the row. Name the neighbourhoods instead and
  put those on the row — the matter's fourteen sections became Overview, Files, Money, Parties,
  Calendar, Record and Magnus, which fit. Group only what a member can afford to reach through a
  menu; a destination checked daily stays on the row even when it would tidy the arrangement to
  file it away. A measured fold stays underneath as a backstop for a canvas narrower than the
  arrangement; it is not the arrangement. _(matter section strip, 2026-09-01)_
- **A folded group keeps its name.** When a group does reach the overflow, it goes in as a heading
  over its own entries, never decanted into a flat list — otherwise the two routes to one
  destination disagree about what it belongs to, and a member who learned "Trust is under Money"
  finds it loose in a menu at a narrower window. _(matter section strip, 2026-09-01)_
- **No navigation entry is called "Other".** A tab earns its place by naming something a reader
  would go looking for, and "Other" names the absence of a category — it can only be found by
  ruling every other tab out, and it exists as the drawer whatever nobody placed gets pushed into.
  The matter registry's Other section was removed rather than described better: content with no
  home yet waits for the section that will own it, which is a smaller debt than a permanent bin
  that teaches members the file has an unsorted corner. _(matter section strip, 2026-09-01)_
- **A result region is furniture, not a reward.** The structure that will hold results (a frame, a
  panel set, tabs) renders at rest, empty and calm, so arriving data fills a shape the reader
  already has and population is never a surprise. The list-screen "table holds the vertical space"
  ruling is the same judgment. _(safe website viewer, 2026-08-31)_
- **Retry a transient upstream fault yourself, visibly.** Where a backing service faults
  transiently (a registry rate-limiting, a renderer at capacity), the surface retries a bounded
  number of times before reporting failure, and shows each attempt as it happens; the member is
  never made to be the retry loop. _(WHOIS lookup, 2026-08-31)_
- **An empty list says "No Results", and nothing else.** Two words, in title case, for BOTH the
  record that holds nothing and the narrowing that excludes everything — one wording serves both
  because it is true of both, where "no matters yet" is a lie about a filtered table and a sentence
  naming the filters is a second copy of what the header already shows. No description under it, and
  no sentence naming the way in: the create control is in the masthead's action row on every screen
  by the product's own grammar, so prose naming it duplicates a label that is free to change without
  the prose changing with it. **This reverses** the 2026-09-03 "an empty state names the control at
  the top" clause above. Where the reader can widen a narrowing, the way back is a CONTROL beside the
  words, never more words. What the empty states used to carry instead was a definition of the domain
  term — "A packet is the physical thing the firm holds and moves: an envelope, a deed box, a sealed
  wallet…" — which is the explanatory prose _No info lines_ already forbids everywhere else, and
  whose home is `docs/user/`. Not a rule to remember: `DataTable.Grid` has no `empty` snippet to pass
  and `NoResults` takes no props, so there is nothing to get wrong. Three narrower states stay
  distinct because they state a fact about the SUBJECT rather than about the result set — a sample
  matter, a firm that has not enabled something, and a read that failed (which is `FailureNotice`,
  not an empty state at all). _(the custodian register, 2026-09-14)_
- **An empty screen is the filled screen lacking information**, not a different screen. The same
  regions render, each saying what it is missing. A centred card that replaces the layout teaches a
  person nothing about where things will be, and it makes the first real use of the screen a second
  first impression. _(file workbench, 2026-08-31)_
- **No pill describing a result's provenance.** A chip reading "Ran on arrival" or "Needs your
  consent" beside a finding annotates the mechanism rather than the answer. Where when-it-ran
  matters, it is a row in the result. _(file workbench, 2026-08-31)_
- **Values are encapsulated, never floating.** A set of readings renders inside something with a
  heading and edges — a table — so a reader can see where one set ends and the next begins. A bare
  label-and-value list poured onto the page reads as text, and a long value runs into the heading
  under it. _(file workbench, 2026-08-31)_
- **A list of records is the product's one grid**, with its sorting, its per-column filters, its
  show/hide, its selection gestures and its footer counts. A pane being narrow is a reason to start
  columns hidden, never a reason to hand-roll a second list — and a chronology is not one either: a
  list written by hand has none of it and earns each piece back one at a time, differently. _(file
  workbench, 2026-08-31; matter activity, 2026-09-02)_
- **A page's primary query control sits at the reading edge, not in the masthead's far-right
  actions slot.** Left-aligned below the masthead, where the eye starts; the far right is for
  secondary actions. Results render below it, so nothing about the control reflows when they
  arrive. _(WHOIS Lookup tool page, 2026-08-31)_
- **No info lines.** A screen carries no explanatory prose about itself: no intro paragraph saying
  what the tool does, no footer stating what is or is not saved, no reassurance line. Controls,
  labels, and results carry the meaning; explanation lives in the user guides (`docs/user/`). The
  owner has issued this deletion repeatedly; it is recorded so it stops being issued. It supersedes
  the same-day "orienting text persists" ruling, which presumed the text should exist — copy that
  does legitimately exist (an honest empty-state or error line stating a fact about this result)
  still must not vanish or move between states. _(safe website viewer, 2026-08-31)_
- **One fact, once, under the name that can act on it.** Where a panel can state the same fact two
  ways, it states it the way a reader could do something about. The version overlay carried both a
  "This page" line and a `magna-carta-web` row; they are the same commit, and the Worker's name is
  the one someone can open in a dashboard. The duplicate goes, and comes back only as a fallback for
  the case where the surviving line cannot answer. _(Build Versions panel, 2026-08-31)_
- **A confirmation changes the control's fill, never its width.** Feedback on a press (copied,
  saved, applied) tints or fills the control for about a second. It does not append a glyph beside
  the value: the width change reads as the value itself changing, which is the one thing a
  confirmation must not suggest. _(Build Versions panel, 2026-08-31)_
- **Text that grows on a clock never shares a row with a control.** A line whose length changes on
  its own ("checked 2 minutes ago" becoming "checked 14 minutes ago") sits under the header, not
  beside the buttons, so nothing the reader is aiming at moves while they aim. _(Build Versions
  panel, 2026-08-31)_
- **The action that answers a signal sits with the surface's other controls, as a symbol.** A
  panel's gestures belong in one cluster in its header, where a reader looks for any of them, and a
  state-triggered action joins that cluster rather than opening a second control somewhere in the
  body. Distinguish it by its own icon and register, never by repeating the neighbour's glyph.
  _(Build Versions panel, 2026-08-31)_
- **A long reference list folds, remembers the fold, and counts what folding hides.** Behind a
  caret, per browser, defaulting to open. A shut heading still states any fault among the rows it
  hides, because the reason a list is exhaustive is that omissions read as health. _(Build Versions
  panel, 2026-08-31)_
- **A comparison between two things allowed to differ is a status colour, not a sentence about
  them.** Explaining in prose that two related builds deploy separately and may disagree is the "no
  info lines" rule applied to a comparison: state the judgment (matched, one behind, differ) as a
  coloured read instead, reserving the alarmed colour for the one state that actually calls for
  action. _(Build Versions panel, second round, 2026-08-31)_
- **A line whose content can go empty stays mounted, empty, rather than being unmounted.**
  Conditionally rendering a status line (present only while there is something to say) resizes the
  surface around it every time the condition flips; mount it unconditionally and give it inert
  filler when it has nothing to report, so height never depends on wording. _(Build Versions panel,
  second round, 2026-08-31)_
- **A field's label does not get a badge repeating it.** "Internal Memo" wearing an "Internal" chip
  says the same word twice in two voices. _(Time record window, 2026-09-03)_
- **Every labelled control in a row starts at the same baseline, which means every label carries the
  same type metrics.** A label that omits the line-height the others set sits its control a few
  pixels low, and a row of three fields reads as two fields and a mistake. Where a primitive renders
  its own label it restates those metrics, and the two blocks change together. _(Time record window,
  2026-09-03)_

- **A submenu holds what it is named after, and settings are not filed under a noun.** The table
  header menu kept the display settings — row shading, and whatever the surface added — inside its
  Columns submenu, one arrow to the right of a trigger that names something else. A column roster is
  what a submenu is for: one row per column, the hidden ones included, since a hidden column has no
  header left to right-click. How the table LOOKS is not a column, so it sits in the menu's own
  root, in the menu the reader already has open. _(the file manager, 2026-09-06)_
- **A control that comes and goes never ends a row.** The end of a right-aligned row is an anchor,
  and a control that appears only in some states must not hold it: everything before it slides
  sideways each time it arrives or leaves. The file manager's display settings, which belong to the
  icon view alone, sit BEFORE the list-or-icons swapper for exactly this reason — the swapper is on
  every view, so the swapper keeps the end. Same property the create control's fixed width protects
  in the matter header. _(the file manager, 2026-09-06)_

- **A pair of surfaces that are one idea pointed two ways is ONE frame rendered twice.** Uploads and
  Downloads had been built separately and had drifted the way separate things do: one named itself on
  hover and the other did not, so the single control in that band that STARTS a transfer was the one a
  reader could not identify, and each had grown its own empty wording with its own paragraph under it
  explaining the mechanism. The frame is shared (the trigger, the dot, the titled panel, the way to
  the full surface) and what differs is passed in. What is NOT shared is as deliberate: where the two
  hold different kinds of record — a stored document any format can be taken from, against a file on a
  matter — their tables stay their own, because one table over both means a column that is blank for
  half the rows. The test is whether the FRAME is the same thing, not whether the contents rhyme.
  _(the transfer registers, 2026-09-16)_
- **A live register that forgets is answering the wrong question.** Where a surface holds work that
  genuinely cannot survive the tab, separate the TRANSFER from the RECORD of it and keep the record.
  An upload's file handles die with the tab; the names, the matter, the folder and the file each one
  became do not, and those are what somebody is asking for the next morning. Keep the record where
  the transient thing lived, bounded, with nothing privileged in it, and make every landed item
  reachable again from there — a register that answers "nothing uploading" to "where is the thing I
  sent yesterday" is truthful and useless. _(the Uploads screen, 2026-09-16)_
- **A control that opens an outside service wears that service's own mark, not the nearest glyph we
  have.** The icon rule is absolute for iconography — every glyph is Lucide, none is drawn — and a
  brand mark is not iconography: it is the identity of one specific service, and the nearest Lucide
  shape for it states a concept instead. The build panel's repository link wore a git-branch glyph,
  which says "a branch" about a link that goes to GitHub. A service's mark is a compliance artefact
  rather than a design choice, so it ships self-hosted and unaltered, in its own quarantined home
  (`@magna-carta/design-system/service-marks`), with a row in
  [`third-party-trademarks.md`](third-party-trademarks.md) recording whose it is and on what terms.
  Nothing else earns an exception to the icon rule. _(the build panel, 2026-09-16)_
- **A FOLD is not a screen, and nothing is ever reached through one.** A group of rows too long to
  take in at a glance folds behind a chevron; a group of rows reached by opening a page ABOUT them
  costs a navigation and gives the reader a list of the things they are not doing. The nine tools
  had been both in a fortnight — a two-sided screen, then an index — and the fold is what the
  grouping was always trying to be. Three things keep a fold honest: pressing it opens the rows
  rather than going anywhere, a fold holding one row is not drawn (a chevron hiding one thing costs
  a press and saves nothing), and everything inside it stays reachable from search, because hiding
  must never remove capability. _(the rail's sub-menus, 2026-09-16)_
- **A category is named for what the reader is doing, not for what the thing is made of.** Eight
  catalog subject groups became four — Records, Internet, Mailing, Files — because a member reaching
  for a domain's registration thinks "internet" and never "web-domains", and because eight headings
  over nine rows is a heading per row, which is no grouping at all. _(the tool clusters, 2026-09-16)_
- **A set the reader scans by name is ordered by name.** Alphabetical is the default for any list
  whose rows are things somebody arrives already knowing the name of; an authoring order is a fact
  about the repository rather than about the firm. _(the tools in the rail, 2026-09-16)_
- **One mark answers one question.** A star had been "show this row in my sidebar" while every other
  product on the reader's screen uses it for "this is mine, keep it handy". The two are different
  questions and now wear different marks: an EYE for visible-here, the star for a favourite. Where a
  mark is doing two jobs, the fix is a second mark, not a better tooltip. _(Customize and favourites,
  2026-09-16)_
- **A shortcut the platform cannot predict is the member's to make, and the gesture belongs on every
  page.** No registry can know which of ten thousand matters somebody opens each morning, so the
  person standing on the page says so. That only works if the gesture is everywhere, which means it
  rides the one component every screen already builds its title from rather than being added screen
  by screen — a favourite control thirty screens have to opt into is a favourite control that covers
  twenty. _(favourites, 2026-09-16)_
- **Every page has a menu beside its star, and the star stays out of it.** The `…` on the title's
  row holds what is about the page rather than work on it: Copy Link and Open in New Tab on every
  screen, then the screen's own secondary page-level items (`pageMenu` on `ScreenHeader`) — a
  hand-off to the settings page behind it, a history it can forget. Moving the star into the menu
  was considered and declined, because the gold star is the only thing that tells a member the page
  is already a favourite, and a menu hides that answer. Search, create, filters and the screen's
  main action never move in, and an unwired item stays on the row marked Soon rather than going
  behind the glyph. A screen being redesigned passes its page-level extras here instead of growing
  its own header overflow. _(page menu, 2026-11-09)_
- **A mark beside a label never rides inside it.** A row is a grid: the label takes the slack and
  truncates, and the trailing mark sits in a column sized to its contents that never shrinks. Put
  inside the label the mark inherits the label's overflow, so it is the FIRST thing to disappear on
  exactly the rows long enough to need it — "Property Listing Links" hid its own Soon badge, which is
  the one row where the badge was load-bearing. _(the sidebar rows, 2026-09-16)_
- **A row that can be dragged says so at rest, and the thing that says so must work.** A grab cursor
  answers only once the pointer is already on the row, which is an answer to a question nobody
  asked; a grip states the affordance before the hand commits. But a grip drawn beside the gesture
  rather than inside it is worse than no grip at all: it answers the question WRONGLY, and the
  reader who takes it at its word finds nothing happens. The press belongs to the whole row — grip,
  glyph, name and mark alike — with the row's own trailing control let out by target, because that
  is the one thing on the row somebody presses to act rather than to move. _(Customize mode,
  2026-09-16; the handle corrected 2026-09-17)_
- **A nested list is stepped far enough to read as one.** A rail's rows already carry an inset of
  their own, so a sub-menu indented by less than that inset again puts a child's glyph barely a
  glyph's width right of its parent's, and the fold reads as one flat list — the hairline down the
  edge then has to carry the whole relationship by itself. Step the child by more than the row's
  own inset, and let the rule sit on the step rather than in place of it. _(the rail's sub-menus,
  2026-09-17)_
- **Direct manipulation settles; it does not hunt.** A drag that reorders measures the real PITCH
  between two rows (a row's height is short by the gap between them), moves its landing index only
  once the pointer is well past a boundary and needs less travel to come back, and writes its
  position once per animation frame however fast the device reports. Rounding at exactly half a slot
  puts the flip where a hand rests while it is deciding, which is what makes a list judder.
  _(reordering, 2026-09-16)_

- **A control whose GLYPH changes with its state is not a pressed toggle, and is not ringed like
  one.** The ghost recipe draws an accent hairline around an active toggle because a view or pane
  toggle's icon says nothing about which side is on; a star that fills and turns gold has already
  said it, and the ring then reads as a box fencing in the mark. Such a control drops `aria-pressed`
  and carries its state in the glyph, in a label that names the act in both directions, and in a
  data attribute — never by neutralising the recipe's paint at the call site. _(the screen header's
  favourite star, 2026-09-17: "only the star should be yellow, there should not be a box around the
  star")_

- **A band of controls holds one open panel, and the band decides it — not the panels.** The top
  bar's controls sit a few pixels apart and nearly every one opens a panel over the same work
  canvas; pressing the second control is how a member says they are done with the first, so opening
  any of them closes the others. Leaving it to the overlay library is not enough and fails
  intermittently: a hover label is itself a dismissible layer, so a press on a neighbour while its
  label is showing makes the LABEL the layer responsible for the press, and the panel underneath is
  never asked to close. `TopBar.Root` declares itself an overlay band and every popover, menu and
  dialog seated in it hands its place on; the library keeps every deliberate route it already
  owned. _(the top bar, 2026-09-18)_
- **A menu in the window's own chrome opens on a press, never on a pointer passing over it.** Hover
  activation earns its place in a strip a member READS by pointing at — the matter's section strip,
  the rail's groups — and loses it at the corner of the window, where a pointer lands on its way to
  somewhere else and the menu opens over whatever was actually being reached for. The account menu
  is `openOnHover={false}`. _(the account corner, 2026-09-18)_
- **A seam that names a fact the product already holds is not a seam, it is an omission.** The
  account corner said "Your name and firm are not shown here yet" while the session bootstrap
  carrying both was being awaited on every navigation a few files away. Where the data is already
  read, the surface reads it: through the shared cache, at no new request, as a `LoadingRegion`
  fixture while it is in flight, and — if the read does not answer — as what is known, or as
  nothing at all, never as a sentence about our own plumbing. _(the profile menu, 2026-09-18)_

### List screens

- **A list screen is ONE table at the full width, and a rail down its side has to earn the
  difference.** The custody register kept a container tree in a left column, narrowing the rows to
  a whole branch — a subtree read the server does per request, which no column filter over loaded
  rows can express. That argument was real and still lost: the rail made this register read as a
  different kind of table from every other one in the product, which is a cost paid on every visit
  for a narrowing that a set filter on the Location column already serves. Where a thing is kept is
  a property of the row, so it is a column, filtered from its own header the way Status is.
  _(the Custodian register, 2026-09-06)_

Issued against the matters list and re-issued against the directory. They bind every List/Index
surface, which is most of the product.

- **A heading carries no explanatory sub-text.** No sub-heading under a page title, no sentence
  under a section heading restating what the section obviously is. "The firm's active docket" under
  _Matters_, and "Clients, parties, counsel and courts, in one book" under _Directory_, were both
  removed for the same reason: they spend vertical space on a working screen and tell a working user
  nothing they did not know before they clicked. This is not the same as an honest line that carries
  a CONSEQUENCE — "revealing a value is recorded in the firm's audit log" stays, because it says
  something a reader must know before they press. The test is whether removing the line loses a
  fact. **Issued here against lists, it binds every archetype** — see _Screen headers_ below, which
  is where it was carried to the rest of the app. _(matters list, 2026-08-30)_
- **Actions collapse into one compact action row.** Everything above the data that is not the data
  is a single row: the primary action, then narrowing and searching as icon controls that open what
  they need when they are needed. A labelled dropdown and a labelled search box, each with a
  sentence under it, cost three rows of a screen whose subject is a list. Where a screen would carry
  a button per variant of one action ("New person", "New organization"), it carries ONE primary
  action with a menu instead. _(matters list, 2026-08-30)_
- **A control that WIDENS the list does not sit in the row that narrows it.** The row above a list
  holds the acts a reader arrives wanting — searching, and making a new record — and the one way
  back to everything. Asking to see what is CLOSED (done, cancelled, archived, closed out) adds
  records rather than holding them back, so it belongs at the foot of the list, met after
  everything the list is actually for has been read, and undone by its own label ("Show Done"
  becoming "Hide Done") rather than by the clear control. The task list carried Done and Cancelled
  as two boxes over its rows, where they took the space the search was reached for in and made the
  clear control appear because MORE was on screen, which answers the wrong question.
  _(tasks, 2026-09-08)_
- **The table holds the vertical space it would occupy when full.** The list region takes the
  remaining height and keeps it, so the screen does not reflow as rows arrive, as a filter narrows
  them, or as an empty state replaces them. In practice: the page is a full-height column and the
  table is `min-h-0 flex-1` inside it. _(matters list, 2026-08-30)_
- **One place to narrow.** Where several mechanisms narrow the same list — a server-side scope, a
  server-side search, the table's own column filters — they sit behind one control, because from
  where a reader sits they answer one question. Answering it in three places is how somebody ends up
  staring at an empty table with a filter set on a control they are not looking at. _(matters list,
  2026-08-30)_
- **A listing states how many there are; a capped answer states that it is capped.** These are the
  two shapes a list of records comes in and they must not be presented alike. A LISTING is sorted,
  walkable to the end, and carries the size of the whole record — not of the page in hand. A RANKED
  ANSWER is in the server's relevance order, is never re-sorted on the client (that would put the
  best of an arbitrary slice at the top and read as the best of the firm's record), and says so
  when more matches exist than were returned. A screen that has both shows them as two different
  objects. Never fake a listing out of a search. _(directory, 2026-08-30)_
- **A tab strip is not a place to keep a report.** Where tabs beside a list hold answers the list
  itself could give — everything under a hold, everything overdue — they are pre-set filters wearing
  the costume of destinations, and a reader has to visit each one to find out whether it holds
  anything. Either the narrowing belongs to the one table or the report does not belong on that
  screen; what it never is, is a second screen. A genuine aggregate (counts per owner rather than a
  list of packets) is a different object and is judged on its own, not carried along because it sat
  in the same strip. _(Custodian register, 2026-09-01)_
- **Where a surface both HOLDS a record and OFFERS the act that writes one, the record is the screen
  and the act is the create control over it.** The conflicts destination opened on the check
  composer — a matter picker, the parties, the sources, the band, three edge budgets and two caps —
  with the firm's own log of every check it had run pushed below all of it. The form is filled in on
  a fraction of visits; the log is the question the screen exists to answer, and it was the part a
  reader had to scroll to. The act does not lose anything by moving: it becomes New Check at the end
  of the action row, opening the one panel the product asks acts in, which is also where a reader
  already looks for it on every other list screen. _(Conflicts Check, 2026-09-08)_
- **A screen with no way to create the thing it lists is not built.** A list, a detail window, a
  filter set and a print sheet over records nobody can add is a reader for somebody else's data. The
  entry path ships with the surface, and where the backend already serves it, its absence is the
  defect rather than the roadmap. _(Custodian register, 2026-09-01)_
- **A control that clears or dismisses says so on screen, not only on a key.** A keyboard way out
  is not an affordance: nothing advertises it, and a pointer user is left to select the contents and
  delete them. ScreenSearch shipped with Escape-to-clear and no glyph on the reasoning that the key
  was enough; it was not. Where a control can be emptied or closed, the visible way to do it is
  present whenever there is something to empty — and the key keeps working, routed through the same
  function so the two cannot drift. _(matter search, 2026-09-02)_
- **A click on bare background is a click away.** A person who clicks a page's empty margin has left
  the control, and a transient thing — an unused field, a popover — closes. Reading focus alone
  cannot see this: clicking a margin moves focus nowhere, so nothing fires that says "away", and
  code that waits to be told will wait forever. Watch the pointer as well as the focus. What stays
  open is a control still carrying STATE a reader needs — a live query keeps its field open, because
  a narrowed list must carry its reason on screen. _(matter search, 2026-09-02)_
- **Enter means the next thing, not the same thing again.** On a field that already searches as you
  type, the answer is on screen before Enter could be pressed, so re-running the search is a no-op
  wearing the costume of a response. Enter goes to wherever the whole answer lives, and pending
  debounce is flushed first so the destination never opens on a query one keystroke stale. A screen
  with no such destination leaves Enter alone rather than inventing one. _(matter search, 2026-09-02)_
- **A way through to the full surface does not require starting the task first.** A panel that only
  appears once a query is typed puts everything in its header — the scope, the link onward — behind
  work the reader has not decided to do yet. The panel opens with its control; it is its header row
  until there is something to answer. _(matter search, 2026-09-02)_

- **A status word is legible against the others in its set, not on its own.** Where a state leaves a
  reader asking what it is, the label takes a word the domain already writes for it — but the test
  it has to pass is the PAIR: custody's "Out" became "Checked out" and was then read as the same
  event as "Released", because both merely say the property left the building. "On loan" carries the
  return, which is the one thing that distinguishes it from a release. Fixing a word in isolation
  and shipping it beside the word it collides with is half the correction. This never licenses a
  synonym: the enum, the ledger and the filter are unchanged, and the word chosen is the domain's
  own (the ledger row for this state records a `borrower`). _(Custodian register, 2026-09-01)_

### Screen headers

Issued against the main screens as a set (2026-09-06). They bind every screen that states its own
name, which is every screen outside a matter.

- **A main screen's title is its destination's name, and nothing else.** `ScreenHeader` with a
  `title` and no `eyebrow` — the Matters shape, which the owner named as the one to copy: "i like
  matters, simple, just the name". Home greeted the reader with the daypart, Notifications called
  itself "Notification Center" while the sidebar called it Notifications, and Downloads and
  Notifications each carried an eyebrow that repeated their own title back. A screen and the
  sidebar row that leads to it disagreeing about the screen's name costs the product a shared
  vocabulary and buys nothing. Take the name from `destinations.ts`. _(main screens, 2026-09-06)_
- **The eyebrow names what the screen's SUBJECT is, never what the screen is.** It exists for a
  record window — PERSON over _Rosalind Chase_ — where the reader needs to know what kind of thing
  they are looking at. On a destination screen the title is already that answer, so the eyebrow can
  only repeat it. No main screen carries one. _(main screens, 2026-09-06)_
- **The meta line carries facts, not descriptions.** This is the no-explanatory-sub-text rule
  (_List screens_, above) applied to the masthead's citation, and the test is unchanged: removing
  the line must lose a fact. Home's date, a room's kind and seat count, a speed test's run time and
  a maturity badge all stay. "Alerts, mentions, and updates across your matters", "Runs outside any
  matter" and "Registration records for a domain or IP address" were removed — each restated its
  own title in a sentence. _(main screens, 2026-09-06)_
- **The rule is a gate, not a ledger entry.** `pnpm run lint:screen-headers`
  (`tooling/lint-screen-headers/`) refuses an eyebrow on any screen, a destination screen whose
  title is not what `destinations.ts` calls it, and a meta line that is fixed prose rather than a
  read value. It exists because the drift reappeared while the consolidation was still open: the
  uploads screen shipped `eyebrow="Uploads"` over `title="Uploads"`, written by somebody with no
  way to know the rule had been made. A rule in this file binds whoever reads this file; a rule
  with a gate binds the diff. The meta test is a shape rather than a judgement — a fact is READ
  from somewhere, a description is typed in place — and every line the consolidation removed was
  static text while every line it kept interpolates or renders. Exemptions are named in the scan
  with their reason, and there are none. _(main screens, 2026-09-06)_
- **A screen with a page header does not also label its content region.** Where a page owns an
  `h1`, the component beneath it drops its own heading rather than saying the name twice; where the
  page's masthead names something else — a matter's Tasks section under the matter's own name —
  the section keeps its label. `TaskList`'s `heading` is optional for exactly this reason.
  _(main screens, 2026-09-06)_

- **Information a screen owes the reader lives on the page, not in the header.** The header states
  the name; a fact the reader needs stands where it bears on what they do. The safe website
  viewer's "the page renders in an isolated remote browser" was not deleted — it moved to the
  address bar, beside the control it qualifies, in the band that otherwise carries an invalid
  address. This is the disposal route for anything the no-sub-text rule removes from a header:
  ask where the fact is actually used, and put it there. _(safe website viewer, 2026-09-06)_
- **A settings page's descriptor leads its content, and its header is only its name.** Settings is
  a nested archetype — every page is a sub-page of Settings, named already by the section nav — and
  it was the one place still carrying a sentence in the band. The descriptor now renders as the
  first line of the page's own scroll area (`settings-description.svelte`), so it scrolls with the
  plates it describes instead of being pinned above them, and `SettingsMasthead` no longer takes a
  `meta` at all. The band keeps the page name and the standing facts about it — the posture badge,
  the documentation seam, the history trail — because those are facts and controls, not
  description. _(settings pages, 2026-09-06)_

### Screen search

- **A live query carries an X that clears it**, at the field's trailing edge, shown only while there
  is something to clear. This REVERSES the original rule that Escape was clearing enough: Escape is
  a keyboard affordance and nothing on screen advertises it, so a pointer user had no way to empty
  the field but to select the text and delete it. Escape still clears, and both paths run the same
  code so they cannot drift. _(matter search, 2026-09-02)_
- **Clicking outside an empty search closes it.** Also a reversal: focus landing on the document
  body was read as "focus went nowhere", so the control stayed open. To a person there is no such
  place — they clicked away. A live query still holds the control open, because a narrowed list has
  to carry its reason on screen; the X is how you empty it. _(matter search, 2026-09-02)_
- **Enter goes to the fuller surface, where the screen has one.** A search that already answers on
  every keystroke has nothing to re-run, so Enter must mean the next thing rather than nothing at
  all. A screen that narrows rows in place has no such destination and leaves Enter alone rather
  than inventing one. _(matter search, 2026-09-02)_
- **The control opens in two directions, and each one has a job.** To the inline START it opens
  into the field, which is for WRITING the query; DOWNWARD it opens into a panel, which is for
  everything else — what the query reaches, and what it found. Aiming a search is not part of typing
  it, and a scope named in full ("Everything on this matter") took most of the width the field had
  on a header line. ScreenSearch's `scope` seam, which seats a scope control inside the field's
  leading edge, is therefore NOT what a long scope vocabulary should use. _(matter search,
  2026-09-02)_
- **The downward panel belongs to the control, not beside it.** A panel rendered as a sibling is
  outside the control's root, so the collapse watches read a click into it as a click away and shut
  the whole thing on first use. `ScreenSearch`'s `panel` seam renders it inside that root, which
  makes the correct behaviour structural rather than something each surface has to rediscover.
  _(matter search, 2026-09-02)_
- **A search panel opens with the field, not with the first keystroke.** Anything a person needs
  before they have typed — the scope, the way through to the full results — is unreachable if the
  panel is gated on a query, and gating it made changing where the search looked require starting a
  search first. Empty, the panel is its header row and nothing else. _(matter search, 2026-09-02)_
- **Every Workspace screen searches itself through the one control, in the top right.** The
  owner's direction: a member should never have to learn where a screen keeps its search, and the
  answer is the same everywhere — `ScreenSearch`, in the screen header's `actions` snippet, at the
  inline end of the title row, resting as an icon so it costs the screen no vertical space. What
  made this a ruling rather than a habit is what was found when it was checked: the Matters docket,
  the Directory and a matter's Notes were each still carrying their own search box, every one of
  them a `type="search"` field beside a Lucide search glyph with its own debounce and its own idea
  of what pressing the icon on a live query should do. None was wrong; they were three more answers
  to a question the product had already settled, and both 2026-09-02 corrections above had reached
  the component and none of them. All three now use the control. _(Workspace screens, 2026-09-14)_
- **"The read takes no query" is a reason to add the query, not to skip the search.** The owner's
  correction, on the first pass at the ruling above: four screens had been recorded as declining a
  search because their rows are paged off a read with no search parameter, and there was no reason
  they should not have one. Notifications, Conflicts Check, Magnus and Calendar each search now, and
  the work was in the read rather than on the screen. What survives of the original reasoning is only
  its narrow true part — narrowing the pages that happen to be in the browser, on a list the server
  pages, answers "of the forty I have read, which match" while appearing to answer "which of yours
  match", and does it silently. That remains forbidden. The answer is to push the query to the
  server, which is what each of these now does. _(Workspace screens, 2026-09-14)_
- **Where a screen's words are composed in the browser, the browser resolves the query and the
  server still does the paging.** Two of these screens carry no sentence in the record at all, by
  design: a notification row holds identifiers, closed labels, counts and dates, and the conflicts
  log holds closed labels and identifiers recorded by reference. A substring scan server-side would
  be searching `deadlines.deadline.overdue`, which is not what anybody types. So the client resolves
  the term into the kinds and categories whose WORDS match — it owns those words — and sends them
  with the term; the server matches those plus the one member-facing string the row does carry, the
  matter number. The whole record is searched, the paging never leaves the server, and the
  vocabulary never leaves the client. _(Notifications and Conflicts Check, 2026-09-14)_
- **A search states the scope it actually reached.** The calendar's search narrows the window on
  screen, because each of its three reads caps its horizon server-side and refuses a wider one
  rather than clamping it — so "search the whole record" is not a request that can be made there
  yet. That is allowed to be the answer, and it is not allowed to be silent about it: the screen
  says how many entries in the named window match and that other dates were not searched. A bare
  "3 matches" beside a month grid would read as three on the calendar. _(Calendar, 2026-09-14)_
- **A screen that genuinely has nothing of its own to search says so in the gate.** One Workspace
  screen declines today — Home, which is a summary of other screens rather than a list, and whose
  answer to a query is the command palette already in its top bar. What is refused is not answering.
  `pnpm run lint:workspace-search` holds all of this: it refuses a Workspace screen that neither
  searches nor declines, a control seated anywhere but the header's action row, a decline left
  standing after its screen got a search, and any second implementation of a search box.
  _(Workspace screens, 2026-09-14)_

- **A screen searches the list it already shows; it does not grow a second one to put the answer
  in.** The Matters docket sends its query to the read and the same grid, with the same columns,
  shows what matched — while the Directory swapped that grid out for a separate table of hits the
  moment anything was typed: a second surface to learn, arriving exactly when a reader is
  mid-thought, and taking the sort, the filters and the columns they had set up with it. The
  narrowed list keeps the screen's own footer, which is where the count and the "there are more
  matches than these" sentence belong; a capped answer still says it is capped. The one shape this
  is not is a screen with no single list to narrow — a matter's search reaches its documents, notes,
  time and people at once — and that answer already has its home in the `panel` seam that opens
  downward from the control. `pnpm run lint:workspace-search` refuses a screen that draws a table
  under the query and another under the else, and names any allowance left standing after the
  screen began searching in place. _(Workspace screens, 2026-09-17)_

- **Where a query could honestly land on more than one register, the other answers arrive as rows
  in the same table.** Somebody searching the Directory for "Pemberton" is as often looking for the
  file as for the person, and sending them to a second screen to find out is the same defect in
  another form. So a live query on the Directory also lists the firm's matching matters, marked by
  the Kind column, blank in every contact column, opening the matter — and the resting index stays
  the book of people and organizations, with its count the directory's own. _(the Directory,
  2026-09-17)_

- **The search field reads "Search", and nothing more.** Twenty-three screens each handed the
  control a hint naming their surface — "Search the docket", "Search the firm's fees" — and the
  owner struck them: the control sits in the screen's own header, so the screen is already named an
  inch to the left, and the hint was restating it. The placeholder is no longer a prop of
  `ScreenSearch`; a screen names its surface only in the accessible label, which never shows.
  _(Workspace screens, 2026-09-18)_

### Layout

- **A panel with a side rail holds ONE size, whichever rail item is chosen.** A modal sized to its
  content is right for a panel whose content is fixed and wrong for one whose content the reader
  picks from a rail beside it: four fields, then a table, then a list whose length the firm's own
  data decides, and the panel jumps taller and shorter under the pointer on every press — so the
  rail item somebody was reaching for next has moved by the time they get there. The panel takes one
  height for the SCREEN it opens on (a share of the viewport, capped at a comfortable measure, so it
  neither overflows a laptop nor wastes a monitor) and the chosen section scrolls inside it. The
  right-hand pane takes the same height, or a long list there decides the geometry instead.
  _(the directory record and New Person, 2026-09-08)_
- **A row of fields WRAPS; it never scrolls sideways inside a panel.** Five controls on one grid line
  inside a modal pane put everything after the second past the right edge of a panel that does not
  scroll sideways, so the fields were unreachable rather than merely cramped. Each control keeps a
  width it can be typed into and the row grows downward, which a panel has room for.
  _(the directory record, 2026-09-08)_
- **The five money sections are one surface, and it wears the file manager's frame.** Time, Fees,
  Costs, Billing and Trust each render inside `MoneySurface` (`apps/web/src/lib/money/`), which is
  the file manager's arrangement applied to a ledger: the surface runs to the edges of the work
  canvas, a toolbar strip sits flush under the section strip, the table connects to it with no
  rounded card between them, and the counts strip sits on the bottom edge. The owner's words: the
  four framed tables "look good, but I like how Files looks more, where the features and the table
  start at the top, connected up there" — and wanted one central component that looks the same for
  every money sub-part. Nothing under Money draws its own frame, acts row, footer or pane toggle;
  a ledger declares its columns, cells, figures and verbs and hands them to the surface.
  _(the money sections, 2026-09-05)_
- **The framed look survives as the reader's alternative, one setting for every money section.**
  The surface offers two layouts, flush (the default, the file manager's) and framed (the table in
  its rounded card inside the canvas padding), switched from the toolbar and remembered under one
  key for all five sections, so the money screens can never be in two looks at once. The density
  step (comfortable or compact rows) is the same kind of setting and lives beside it. Both are view
  settings, so they sit on the toolbar where the file manager keeps its list-or-icons switch,
  never on the counts strip, which holds the pane toggles. _(the money sections, 2026-09-05)_
- **A working surface takes the rest of the screen and keeps it.** Most pages are documents and are
  as tall as what is on them. A few — the file manager, the financial ledgers — are surfaces you
  work in: the list scrolls inside itself and the counts footer belongs on the bottom of the screen.
  Those are exactly as tall as the viewport whatever is in them, or the page grows a second
  scrollbar as records arrive and the footer walks off the bottom. The height comes down an unbroken
  chain of flex-grow over min-height-0 — never a percentage, which resolves against an indefinite
  height and quietly does nothing — and the chain is one shared component, not a class list each
  page repeats. _(the file manager and the financial ledgers, 2026-09-02)_
- **A modal filling the screen has square corners.** A radius says the panel is a sheet lying on top
  of something; at full size there is nothing underneath, and the curve reads as four notches of
  desktop showing through the corners of the application. Fixed on the shared modal frame, so any
  shell that grows an expand gesture inherits it. _(Time record window, 2026-09-03)_
- **A windowed modal never touches the edge of the screen.** On a laptop a long record ran from the
  top edge of the screen to the bottom edge with its rounded corners cut off against them, and at a
  laptop's width the record-width panels touched both sides too; the owner read it as the modal
  taking the screen. A panel is a thing lying over the application, and it keeps a gutter of screen
  around it on every side (`size.modal-gutter`, 32px) that its width cap and its content are measured
  inside: a panel that fits opens at its own height with air around it, and one that does not caps
  at the screen less the gutter and scrolls inside. The gutter is a fixed length rather than a share
  of the screen, because a share swells on a large monitor, where the width caps already leave room,
  and shrinks on a small one, where the air is needed most. Expanding is the one exception, by
  design: filling the screen is that gesture. Every dialog, alert dialog, action dialog and record
  window inherits it from the shared modal stage; edge sheets are drawers and stay on their edge.
  _(the modal shells on a laptop, 2026-09-03)_
- **The foot of the sidebar is the utility tray, and what belongs there is meta about the app.**
  Settings, Customize, Downloads and Uploads sit as small icons at the rail's foot, apart from the
  labelled destination rows above. The test is not importance but subject: a destination row names a
  place in the firm's work, while a transfer register describes what the application is doing —
  often two of them at once, since a download and an upload can run together — so the registers
  belong with the app's own controls rather than in Workspace. They are fixtures there, never
  starrable or reorderable, and the collapsed rail still shows only Settings. The top-bar trays keep
  their own job: a summary with quick actions, linking into these full surfaces.
  _(the sidebar's foot, 2026-09-07)_
- **A tray holding two kinds of thing separates them by its two ends, not by a divider.** The
  sidebar's foot leads with the rail's own controls (Settings, then Customize) and leans the two
  transfer registers to the inline end, so a reader tells a control from a destination by where it
  sits. An auto margin on the trailing group does it, never `justify-content: space-between` on the
  tray, which would also spread the leading controls apart from each other; and the trailing group
  is ONE element, so the collapsed rail's "everything past the first icon goes" rule takes it away
  and brings it back whole. _(the sidebar's foot, 2026-09-07)_
- **A totals strip sits on the bottom edge of its frame, not under the last row.** A ledger fills
  the height it is given, so the ordinary case is a table with room beneath it; totals that come to
  rest halfway up the screen with a band of empty surface below them read as a table that failed to
  load the rest. _(the four financial ledgers, 2026-09-03)_

- **The document declares its colour scheme, and the root declares its ink.** The token cascade
  re-points every `--mc-*` per theme and mode, so anything drawn from a token follows the mode — but
  the browser paints a great deal no token reaches (the canvas behind an overscroll, scrollbars,
  form controls, the caret, and the system colour that stands in wherever a colour was never named),
  and all of it follows `color-scheme` alone. Neither was declared, so on the dark themes the
  browser was still painting in light mode underneath the design system, and any element written
  without a colour took `canvastext`, which is BLACK whatever the page behind it looks like. It
  surfaced as the file manager's breadcrumb reading black on a dark band; it was never a file
  manager defect, and every screen carried it. One stylesheet in the `base` layer
  (`packages/design-system/src/lib/styles/base.css`), imported by the app entry and the catalog
  preview alike, so the two review the same product. A component still names its own ink — this is
  only what the document starts from. _(the file manager, 2026-09-06)_
- **The root is painted too, and the scheme is written before the stylesheet arrives.** The same
  document base, carried the last two steps by the white-flash report. A colour scheme is not a
  colour: it buys the browser's generic canvas for the mode, not the surface the product is drawn
  on, and against a 99% warm surface the light one reads as a flash to pure white. Every shell
  paints its background INSIDE the Svelte tree, so the canvas is what shows wherever that tree does
  not cover the viewport — the boot of a hard load, a shell swap on the way to Account or sign-in,
  an overscroll, the scrollbar gutter. The root takes `background-color` from the surface token, and
  a background on the root propagates to the canvas, so no unpainted layer is left. And because a
  stylesheet is a separate request while this document has an empty body until the application
  mounts, `applyThemeToDocument` writes `color-scheme` inline as well — mirrored in the boot script,
  the same fact in the one window a stylesheet cannot reach. _(reported as a white flash between
  screens, 2026-09-07)_

- **A capability a member OPENS is a row in the rail, not a row in a column inside a sub-page.**
  Where a set of surfaces is reached through a screen whose left side lists them all, ask what that
  column is worth to the reader who has already chosen. If the members of the set have nothing to do
  with each other — the tool catalog is the case that settled it: a postage rate, a WHOIS record, a
  county recorder's site and a bandwidth measurement — the column is a standing list of the things
  you are not doing, and it charges the surface you ARE doing the width of itself on every visit.
  The two-sided shape earns its column where the column is a finding aid over ONE subject the reader
  moves around inside (settings, a matter's sections, the reports register); it does not where the
  rows are unrelated destinations. Elevating them costs nothing that matters: the addresses do not
  move, the index survives as the place to read what each one does, and the rail was already the
  product's answer to "where do I go". _(the tools, 2026-09-16)_
- **A sidebar group folds, and the heading is the control.** Not a chevron beside a label, not a
  control in a row of its own: the heading itself takes the chevron and the full width as its hit
  target, keeps the letterspaced-caps voice unchanged, and the fold is remembered per browser. Two
  things it is not allowed to be. It is not available in the collapsed icon rail — a rail with no
  visible heading has nothing to fold BY, and folding there would leave a column of icons with
  nothing saying why the rest are missing. And it never reaches the command palette: folding hides
  rows the way a star does, and the invariant is the star layer's — hiding must never remove
  capability. _(the sidebar, 2026-09-16)_
- **An index whose children are destinations in their own right lights as current only on its own
  address.** The default is the opposite and is right nearly everywhere — a destination owns
  everything beneath its path, which is what keeps the gilt bar on Matters while a matter is open.
  Where the things beneath it are rows of the same rail, prefix-matching lights two rows at once and
  the reader has to work out which one is the answer. _(All Tools, 2026-09-16)_

- **A screen header is its name and its actions, and a control that moves the grid stays over the
  grid.** The owner named the escape — lifting the calendar's controls into the header — and ruled
  against it in the same breath, so the action row stays where the 2026-09-16 arrangement put it and
  is made to FIT instead: the window's name takes the slack the other groups leave rather than a
  fixed slot, the way back to everything is the Kinds menu's own last item so narrowing can never
  widen the row, and the glyph controls are the small square the rest of the row already stands at.
  Wrapping survives only as the fallback below the width the groups themselves need. _(the
  calendar, 2026-09-17)_
- **A two-sided screen has two scroll regions, and a column that has one does not nest another.**
  The rail scrolls and the content column's grid scrolls — that is the layout's design — but under
  the action row there is exactly one scroller: the region around a month, a week or a day, which
  are tables that scroll nothing of their own, or the agenda itself, which is already a named
  focusable scrolling region. A region inside a region offers a reader two bars for one list and no
  way to tell which moves what. _(the calendar, 2026-09-17)_
- **A grid that fills its column is sized by a cell MINIMUM, never a fixed cell.** Six weeks at the
  largest spacing step stood taller than a laptop's work canvas before a single entry was painted,
  so an empty September scrolled. The month now fills the height it is given and its weeks share
  the surplus; the region above it scrolls only when the minimum wins. _(the calendar, 2026-09-17)_

- **A two-sided screen shows two scrollbars, never three, and the navigation's is not one of the
  two.** The settings column stood three bands, eight groups and twenty-four rows open at once —
  about twice a laptop canvas — so it carried a permanent scrollbar of its own beside the page's,
  and a viewport-derived height that overshot the canvas by a pixel added the canvas's own on top.
  Every band and every group folds now, and `NavigationLayout` caps its height against the canvas
  it actually sits in rather than against the viewport. A height computed from `100dvh` is a guess
  at a parent's height; where the parent is itself a scroll region, the guess is the defect.
  _(Settings, 2026-09-17)_
- **A settings page is the three stories and nothing else — masthead, the one scroll region, the
  exit.** A page that writes the scroll region's two divs out by hand gets the spacing right by
  accident and drifts the first time anything is corrected. `SettingsScrollRegion` is the only
  `overflow-y-auto` under Settings. _(Settings, 2026-09-17)_
- **The fold is one grammar across the product, and it is the sidebar's: the heading IS the
  control.** Full width as the hit target, the label's own voice kept, a chevron down while open and
  toward the inline start while folded, remembered per browser as departures from everything-open so
  anything shipped later arrives open. It is one component — `NavigationLayout.Group` — for every
  two-sided screen's column. The rail's own rows are not folded into it: a sub-menu row is a grid
  with an icon column, a truncating label and a collapsed-rail tooltip, which is a different anatomy
  wearing the same grammar. What must never drift is the grammar, and a part is the only way to
  hold that. _(Settings, 2026-09-17)_
- **The column never folds away the page the reader is standing on.** Arriving inside a folded
  group opens it, that opening is not remembered, and one press still folds it — a fold is a reading
  convenience, and the command palette still reaches every section inside one, because hiding must
  never remove capability. _(Settings, 2026-09-17)_

- **The canvas lays its children out; a screen that takes the whole height may shrink.** A
  two-sided screen sizes itself to the canvas, and as a block child it kept that height whatever
  stood above it — so the platform notice, which the shell renders over every page, pushed it past
  the bottom edge by exactly the notice's height and the canvas grew a third scrollbar. The work
  canvas is a flex column now and the layout is a shrinkable item with no minimum, so the notice
  takes its room and the layout keeps its bottom edge on the canvas's. Ordinary pages stack in the
  column exactly as they stacked as blocks. _(the shell, 2026-09-18)_

### Spacing and rhythm

- **The App Shell draws the page inset, once, for everybody.** A screen rendered into the shell's
  `<main>` never insets itself: `<main>` already sets the distance between the chrome and the
  content, and a screen that pads itself as well sits at twice every other screen's distance from
  it. The difference is invisible on the screen itself and obvious the moment somebody navigates,
  which is how Tasks, Time and Magnus each came to carry a second `p-24` — each written from a copy
  of the last. Spacing BETWEEN the things on a screen is still the screen's own: the `gap-*` on its
  column, the padding inside a card, a one-sided padding off a border. Enforced by
  `pnpm run lint:page-inset`, which reads the inset off the shell rather than assuming it. The same
  scan refuses `flex-1` on a screen's top-level element, because `<main>` is a block container and
  a screen that says `flex-1` there is silently taking no height at all — `h-full` is what it means.
  _(tasks and time, 2026-09-07)_
- **Meta text sits at a fixed offset under the element it annotates**, expressed as one rule, not
  re-chosen per screen. Any explanatory line under a field, a button, or a heading uses it.
  _(auth flow, 2026-08-07)_

### Art direction

- **The auth surface is a signature moment and should not be a flat ground.** The owner's direction
  is typographic texture drawn from historical legal text, which is on-brand and public domain.
  Constraints: stays within tokens, behaves in dark mode, respects reduced motion, and costs the
  card no legibility. Explore as mockup variations for selection before any build. _(auth flow,
  2026-08-07; open)_

---

## How corrections are recorded

Append an entry under the round it came from, then promote the generalizable part into _Standing
rules_ above. An entry that is purely local to one surface (a specific string on one screen) stays
in the round and never gets promoted.

### 2026-11-09 — the numbering editor: preview beside current, parts that drag, and counts that need no padding

The owner, reviewing client and matter numbering over a mockup of Settings, Numbering:

- **"A client may be assigned a code, as in numbers, instead of letters ... 3333 is the client,
  3333-1 is the first matter ... 3333-9 and 3333-10 should be allowed and not require setting the
  amount of white space between."** The engine already wrote a counter's width as a floor rather
  than a fixed width; a new counter now starts at one digit, so a scheme of Client Code, `-` and a
  Counter with a separate count per client issues `3333-1` through `3333-10` with no zeros. The
  column that set it is **Format**, and on a counter it reads as the fewest digits.
- **Numbers sort as they are read.** `3333-10` filing between `3333-1` and `3333-2` was the cost of
  dropping the padding, so every text column in the product's table compares runs of digits as
  numbers. Promoted to _Lists and tables_.
- **"Instead of up and down arrows, would prefer drag ability of those items."** A part moves by
  its grip, and the grip keeps the keyboard path (Alt with an arrow key). Replaces the move-up and
  move-down buttons at the row's end, which had been placed there on 2026-09-19.
- **"Preview should sit beneath the current area."** Current and Preview are one above the other,
  ahead of the parts, so the number in force and the number the edit would issue are compared at a
  glance. **"We don't need the text beneath current and preview that explains it, nor the
  continuation count."** Both rows state their number and nothing else, except that an unset
  scheme still says what being unset means, which is a consequence rather than an explanation.
- **"Rename Restarts the Count."** Asked what it does and how it is said elsewhere (a separate run
  for each value of the part: Client Code on gives 3333-1, 3333-2, 4444-1; off gives one firm-wide
  count with the code as a label), the owner chose **Separate Count**.
- **"Load example and add parts ... don't need to be as big ... prefer no load example."** The
  examples are gone; **Add Part** is a quiet line under the last part.
- **"Numbers already drawn" becomes "Numbering Scheme only affects future generation."**, in the
  owner's words, beside Save.
- **"Date numbered should be 2026.11.11 ... client name should have - between words ... allow a
  minor setting for how the user wants to delineate."** Date Numbered and Client Name each take a
  separator: Dash, Period, Underscore, Tilde or None. A slash is refused, because a number rides in
  links. A new part starts with a period for the date and a dash for the name; a scheme saved before
  the choice existed renders exactly what it always did (`20261111`, `AshfordHoldings`), because a
  firm's run must not change shape on its own. **"When clicking into the dropdown, show what the
  output would look like from there."** The Part picker shows beside each choice what that part
  would put into the number.

### 2026-09-18 — a Communications group

The owner, placing Meetings in the left sidebar:

- **"We should likely combine it into a new section called communications to encompass this,
  messaging, and potentially other items."** Messaging had been one row among the firm's work, and
  a second row for meetings beside it would have made the Workspace group answer two questions at
  once. A sixth group now sits between Workspace and Money, holding the channels the firm reaches
  people through — calls and texts, video meetings — with room for the ones ahead (a client's
  messages through the portal, a firm mailbox). It generalizes the rule of two days earlier: **a
  group answers one question, and a row that answers a different one is the start of a new group,
  not the end of a long one.** Messaging keeps its stored id, because a member's stars are filed
  under it; only its group moved.

### 2026-09-17 — a star, the settings column, the Directory's search, and the calendar on a laptop

The owner's round over the deployed site, in one message. What was said, and what each part
generalizes to:

- **"For the favorites button, only the star should be yellow, there should not be a box around the
  star."** The ghost button recipe rings a pressed control with an accent hairline, and the star was
  declaring itself pressed. It no longer does: the filled gold glyph is the state. Generalized above
  under _Controls and patterns_.
- **"AI and the assistant setting has multiple scrollbars, make sure to harmonize all setting pages
  to use the same component."** Two causes. The settings column stood every band and group open —
  about twice a laptop canvas — so it scrolled beside the page; and the layout's height was a guess
  from the viewport that could overshoot the canvas by a pixel and wake the canvas's own bar. The
  column folds now and the layout is capped against the canvas it sits in. Of the twenty-four
  settings pages, one (Conflicts) had written the scroll region's two divs out by hand; it is on
  the shared part. Generalized above under _Layout_.
- **"My settings, firm settings, and platforms should be collapsible menus, with submenus and
  grouping also being collapsible. Check what we use in the left sidebar, should these be combined
  in components?"** Yes to the grammar and no to the rows: the heading is the control, folded per
  browser as departures from everything-open, built once as `NavigationLayout.Group` for every
  two-sided screen's column. The sidebar's own sub-menu row is a different anatomy (an icon column,
  a truncating label, a collapsed-rail tooltip) wearing the same grammar, and folding it into the
  part would have made the part four things. Generalized above under _Layout_.
- **"I added more columns for directory, but it did not populate in, even with blank data."** They
  were declared hidden, reachable only by right-clicking a header. Every declared column shows now.
  Generalized above under _Lists and tables_. What is still open for the owner: the Columns submenu
  itself is reachable only by that right-click, and nothing on the screen says so.
- **"We should be able to see matters in the directory search area."** Read as matter rows in the
  same search answer, marked Matter; the record window's own matters pane answers a different
  question (what one person is on) and is untouched. Generalized above under _Screen search_.
- **"Remove 'Every match the firm holds, in its own relevance order' from bottom of search."** Gone,
  both places; the footer now speaks only when the answer was cut short.
- **"Search functionality in the matter screen searches the table, while directory generates a new
  searchable area which I dislike. Identify which places do it this way and swap over. Create lint
  rule."** The survey of every screen with the search control found the Directory the only one that
  swapped its table for a second surface; it searches in place now, with the server's relevance
  order kept until the reader sorts. `lint:workspace-search` gained the `second-results-surface`
  rule. The one sanctioned other shape is a matter's own search, which reaches everything on the
  matter through the control's downward panel. Generalized above under _Screen search_.
- **"For Collabora, I dislike how some settings are nested; to get to paragraph and font settings I
  have to click into the menu, as opposed to that stuff being right at the top."** (2026-09-18.)
  The editor was opening in its compact mode by default; the launch form now sends the editor
  `UIMode=tabbed`, whose Home tab carries those controls. A default, not a lock: the editor's View
  menu still switches, and a browser remembers the switch. The size of the editor's controls is
  a separate question, still open (the frame zoom or a branding stylesheet in the container).
- **"Sometimes I press uploads or downloads or other buttons in the header and the other one will
  stay open."** (2026-09-18.) A hover label outranked the open panel in the overlay library's
  dismissal order, so the panel was never asked to close. The top bar is an overlay band now: one
  open panel, and opening the next closes the last. Generalized above under _Controls and
  patterns_.
- **"I don't want the top right menu to open just on hover."** The account menu opens on a press
  only. Generalized above; every other hover-opened menu sits in a strip read by pointing and is
  unchanged.
- **"This menu also still says 'Magna Carta / Your name and firm are not shown here yet'."** It
  shows the member's name over the firm's, from the bootstrap every navigation already reads, and
  the avatar carries their initials. Generalized above.
- **"Downloads and upload pages should show the table data would populate in, even if there is no
  data. I want this as a lint and standard rule, that data tables will still appear before data is
  in the area."** (2026-09-18.) Built as `DataTable.EmptyRow` and the `table-behind-absence` rule;
  fourteen surfaces fixed, three allowances stated. Generalized above under _Lists and tables_.
- **"In file manager area, regardless of how files are sorted (by name), folders should always
  sort separately from files."** (2026-09-18.) One pure function on the grid's `orderRows` seam,
  reaching the browse table, the icon grid, the inside of an archive and the upload intake's
  hierarchy. Ledger row L59 in `file-manager-rulings.md`. Generalized above under _Lists and
  tables_.
- **"Calendar is very tight on my laptop, and has multiple scrollbars. If we move controls up higher
  in the header area, maybe this would be better, but it would also be against what we really
  do."** The escape was named and refused in the same sentence, so the controls stay over the grid
  and were made to fit: one scroll region under the row, a month sized by a cell minimum that fills
  its column, and a row that fits one line by measure. Generalized above under _Layout_.

### 2026-09-17 — the second level, read and grasped

The owner on the deployed rail, two items:

- **"The parts under tools such as records should be indented slightly so that they are easier to
  delineate as subparts."** The sub-menu had a 24px step against rows that already sit 8px in, so a
  tool under Records landed almost under Records. It is a 32px step now, with the hairline on it.
  Generalized above.
- **"The dragging icons should be draggable, not just the text."** The grip was drawn beside the
  element that took the press rather than inside it, so pressing the one thing on the row that says
  "move me" did nothing. The row takes the press now. Generalized above, as an amendment to the grip
  ruling of the day before — the affordance and the gesture are one thing or they are a lie.

### 2026-09-16 — the rail regrouped, the tools elevated, and favourites

The owner, in a second pass the same day, over the left navigation. What was said, and what each part
generalizes to:

- **"Move file workbench to tools. Remove all tools page. Move each tool to a top-level ability."**
  The index that survived the morning's ruling did not survive the afternoon's, and for the reason
  the morning's gave: a screen about tools is a stop on the way to work. Every tool is addressed at
  `/<id>` with a rail row of its own; the File Workbench, which had been promoted out of the catalog
  precisely because the old area charged a navigation to reach it, is a catalog tool again.
- **"Allow for sub-carrot menus within tools (and potentially others)."** Built as a general
  mechanism rather than a Tools feature — any group may fold, and the parenthesis is why. Generalized
  above, with the three properties that keep a fold from becoming a screen.
- **"Move firm usage to firm."** A tool is a utility a member RUNS; Firm Usage runs nothing, it is
  the firm reading its own records, which is what Reports beside it does. Its permission travelled
  with it rather than being dropped.
- **"Identify best way to organize (records, internet, etc.)"** The owner's own two examples were the
  answer: the eight subject groups became four named for what the reader is doing. Generalized above.
- **"Default sort tools alphabetically."** Generalized above, for any list whose rows are things
  somebody arrives knowing the name of.
- **"Perhaps we move home and notifications out of workspace? Consider if they should move or any
  others?"** They are about the person, not about the firm's work, and no ordering inside a
  fourteen-row group was going to say that. Five groups now, each answering one question; Tasks,
  Calendar and Magnus moved with them, on the same test.
- **"For customize, instead of stars, let's find a better symbol... I want to create a favorites
  section, whereby users can delineate certain pages as quick access... we would have to find a way
  to get this in all pages."** Both halves generalized above: one mark per question, and the gesture
  riding the one component every screen already uses.
- **"Drag and drop for reorganization stutters, also, the items lack little dots on the side to show
  that this can be moved."** Two separate rules above — the grip, and how direct manipulation
  settles. The stutter was three faults stacked, and the arithmetic is recorded where it lives
  (`apps/web/src/lib/components/drag-reorder.svelte.ts`).
- **"For unmade tools, the soon badge does not appear in the left side bar, it is hidden by the
  length of the text."** Generalized above: a mark beside a label never rides inside it.

### 2026-09-16 — the transfer registers, the rail, and two glyphs

The owner, in one pass over the upload and download surfaces, the sidebar and the build panel. What
was said, and what each part generalizes to:

- **"Hovering over upload button in header should say upload."** The download tray beside it already
  did. Generalized above: a pair of surfaces that are one idea pointed two ways is one frame rendered
  twice — the fix is not a tooltip added to one control, it is the two controls ceasing to be two
  implementations.
- **"History of uploads and downloads should be retained between sessions."** Downloads already were
  (a shelf on the member's record, held a week). Uploads were not, and could not be as transfers —
  so the record was separated from the transfer and kept per browser. Generalized above.
- **The two empty states become "No Uploads" and "No Downloads."** Not a new rule: the empty-state
  ruling of 2026-09-14 (two words, title case, no description) reaching two screens that predated it
  and each carried a paragraph about the mechanism instead.
- **"Uploads and downloads are so similar, make sure they are built modularly."** The frame is one
  component; the words neither is allowed its own copy of are one module. The ruling states the line
  the modularity stops at, which is the part a later round would otherwise get wrong.
- **"Items should be redownloadable from the upload or downloads areas."** Every landed file carries
  a download straight to its own route on the matter — the same route the file list uses, so what
  comes back is the file and not a copy of it.
- **"In build info, replace copy button and github button with better icons."** Copy was a clipboard
  with an arrow, which is the picture of paste. The repository link was a git-branch glyph, which
  names a git concept rather than the service. Generalized above, including the one exception to the
  icon rule and the compliance track that carries it.
- **"Workspace, money, and firm should all be collapsible menus."** Generalized above, with the two
  places folding is not allowed to reach.
- **"Instead of tools being a sub-page, maybe we should elevate those tools to the left sidebar,
  since they are all so different, and we lose screen space without it. Especially relating to high
  usage like mailing and postage, this may be a long-term benefit."** The reasoning is the ruling and
  is generalized above: an unrelated set does not earn a navigation column, and the surfaces that
  will be used most are the ones least able to pay for one.

### 2026-09-14 — everything has a number, intake included

The owner, on seeing the modal-header work land: "everything should have a number, intake would have
a number as well." What binds:

- **The last of "no number before active" is gone.** The lifecycle ruling of 2026-09-06 said no
  number of any kind existed before a matter became active; the consultation sequence reversed half
  of it and this reverses the rest. An intake draws its own number the moment the enquiry is written
  down, from a third run beside the matter and consultation runs, rendering `I2026-0001` by default.
- **A number per rung, not a number moved earlier.** Drawing the consultation number at intake
  instead would have been cheaper and is the wrong shape: most enquiries are declined, so the
  consultation run would fill with numbers issued to nothing and stop being readable as a run of
  consultations. Each run counts one thing, which is what keeps each of them dense enough to read.
- **A file that came the whole way answers to three names and keeps all three.** Nothing is
  replaced. A surface shows the newest number the record has drawn — that is the one a person is
  being told now — and searches every one of them, because a note quoting the number a file was
  filed under at the time has to keep finding it.

### 2026-09-14 — the modal header: the act, and the identifier of what it acts on

The owner, opening this stream: a standardized format for stating what a modal does and the
identifier of the data being entered, "because all data should be traceable, and in that way, all
data should have identifiers. These are our tentative matter numbers, or message numbers".

The round found that both halves had already been ruled on — on 2026-09-08, twice, and in the
shells' own prop documentation before that — and that none of it held. Across 82 panel openings, 18
of 54 subtitles were paragraphs about what a subsystem is for, four billing panels put a number and
a sentence in one string behind a middle dot in three places and an em dash in a fourth, five
headings asked a question where forty-seven named an act, six capitalised an article fourteen left
alone, and the preview-before-save the owner had asked for had reached exactly one file.

- **A ruling in a ledger binds the people who read the ledger; a ruling with a gate binds the diff.**
  The two rulings of 2026-09-08 were both correct, both written down, and both broken within the
  week by people with no way to know they existed. What changed is not the rulings — it is that the
  subtitle slot stopped being typed `string`, and that `pnpm run lint:modal-headers` now reads the
  call sites. Promoted into _Controls and patterns_ above.
- **A number a record does not hold yet is still stated, and says which it is.** Three standings,
  and the difference between the last two is load-bearing rather than a shade of wording: a matter
  number is `drawn`, a consultation number is `tentative` — the record really carries it, it
  survives the matter opening, and a document filed under it still resolves — and a `preview` is
  what the NEXT record would take, shown while the reader is still filling the panel in. A panel with
  no number to show says "A number is drawn when this is saved." rather than standing empty.
- **What a panel explains goes beside the thing it explains.** Every sentence removed from a
  subtitle in this round either restated the heading (deleted) or explained a field, a choice or a
  consequence (moved beside it). The one that mattered most was on the detach confirmation, where
  the fear the panel has to answer — that pressing Detach destroys the file — now sits in the
  panel's body instead of in the line that names the document.

### 2026-09-14 — the calendar: many calendars in folders, a day of columns, and a form that asks where

The owner walked the deployed calendar and issued eleven corrections in one round. Most of them
generalize; the generalizations are promoted above and the rest is here.

- **A firm does not have one calendar, it has twenty — so a calendar surface offers them as a RAIL
  of individual calendars kept in FOLDERS, not as a filter.** "For calendars, you should be able to
  set any number of individual calendars… there would be several rooms that have calendars, so
  those would be in a folder of some kind, attorneys could be in another folder, support staff like
  paralegals, receptionists would be in another." Each row turns on and off on its own; each folder
  turns its rows on and off together, and its control carries the third state, because two of six
  attorneys on is neither on nor off. **The folders are the firm's own vocabulary and never ours**:
  a folder is a ROLE the firm handed out and its rows are the members holding it, so nothing in the
  product decides who counts as support staff. A member holding two roles is filed under the first,
  because a calendar listed twice reads as two calendars and toggles as one.
- **A calendar carries a colour its owner chose, from the product's ONE palette.** "You should be
  able to set the color of a calendar, that way you could more easily delineate." The palette is the
  same eleven the file manager's folders offer, which is now one module
  (`packages/design-system/src/lib/palette/`) rather than two lists free to disagree about red; a
  calendar offers the nine of them that read on a chip. An unchosen calendar is dealt a colour by
  position, so eight calendars turned on are eight a reader can tell apart before colouring any.
- **The colour and the status register are two facts and never fight.** A chip's fill is the
  product's status register (a cancelled setting is struck and warning-toned whoever owns it); the
  calendar's colour is a rule down the chip's leading edge. Putting both in one property loses
  whichever was written second.
- **A DAY IS A TIME AXIS CROSSED WITH A COLUMN PER CALENDAR.** "There should be a daily view,
  especially considering that a day with a lot of attorneys may have a lot of parallel scheduling."
  The month and the week put a civil DAY in a column; the day puts an HOUR in a row and a CALENDAR
  in a column, which is the only presentation that makes six attorneys in four places legible. A
  record on two calendars is drawn in BOTH their columns on purpose — a column that left a shared
  hearing out of one attorney's day would be lying about that attorney's afternoon.
- **Double-clicking an empty day or hour starts a record on it.** "When creating an event, you
  should be able to double click within the calendar to start the creation process." It is an
  ACCELERATOR and never the only path: the screen still carries the one create control every screen
  carries, which is what a keyboard and a touch device reach for. It never fires from a press on a
  chip — opening a record and making one beside it are different intentions.
- **A form that schedules something shows the day it is scheduling.** "When you select a day for
  scheduling, on the right side of the modal, you should see that day's calendar so you can identify
  when people will have availability." It is the panel's own context pane, and what stands in it is
  the product's ONE calendar with a day view and no toolbar — never a second rendering of one. It
  follows the date field, and says so before a date is chosen rather than showing today as if that
  were an answer.
- **"Where" is Location, and it is the product's dropdown-with-add.** "Where should be location, and
  this should be a dropdown." The label is the plain word for what the field holds, and the control
  offers what the firm already knows about its own places — its offices and its rooms, under
  headings — while still keeping a courthouse nobody has a record of. A closed list here would
  refuse most of the hearings a litigation firm records.
- **Where a setting is JOINED is a different field from where it is HELD.** "Some events may be
  online, so it may benefit to have the ability to have a zoom link or some other e-conference
  link." A deposition can be in a conference room and on a call at once, and a firm that typed the
  link where the room goes has lost the room. Held as a URL and never as a provider and a room
  number: every service expresses a meeting as a link, and a schema naming providers is a list this
  repository would maintain on somebody else's release schedule.
- **A time of day is a time field, and its zone sits beside it as a SHORTCODE.** "Start and end time
  need to be time fields. Time zones should go by shortcode like PST and should be little dropdowns
  next to the time." One moment is one line: the day, the hour, and the zone that hour is read in
  sit side by side. The abbreviation is worked out ON THE RECORD'S OWN DAY, because the same zone is
  PST in January and PDT in July — and nothing is ever stored from it, because CST is three
  different zones. A record has ONE zone, so the ends line STATES the same code rather than offering
  a second control that could only ever disagree with the first.
- **A record that belongs to no case is not refused, it is a different record.** "Remove 'A matter
  is needed.' from the bottom, matter is not needed." The event form no longer stands refused until
  a matter is picked; no matter is a CHOICE whose row says what it writes, and the form writes a
  firm event instead. That is the shape the data already had — `matter_event` requires its matter
  because every read of it is "what happened on this case", and `firm_event` is the table for
  everything else — so one question decides which record is written rather than a reader having to
  know which of two menu items to have started from.
- **A grid that is empty says so by being empty.** "Remove 'Nothing recorded in September 2026' on
  main calendar screen, doesn't seem very helpful." A month, a week and a day all draw their days
  whether or not anything is on them, so a reader looking at thirty empty squares has already been
  told, and a line above them spends a sentence on a fact they can see. A LIST is the exception and
  keeps its sentence: an empty agenda is a blank rectangle, which reads as something that failed to
  load rather than as a fortnight with nothing in it.

### 2026-09-09 — the front door asks less, and confirming is the way in

The owner walked the deployed sign-in surface and issued eight corrections in one pass. Six are
wording and shape; two change what the flow actually does. What binds:

- **The persistent-session control reads "Remember Me."** Supersedes the 2026-08-07 wording, which
  spent a full line of the card explaining a tick box everybody already understands. The
  second-factor trust control is untouched — the two are still separate dials.
- **A back control names its destination, never "Back to …".** Promoted into _Copy_ / _Controls_
  above, with the corollary the same round produced: the full-stop screen (Check Your Email) and the
  screen reached cold from a mailbox (the confirmation-code entry) both take the panel's own back
  control at the top of the card, not a full-width button at the foot and not nothing at all.
- **Registration asks for an address and a password, and nothing else.** A first and last name are a
  PROFILE, and a profile is something an account has rather than something it needs in order to
  exist. Generalizes: a form that stands between a person and the thing they came for asks only for
  what the thing cannot be made without. The account files the address as its display name until
  somebody replaces it — a visible placeholder, never a guess split out of the address.
- **A password being SET is typed twice.** This reverses the single-field-with-a-reveal ruling that
  the registration and reset screens were built on. The reveal stays; what the reasoning missed is
  that a reveal must be thought of and pressed, while the cost of a password mistyped identically
  twice is a mail round trip before a first sign-in. The mismatch is said under the second field as
  soon as there is something in it to disagree with, and the submit stays shut until they match.
- **Confirming a registration signs the person in.** The token only ever travelled by email, so
  spending it proves the mailbox — the same proof a mailed sign-in link rests on, and a stronger one
  than the password the very next screen would otherwise ask for. Generalizes: never ask for a
  weaker proof immediately after accepting a stronger one. The "Your Account Is Ready → Sign In"
  screen survives only as the fallback for a session that could not be minted.
- **A screen with one field and one button does not narrate itself.** Reset Password lost the line
  under its heading; its button now reads "Reset Password" rather than "Email Me a Reset Link",
  which is the same sentence the heading already says.
- **Do not greet somebody who arrived a second ago.** The welcome screen's "Signed in as X. One
  thing left: tell us where you work." read the account's name back and then restated the screen's
  own purpose, above two buttons that already say what the choice is. It is gone.

### 2026-09-08 — the call log, third round: one window, a typed length, and a number every call has

The owner's third round on the deployed Messaging screen. Their list, worked end to end:
double-clicking a row should open the same window that records one; a length that can be typed and
need not match the clock; the provenance tab as History on the right; an intake startable from the
form; one modal rather than two; the description beneath the other information the way a time entry
does it; an extension where a number runs past its country's length; and a number on every call,
visible before the record exists and carrying the date. What binds:

- **Two modals for one record is the defect, even when they share their fields.** Both are promoted
  into _Data entry_ under "A record is MADE in the same window it is read in", along with the rule
  that a record quoted out loud is identified before it is saved.
- **A typed length beside a computed span reverses last week's derived-value rule**, and the reversal
  is written into that rule rather than beside it. What generalizes is the question to ask first: do
  the two fields really answer the same question? An hour on the line and twenty minutes of call do
  not.
- **The description goes under the row, and the number goes in front of it.** Both promoted into
  _Lists and tables_.
- **Digits past the end of a number are an extension, not a formatting failure.** `AsYouType` stops
  formatting silently once the digits exceed what a country holds, so a direct dial typed onto the
  end of a number turned a grouped number into a run of digits under the cursor. The overflow rolls
  into an extension the shared phone field now owns — and the split is the longest prefix
  libphonenumber calls possible, not the country's digit count, because a North American number typed
  with its trunk 1 is eleven digits and perfectly valid. Generalizes to every as-you-type formatter:
  when input exceeds what the formatter can shape, the answer is to understand the excess, never to
  stop shaping. The Directory's contact rows had built their own extension input beside the shared
  field; that was the last half of that pair still built twice.
- **The number's date is the UTC day, and that is a deliberate trade rather than an oversight.** A
  reference number is a key before it is a sentence, so it must read the same in every office
  (`docs/conventions/dates.md`, "the UTC day, for a query key"). It can therefore name a different
  day from the record's own When for a call taken late in the evening west of Greenwich. The firm's
  own time zone is what would close that, and the platform does not have one yet; the record's When
  field stays the authority on the local day.
- **Local, and not promoted:** Save And Start An Intake records the call first and hands the saved row
  up. An intake with no account of the call that caused it is the thing the control exists to prevent,
  which is why it commits rather than carrying a draft across.

### 2026-09-08 — the New Check panel: two panes, names that say what they search, and one scrollbar

The owner, on the panel the previous round had just built: "conflict check ui, scrollbar needs to use
common scrollbar component… conflict check should be a two-column modal… a conflict check does not
need to check against a matter, the whole point is to find the matters that are potential conflicts…
what is difference between preliminary and comprehensive conflict check? not sure why we would have
both… what do party, graph, imputation, and content search? what does strictness search for? we need
more modular control, rather than these one off buttons. that is where the left and right side would
work well. left would be general information, right would be advanced and technical settings. left
side is the input. right side is the 'engine' settings… overall, you have so many settings and i
don't know what half of them mean, meaning we need better naming." What binds:

- **Every scroll region wears the design system's scrollbar** — a rule that already stood under
  _Lists and tables_ for tables, now widened there to every region and made mechanical by
  `pnpm run lint:scrollbar`. This was not a conflicts defect: `.mc-modal-frame-pane` scrolls in CSS
  and named no recipe, so every `ActionDialog` in the product had it, and so did `Dialog`,
  `AlertDialog`, `Sheet` and `RecordWindow`.
- **A settings-heavy panel splits along "what I am asking" and "how the engine answers".** The left
  pane takes the fields a member fills in every time; the context pane takes the machinery. One
  column had put the parties and a bank of hop budgets on the same footing, which is how a form comes
  to read as a control panel for something nobody can name. Generalizes to any act whose scope is
  configurable, and is promoted into _Controls and patterns_ above.
- **A control that tunes something invisible carries its sentence in place, not on hover.** A hover
  title does not exist on a touch device and a screen reader reaches it only by asking. Every setting
  on the right pane says what it searches, under it, in the reader's words. Promoted.
- **A form whose result is invisible reads back what it will do.** The left pane ends in sentences
  composed from the very values the request is composed from, so it can never describe a search other
  than the one that runs. It is the only honest answer to "what does this setting do" for an engine
  nobody can watch. Promoted into _Data entry_ above.
- **Do not ask a member to classify their own act when the record already knows.** Preliminary and
  comprehensive name WHEN a check ran, not how it searched. The panel derives it — a check filed
  against a matter the firm has taken on is comprehensive, every other check is preliminary — and
  states which. Generalizes: a field with a wrong answer and no way to tell you that you gave it does
  not belong on a form.
- **Name the thing, not the dial.** `Strictness` became **Name matching**, because what the dial
  moves is how many ways a name may be written and still count. `Party`/`Graph`/`Imputation`/
  `Content` became **Name or identifier**, **Relationship**, **The firm's own people** and
  **Documents and messages**; `Control` and `Family` became **Ownership and control** and **Family
  and personal**; `Closure cap` and `Candidate cap` became **Related parties to reach** and
  **Candidates to record**. The stored values did not move — only the words a reader sees, and they
  moved everywhere at once because one vocabulary map serves the form, the log's columns, the
  settings screen and the printed report.
- **Sound-alike matching is named out loud.** It ran in both bands and was mentioned nowhere, which
  is why the owner asked for it as a new feature. A capability that is not on the screen does not
  exist.
- **A default a field will take is the field's placeholder, never a footnote.** The panel's closing
  block — "An empty field takes the firm's own setting. Firm floor · Party · Balanced · Defaults
  depth 1 · closure cap 500 · candidate cap 5000" — was four facts in a shorthand that required
  having built the engine. Each field now shows the firm's own number inside its own box. Promoted
  into _Data entry_ above.
- **A panel does not explain its own subject in its subtitle.** "A conflicts check searches the
  firm's own record and writes what it searched into the log. It is not a verdict…" was removed on
  the owner's instruction, and so was the refusal that lectured — "A check searches for the parties
  it is given. Name at least one." now reads "Name at least one party." A refusal states what to do,
  in as few words as that takes.
- **A matter is where a check is filed, not what it is checked against.** The field is optional in
  what it says as well as in what it accepts, because finding the matters that might conflict is the
  point of running one.

### 2026-09-08 — the tasks screen: the closed work moves to the foot

The owner, on the tasks screen: "remove the done and cancelled boxes. this should be handled in the
lower area, make sure that the search and new icons are in the same place as they would be on other
screen." What binds:

- **The Done and Cancelled boxes are gone from the row above the list.** What is closed is asked for
  below the rows, by two controls that name the act and then name its undo. Generalizes, and is
  promoted into _List screens_ above: a control that widens a list does not sit in the row that
  narrows it.
- **A screen with a masthead seats its search and its create control in the masthead's action
  row**, at the position every other main screen keeps them, rather than in a second row the
  content below draws for itself. Tasks was drawing its own band under the header because the list
  component owned the controls; the component now hands them to its host to seat, so a matter's
  Tasks section — which has no masthead of its own — still draws the row under its heading. This is
  the placement half of the standing compact-action-row rule, and where a shared component is
  involved the placement is the HOST's decision, never the component's.

### 2026-09-08 — the Directory: the index's columns, and the record panel

The owner, on the directory page and the panel a person is recorded and read in: "we need to
increase the number of columns we can show. get rid of the out of table filters button, as that
functionality is handled within the table. allow for saving an individual without a last name, some
people don't have a last name, save with a warning though. prefix and suffix should use common
component we already use for that elsewhere in the application. allow for multiple suffixes. rename
given to First Name. Middle Name. Last Name. contact should not have contacts within a box, that is
weird. we don't have any way to edit contact information once set besides deleting it. identifiers
also have this box format which i don't like. these identifiers also are all in one line and scroll
off the right side. address format should reflect the country identified, since they all can be
different. look at making a common component. address should be in the left side of the modal,
separate from contact. when changing left sidebar sections, don't change size of the modal. modal
should always be the same size, which may depend on the size of the screen of course." What binds:

- **A list offers more columns than it shows.** The directory carried three; it now declares twelve
  and starts with six, the rest reachable from the header menu's Columns submenu. Generalizes, and
  is promoted into _Lists and tables_.
- **A screen adds no filter control of its own.** The filter popover above the table narrowed to
  people or organizations, which the Kind column's own set filter already did. The standing rule
  that filtering belongs to the columns was already recorded (_Data entry_, from the matter activity
  round); what this round adds is that the rule also refuses a control that merely DUPLICATES a
  column's filter, not only one that invents a narrowing the columns cannot express.
- **A person needs a name, not two names.** Recording refused without a family name; a mononym is the
  ordinary form of a name in much of the world. It records with the missing last name stated as a
  warning above the commit. Generalizes, and is promoted into _Data entry_.
- **A closed-but-growable vocabulary is the product's dropdown-with-add, never a text box.** The
  prefix and the suffix were free-text, which is how one firm's file held "Mr", "Mr." and "mr.".
  Generalizes, and is promoted into _Data entry_.
- **A field holds as many values as the fact has.** A person is "Jr." and "Esq." at once, and a
  suffix field that held one lost the other. Promoted into _Data entry_.
- **A field's label is the word the reader uses.** Given and Family became First Name and Last Name.
  The plain-word rule was already standing; this is it applied.
- **An entry row is the last row of its list, not a panel beneath it.** Contact and Identifiers each
  drew a bordered, raised box around their add row, so each section read as a list and a form.
  Generalizes, and is promoted into _Data entry_.
- **A recorded value is corrected, not deleted and retyped.** Promoted into _Data entry_.
- **A row of fields wraps; it never scrolls sideways inside a panel.** The identifier entry row put
  five controls on one grid line and ran off the right edge of a panel that does not scroll
  sideways. Promoted into _Layout_.
- **An address is a form whose shape is the country's, and it is its own section.** It was a fourth
  choice in the Contact section's kind dropdown — one option that grew a whole form beneath it
  beside three that did not. Promoted into _Data entry_.
- **A panel with a side rail holds one size.** Promoted into _Layout_.

Local to this surface, and not promoted:

- The index's contact columns are the record's DEFAULT row per channel — one email, one number, one
  place — and never a contact register. A sealed identifier is never a column: reading one is a
  permission-gated, audited decrypt, and a page of fifty rows cannot ask that.
- The name parts start hidden and the assembled name leads, because the assembled name is what a
  book of names is read by; the parts exist so it can be SORTED by surname, which the assembled name
  cannot do.
- The address form's country field, and the address section's Use and Type, are comboboxes rather
  than selects — the ruling from the call-log round the same day, applied to the code this round
  wrote. The country field is the case that ruling names: two hundred rows in a select is a list
  nobody can use. The prefix and suffix fields are NOT that control: `ChoicePicker` is for a set the
  firm cannot add to, and those two are open by design, so they are the Combobox with the add row —
  which is `apps/web/src/lib/names/honorific-field.svelte`, built for the settings round on the same
  day and used here rather than copied.

### 2026-09-08 — Record Communication: two columns, typed choices, and a number that can be shortened

The owner's second round on the messaging form, from the deployed screen. Their list, worked end to
end: flags and typing in the country control, a number field consolidated with the one that already
existed, start and end times, type and direction typable, the number's ghost text showing its shape,
a zip that could not be backspaced, "Length in minutes" renamed to Duration and worked out from the
times, no reflow when the type changes, "Belongs to" searchable against matters, no grab corner on
the description, the helper line struck, the panel renamed, the New button beside the contact
removed, and the whole form segmented into two columns. What binds:

- **The quantitative and the qualitative are two columns.** Everything measurable about the call is
  on the left and what was said fills the right, because they are different kinds of answer written
  at different moments — the left is transcribed from the phone in seconds, the right is composed.
  It also leaves the right side room to become tabs (the message, a transcript, the recording), which
  is where the surface goes once the carrier is connected. Promoted into _Data entry_ as the
  combobox, no-reflow, derived-value and one-question rules above.
- **The panel keeps one name.** Record Communication, whichever type is chosen. A heading that
  renamed itself as somebody switched the type is a panel changing identity under the hand filling it
  in, and the sentence beneath it ("nothing is sent from here") explained the subsystem to a reader
  who had already decided to write a call down. Generalizes: a panel is named for the act, not for
  the variant of the act.
- **The defect behind "I cannot backspace unless I re-enter it" was the formatter, not the field.**
  A number regrouped on every keystroke cannot be fed its own output blindly: backspace over a
  bracket or a space deletes a character the formatter immediately puts back, so the key does
  nothing at all and the field reads as broken. A deletion that removes no digit removes the last
  digit instead. Generalizes to every as-you-type formatter the product grows. (The ruling said
  "zip"; the only field on this panel that formats as it is typed is the number, and the address's
  postal field has no formatter and could not reproduce it. If a postal code really was the field,
  it is still to be found.)
- **Two hand-built copies of one field is where they drift.** The country-and-number pair existed in
  the Directory's contact rows and in the call log, and the backspace defect was in both. It is now
  one field used by both. The design system's own component list has had a `PhoneInput` planned since
  2026-06-13; this is that field, built where the phone knowledge already lives (the app) rather than
  in a package that would have to learn about countries.
- **Flags are files, not characters.** The regional-indicator pairs are emoji — banned by golden rule
  2 — and Windows ships no font for them, so the owner's own machine would draw two boxed letters
  where every other machine drew a flag. They are vendored SVGs served as static assets, fetched only
  for the rows a reader looks at. Generalizes: a glyph the product cannot draw on the owner's machine
  is not a glyph the product uses.

### 2026-09-08 — the Conflicts Check screen: the log is the screen, the check is a panel

The owner: "conflicts check needs some work. when accessing the conflicts check screen, it should be
a history screen with a new conflict check button at the top right. when you click the button, you
get a modal to go through doing a conflicts check." What binds:

- **A destination whose subject is a RECORD opens on the record, not on the form that makes one.**
  `/conflicts` opened on the composer — a matter picker, then parties, sources, band, three edge
  budgets and two caps — with the firm's own log of what it had run below all of it. The form is used
  on a fraction of visits; the log is what the screen is for. Generalizes, and is promoted into
  _List screens_ above: where a surface both holds a record and offers the act that writes one, the
  record is the screen and the act is the create control over it.
- **The act is asked for in the one panel the product asks acts in.** New Check is a `CreateControl`
  at the end of the header's action row and opens an `ActionDialog`; it does not scroll the reader to
  a form, which is what the matter's own section did with the same words on the same control. One
  gesture, one panel, from both doors.
- **One form, two doors.** Opened from the firm's log the panel asks which matter; opened from a
  matter it states the matter and asks nothing about it. The fields are one component either way — a
  surface that carried its own copy of the composer is how the two came to differ in the first place.

### 2026-09-08 — the Upload panel, eighteenth file-manager round

The owner, having watched an upload fail and read the Worker log for it: "having issues uploading
files. not sure what document type dropdown will help for. the +new file and + New folder should be
one click, on button, that handles both functionalities. hashing of files should start before
upload, while they are waiting for the upload to commence… the upload bar should be fixed in width,
so that variable length of text for uploading size can be accounted for"; then "table functionality
in upload modal should have full functionality of main table component, with sorting and filtering";
then "rename on arrival to Advanced Settings. make it a carrot menu so it isn't always open, since
it may be default behaviours. consider other advanced settings"; then "when uploading a folder,
don't force dialog through the broswer to confirm multifile upload". Asked whether a batch-wide
document type should go or stay, the ruling was to remove it "unless you can find way to associate
different document types to different files at the same time". What binds:

- **One control, one press, for the common ask.** A control whose every use begins with opening a
  menu is a control that costs two gestures to do the one thing it is for. Add opens the file
  picker; the second ask rides a chevron ON the same control rather than as a peer item in a menu
  above it. Where a browser genuinely cannot merge two asks — no engine offers a picker that takes
  files and folders together — the split is stated as the browser's limit, not designed around as
  though it were a choice, and the gesture that HAS no such limit (the drop, which takes any mix) is
  named where the reader is looking.
- **A classification is a fact about a file, never about a batch.** One type for everything in an
  upload is wrong about every folder a firm actually keeps: discovery holds correspondence,
  pleadings and exhibits together, and a batch-wide control makes the reader upload three times to
  say so. It is a COLUMN on the source table, set on the rows selected — which is also why it needed
  no new mechanism: the table already selects, sorts and filters.
- **A section of defaults folds shut.** "On Arrival" stood permanently open asking two questions
  whose answers nearly every reader accepts. Renamed **Advanced Settings** and collapsed, so it is
  reached when there is a reason and costs nothing when there is not. What belongs inside it is
  anything with a right default: how a file is dated, and whether the firm is asked if it already
  holds the bytes.
- **Work that can start early starts early.** The digest that lets the firm answer "we already hold
  this" was read when a file's upload lane reached it, so three lanes each stalled on a read with
  the connection idle. It is read from the moment the file is CHOSEN — the panel is open, nothing is
  moving, and the read costs the reader nothing they can feel. Generalizes: where a preparatory step
  is independent of the act, it belongs at the choice, not at the act.
- **A figure that changes length gets fixed room; the thing beside it holds still.** The pace line
  reads "1.2 GB of 4.5 GB · 2.4 MB/s · about 20 min left" and every figure in it grows and shrinks
  as the transfer runs, which resized the progress bar several times a second. The measure is a
  token, the way the create control's width is, and the bar is what does not move.
- **A second browser dialog over ours is a defect, not a browser fact to accept.** An `<input
  webkitdirectory>` makes Chrome ask "Upload N files to this site?" about a folder the reader has
  just chosen, in a dialog we neither control nor word. The File System Access pickers raise no such
  confirmation and are used wherever the engine has them.
- **A failure states WHERE the fault is, not only that there was one.** The byte write is the one
  step that does not go through the app's own host, so its refusal reaches no log and the browser
  reports it as silence. "Nothing answered" sent readers to check their own connection for a fault
  on the storage's side; the line now says it is the storage that did not answer, that nothing was
  saved, and that an administrator is who puts it right. The log signature that identifies it — a
  201 reservation, no part calls, an abort seven to nine seconds later — is in the operations
  runbook, where the next person reading a log will be.

### 2026-09-07 — the sidebar's foot: the transfer registers join Settings and Customize

The owner, on where Downloads lives: "I want to move access to the full downloads section from the
left sidebar down to the area next to customize and settings. we can have access to uploads and
downloads there. since they may both be working concurrently, and are more so meta about app
behaviour rather than relating to items in the applicaiton. we will still keep the items in the top
right header, as those are summary sections with quick actions, while these areas will be the larger
ones." What binds:

- **Downloads and Uploads leave the Workspace group and become footer fixtures**, beside Settings
  and Customize, in the registry's own `footerPinned` tier — so the scrolling groups and Customize
  mode never carry them and each row keeps exactly one home.
- **The tray has two ends.** The owner, on seeing the first arrangement: "move the downloads and
  uploads to the right side of the customize button. lean those to the right side, so the left side
  is settings and the right side is the uploads and downloads." So the rail's own controls lead —
  Settings, then Customize — and the registers lean to the far end. Settings still leads the row
  outright, because it is the one icon the collapsed rail keeps.
- **The two levels stay distinct.** The top-bar trays are summaries with quick actions; the footer
  icons open the full surfaces. Neither replaces the other.

### 2026-09-06 — the calendar's create control, the header's hovers, the custody rail

Three corrections from one walk of the deployed app; all three generalize and are promoted above.

- The firm calendar's primary action was a hand-built dropdown reading "Record" — the one create
  control the product has, re-implemented under a different verb. It is `CreateControl` now, reading
  the bare "New" over "New Event", "New Deadline", "New Firm Event". The matter's own calendar
  section had the same mislabel from the other direction: it read "New Event" over a menu that also
  records a deadline. The gate that refuses a rival create button did not cover the calendar's
  routes, which is why the hand-built one survived; it does now.
- Each kind wears the glyph it already wears wherever it is named — event a calendar, deadline a
  clock, firm event a building — rather than a second choice made per menu.
- The custody register's location rail is gone; Location was already a set-filtered column.
- The owner then extended the label rule to every menu-bearing create control rather than the
  calendar alone, which is why Files and the directory move with it.

### 2026-09-06 — the file manager, seventeenth round

Five corrections against the deployed file manager. The generalizable parts are promoted above — the
document base, and the rule that a submenu holds what it is named after; what is local to this
surface is in [`file-manager-rulings.md`](file-manager-rulings.md) (round seventeen).

### 2026-09-06 — the matter lifecycle: a hold beside active, and no number before active

The owner, the morning after the intake rung: "we should also add a HOLD status, for matters that
are not closed, but there are various issues relating to why they are no longer considered active,
like clients not paying bills. whats important is that no matter number is assigned until it
becomes an active matter." And: "status pillbox modal will need to allow changing into this hold
status as well." What binds:

- **A matter's statuses are Intake, Consultation, Active, On Hold and Closed**, stored as `intake`,
  `consultation`, `open`, `hold`, `closed`. On Hold is reached only from Active — "no longer
  active" presumes it was — and returns only to Active.
- **A hold keeps the number and draws nothing.** None is surrendered or re-drawn on either side of a
  pause. A held matter stays on the docket wearing its status; it is not an unnumbered rung and does
  not go to the Intake desk. _(The half of this ruling that said no number of any kind exists before
  a matter is active has since been reversed in full: the consultation sequence on 2026-08-31, the
  intake sequence on 2026-09-14. Every rung draws a number of its own now, on a run of its own.)_
- **A hold carries its reason, and the reason is required.** It is asked in a sentence, in place,
  beneath the step that records it, and printed beside the status wherever the status is read. A
  pause nobody can explain is not a pause anybody can resume.
- **The status window offers every step a status allows, never a picker.** Active offers Close
  Matter and Put On Hold; On Hold offers Release Hold and Close Matter. The first is the step the
  lifecycle runs toward, the second the pause or the exit. One permission, `matters:hold`, both
  ways: whoever may pause the firm's work may resume it.
- **A matter cannot be started on hold**, and the New Matter window says so in its own words, with
  no Soon mark, because nothing is coming: a hold pauses work, so there has to be work to pause.

### 2026-09-05 — the matter lifecycle: an intake rung before the consultation, and the word

The owner, walking the desk: "I don't think that intake should have a matter yet. Intake gets
something to prospective after it has graduated all the other requirements for intake. Intake is
like the walkthrough to get to prospective." Then: "perhaps prospective is the improper name, and
it should be consultation?" Then: "we have no matters to migrate, so store it as consultation and
open." What binds:

- **A matter's statuses are Intake, Consultation, Active and Closed**, in that order, stored as
  `intake`, `consultation`, `open`, `closed`. The word "prospective" is not a status word anywhere a
  reader sees it; it survives only where it means the client's standing under the conduct rules.
- **Intake is a rung, not a phase derived from a checklist.** The matter row exists from the first
  call (the conflicts corpus, the files, the calendar and every procedure reader need it) but it
  carries no number of any kind, it appears on the Intake desk and not the docket, and it
  graduates into a consultation by a recorded act.
- **The firm's intake procedure holds the door between intake and consultation**, never the door
  into opening. Completing the intake draws the consultation number; opening draws the matter
  number and is the firm's decision.
- **A control that takes a lifecycle step reads the step's own verb**: Complete Intake, Open
  Matter, Close Matter, Reopen Matter. Never "graduate", which is the code's word.

### 2026-09-05 — the intake desk, and New beside every person field

The owner described the receptionist's workflow: open Intake from the sidebar; choose the caller
from the directory or create them; collect what the intake requires and clear its criteria — the
conflicts check, the agreement out and back, the client's online forms, the payment, and whatever
else the firm requires; run several intakes at once and resume any; and, once one is complete,
schedule the consultation. And: "on this field and other places in the app where a user can select
a person, we need a way to create an entity from that location. A top level '+ New'." The
generalization is promoted under _Data entry_ above. What is local:

- **The desk is one table**, on the list archetype every register uses: search and the create
  control in the masthead, the columns' own filters, the consultation number anchoring the row.
  The standing reads as counts of the firm's own steps ("3 of 5 answered, 1 required
  outstanding"), never a word about the client.
- **New Intake is the New Matter window** in an intake purpose — status fixed at Prospective and
  not offered, Start Intake, no money block — not a second window for the same act.
- **Schedule stands on every row and is refused with the reason** until every required step is
  answered; it opens the calendar's own event window on the consultation with the client and the
  responsible attorney already on it.
- **The picker's New is a button for one kind and a menu for both**, in the field's row, at the
  small secondary size; the add rows in the list say which kind they will make when both are
  offered ("Add "Northwind Couriers" as an organization").

### 2026-09-05 — the directory record, from a screen to one window

Raised by the owner after walking from a matter's parties into a person: the person opened as a
screen in the directory, and the way back at the top of it led to the directory's list, not to the
matter just left. Three shapes were put up — an origin-aware way back, a window over the matter, a
breadcrumb trail — and the owner ruled for the window, then for the window as the record's only
surface. The generalization is promoted above; what is local to this surface:

- The window takes the New Person screen's arrangement, not the tabbed screen's: the owner
  preferred the side rail with the section beside it to a row of tabs across the top.
- The right pane shows what the host alone knows — on a matter, the roles this record holds there
  with the capacity beside each — above the record's own facts. The directory host adds nothing.
- The record's Names and Duplicates acts keep their own panels, which open over the window.
- The old record address redirects to the directory with the record's window open.

### 2026-09-05 — the money sections, one surface

The owner walked Time, Costs and Billing against Files: "time, costs, and billings all appear as
separate tables. It looks good, but I like how files looks more, where the features and the table
starts at the top, connected up there." Then: an alternative table view with the same functionality
for these screens, applied to Costs as well, and to Trust; and "streamline and get this closer a
central component that looks more or less the same for all money sub-parts."

What is local to these surfaces:

- **`MoneySurface` is the one frame.** Toolbar, notices band, list, the line above the footer, the
  counts strip with the pane toggle last — every money ledger hands the surface its columns, cells,
  figures, acts and panel and draws none of that itself. `LedgerPanes` stays underneath it as the
  two-pane geometry.
- **The toolbar leads with the money sub-parts.** A coins glyph, then Time · Fees · Costs · Billing
  · Trust as quiet links in the section strip's own register, the current one marked. The strip's
  Money group is what put them a menu away; this row puts them a click away and names the one the
  reader is on.
- **Clear Filters is the surface's, not the ledger's.** Four copies of one control became one,
  rendered while a filter is on, in the toolbar's trailing group ahead of a ledger's own acts
  (Costs' Review).
- **Load more sits directly above the counts strip**, on the line the file manager keeps for an
  archive's crumb, rather than beneath the footer where it was pushing the strip off the bottom.
- **Trust takes a real surface.** The ledger is built whole against the trust movement record —
  date, kind, method, reference, counterparty, purpose, in, out, who recorded it, who authorized it
  and on what footing — with Balance, Held and Available as its figures, on the same surface as the
  other four. It stands empty and says why: the matter's ledger is read against a trust account,
  and no route lists the firm's trust accounts yet. New Deposit is the header's control, disabled
  with that reason. The section stub is gone.

What generalizes, and is promoted above: the five money sections are one surface wearing the file
manager's frame; the framed look survives as one setting for all of them; and the amendment to the
row-above-a-table rule.

### 2026-09-02 — the matter search, first deployed round

Five corrections against the matter's consolidated search, the first time it was walked on the
deployed site. Four were plain defects and are fixed in the shared component rather than the one
screen, because ScreenSearch is every list screen's search and a divergence here would have been a
second search box with second behaviour. The generalizations are promoted above.

- An empty field did not close when clicked away from. The cause was deliberate and wrong: focus
  landing on the body was read as "focus went nowhere" and treated as staying. There is no such
  place from where a person sits.
- No X. Escape cleared the field and nothing said so.
- Enter did nothing at all.
- The full search page could not be reached without typing something first, because the panel that
  holds the way to it did not open until there was a query.
- Searching for a folder by name found nothing. Local to the matter search rather than general: the
  files source queried file names and joined the folder table only to LABEL which folder a file was
  in. Recorded here because the shape recurs — a table joined for display is easy to mistake for a
  table being searched.

Still open at the end of the round: where the scope filter sits. It spells out "Everything on this
matter" on the header line and takes most of the rail. Three placements were put to the owner (a
chip inside the field, the panel's header row, chips beneath the field); this entry gets the ruling
when it is issued.

### 2026-09-03 — the create control, moved up and made one component

The owner asked for the "+ New" button to move next to the search at the top of the matter screen,
as one modular control that reflects the screen it is on without reflowing — "New Fee", "New Cost",
"New File" — with the lower buttons removed; then, that the control be a main component that can go
into the matter list, the directory and anywhere something new is made; then, that the custody
register, which had the button and no search, carry the pair. The generalizations are promoted
above. What is local:

- **The label per section** is the registry's: Files → File, Time → Time, Fees → Fee, Costs → Cost,
  Billing → Bill, Notes → Note, Custodian → Packet, Parties → Party, Calendar → Event (disabled,
  waiting on the event and deadline forms, where the section used to draw two disabled buttons).
  Overview, Trust, Emails, Messaging and Magnus decline with a line; the bare "New" shows off a
  section (the results page).
- **Files' control is a menu** — New Document, New Folder, Upload Files — replacing the toolbar's
  New menu. The rail's New Folder and the folder-level right-click menu stay: gestures on a place,
  not a second button. The empty-folder state's two buttons are gone.
- **Parties' control opens the tab's own add row**, the one its inline Add… opens; the tab is a
  shared component and keeps that gesture.
- **The Directory's control reads the bare "New"** and opens its person-or-organization menu; the
  "New person" empty-state button is gone.
- **The width is a token, 136px**, sized to "New Packet" with the glyph, the chevron and the
  button's padding; the noun budget is seven characters. _(Re-measured on 2026-09-18: 140px and
  eight characters, so "New Template" fits. The token is the fact; these numbers are what it held
  then.)_
- **The registry's declared slug is checked against the address**: a page claiming the control for
  a section it is not on is refused loudly, as is a second claimant on one screen.

### 2026-09-03 — the Time tab, second round

The owner walked the time record window, the sheet and the cost window together. Most of what came
back was about fields explaining themselves instead of working: two paragraphs apologising that a
firm has no codes turned on, a badge repeating the word already in a label, a rate that could be
read and not set, and one duration field where a firm thinks in three.

What is local to these surfaces:

- **A time entry's rate is a field.** The rate chain has always ranked a per-entry override first
  and capture has always accepted one; the record window now offers it, and the update route carries
  it, so an entry captured at the wrong rate is corrected rather than voided and typed again.
- **A duration can be stated three ways** — in hours, in the firm's own billing units, or as the two
  clock times the work happened between. All three are live at once and each is a view of the same
  minutes; which of them are ON SCREEN is the reader's own setting, in the window's menu, and the
  last one standing cannot be turned off.
- **A void can be undone.** `POST /time-entries/{id}/unvoid` returns the entry to draft with its
  number, its memo, its codes, its documents and its history. It refuses the one void that must
  stay one: an entry whose value was moved onto a cost record, where restoring the time would charge
  the same work twice. It restores to DRAFT and never to submitted or approved — those were
  somebody's judgement about an entry that has since been withdrawn.
- **The vocabulary is void, never strike.** One word for the act, across the history rail, the
  sheet, the ledger and the record window.
- **The Billing dropdown lost "No charge, on the bill at nothing"** — it is non-billable under a
  longer name, and two rows for one disposition make a reader choose between them with no right
  answer.
- **The cost window commits with "Save & Close"**, as the time window does.

What generalizes, and is promoted above.

### 2026-09-02 — the matter Activity section, fourth review round (from scratch)

The owner rejected the third round outright — a file's kind read as `txt`, `zip`, `bin` when "we
have a whole file manager that has the file read functionality" — and asked for the section to be
reviewed line by line and rebuilt as a consolidation that respects the modular seams of the parts
it consolidates, naming where those parts are not modular enough. The review and the plan are the
design artifact of that day; what it changed is recorded here.

- **A consolidation view names nothing itself.** Every word on an Activity row — the section, the
  type, the glyph, the facts, how it opens, how one is made — is declared by the subsystem that owns
  the row, in an `ActivityContribution` beside that subsystem's own web code, and the server half is
  a `describe` on that subsystem's own timeline source. The two central files that had decided all
  of it in `$lib/matters` are gone. Promoted above as a standing rule.
- **A file's type is what the file manager identifies it as.** The document type where the firm set
  one, else the label of the identification the design-system `FileIcon` resolves from the content
  type and the name — "PDF document", "Archive" — composed once in
  `$lib/file-manager/file-identity.ts` with the size and the safety standing out of the status
  register, and drawn with the file manager's own glyph. Never a name suffix.
- **Section and Type are two columns.** Which part of the matter a row belongs to (a closed
  vocabulary the registry declares, so the filter offers every section) and what the row IS in its
  own subsystem's words. One column doing both had mixed "Deadline" with "pdf" in one filter list.
- **The description is server-side and by identity.** The first cut read each subsystem's first
  page on the client and joined by row id, so a document older than that page silently had no name.
  The rebuilt read names the rows on the page, one statement per source present on it, behind each
  source's own read capability: a member without `notes:read` sees that a note was written and not
  what it said. The firm-wide read is never described.
- **The screen can make a record.** "+ New Note" opens the note window on the Activity section; a
  subsystem with a window of its own adds a verb and the control becomes a menu.

### 2026-09-02 — the matter Activity section, first review round

The owner opened the new Activity section and reported that it lacked useful information, that
uploading a file is not filing one, and that it needed a way to filter. The vocabulary ruling is
promoted above; it binds everywhere. What is local to this surface:

- **A row leads with what the thing is CALLED, where its own subsystem can name it.** The screen
  reads the owning subsystem's own access-gated read for the rows on the page — the same read a
  person could make by opening that section themselves — so a document row leads with the file name,
  its size, its version and whether it is quarantined, and a note row leads with its opening line.
  The federated read still projects none of that: it spans matters, and a note's first eight words on
  a firm-wide read is the disclosure the label discipline exists to prevent. Enriching at the client,
  for one matter somebody is already standing inside, is following the deep link eagerly rather than
  loosening anything.
- **The kind drops to one quiet word once the name leads.** "A document was added to the matter" on
  forty rows is forty repetitions of what the glyph already said. The whole sentence survives as the
  primary text of a row whose subsystem has no name to offer, because there it carries the row.
- **The filter starts at All, and All is a pressed control rather than an absence.** Any number of
  bands can be on at once. Beside them: Any time / Past / Upcoming, and a From and To date. Every one
  of them narrows the READ — the source keys and bounds travel with the request and the server
  narrows its registry before it builds a statement — so a filtered chronology is cheaper as well as
  shorter, and Clear Filters appears only while something is hidden.

### 2026-09-02 — the matter Activity section, third review round

Three corrections, all promoted above except what is local:

- **A document row's Kind is what the file manager says the file IS**, not the word "Document",
  which told a reader nothing the glyph had not. The first pass took a name suffix for that and was
  corrected the same day: the file manager identifies a file from its content type and its name
  through the design-system `FileIcon` vocabulary, grades its safety, and knows its document type,
  and Activity shows that identification rather than a suffix. A subsystem may refine any row's
  kind, and the Kind filter picks the refinement up on its own.
- **There is no Columns button.** Choosing columns is a right-click on a column heading, through the
  shared grid's own head menu (`DataTable.GridHeadMenu`), which every register now carries. The
  branch had first built a second menu over the whole register for the same gesture; `main` landed
  the head menu in the meantime and the duplicate was removed rather than merged — two menus over
  one region would race for the same right-click, and the ruling that a column's controls are
  summoned from the column is promoted above.

### 2026-09-02 — the matter Activity section, second review round

The owner rejected the hand-built chronology outright: it should be the same table as every other
register, filtering belongs in it, and withholding content from a signed-in member "is stupid and
helps no one". All three are promoted above. What is local to this surface:

- The register is `DataTable.Grid` with six columns — Date (anchored, the chronology's own order),
  Time, Kind, What, Details, Who. Kind and Who carry set filters; Date carries its range.
- **The band chips are gone.** Kind's set filter declares the platform's whole vocabulary through
  `filterValues`, so a matter with no costs yet still offers "Cost" and does not tell a reader it can
  never have one.
- **Six of the fourteen sources now name their own rows** — documents, notes, time, costs, events,
  deadlines — each through one bounded read of its own subsystem's listing, joined on the row
  identity the timeline already carries. The remaining sources keep the platform's sentence, and
  adding one is a single loader.
- The What column's width claim is capped at 72 characters. The grid fits a column to its longest
  text, and one paragraph-long note would otherwise push Who off the screen for every other row; the
  cell truncates and the full text stays in its title, so the cap is on the column, never the record.

### 2026-09-02 — the four financial ledgers, chrome round

The owner walked Time, Fees, Costs and Billing together and reported that they did not agree with
each other or with Files: four different pane toggles, tables that grew down the page instead of
filling it, empty states running off the right, a grip handle in the middle of the screen, a
duplicate door to the Time Sheet, and the Fees verbs spread over two rows.

What is local to these surfaces:

- **The matter Time tab drops its Time Sheet button.** The sheet opens from the top bar on every
  screen, so a second door on one of them is a control that takes a reader where they already are.
- **The Fees toolbar is one row**: the arrangement's facts lead, then View, Amend, New Fee and the
  pane toggle. The verbs and the strip they act on are one line, not two.

What generalizes, and is promoted above:

- A working surface takes the rest of the screen and keeps it.
- A pane toggle is the quiet chrome affordance, never a bordered button, and it ends the row.
- A resizable divider carries no grip handle.
- A placeholder's content centres in the frame, not in the table.
- Controls sitting in one band wear one chrome.

### 2026-09-01 — the matter Notes section, first review round

The owner opened the Notes section on a real matter and reported that it never stopped loading, then
issued four corrections and, after the first pass, a fifth. Everything generalizable is promoted
above. What is local to this surface:

- The primary action reads **"+ New Note"**. It names the thing being made.
- Writing, reading, editing and deleting a note all happen in the shared record window, opened from
  the list. The list keeps the search and one row per note, and a row opens the note.
- The occurrence field is labelled **Date**, with **Time** on the same line beside it. The zone the
  wall-clock time is read in is stated beside them, and only once a time has been entered.
- A note's Attachments tab offers the matter's own documents and nothing else. Notes have no upload
  path, so the shared tab's dropzone is withheld rather than rendered inert.

**On the loading report, honestly:** it did not reproduce. The Notes section was driven end to end
against a real Worker — sign-in, an empty matter, a matter with notes, writing one through the
window, attaching a document — and the list settled every time
(`apps/web/e2e/matter-notes.spec.ts`), as does the route's empty-page envelope
(`apps/api-worker/test/notes-routes.test.ts`). What the rebuild changed is the shape that made a
permanent skeleton possible at all: the notes read is now an effect of its own, so nothing else the
screen wants can abort it before the read is asked for, and a failed read settles the list and
offers Retry instead of leaving the skeleton standing.

### 2026-09-01 — the matter status window

Six corrections against the window behind the matter's status seal, all from the owner. What is
local to this surface:

- The seal itself is the control. The lifecycle action left the masthead's overflow menu, which held
  nothing else and went with it: the status was read in one corner and changed in another.
- The requirements to close are not checkboxes. A checkbox asks a person to work through what the
  program already decides, so the window lists the requirements and the program marks each met or
  unmet from its own reading of the firm's rules.
- The word is **status**, not standing. The page is called Matter Status.
- Two sides, and the physical file is the right one. It is a standing fact rather than a consequence
  of closing: a firm keeps a matter's folder in a box, a cabinet, a safe or on a shelf, commonly with
  other matters' folders and commonly at a remote store, and closing the matter moves none of that.
  Nor may the row name a medium, because firms do not agree on one.
- The step does not sit at the foot of the window. Somebody may open this window to read where the
  paper file is kept, and a bottom-right primary button puts the act they did not come for where a
  hand goes by habit. The step is a quiet control on the status row, beside the fact it changes; the
  window's corner offers only the way out of it.
- The Soon rows carry no dependency sentence and no note about the close. A row reading "Not
  recorded" beside the Soon mark has already said it is not built; the paragraphs repeating it were
  the loudest copy on a window whose point is to be short. Recorded here rather than promoted: the
  standing Soon rule still holds for a CONTROL, where the sentence is the only thing that explains a
  disabled affordance.

### 2026-09-02 — the calendar

The first slice of the calendar interface shipped with the week starting on Sunday and the plan
naming "the week-starts-on preference" as a later, personal setting. The owner's ruling: the day the
week begins on is set by the FIRM. The generalizable rule is promoted above; what is local:

- **The setting lives at Settings › Practice › Calendar**, the first settings page with a server
  behind it (`GET`/`PATCH /api/v1/calendar/settings`), staged and saved through the same row and
  footer as every other draft page but never through local storage. A member without the calendar
  manage right sees the firm's answer engraved as a fact.
- **The page shows no history.** The other draft pages render a per-browser ledger; for a firm-wide
  fact that ledger would be one browser's recollection, silent about every change a colleague made.
  The record is the audit row the server writes with the change; the page shows history once a
  per-record audit read exists.

### 2026-09-01 — the matter screens, chrome-removal round

Two removals, one addition, and the strip regrouped. Both removals were issued the same way: the
owner looked at the shipped chrome and could not name what a part of it was for. The generalizations
are promoted above.

- **The header band's overflow (`...`) control is gone.** Its only item was the status's lifecycle
  action, disabled and marked Soon. Asked what it was buying, the honest answer was a control's
  width and one glyph a member has to press to discover there is nothing behind it. The lifecycle
  action returns as a named control on the row when it is wired, and the band now carries no
  actions at all: the inline-end column is the section strip and nothing else.
- **The Other section is gone from the registry and the route tree.** It was the only tab whose
  label described no place — it named everything the other thirteen did not cover, which is a bin
  rather than a destination, and its stub had to be written in the abstract because nothing concrete
  was ever going to live there first.
- **Magnus takes a matter section**, a `soon` stub for now. It stands alone on the row rather than
  joining a group, because the assistant is not one of the matter's records — it is the way to ask
  about them, and a member reaching for it is not reaching for a neighbourhood.
- **The strip is grouped.** The owner raised it against the flat strip and chose grouped menus over
  reordering and over nesting a Financials section. Seven top-level entries: **Overview · Files ·
  Money ⌄ · Parties · Calendar · Record ⌄ · Magnus**. Money is Time, Fees, Costs, Billing and
  Trust; Record is Notes, Emails, Messaging and Custodian. Overview leads because the bare matter
  address lands there, Files stands alone because it is the busiest destination and a click on
  nearly every visit is a real cost, and Magnus stands alone because it is not one of the matter's
  records but the way to ask about them.
- **Calendar is a top-level tab** — the owner's correction to the first build, which had it in a
  People group beside Parties. A matter's dates are checked too often to sit behind a menu, and the
  grouping was wrong on its own terms besides: Parties is people, a hearing date is not. Taking
  Calendar out left that group holding Parties alone, which the one-item rule above forbids, so
  Parties came up to the row with it and the group went away. The general lesson is promoted above:
  group only what a member can afford to reach through a menu.
- **The arrangement's order is also the fold order**, so the tail is what a member can most afford
  to reach through a menu — Magnus first (a stub), then Record (three of its four are stubs), then
  the dates and the people. Money stays on the row longest of the folding candidates because all
  five of its sections are live working surfaces.

  Measured after building: all seven hold the row at 1440, where the flat fourteen had already
  folded seven away. Below that the backstop fold takes over and entries fold as groups — at 1360
  Record and Magnus go, at 1024 four do. It is NOT true at every width that nothing is hidden. The
  band's even split leaves the strip about 384px at 1024; recovering that would mean reopening the
  even split (the identity block no longer needs half the band now the strip is bounded), which is
  a separate ruling and was deliberately not touched here. The owner accepted this on 2026-09-01.

### 2026-09-01 — the Custodian register

The owner opened the register and reported, first, that there was no way to put anything in it. That
was true: the whole `custody.*` write surface existed and the screen offered a disabled "Log a
packet" button with a Soon mark, so a firm could read a register it could not begin. The rest of the
round was the screen carrying more furniture than record.

What is local to this surface:

- **The three report tabs are gone, and the panels behind them with them.** By Owner, Holds and Due
  stood beside Register as though they were four destinations. Asked which of them were really the
  register narrowed, the owner's answer was that no firm they know uses holds or due dates yet, so
  all three come out rather than being folded in. The endpoints stay; the surfaces do not. The
  generalizable half is promoted above.
- **The status dropdown above the table is gone rather than renamed.** The correction as issued was
  "change standing to status" — but Status is already a column with its own set filter, so renaming
  it would have kept the second mechanism the matters docket round removed. Removed, per that rule.
- **The screen's own search box is gone.** A centralized search component is being built elsewhere
  and will reach this listing; the server-side `search` filter stays plumbed through the register
  component for it to use.
- **The masthead's "Originals the firm holds in safekeeping" is gone**, under the standing rule that
  a heading carries no explanatory sub-text, and so are the two paragraphs under the location tree
  and the standing paragraph under the matter's Custodian section, which said that closing a matter
  is never blocked by what the firm holds. That is true, and it is a fact about the close path, so
  it is stated where closing happens rather than on a screen that is not closing anything.
- **The primary action is "New".** The register creates one kind of thing, so it needs no menu.
- **"Out" now reads "On loan", after a first pass at "Checked out" was rejected.** The owner
  reported not knowing what Out meant, and listed the statuses they believed real: Held, Released,
  Destroyed, Lost. Out is real — it is what the ledger derives from a `checked_out` movement, it
  carries the borrower and the due-back date the overdue report is built from, and a checked-out
  packet has nowhere else to render — so it was relabelled rather than removed. "Checked out" did
  not survive contact: the owner's answer was that checked out and released are the same thing, and
  read as labels alone they are, since both only say the property is not on the shelf. The pair has
  to separate itself without a legend, so the state is "On loan" (the firm's to get back) against
  "Released" (the firm's custody has ended), and both hovers now state the ending or the return
  rather than only the handover. The ACT stays "Checked out" in the history, where it is read as a
  sentence about what somebody did. Promoted above.
- **The empty register was running off the right-hand edge**, and it was never this screen's defect:
  the grid's cells are `white-space: nowrap` for the sake of aligned columns, the placeholder cell
  inherited it, and a wordy empty state therefore widened the table past its own frame. Fixed in the
  shared table recipe, the same way the empty docket's hover band was.
- **An item needed a history of its own**, and the ledger had been recording one all along: rows
  carry an optional item, so withdrawing one instrument or superseding it was already written
  against the item rather than the envelope, and nothing could read them back at that scope. The
  read is the same ledger with one more filter rather than a second record. Two things had to be
  decided rather than assumed: an item's history INCLUDES the packet-wide rows, because an item goes
  wherever its packet goes and a history of only the rows naming it would show "Contents described"
  over a decade of moves; and each list marks whichever kind of row is the odd one out in it, so
  neither reads as the other. Each item in Contents opens onto its own rail, and opening is what
  reads the ledger.
- **Entry is three modals**, at the owner's direction, over the register's existing write endpoints:
  New Packet on the register and on a matter's section, Describe An Item and File A Copy inside the
  packet window, each on the tab it belongs to. The owner also raised a centralized modal framework;
  around thirty dialogs now compose `Dialog` by hand, so that is worth its own look and is not part
  of this round.

### 2026-09-01 — the matter chrome, identity-block round

With the section strip in the band, the owner asked what more the left side could give back. Six
settings were rendered and measured; the generalizable parts are promoted above. What was decided:

- **The identity block folds to two rows and the title steps down once.** The ledger line and the
  status seal lead the citation instead of holding a row above the title, and the title takes the
  Masthead recipe's new `compact` density (2rem to 1.5rem).
- **The overflow control moved onto the section strip's row.** This is the change that mattered:
  it is the only one that got the band under 90px, because it is the only one that touched the
  column actually setting the height. 111px became 76px — 152px before the strip moved at all.
- **A third density step was built, measured and dropped.** At 1.25rem the display face is close
  enough to the citation that the register's scale contrast nearly goes, and it bought nothing over
  the structural saving, so it is not in the variant.

### 2026-08-31 — the matter chrome, section-navigation round

The owner asked what could be done with the empty inline-end half of the matter masthead, which
carried one overflow control while the section strip spent a whole row of its own below. Four
arrangements were built from the shipping design system and measured against today's chrome; the
generalizable parts are promoted above. What was decided:

- **Arrangement B ships:** the actions on the title's row and the section strip beneath them, both
  packed to the inline end, in one band with one rule. Chosen because it "retains most of what we
  have" — the masthead keeps the serif title at masthead scale, the ledger line and the citation,
  and the strip keeps its comfortable density and the gold bar. 152px of chrome becomes 111px.
- **The section rail was rejected** for overstepping the main shell. Promoted above.
- **The Alpha pillboxes come off everywhere**, so the navigation reads as the firm's actual usage
  rather than as a build status. Promoted above.

Engineering that the round produced rather than the owner:

- The strip's fold arithmetic moved to `section-overflow.svelte.ts`, so the live nav and the
  candidates could not fold their tabs by two different rules. It stayed after the candidates went.
- An even split of the band was measured against a capped identity block, and both against a
  wrapping one. Wrapping cost 27px at a 1024 canvas — a net loss. Capping the identity block
  starved the strip to a single tab. The even split with a truncating title and a truncating
  citation is what holds 111px at every width, and it is why the citation is now one joined string:
  a flex row of separate entries cannot ellipsis, and truncating each entry to its share gives four
  stubs and no citation.

### 2026-08-31 — the Build Versions panel

Five corrections against the version overlay, all from the owner, all promoted above:

- The **"This page / committed … · built …"** line was deleted as duplicative of the
  `magna-carta-web` row. It survives only as the fallback for a panel nothing else can speak for:
  signed out, a failed read, or a silent web row.
- **"Services checked … ago"** moved off the header row and under the header. It grows and shrinks
  as the clock ticks, and on the header row that motion pushed the Refresh control around.
- The **Reload** control moved into the header beside Refresh and became a symbol (a warning-tinted
  `rotate-cw`, distinct from Refresh's `refresh-cw`). The Update Available block keeps the badge and
  the sentence and no longer carries a second copy of the gesture.
- The **Workers** beneath the leading pair fold behind a caret, and the fold is remembered per
  browser. It defaults to open, and a shut heading counts any worker that came back without a
  version, so the fold never turns the fleet list into a claim of health.
- **Copy feedback stopped being a check glyph** and became the control darkening for a second. The
  glyph widened the button on every press, which read as the identifier itself changing.

### 2026-08-31 — the Build Versions panel, second round

Two more corrections against the same panel, both promoted above:

- The fixed sentence explaining that `magna-carta-web` and `magna-carta` deploy separately and may
  report different builds was deleted. In its place, the leading pair carries a colour-coded sync
  badge — green **In sync**, amber **Web behind** (the one state that is actually actionable), or
  neutral **Different builds** for any other difference — shown only once both sides have reported a
  real commit to compare.
- The **"Services checked … ago"** / **"Checking services"** line is now mounted unconditionally
  whenever the panel can read the aggregate, with a non-breaking space when it has nothing to say.
  It used to appear and disappear as the read moved through in-flight, freshly-answered, and aged,
  resizing the popover under the reader each time.

### 2026-08-31 — WHOIS Lookup tool page, deployed-site review

The owner walked the WHOIS page on the deployed site while the Safe Website Viewer page was being
built. All three corrections generalized and are promoted above; both web-domains tool pages apply
them:

- The idle intro rendered as two stacked paragraphs, which read as a hard line break in one
  thought; it is one flowing paragraph now.
- The query form sat in the masthead's far-right actions slot; it moves to the left, below the
  masthead, at the content's reading edge.
- The intro text vanished the moment a search ran (it was gated on the idle state); it stays
  visible, with results rendering beneath it.

Follow-ups from the same round, all from the owner:

- **Info lines are deleted, everywhere, and stop being written.** Issued against the Safe Website
  Viewer's intro paragraph ("Paste a link you do not trust…"), with the note that this deletion has
  been issued repeatedly before. Promoted above as _No info lines_; it supersedes this round's
  "orienting text persists" ruling, which is why that bullet no longer appears in the standing
  list. Both web-domains pages lose their intro paragraphs and footers.

- **Alert-title casing: the owner has no preference**, so no ruling binds. The working choice on
  the web-domains pages is sentence case — an alert is a message, not a header, so "Headers are
  title case" is read as not reaching `Alert.Title`. The codebase is split (several list surfaces
  use title case); either is acceptable until the owner says otherwise, but one page must not mix
  the two.
- **The network speed test is not retrofitted.** Its run controls stay in the masthead where they
  are; the reading-edge rule above binds new and reworked surfaces, not a shipped page nobody is
  changing.

A third round the same day, issued against both pages on the deployed site. The generalizable
parts (the always-rendered result structure; visible bounded retries) are promoted above. Local to
the Safe Website Viewer: the URL entry moves into the shell's own address bar (one entry, "Load
Website"), with the landed URL as a secondary row when it differs; back/forward/refresh navigate a
client-side capture history; outbound links load in the viewer as new captures (buttons, never
anchors); the URL is click-to-copy; a Static/Live view toggle renders with Live seamed behind the
Soon affordance until interactive remote browsing exists; tab panels are boxed structures.

A fourth round the same day, against the viewer's shell-and-tabs build. Generalizable parts (link
formatting; the unmistakable toggle) promoted above. Local: the landed-URL row gets its own copy
control; the screenshot gains Download Image and a full-screen overlay; shell and tabs compose as
one unified frame rather than two cards; the loading viewport says what is happening (the URL
being captured, elapsed seconds, one honest status line — no fabricated server stages); a new
Overview tab leads the right side with facts already in hand (final status, content type, server,
redirect and link counts, captured-at, duration, the different-site flag) plus a Registration tab
that runs the WHOIS lookup in place for the captured host through the shared lookup seam — the
owner does not want a redirect to the WHOIS page; the information comes to the viewer. Facts that
would need new backend probes (resolved IP, TLS certificate details, hosting provider) are
recorded as wanted, not faked.

A fifth round the same day, from the owner's first real captures (YouTube shot mid-load, first
viewport only; the Registration lookup failed instantly). Mostly engineering, recorded here
because the corrections were issued in review: the renderer now waits for the page to finish
(networkidle plus a settle beat) and captures the FULL page; a WHOIS query for a hostname walks up
to the registrable domain that actually answers (www.youtube.com is a registry 404, youtube.com is
the record the member meant); the capture streams real stage lines (probing, then the settled
redirect chain while the render continues) so the loading viewport narrates facts rather than a
generic spinner-plus-elapsed. Screen-local: the tab strip matches the address bar's height so the
unified frame's top band is one continuous bar; the Different Site indicator lives ONLY on the
right side (the landed URL, its badge, and its copy control move into the Overview tab — the left
chrome stays clean); the Soon marker leaves the chrome entirely, surviving only on the Live
control's hover and accessible description; and the WHOIS page renders its result frame at rest
per the furniture rule.

A sixth round the same day. The "That address cannot be viewed" failures for youtube.com, google
and 8.8.8.8 were one defect wearing three names: the interface and the API deploy as separate
Workers since this morning, so the fresh page called the streaming route on an older API, the 404
fell through problem guidance's default input case, and the member's address was blamed for deploy
skew. Now: a 404 from our own API reads as "the service is mid-update", never an input fault; the
staged capture falls back to the non-streaming route when the streaming one is not deployed (the
member loses the narration, not the capture); and a bare single label ("google") is refused at the
field with the inline hint rather than spent on a round trip. Screen-local: the export menu's
format rows carry the same file symbols the file manager uses for those types, and Static/Live
join into one segmented control whose halves touch.

### 2026-08-30 — the matters screens, second round

Four of the five corrections in this round had been issued before and not carried out, which is the
reason this file exists. Recorded here so a third round is not needed. The generalizable parts are
promoted above; what is local to these surfaces:

- The scope control offering "The working docket / Open matters / Closed matters / Consultations" is
  gone. The docket reads the whole record and defaults to every matter. The listing endpoint's own
  default omits unnumbered consultations and its `status` parameter takes one status, so the screen
  merges two reads rather than keeping a control to reach the second one.
- The clearance section stopped being a fourth tab of the intake and became its right-hand side.
- The intake's tabs are "The Matter", "Client", "People" — what is entered. Assigning people means
  one responsible attorney plus any number of assigned attorneys and support staff.
- The empty docket's hover defect measured 292px of a 692px table frame — a grey band over the top
  42% of an otherwise white surface. The fix belongs to the shared table recipe, not to this screen.

### 2026-08-30 — the directory list

The owner opened the directory and reported that it was not listing people they had created. It was
not: the screen was built to be searched and not browsed, and its resting state was an instruction
to type three characters. The reasoning behind that had a real point in it — a ranked, capped answer
is not an index — but it drew the wrong conclusion, because the answer to "an index is a different
thing" is to build the index, not to withhold it. What is local to this surface:

- The directory lists BOTH kinds in one sequence. Kind is a column and a filter, never two screens.
- A record folded into another by a merge is not listed, though its names still answer a search and
  still resolve to the survivor: listing it beside its survivor shows one client as two.
- The three-character floor stays on the SEARCH, because the corpus matches three-character windows
  and a shorter query can match nothing at all. It is no longer a floor on seeing the directory.

The generalizable parts — the two shapes a record list comes in, and the compact action row that
replaced a button per entity kind — are promoted above.

### 2026-08-07 — auth flow, mockup revisions v4 through v18

The owner iterated the sign-in mockup through fifteen revisions. Most of what those revisions
decided was general, and is promoted above. The remainder that is specific to the auth surface:

- Federated sign-in buttons read "Login with Microsoft" / "Login with Google", capability-gated on a
  backend that is not built.
- The persistent-session control reads "Keep me signed in"; the second-factor trust control reads
  "Don't ask for 2-Factor on this device for 30 days" (with the number rendered from configuration,
  per the standing rule). **The first half is superseded by 2026-09-09** — the control now reads
  "Remember Me"; the second-factor wording is unchanged.
- The rate-limited response gets its own message rather than falling through to a generic failure.
- Recovery-screen copy follows the mockup revision, which is authoritative over anything earlier.

The mockup's `data-mc` annotations name their targets; when a mockup and this file disagree about a
detail on that surface, the mockup wins and this file gets the correction.

### 2026-09-03 — the fee arrangement lives behind the status seal

The owner, on the fee-arrangement window: "truthfully I don't like the fee arrangement window", then
"move this into the matter status, which can be reached from the matter status badge", and "remove
from fee screen".

- **The fee arrangement is a fact of the engagement, not of the ledger.** It is set when the matter
  opens, rarely read again, and rests on the intake agreement the client signed. It lives in the
  matter status window behind the seal, in an Engagement section beside the status, with its
  history folded away and Amend seated beside it the way the lifecycle step is seated beside the
  status.
- **The Fees screen states nothing about the arrangement.** No strip, no View, no Amend, no
  summary in the details panel. Fees are recorded against whatever the status window says.
- **An arrangement version names the signed agreement as a file**, picked from the matter's own
  files — the conflicts waiver's precedent — never as a sentence. Optional, because the paper may
  follow the deal.

### 2026-09-11 — the messaging log's tabs

The owner, on the messaging screen: "messaging screen has tabs that no other screen has, and
overlaps table functionality, remove 'Everything / Waiting to be filed (0) / On a matter / Not a
matter'".

- **The four scope tabs are removed.** No other list screen in the product narrows itself with a tab
  strip above its table, and what these tabs ask — filed, unfiled, set aside — is what the column
  filters already ask. _(built 2026-09-14: the tabs are gone, the Matter column's filter reaches the
  server, and "waiting to be filed" is a figure in the counts strip)_
- The screen's own comment argues the opposite and is what the correction overturns: "the tabs and
  the column filters answer different questions: the tab asks the server, the column filters run
  over what is loaded". That distinction is real and it is the thing to solve rather than to keep a
  tab strip for — a filter that narrows only the loaded page is a filter that lies on a paged
  register, and the answer is a column filter the server honours, on every register, not a second
  mechanism on one screen.
- The unfiled COUNT is not a tab, and losing the tabs must not lose it: "waiting to be filed" is
  work the firm owes, and it belongs wherever the screen states its figures. The staged money-screen
  round in [`time-tab-rulings.md`](time-tab-rulings.md) is the same correction on four other screens
  — a header control answering a question the table already answers — and the two should be built to
  one conclusion.

### 2026-09-11 — one component for the two-sided screen

The owner: "we need to make a consolidated component for when the main screen has two sides, a left
navigational menu (such as for magnus and settings), and a right content menu."

- **The two-sided screen is one design-system component**, `NavigationLayout`: a left navigation
  landmark and a right content column, each scrolling independently with a reserved gutter, taking
  the full height under the top bar and cancelling the work canvas inset itself. Two token-derived
  navigation widths, standard and narrow. _(status: open — being built in the design system in the
  same round as the floating-surface defaults)_
- The consumers it replaces: `apps/web/src/routes/(app)/settings/+layout.svelte`, which hand-rolls
  a `<nav>` at `calc(var(--mc-size-popover) + var(--mc-space-48))` inside a `-m-24` full-height row,
  and the Magnus workspace rail in `apps/web/src/lib/magnus/magnus-surface.svelte`, a `w-2xs`
  column — two widths and two scroll treatments for one shape. Settings adopts it first, Magnus
  second.
- **It reaches further than the two screens that have the shape today.** The owner, in the same
  breath: "this may also be implemented for tools, reports, and other potential screens". Tools
  (`apps/web/src/routes/(app)/tools/`, a landing page and one route per tool) and Reports (a
  register page and one route per report) are both one-list-then-one-thing screens with no
  navigation column at all, so adopting the component there is a redesign of the screen rather than
  a swap of its frame: the list of tools, or of reports, becomes the left navigation and the chosen
  one the right content. The file manager's folder tree beside its list is the other candidate.
  None of the three is in this round; each is a follow-up once the component exists.
  _(built 2026-09-14: Settings, Magnus, Tools and Reports all render on `NavigationLayout`; Tools
  and Reports share one catalogue column, with the landing index kept in the content column so a
  route's back control never bounces. The folder tree remains the follow-up.)_
- **The firm calendar's rail of calendars is the fifth consumer**, named by the owner on 2026-09-14
  ("calendar … has a permanent left sidebar, similar to what we have in tools and settings; let's
  try and get these components together"). It had been a `<nav>` at `w-3xs` with a scroll region and
  a gutter of its own beside the grid — a sixth width for the one shape. `CalendarView` now renders
  the layout where the rail stands, and the screen's masthead is handed DOWN into the content column
  (the Magnus arrangement) because the layout takes the full height under the top bar. The rail's
  rows stay CHECKBOX rows: `NavigationLayout.Row` renders its own anchor or button and a switch
  cannot be nested inside one, so what the columns share is the frame and the indent stagger — which
  is what "the layout imposes no structure on what the navigation holds" is for. _(built 2026-09-14)_
- **The row inside that column is `NavigationLayout.Row`, and a navigation row's name wraps rather
  than truncating.** The treatment had been written three times — the settings nav, the catalogue
  column, and inline in both. A row reading "Property Listin… Soon" has stopped naming the thing it
  offers, so the name takes a second line and the row grows to hold it. The wrap binds every
  navigation column, Settings included, and will bind the folder tree. _(built 2026-09-14. The name
  has about thirteen characters a line at the `standard` measure: the column's content box is
  `size.popover` at every width, so a wider gutter cannot buy the name room — only a third row
  measure would, which is the owner's to settle if the wrapping reads cramped.)_

### 2026-09-14 — the calendar's left column, and four corrections on its surface

The owner, on the firm calendar: "calendar is starting to look really good. it has a permanent left
sidebar, similar to what we have in tools and settings. let's try and get these components
together." Then, in the same round: "remove colleague, mine, everyone buttons since that is covered
by leftside bar functionality"; "type field should be the common component that allows for typing
and dropdown, we have it, if not, make it. should be sorted alphabetically"; and on the record
form's timing, "zone dropdown is separate from where it should be, one is a dropdown, the other
isn't and i cant see the contents of the dropdown … size of start and end boxes are slightly
different, perhaps only when one has value."

- **The rail of calendars is `NavigationLayout`'s navigation column**, which makes the firm calendar
  the fifth consumer of the one two-sided screen. See the 2026-09-11 ruling above for the component
  and for why the screen's masthead moves inside it. _(built 2026-09-14)_
- **Whose calendar is the rail's question, not a toolbar's.** Mine / Everyone / a colleague narrowed
  the SAME firm read that the rail narrows a calendar at a time, so the three controls are gone. A
  reader wanting their own day turns their own calendar on. The address's `scope=` key is still
  honoured, because a link somebody was handed is a promise about what they will see.
  _(built 2026-09-14)_
- **A long closed list is typed at, not scrolled.** The event type is the product's combobox, sorted
  alphabetically — the same control the zone field and the member pickers already were. A catalog
  ordered by when somebody happened to create each entry has no order at all. _(built 2026-09-14)_
- **Two lines that ask the same shape of question are built on equal tracks, never fitted
  controls.** An empty time field and a filled one are different widths in every browser, so Starts
  and Ends drifted apart as soon as one was answered; `FieldRow` cannot do that. And **a control
  and a sentence are not two renderings of one field** — the zone was a dropdown on one line and a
  statement on the other, both in a 40-pixel slot. A record still has one zone, so it is asked once,
  full width, under the two moments it qualifies. _(built 2026-09-14. A separate zone for the END of
  a setting — the owner's "they may start and end separately" — is a schema change and is open.)_

### 2026-09-14 — the calendar's grids answer time

The owner, in one round: "move month view controls to next to the new event button. week view
should be taller since we can include time. there should be a setting to allow for overlapping
events on one calendar, or showing them next to each other. you did something like that for daily
view, but this should be a choice for all views." And separately: "start and end time need to
properly show themselves on the calendar, not just on the start, should stretch accordingly."

- **A timed entry is a BLOCK from its start to its end, on every grid with an hour axis.** The Day
  had argued the other way in its own comment — a two-pixel sliver for a fifteen-minute call is
  unreadable, and a block that overlapped its neighbour needs positioning a table cannot give — and
  both halves of that are answered rather than accepted: the sliver by a minimum block height, the
  positioning by placing the block out of the table cell it already sits in. A chip parked in its
  starting hour with the duration written on it was a calendar that made the reader do the
  arithmetic. _(built 2026-09-14)_
- **The week is a time grid, not seven cells.** A week is the span a firm plans in, and a list per
  day answers none of what it is read for. Hours down the leading edge, a day per column, and a band
  above the hours for what is true of a whole day — where a multi-day run is still drawn across its
  days. _(built 2026-09-14)_
- **How things that run at the same time are drawn is the READER's choice, not the grid's.** Side by
  side divides the column so nothing hides; overlapping steps them over one another so each keeps
  more of its width. Held per browser beside the calendar colours, because it changes nothing anyone
  else sees. _(built 2026-09-14, on the week and the day — the two views with an hour axis. The
  month and the agenda are lists of days, where there is no spatial concurrency to choose between;
  if "all views" meant something else there, it is unbuilt and needs saying.)_
- **A screen decides WHERE a component's controls sit, even though the component owns them.**
  `CalendarView` hands its action row up through the `header` snippet, and the firm calendar seats
  it on the masthead's line beside New. The component keeps the controls — only it holds the
  controller they act on — and a host that ignores the snippet still gets the row above the grid.
  _(built 2026-09-14)_

### 2026-09-16 — a setting is read in one zone, and a series says what it would collide with

The owner: "only have one field for time zone. always the same for start and stop." And, in the
same breath as starting recurrence: "check conflicts."

- **ONE zone field on a setting, shared by its start and its end.** This reverses the owner's own
  earlier "they may start and end separately", which had been specified but not built — so nothing
  is unwound, and the forms already ask once. The reversal is the better design: two zones bought a
  handful of genuinely cross-zone settings and cost every form a second question, every read a
  second column, and the grid the one conversion it otherwise never performs, since a block's height
  would have had to be computed across two clocks. Where somebody is in another zone, the
  wall-clock text's zone suffix already says so. **Do not add `end_time_zone`.** _(standing;
  nothing to build)_
- **A setting says what it would collide with, and is never refused for it.** Two things at once is
  not something the platform knows to be wrong — a partner signs an order while an associate takes a
  deposition, and a room is booked for both halves of a mediation on purpose — so the form states
  and the reader decides, which is the posture the resource booking already took. Collisions are
  compared on civil days and wall clocks, never instants; back-to-back is not a collision; a vacated
  hearing competes for nobody's Tuesday; and a series reports DAYS rather than collisions, because
  "three of the twelve dates" is the question a person asks and "seven conflicts" is not.
  _(built 2026-09-16 as `schedule-conflicts.ts`)_

### 2026-09-14 — messaging's create control names a message

The owner: "messaging, new should say new message, not new call".

- **The messaging screen's create control reads "New Message".** The screen is the messaging log;
  a call is one kind of message it holds, and a control named for one kind claims the whole screen
  is that kind. The same control on the matter's Messaging section carries the same word.
  _(built 2026-09-14, on both screens; the channel vocabulary keeps "Call" as the kind of message)_

### 2026-09-14 — where data will arrive, its structure renders first

The owner, on the messaging record's History tab ("Nothing yet. Saving this records who wrote it
down and when…" over a paragraph about carriers' reports): remove it; "messaging history should
have whatever table it will have once we have the history, that way it doesn't just look like
blank space." And the general rule, with a lint asked for: "places where data will populate and it
should be in the table, but it is just loose on the background or the screen. This doesn't prepare
the user for incoming information, and makes it more difficult to identify issues. The Hash screen
for files would be another example of this; but also showcases how we need to consider not every
place we need to structure data will just be a table, but may have other elements."

- **Where data will arrive, the structure that will hold it renders first, empty.** A table renders
  its header row over an empty body; a definition list its terms over empty definitions; a rail its
  frame. The words that explain the emptiness live inside that structure's own empty state — short —
  never as loose prose beside or beneath it on the canvas. A reader is being prepared for what will
  arrive, and a defect in a structure that is already standing is visible where a defect behind a
  sentence is not. _(built 2026-09-14: `lint:structured-empty` in `tooling/lint-structured-empty/`
  — an absence-shaped prose branch where a structure should stand, or muted prose after one, with
  an inline `structured-empty-allow: reason` for the genuinely prose-only case; the rule itself is
  in `ui-design.md`. The messaging History tab, the Hashes tab as a new `DefinitionList` with its
  own `Empty`, bill History and Delivery, the trust ceiling row, the resource meters and the
  speed-test panels are fixed; `EventRail` renders its frame with zero events and gained `note`,
  the one honest line inside a structure; `DataTable.GridFigures` takes a per-figure
  `scope: "whole-record"` so a server count is never labelled "In view". One finding stands in
  the conflicts round in flight, `hit-window.svelte`.)_
- **It is not always a table.** The Hashes tab is a definition list; a transcript is a
  `Conversation`; a chain is a rail. The rule is about the structure the data takes, and the lint
  looks for prose standing where any of them should.

### 2026-09-14 — two gestures share the drag event, and the payload tells them apart

The owner, on the file manager: "I should be able to drag and drop files to move them in or out of
folders. This includes in the left sidebar, the breadcrumbs, and in the main area. Should likely be
a common component."

- **One drag primitive, not one per surface.** A screen with four places to drop something has four
  copies of the same five handlers unless the gesture is a component. The payload's shape, which
  targets accept which sources, the mark drawn under the pointer, and clearing state on `dragend`
  however the gesture ended are all one implementation's to decide. _(built 2026-09-14: `ItemDrag`
  in `packages/design-system/src/lib/components/item-drag/`, registered in `lint:one-ui` so a
  second set of handlers is a defect rather than a choice. `FolderTree` was rewritten onto it and
  its five handlers are gone.)_
- **A drag is told from an upload by what it carries, never by where it lands.** The same
  `dragover` reaches a folder row whether the pointer holds a file from the desktop or a row being
  filed, so a surface that decides by target treats one as the other the first time they overlap.
  Both questions — is this ours, is this the operating system's — belong to the one module, and
  every surface asks it rather than reading `dataTransfer.types` itself. _(the upload dropzone and
  the File Workbench's drop target both ask it now.)_
- **A refusal is the pointer, not a banner.** A drop that cannot land is refused by not preventing
  the default, so the cursor says no before the reader lets go. A message after the fact explains a
  failure the gesture should never have allowed.
- **The mark is an edge, not a fill.** It has to read over a row that is already selected, striped,
  pinned or cut, and a wash across data either loses that argument or wins it by covering the data.

### 2026-09-16 — a press inside a modal does not grow the modal

The owner, on the matter's status window: "For physical file, and for many other items in the app, I
do not want reflow when clicking buttons inside of modals. For example, the set location button. We
should make it that either a new modal is activated, the area is already designed for the additional
info, or we use dropdowns (the kind you can click down or type in). Can we lint/design around that
system."

- **A modal is a fixed frame, and a press inside it must not move that frame.** A window centres
  itself, is as tall as its content, and puts its commit at the bottom. A control that reveals a
  form on press moves all three at the moment somebody acts: the commit walks down the screen, the
  frame re-centres, and what was under the pointer is no longer under the pointer. On a window
  already near the height of the screen the commit leaves the viewport entirely. _(gated:
  `pnpm run lint:modal-reflow`, which refuses a hand-written `aria-expanded` inside a modal shell or
  inside a snippet that shell is handed. Five folds predate the ruling and are listed in the gate
  with what each would take to clear.)_
- **The three remedies, in the order to reach for them.** A **second panel** over the first, which
  is what Amend and Change Status already do from the status window. An **area that was already
  there** — the field standing in its row at rest, carrying the value the record holds, with its
  commit beside it. A **combobox**, for a closed choice: it opens in a floating layer over the
  surface and displaces nothing, and the product's own rule is already that a closed choice takes
  typing. Anything else is the defect.
- **A field at rest needs no separate commit for a single value.** The paper file's office is one
  office; a press to confirm a choice already made is a second press for nothing. What it does need
  is somewhere fixed for the refusal to appear, and a way through to whatever the value names —
  both of which are lines the row keeps whether or not they are carrying anything.
- **This is the same rule the Upload dialog settled as A34**, generalized. That dialog is sized for
  its settings open so that opening them moves nothing; the rule it was standing on was never about
  uploads.

### 2026-09-16 — a reader's scale control scales the thing, not the chrome around it

The owner, on the file manager: the zoom did not appear to work between the icon view and the list
view.

- **A control that scales a surface scales what the reader is looking at, and nothing else.** The
  text, the row height and the glyphs that ride inside a row take the multiplier. The hairlines do
  not — a scaled hairline is a blurred one. The header band and the footer strip do not: they are
  the frame around the list rather than the list, and growing them pushes the rows the reader asked
  to see more of off the bottom of the screen.
- **Scale and density are two axes, and one must not be derived from the other.** The file manager
  derived a two-value density from a ten-step scale at a single threshold, so nine of the ten steps
  changed nothing anybody could see, and the tenth moved the list in a jump. A control offering ten
  steps has to answer to all ten.
- **It is one multiplier on an ancestor, defaulting to 1** (`--mc-table-grid-scale`), so a surface
  that scales nothing is unchanged to the pixel and a surface that scales publishes one number
  rather than threading a size through every component in the region.

### 2026-09-16 — a column that can only be right in one view belongs to that view

The owner, on the file manager: "I don't see the benefit of the 'Location' column."

- **A column shipped hidden is a column asking to be deleted.** Location was `hidden: true` in the
  browse set because in a folder listing it prints the folder the reader is already standing in,
  once per row — and the path above the list and the tree beside it have both already said it. The
  hidden flag was the admission. It is defined only where rows genuinely come from different
  folders now, which is search results and analysis.
- **Hidden is for a column a reader might reasonably want; absent is for one that could never say
  anything.** The difference matters because hidden columns are offered in the header menu, so a
  reader can switch a table into a state where a whole column reads the same value top to bottom.
- **One table, one typeface.** A column set in a different face than the columns beside it reads as
  a different kind of data. File Type holds an extension, which is a word.

### 2026-09-17 — a state one stylesheet owns is not a state every stylesheet may set

The owner, on the calendar's month picker: "when a date is selected in the calendar sidebar, and it
is today, i cannot see the date. use greater shadowing in the small calendar to delineate outside
the month. can you make mock data to simulate this?"

- **A component's own states are scoped to that component, and a shared recipe is not the place to
  put them.** The range picker added its band states — endpoints, the muted span, today — as bare
  `.mc-calendar-day[...]` selectors on the recipe every calendar in the product shares. Same
  specificity, later in the cascade, so its `background-color: transparent` for today overrode the
  selected fill everywhere, and selection's near-white foreground was left painting a number onto
  the white surface. A rule that only makes sense inside one component hangs off a class that
  component puts on itself.
- **A state marker is a RING when the state can coincide with another one.** A fill can only be one
  colour, so marking today with a fill means today and selected are competing for the same
  property, and whichever declaration wins erases the other. The ring is inset, so the fill sits
  behind it and the hairline simply changes colour to stay legible on it. Any state that can be
  true at the same time as selection gets the same treatment.
- **A boundary is shaded, not merely tinted.** Outside-month days were paler text and nothing else;
  with six fixed weeks that is up to eleven days, and a reader had to count columns to find where
  the month began. The wash goes on the CELL so the neighbours read as one continuous band and each
  day keeps its own chip for hover and selection — and because the band is already the colour an
  ordinary day hovers to, an outside-month day hovers one step darker.
- **A state that is only reachable on the right day is a state nobody reviews.** Today-and-selected
  happens once a month per reader, which is why a defect that made a date invisible survived every
  round. It has a specimen now — `/developer-console/calendar-day-states`, which selects today
  deliberately, because `data-today` comes from the clock and the fixture is the SELECTION rather
  than the date. Generalizes: when a state depends on the clock, the ambient environment, or data a
  reviewer cannot summon, build the specimen beside the screen rather than describing the state.
- **A defect that lives in the cascade needs a pin that reads the cascade.** No type, and no jsdom
  render, could have caught this: jsdom applies no cross-stylesheet cascade, which is precisely
  what broke. `packages/design-system/test/calendar-day-states.test.ts` reads the stylesheets as
  text and pins the scope, the declaration order, and the import order they depend on.

### 2026-09-17 — a participant's role is offered, not asked for blind

The owner, on the calendar's record form: "Note sure what the write-in role field means. would make
more sense for a dropdown?" — then, having been given both options: "consider both options for
participant role field", and "take best option".

- **A blank text box does not ask its question.** The field was labelled Role and was empty, and a
  label is not a question a reader can answer: "Role" could mean the person's job at the firm, their
  role on the matter, or their capacity at this one setting. The correction is not a clearer label —
  ghost text is the field's own name and vanishes at the first keystroke, which is exactly when an
  example would be wanted — it is that **the answer set is what explains the field.** A reader who
  sees Appearing counsel, Court reporter and Interpreter offered knows what the field is for without
  being told.
- **The closed dropdown was the wrong one of the two, and for a reason worth keeping.** The roles a
  practice needs do not close: a special master, a Rule 30(b)(6) designee, a parenting coordinator,
  a check interpreter. A closed list missing the role somebody needs does not stop them — it makes
  them pick a wrong-but-adjacent one, which corrupts the very consistency the closed list existed to
  protect, and does it **invisibly**, because an entry chosen from a fixed set looks clean while free
  text looks obviously rough. Generalizes: **prefer the failure that is visible.** Where a closed
  set cannot be completed, a control that refuses the missing value is worse than one that records
  it, because the first hides its own gaps.
- **The already-standing rule decided this, and the round should have started there.** _A vocabulary
  that is not closed but is not free either is the product's dropdown-with-add_ (under _Data entry_
  above, 2026-09-08) already says the combobox with `AddOption` "is the same control in every such
  field". Two siblings had it — the location field on this same form, and the matter-party role —
  and this field was simply the one that had not been carried over. **A question that a promoted
  rule already answers is a question about which fields have not caught up yet.**
- **What the offered list buys is one spelling, and that is worth a function of its own.** A role
  matching an offered spelling in any casing settles to the offered spelling
  (`settledParticipantRole`), so "court reporter" does not found a second role beside "Court
  reporter". Free text gave one firm three spellings of the same role and a reader narrowing to one
  of them saw a third of the events. Anything unlisted is kept exactly as typed.
- **A field's name has to survive being read into a sentence.** "Attending as" is a clearer name for
  this field than "Role" and was rejected anyway, because `Combobox.AddOption` renders the field's
  name into a row that reads `Add <name>`: `Add role` is a sentence and `Add attending as` is not.
  Generalizes: where a control composes the field's name into prose, the name is chosen against that
  prose, not in isolation.

### 2026-09-17 — a filter is chosen from what the column holds, and a calendar in a menu stays

The owner, on the tables' per-column filters: "when clicking to filter dates in tables, once, i
click to add the dates, they disappear and i am unable to set them. also, from, to, file or folder,
and potentially other fields, filter doesn't provide baseline to go off of, it is more like a search
than allowing to set filters."

- **A column's filter offers the column's values.** A text column's filter was a box that matched
  whatever was typed into it, and a box like that gives a reader nothing to choose from: they have
  to already know what the column holds before they can narrow it, which is a search, and the table
  has one of those. The filter for a text column is the SET — every distinct value the rows carry,
  each with a checkbox and its count — because a filter is chosen from a baseline the control
  itself shows. The grid model's default flipped, so a column now gets the set by saying nothing,
  and the ones caught were the changelog's From, To and File or Folder, the file Name in every
  view, the upload's Name and the conflict hit's Party. Generalizes, and is promoted into _Lists
  and tables_: **a contains box is a search wearing a filter's name.**
- **Prose keeps the contains box, and has to say so.** Where no two rows share a value — the time
  ledger's narrative, a fee's description — a checklist of every value is the column read twice,
  and matching typed text is the only narrowing that means anything. Such a column declares
  `filter: "text"`; the declaration is the record that somebody decided this column is prose.
- **The one select control acts on what is listed.** A set of hundreds of names is narrowed by the
  field above it, and the control under that field now speaks for the listed choices — "Select all
  listed", "Select none listed" — touching only those, so a reader narrows a long list to the dozen
  that match a word and takes them in one press. With the list whole it is the same control saying
  "Select all" or "Select none", as before.
- **A field's own floating layer is inside the menu that holds the field.** The date range's
  calendar is a popover portaled outside the filter submenu, and the submenu closed the moment the
  calendar took focus — Bits keeps a submenu open only for focus in itself, its parent or another
  submenu — which unmounted the very field whose calendar had just opened: the dates "disappeared"
  the instant they were reached for. The design system's submenus now keep focus in a popover, a
  select list or a combobox list as focus inside the field
  (`context-menu/menu-field-layer.ts`). Bits' documented route — `preventDefault()` in the
  focus-outside handler — is a no-op on a focus event, which is not cancelable, so the pinned Bits
  patch now also wraps that event the way Bits already wraps a pointer event. Generalizes: **a
  field that opens a layer of its own is usable wherever the field is**, and a menu is not exempt.

### 2026-09-18 — a row's name is the explanation, and a dropdown that says "several" takes several

The owner, walking Account Settings: "remove all the small text like 'How you are addressed. Several
is fine: Hon., Dr. Optional.'", "the dropdown says it allows for multiple selections, but once i
select one, i cannot select another until it is removed", "remove the info screen that says 'A device
signed out here can take up to five minutes…'", "remove small text like 'The devices signed in to
your account.' beneath all headers in this area", "add a way to change a password", "allow for
uploading and adding a profile image", "identity should show the associated email address".

- **A descriptor is for a choice with consequences, not for a field whose name is the whole fact.**
  Every row on the account surface carried a muted line under its name, and every page carried one
  under its heading: "Prefix — how you are addressed", "Active Sessions — the devices signed in to
  your account". A reader passes over each of them forever, and a surface built of them reads as a
  manual rather than as the reader's own record. `SettingDefinition.description` is optional now and
  `SettingsRow` renders the line only where there is one; `AccountMasthead` lost the prop entirely.
  Generalizes: **a firm SETTING earns a descriptor, because a firm-wide choice has consequences its
  name cannot state. A field whose label is the fact does not, and neither does a page whose heading
  is.** Where a reader genuinely must be told something, it belongs beside the control it applies to,
  not under the page's name.
- **A standing explanation is a control that was not built.** The signed-in-devices screen opened
  with a notice about the few minutes a revoked device keeps working, which ended by telling the
  reader to go and find the password reset on the sign-in screen — because the in-account change was
  a disabled seam. The notice came off and the change got built. Generalizes: **when a screen's
  standing sentence is an instruction to go somewhere else, the sentence is a placeholder for a
  control, and removing it means building the control.**
- **A caption for a fact the row does not carry belongs to nobody.** Every device row read "Address
  not recorded", on every row, because the deployment was reading a header its front door does not
  send. The header was fixed; a row that genuinely carries no address now has one fewer clause.
  Generalizes, and is the second half of the _structured empty_ rule: **a field with no value is left
  out, never captioned with its own absence — and a caption appearing on EVERY row is a bug report
  about the read, not a design decision.**
- **A control that holds several holds several after the first one.** The prefix/suffix combobox
  narrowed its list against the part of the line after the last comma, which at rest is the entry
  just chosen — so the list offered exactly the one entry already held and no second pick was
  reachable. Generalizes: **a multi-hold control must distinguish text somebody is TYPING from a
  value that has settled; a settled value narrows nothing.** And where the underlying primitive holds
  one value, the rows carry a per-pick sequence number so the primitive's "you clicked the row I
  already hold" deselect can never swallow an act.
- **A fact a member may see and not change is engraved, never a disabled box.** The account's email
  address is stated in the read-only posture — the same device the settings table uses for any fact a
  member reads and cannot set — rather than as a greyed input beside a Soon badge. A disabled control
  reads as broken and invites fiddling; a stated value reads as what it is. The Soon badge went with
  it, and the seam guard now asserts that a page with no seam claims no badge. Generalizes: **a Soon
  badge is a promise about the near term. On a row nobody intends to build soon it teaches a reader
  that the badge means less than it does.**

### 2026-09-18 — the create control's width is re-measured, not worked around

The owner, on /documents answering with the crash screen: what the report said was `status: 500` and
"Something went wrong", and what had actually happened was that `CreateControl` refuses a noun longer
than its fixed width holds, `noun="Template"` was eight characters against a budget of seven, and
the refusal is a `throw` raised while the screen renders. The render boundary did its job — the page
became the failure screen with an Error ID — which is precisely why the defect read as a server
problem for a day. Offered the bare "New", a shorter noun, or a wider control, the owner took the
width.

- **The one width is re-measurable; a screen's own width is not.** `size.create-control` is 140px
  (was 136px) and `CREATE_NOUN_MAX_LENGTH` is eight (was seven), so "New Template" fits and every
  create control in the product moves together. The property the fixed width protects is that the
  control is the same size on every screen, so the search beside it never shifts — that property
  survives a re-measurement and would not survive one screen stretching the control for its own
  label. The refusal now says so in place of "choose a shorter noun", which was advice with nowhere
  to go: the template library's record is a template, and the domain has no shorter word for it.
- **The budget is a measurement, and it is written down as one.** In the reading face at the small
  size "New Template" sets 81.6px; a 140px control leaves 80px of label after the padding, the glyph
  and its gap. Eight characters fit with a little over two points to spare and nine do not. A
  menu-bearing control spends a further 20px on its chevron and no eight-character noun survives it
  — which costs nothing, because a menu reads the bare "New" and names the kinds on its items.
- **A design-system assertion that throws during render is a whole-screen outage, so it is checked
  before it renders.** `pnpm run lint:matter-create-control` read create nouns out of the matter
  section registry, where they are declared as data, and read nothing at all out of a top-level
  screen's markup — which is where this one was written. It reads both now, names the file and line,
  and says what a bad noun costs. Beside it, `apps/web/test/documents-library-screen.test.ts` mounts
  the screen under the real root layout and fails on a render-time throw of any kind, not only this
  one. Generalizes: **a component that refuses its own props by throwing needs a gate that reads the
  props from source**, because review does not catch a label that is one character too long and the
  type-checker sees a string.

### 2026-11-09 — the calendar screen: one View menu, the date as its heading, three firm calendars

The owner, on the firm calendar: "the calendar preview area on the left side is pretty big. the
calendar on the right has a scrollbar when it should not. should swap the kinds button and the
button that changes the view, should combine those view buttons into a single view dropdown." Then,
over three rounds on a mockup: "rename to Firm Events, title case. should we separate out matters and
deadlines?"; "we don't need to duplicate which month it is and year in two different locations,
picking the month or date in those dropdowns is bad and can be hard to read"; "source should be
changed to Court Order and Firm"; "not sure how necessary kinds is when we already have the settings
on the left side. the calendar on the left needs a picker. we still need the calendar names in both
places though. move today to left of view dropdown"; "calendar is showing six weeks, when a month has
at most 5. think we need to find a better way to showcase the date above the calendar".

- **The views are one labelled menu, not four icon buttons.** `View` names the view the reader is in;
  the week and the day add how concurrent entries are drawn as a section of it, and the agenda adds
  Hide settled. A choice that means nothing on a view is not drawn there. _(built 2026-11-09)_
- **The window's name is the heading over the grid, and it is the way to go somewhere far.** Large,
  at the reading edge, with the arrows BEFORE it so they hold still whatever the name's length;
  pressing it opens `MonthJump`, twelve months a year at a time. Today and View sit together at the
  far end, Today first. _(built 2026-11-09)_
- **A month and a year are never chosen from native selects on the calendar screen.** The rail's
  month names its month in words with arrows of its own, and its name opens the same `MonthJump`.
  The month name reads in both places, because the rail's month browses on its own and must say
  which month it is showing. _(built 2026-11-09 for the compact `Calendar`; the framed date picker
  still carries the two selects and is the open follow-up.)_
- **The rail's month fits the rail.** The compact density drops the frame and steps the days down
  one control rung, so seven make exactly the navigation measure; the framed picker was wider than
  the column it stood in. _(built 2026-11-09)_
- **A month grid draws only the weeks the month touches, and never scrolls for nothing.** Four, five
  or six rows sharing the height. A month told to fill its host while also drawing a blank caption
  line was the host's height plus that line, so the region scrolled on every screen; a grid with
  nothing to say keeps its caption for assistive technology only. _(built 2026-11-09)_
- **The firm's own calendars are three: Case Settings, Deadlines, Firm Events.** Each has its own row
  and colour, so a hearing and a filing deadline read differently and either can be turned off alone.
  That is also why the separate **Kinds** filter is gone: what sort of thing is on screen is the
  rail's question now, as whose calendar it is already was. Every rail name is Title Case.
  _(built 2026-11-09)_
- **A deadline's Source reads Court Order or Firm.** The stored values are unchanged.
  _(built 2026-11-09)_

### 2026-11-09 — the notification centre: one grid, read and dismissed kept apart, and a priority only where one occurs

The owner, reviewing mockups of the notification centre beside the task screen's (the two were
designed together on his instruction). What was said, and what each part generalizes to:

- **The task screen's "A is the basis, but should be able to group", applied to both.** The feed
  became the one grid; its Everything/Unread toggle and category select were removed, not moved,
  because the Status and Category columns already answer both. Already covered by _A list of
  records is the product's one grid_ and _Filtering belongs to the columns_; recorded here because
  the notification centre was the last register still hand-built as a list. Grouping is the grid's
  own group-by (`DataTable.GroupByMenu` and the state's `grouping`): Day by default, then Category,
  Priority, Matter, Read State and No Grouping. Day bands are the reader's own calendar days, read
  "Today" and "Yesterday" and then the date, and their order flips with the table's sort direction.
  Opened, the dismissed shelf is always the last band, whatever the grouping; in a flat list it stays
  the quieted run at the foot. Home: `apps/web/src/lib/notifications/notification-grouping.ts`.
- **"Show dismissed should somehow showcase differently."** Dismissed rows had read exactly like read
  ones. Generalizes: **a row a member has set aside is shown apart from the live rows, never mixed in
  among them** — after them whatever the sort, quieter, with the act that undoes setting it aside
  (Restore) where the act that did it (Dismiss) was.
- **"The seen versus delete is interesting" — the owner chose to keep both.** Reading and dismissing
  stay two acts: seen, and finished with. Neither deletes; the retention clock ages every row out
  whatever its state. Generalizes: **"finished with" is a state with a way back, not a deletion**,
  so the control that sets it can be pressed without a confirmation.
- **"What happened -> Notification", "severity -> Priority".** A column is named for the thing its
  rows are, and for the word a reader uses, not the platform's field name. The wire field stays
  `severity`; what a reader sees is decided at the presentation layer.
- **"Remove for information, priority only if a priority actually occurs."** Generalizes: **a column
  whose ordinary value is "nothing in particular" is blank in the ordinary case.** A word on every
  routine row is noise that hides the few rows that carry one.
