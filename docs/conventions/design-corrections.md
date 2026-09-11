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
- **A record a person quotes out loud carries a NUMBER, and the number is a column.** A handle is
  what the platform joins on; it is not something anybody can read back down a telephone or write on
  a slip. Where a record is referred to out loud — a matter, an entry, an invoice, a call — it draws
  a human number, that number leads the row, and the screen's search matches it first. A number that
  carries the day it belongs to is legible without a lookup, and scoping its sequence to that day is
  what keeps it short enough to say. _(the call log, 2026-09-08: "all calls and logs should have a
  number, which we can identify in the log ... should incorporate date")_
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
  - **A record that is quoted out loud is identified BEFORE it is saved.** Where a record carries a
    reference number a person reads back — to a caller, onto a message slip — the window states the
    number the next one would draw while it is still being filled in, and says that it is a preview
    rather than a reservation. The save is too late for the sentence the person entering it is in the
    middle of. _(the call log, 2026-09-08: "all calls and logs should have a number, which we can
    identify in the log, before it has been created")_
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
  sentence about what a check is. _(the New Check panel, 2026-09-08)_

- **A screen makes something new through ONE control, and it is the same control on every screen.**
  The design system's `CreateControl`: a primary button reading "New" and one noun ("New Fee",
  "New Matter", "New Packet"), pressing straight through or opening a menu in the same footprint,
  held at a token width (`size.create-control`) so it never changes size as the label changes.
  On a matter it sits in the header beside the search and its label follows the section from the
  registry (`sections.ts` answers `createNoun` for every section, or declines with a line);
  the section's page claims the behaviour while it is mounted. Elsewhere it sits in the
  masthead's action row, after the search. Nothing else on the screen makes the record: the
  action-row buttons and the empty-state buttons that used to are removed, not moved, and an empty
  state names the control at the top instead. When nothing can be made right now the control is
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
- **A hold keeps the number and draws nothing.** No number of any kind exists before a matter is
  active, and none is surrendered or re-drawn on either side of a pause. A held matter stays on the
  docket wearing its status; it is not an unnumbered rung and does not go to the Intake desk.
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
  button's padding; the noun budget is seven characters.
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
  per the standing rule).
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
  filters already ask.
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
