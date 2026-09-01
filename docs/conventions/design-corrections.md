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
