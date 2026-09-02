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

### Lists and tables

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
  _(matters docket, 2026-08-30)_
- **A control that undoes a state exists only while that state is in play.** The clear-filters
  control appears when something is narrowing the view and is absent otherwise, so its absence is
  itself the answer to "is anything hidden". _(matters docket, 2026-08-30)_
- **Every scroll region we own wears the app's scrollbar, corner included.** A themed track and
  thumb still leave the corner where a horizontal and a vertical bar meet painted by the user
  agent, and a table wide enough to scroll sideways is where it shows first. _(matters docket,
  2026-08-30)_
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
- **A data-entry surface carries no helper prose.** Every visible line is a label, a value, or the
  one honest sentence a Soon capability owes about what it waits on. A block with nothing in it is
  not drawn at all rather than announcing its own emptiness. _(new matter, 2026-08-30)_
- **A field that holds a chosen person or thing shows what it holds at rest.** Arriving in the
  field is what starts a fresh search; leaving it returns the field to naming the selection. A
  filled seat that renders its ghost text reads as an empty field with nobody in it. _(new matter,
  2026-08-30)_

### Controls and patterns

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
  `apps/web/src/lib/maturity/maturity.ts`, exactly as `ready` does. _(matter section strip,
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
  columns hidden, never a reason to hand-roll a second list. _(file workbench, 2026-08-31)_
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

### List screens

Issued against the matters list and re-issued against the directory. They bind every List/Index
surface, which is most of the product.

- **A heading carries no explanatory sub-text.** No sub-heading under a page title, no sentence
  under a section heading restating what the section obviously is. "The firm's active docket" under
  _Matters_, and "Clients, parties, counsel and courts, in one book" under _Directory_, were both
  removed for the same reason: they spend vertical space on a working screen and tell a working user
  nothing they did not know before they clicked. This is not the same as an honest line that carries
  a CONSEQUENCE — "revealing a value is recorded in the firm's audit log" stays, because it says
  something a reader must know before they press. The test is whether removing the line loses a
  fact. _(matters list, 2026-08-30)_
- **Actions collapse into one compact action row.** Everything above the data that is not the data
  is a single row: the primary action, then narrowing and searching as icon controls that open what
  they need when they are needed. A labelled dropdown and a labelled search box, each with a
  sentence under it, cost three rows of a screen whose subject is a list. Where a screen would carry
  a button per variant of one action ("New person", "New organization"), it carries ONE primary
  action with a menu instead. _(matters list, 2026-08-30)_
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

### List screens

Issued against the matters list and re-issued against the directory. They bind every List/Index
surface, which is most of the product.

- **A heading carries no explanatory sub-text.** No sub-heading under a page title, no sentence
  under a section heading restating what the section obviously is. "The firm's active docket" under
  _Matters_, and "Clients, parties, counsel and courts, in one book" under _Directory_, were both
  removed for the same reason: they spend vertical space on a working screen and tell a working user
  nothing they did not know before they clicked. This is not the same as an honest line that carries
  a CONSEQUENCE — "revealing a value is recorded in the firm's audit log" stays, because it says
  something a reader must know before they press. The test is whether removing the line loses a
  fact. _(matters list, 2026-08-30)_
- **Actions collapse into one compact action row.** Everything above the data that is not the data
  is a single row: the primary action, then narrowing and searching as icon controls that open what
  they need when they are needed. A labelled dropdown and a labelled search box, each with a
  sentence under it, cost three rows of a screen whose subject is a list. Where a screen would carry
  a button per variant of one action ("New person", "New organization"), it carries ONE primary
  action with a menu instead. _(matters list, 2026-08-30)_
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
- **A picker offers the set the record allows, not the biggest set that would answer.** Where a
  field takes an entity, the candidates are the ones the surrounding record permits — a matter's
  parties, not the whole directory. A wider list is not a convenience: it is an invitation to
  record something the domain forbids, and no care at the keyboard makes a list of opposing counsel
  a good place to choose an owner from. Where that narrows to nothing, the field says which choice
  is missing rather than sitting empty looking broken. _(Custodian packet form, 2026-09-02)_
- **A fix is asserted by its effect, never by its own presence in the source.** A rule added to a
  stylesheet, a guard added to a branch, a flag added to a call: each can be present and beaten, and
  a test that checks it is there passes either way. Assert the computed value, the rendered result,
  the symptom the fix exists to remove. The custody empty state shipped "fixed" and unchanged
  because a one-class selector lost to a two-class one and nothing looked. _(Custodian register,
  2026-09-02)_
- **A screen with no way to create the thing it lists is not built.** A list, a detail window, a
  filter set and a print sheet over records nobody can add is a reader for somebody else's data. The
  entry path ships with the surface, and where the backend already serves it, its absence is the
  defect rather than the roadmap. _(Custodian register, 2026-09-01)_
- **A status word is legible against the others in its set, not on its own.** Where a state leaves a
  reader asking what it is, the label takes a word the domain already writes for it — but the test
  it has to pass is the PAIR: custody's "Out" became "Checked out" and was then read as the same
  event as "Released", because both merely say the property left the building. "On loan" carries the
  return, which is the one thing that distinguishes it from a release. Fixing a word in isolation
  and shipping it beside the word it collides with is half the correction. This never licenses a
  synonym: the enum, the ledger and the filter are unchanged, and the word chosen is the domain's
  own (the ledger row for this state records a `borrower`). _(Custodian register, 2026-09-01)_

### Spacing and rhythm

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

### 2026-09-02 — the Custodian register, second round

The owner walked the New Packet form. Most of the round is local, but one correction reverses a
premise the previous round had written into four places, and the reversal is the interesting part.

**A custody packet requires its matter.** Asked to scope the owner picker to the matter's parties,
the reply was that the premise behind the question was wrong: "matterId is not optional for a
custodian item... if they don't have a matter, they aren't associated with us, and we wouldn't hold
their items." The register had been built the other way, and the matterless packet — the will held
for a client whose last matter closed eleven years ago — was written into the register screen's
rationale, the matter section's comment and empty state, and the user guide. All four are reversed.
The API still permits a matterless packet and the server's holding-matter path still exists for one;
the screen is deliberately the stricter of the two, and says so where it enforces it.

The generalizable half is promoted above. What is local:

- **The owner picker was a directory search, and that was the real defect the ruling exposed.** The
  directory holds opposing counsel, courts and vendors; offering all of it as candidate owners
  invites recording a will as held for the other side's attorney. Owners are now the matter's
  parties, which `GET /directory/matter-parties` already answered.
- **The container dropdown was not a rendering bug.** It was empty because a new firm has no custody
  locations and nothing anywhere in the product created one, so the field was a dead end on exactly
  the day it mattered: somebody at a safe with an original in their hand. It describes one inline
  now, nested under whatever is selected.
- **The form is two columns**, the packet against its contents, with items added a line at a time
  before anything is written. Nothing on the right is required: property is taken in sealed.
- **The tentative number is shown.** It is what goes on the physical label, so a person filling the
  form wants to know what they are about to write. Nothing is allocated by asking, which is why the
  response carries the word `tentative` in its body rather than leaving it to the endpoint's name.
- **"Handed over by" and "Handed over on" are the Trustor and the Acquisition date**, and the
  contract's `depositor` / `deposited_at` are mapped to them in one function rather than either
  vocabulary being carried around.
- **"Carried in from an earlier register" did not say what it meant** and is now "Existing number",
  with a line stating the consequence: set it and the register keeps that number instead of drawing
  the one shown above.
- **The Dialog description is gone**, under the standing rule that a data-entry surface carries no
  helper prose.
- **The empty-state fix from the first round never took effect**, and was reported as done. A
  one-class selector cannot beat the two-class rule it overrides, so `nowrap` kept winning and the
  empty register kept running off the screen. Recorded here because the lesson is not about CSS: a
  fix asserted only by its own presence in the source is not asserted at all. The test now reads the
  computed value.

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
