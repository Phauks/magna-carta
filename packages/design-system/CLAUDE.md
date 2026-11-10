# @magna-carta/design-system — CLAUDE.md

**Purpose.** The in-house styled component layer, built directly on headless Bits UI v2 — the only
place UI primitives are defined, styled, and reviewed. Every styled pixel is ours; behavior and
accessibility come from Bits. All styling flows from `@magna-carta/design-tokens` custom
properties; off-token values are machine-rejected.

**White paper:** _Design system, UI consistency & design quality_. (ADR-0076, superseding ADR-0028.)
**Spec:** [`docs/specs/2026-06-10-design-system-foundation-design.md`](../../docs/specs/2026-06-10-design-system-foundation-design.md).
**Plan:** [`docs/specs/2026-06-10-design-system-foundation-implementation-plan.md`](../../docs/specs/2026-06-10-design-system-foundation-implementation-plan.md).

## Key files / entry points

- `src/lib/internal/merge-classes.ts` — `mergeClasses()`, the single class-merge utility; carries
  the tailwind-merge registrations for token namespaces
- `src/lib/internal/types.ts` — the wrapper prop-type helpers (re-exported from bits-ui)
- `src/lib/internal/theme-preference.ts` — the theme/mode storage seam (localStorage now; slice
  0·7b swaps in the settings registry — this module is the only touch point) + the pure
  `applyThemeToDocument` used by both the app and the Storybook toolbar
- `src/lib/internal/floating.ts` — the ONLY home of z-index (`Z_LAYER_CLASSES`) and the presence
  animation constants; `floatingContentClasses()` is the canonical Tier 3/4 content-class builder
- `src/lib/internal/close-guard.svelte.ts` + `discard-question.svelte` — the unsaved-work guard and
  the question BOTH modal shells run every exit through; owned here, never re-implemented in a shell
- `src/lib/components/calendar-grid/` — `CalendarGrid` (Month, Week, Day, Agenda): the domain-free
  presentations on the EventRail division — entries with a civil day, a label, a caller-formatted
  time and a tone come in, and it never learns what a hearing is. **Two of the four are TIME
  GRIDS** — the Day, whose columns are the calendars a reader turned on, and the Week, whose columns
  are its seven days: an hour is a row, and a timed entry is a BLOCK from its start to its end
  rather than a chip parked in its starting hour (owner ruling, 2026-09-14). The block sits in the
  DOM cell of the hour it begins in, which is where a screen reader should meet it, and is
  positioned out of that cell over the hour step (`--mc-calendar-grid-hour-size`), so it overflows
  downwards for as long as it runs. Two pure modules carry the arithmetic and are tested without a
  browser: `time-placement.ts` (the span an entry occupies, floored at `MINIMUM_BLOCK_MINUTES` so a
  fifteen-minute call can still hold its label, and the share of the column it takes) and
  `time-blocks.ts` (which cell it renders in, and the inline style that draws it), and
  `day-segments.ts` (the timed entries a day's axis holds: the ones that begin and end on it).
  **A run of days reads in the band above the hours, never on the axis** (`inAllDayBand`,
  `day-axis.ts`; owner, 2026-09-18): a Monday-to-Wednesday trial spans the band the way it spans
  the month, with its hours on the chip as text. It used to be cut into a piece per day — the start
  hour to midnight, a whole column, midnight to the end — which drew it as three full columns and,
  where the day drew only working hours, as blocks reaching above and below the grid. A span's hours
  never widen the axis either. **How concurrent
  entries are drawn is the READER's** (`concurrency`: `side-by-side` divides the column,
  `overlap` steps them over one another) — a closed set, never a length or a flag at a call site.
  The month and the agenda have no hour axis and take no such prop. The calendar's own arithmetic,
  reads and vocabulary live with its one consumer, `apps/web/src/lib/calendar/`
- `src/lib/components/address-fields/` — `AddressFields`, the product's ONE address form. Its shape
  is the country's (`address-format.ts`), not the platform's; see the Compound Inputs note below for
  the three rules it keeps. Domain-blind: it takes the parts, the countries to offer and — optionally —
  the constraints and an address lookup, and knows nothing about whose address it is — what an address is FOR (its use, whether the place physically
  exists) belongs to the consumer
- `src/lib/components/action-dialog/` — `ActionDialog`, the one panel an act is asked for in;
  `action-dialog-model.ts` holds the kind table (what each kind implies) as data, not `{#if}`
- `src/lib/components/permission-request/` — `PermissionRequest`, the one window any feature asks
  a member for a permission in. It is an `ActionDialog` of kind `confirm` and takes three things:
  the heading, who is asking, and the list of what is granted. It has no prop for what is NOT
  granted, for a description, or for a warning, and gains none: the owner ruled that a permission
  request states only what it grants
- `src/lib/components/record-reference/` — what a modal's SUBTITLE is allowed to say. `types.ts` is
  the contract (`RecordSubject` = an optional `RecordReference` plus short facts; a reference is
  `kind`, `number` and a standing of `drawn | tentative | preview`), `record-reference-model.ts` is
  the table that resolves a reference to what it reads as, `record-subject.svelte` renders the line,
  and `previewed-number.svelte.ts` holds the number a record will take before the record exists —
  the ticketed read that stops a stale answer landing on a newer one. It takes a reader answering a
  number or nothing, so the app's transport and failure model stay in the app. EntityIdentity names
  a PERSON OR ORGANIZATION from elsewhere; this names the RECORD a panel is acting on, by the number
  somebody quotes. Asserted at the call sites by `pnpm run lint:modal-headers`
- `src/lib/components/dropdown-menu/hover-open.ts` — the hover activation every DropdownMenu gets:
  the timing, the focus rules, and the one-hover-menu-at-a-time arbitration, shared from Root to
  Trigger/Content/SubContent through context (`openOnHover={false}` on Root keeps a menu click-only)
- `src/lib/components/conversation/` — `Conversation`, the transcript surface the assistant is read
  through. It is a RECORD, not a chat window: no bubbles, no avatars, no coloured alignment, no
  motion. A turn is a speaker label over a body, hairline-separated, and the two speakers are told
  apart by label and weight rather than by being pushed to opposite sides. It holds no copy — every
  word, the speaker labels included, comes from the caller — and a `state="pending"` turn draws no
  shimmer, spinner or skeleton, because loading here is `LoadingRegion` and nothing else
- `src/lib/components/loading-region/` — `LoadingRegion`, the ONE loading state: real markup over a
  fixture, greyed by the `mc-loading` recipe (imported last in `components.css`, on purpose)
- `src/lib/components/qr-code/` — `QrCode`, a value drawn as a symbol a phone camera reads (the
  two-factor secret). Encoded by `uqr` into a module matrix and drawn as ONE SVG path by the pure
  `qr-code-model.ts`. It is inked in the chrome pair — `chrome-surface` on `chrome-text-strong` —
  because that is the one token pair that does not turn over in dark mode, and a scanner wants dark
  modules on a light field in every mode. A caller always shows the value as text beside it too
- `src/lib/styles/components.css` — the semantic component-class layer (`mc-*` recipes)
- `src/stories/**.stories.svelte` — the catalog; stories triple as browser-mode behavior tests and
  per-story axe checks
- `.storybook/` — catalog config; `catalog-matrix.ts` is the single theme/mode list
- `test/fitness/` — the golden-rule-2 gates (off-token, boundaries, components.css purity)
- `test/csp-spike/` — the CSP probe + `VERDICT.md` (re-runnable; asserts the verdict)
- `visual-regression/` — Playwright screenshots over the static Storybook build, theme×mode

## The formatters: how a value READS, and the one place that decides

**`src/lib/formatters/` is the platform's display vocabulary** — how long, when, which day, how much,
who, which version, and what a field's ghost text says. Each function encodes a ruling already
issued, and a second answer to any of them is a correction that has to be re-issued screen by screen.
The date half is enforced by `pnpm run lint:date-handling`; the standing rules are
[`docs/conventions/dates.md`](../../docs/conventions/dates.md).

- **What a date IS is not this package's question.** Shape, guards and arithmetic live in
  `@magna-carta/civil-time`; these functions turn one into words. Same split as `@magna-carta/money`
  and `formatters/money.ts`, deliberately.
- **`formatDate` / `formatDateRange` / `formatMonth` (civil-date.ts) pin to UTC. Always.** A recorded
  day is a day the firm wrote down; formatted in any other zone it is an instant again, and the same
  work date reads as the 12th in one office and the 11th in another. Every function in that file goes
  through one `civilFormatter` constructor for exactly this reason — do not add one that does not.
- **`formatInstant` / `formatInstantDate` / `formatTimeOfDay` (instant.ts) render in the VIEWER'S
  zone.** A moment happened to somebody, and a person reading a history is asking when it happened to
  them. `formatInstantDate` and `formatDate` are the twins that differ by a day, and both are right —
  a file uploaded at 23:40 in Boston was uploaded on a different day in Reno.
- **NEVER elapsed time.** "Just now", "2 hours ago" and their family are banned: they decay while the
  reader looks at them, two rows carrying them cannot be compared, and a record is a record. The one
  carve-out is the age of a LIVE measurement (a cached probe, a status snapshot), recorded by name in
  the gate's allowance list.
- **An unreadable value renders as the text that arrived.** A blank or a cheerful "Invalid Date" hides
  a defect that showing the data makes obvious.
- **`precision` and `length` are closed sets, not passthroughs.** `timeStyle` / `dateStyle` are not
  exposed, because an open knob is how a fourth way to print a moment gets in.
- **The patterns these sit beside carry no regex flags.** The OpenAPI emitter writes a regex's flags
  into the JSON Schema `pattern`, so a `/u` reaches every generated client as a pattern matching
  nothing. Pinned by `packages/civil-time/test/civil-date.test.ts`.

## Two modal shells, and never a third

**Every modal surface in the product is `RecordWindow` (reading and changing a record) or
`ActionDialog` (an act asked of a reader).** A screen does not compose `Dialog.Content` /
`AlertDialog.Content` / `Sheet.Content` into a panel of its own — `lint:one-ui`'s
`hand-composed-modal` rule fails it, and the homes allowed to compose one are DECLARED in
`tooling/lint-one-ui/registry.json` (`modalShells`), not hardcoded in the rule. Being a registered
component is not enough on its own: `RecordAttachments` is registered and its detach confirmation
is still an `ActionDialog` inside it, not a panel of its own.

- **What `ActionDialog` owns, it owns by having no prop for it**: the footer's geometry and the
  order of its two controls, the dismissal's word, the busy state, whether the corner dismiss shows,
  which primitive renders the panel, and the one close path every exit runs through. There is no
  `class` prop. A caller differs on a closed set — `fields`, `notice`, `kind`, `width`, and a commit
  returning `"committed" | "refused"`.
- **`kind` selects the primitive.** `form` → `Dialog` (corner dismiss, dismissed by a press
  outside); `confirm`/`destructive` → `AlertDialog` (the `alertdialog` role, no incidental dismiss).
  The dismissal says "Cancel" for every acting kind, held as one constant. The trait table describes
  what Bits already does rather than fighting it.
- **`kind="reading"` is the fourth kind, and it is an arm of a discriminated union, not an
  optional commit.** A reading panel — the matter-status window is the model — states a fact and
  seats any step it offers in the body beside that fact, so its bar holds one control that says
  "Close" (nothing was begun). The props type has two arms: acting kinds REQUIRE `commitLabel` and
  `onCommit`; the reading kind forbids them (`?: never`). Neither arm got weaker to admit the other.
  Its row in the kind table carries `commitVariant: null`, which is what hides the commit; it runs
  no unsaved-work guard unless the caller says `unsavedChanges`. It is not a read-only
  `RecordWindow`: a record with tabs, history or an editing mode still opens in the record window.
- **The primary pane is a `<form>` and the commit is its submit button, by `form` attribute.** That
  is how Enter commits in every panel without a caller wiring it: the platform's implicit submission
  presses the form's default button, and only while it is enabled, so a refused or `commitSoon`
  commit refuses Enter too. Ctrl+Enter or Cmd+Enter commits from a textarea (the form's keydown
  listener; the a11y warning on it is ignored with its reason). The form is `novalidate` — a refusal
  is stated beside the commit, never as a browser bubble. A caller must not put a second `<form>`
  inside `fields`, and a raw `<button>` inside it needs `type="button"` (the design system's Button
  already defaults to it).
- **`subtitle` is `RecordSubject | Snippet`, and the removal of the `string` arm is the point.**
  A `RecordSubject` (`../record-reference`) is an optional `RecordReference` — `kind`, `number` and
  a `standing` of `drawn | tentative | preview` — plus short facts, rendered by `RecordSubjectLine`.
  The slot took a string until 2026-09-14, and eighteen of fifty-four call sites used it for a
  paragraph about what a subsystem is for; the owner had already struck exactly that on 2026-09-08,
  and a slot typed `string` accepts it anyway. A sentence about the ACT has nowhere to go now,
  because the heading names the act. The snippet arm stays for a subject carrying real markup, and
  both arms still render through one `subtitleContent` snippet in the shell. `RecordWindow` takes
  the same union, so a record window and the panel that created that record name it identically.
- **`commitSoon: { reason }` is the acting arm's seam for an act not served yet.** The shell wraps
  its own commit in `SoonAffordance` (`../maturity`), so the commit is disabled with the Soon mark
  beside it and the dependency as its accessible description. The commit is ONE snippet rendered
  one of two ways so the bar holds exactly one `<Button` carrying the commit marker in this file's
  source — that is what keeps `footer-set` true; do not duplicate the control to add a branch.
- **`restoreFocus={false}` is the one focus seam, for a trigger revealed on focus.** Bits returns
  focus to the trigger on close; a per-row control that reveals on focus then stays latched open
  after the panel has gone (owner-reported twice on the settings rows). The default is true and
  right for every other trigger; do not reach for it to tidy focus elsewhere.
- **The `notice` slot is the layering seam.** The design system cannot know what a failure reads
  like, so the shell reserves the PLACE and the app puts `FailureNotice` in it. Never import an app
  module here to close that gap.
- **The commit owns the close.** `onCommit` reports an outcome; the shell closes on `"committed"`,
  stands its ground on `"refused"`, and on `"done"` stays open as a panel with nothing left to ask:
  the commit leaves the bar, the dismissal reads Close, the guard stands down, and `fields` /
  `context` are handed `done` so one snippet shows what the act came to (a reference, a batch
  still landing). A caller never writes `open` on the way out — that is what keeps the close to
  one path, and a one-entrance close path is the only kind a guard can cover. A host MAY close a
  done panel itself by writing the bound `open` (the upload panel's host does, once the last file
  lands); that is a prop changing, not a gesture, and runs no guard.
- **Both shells stamp `data-modal-shell`** on their panel, and `ActionDialog`'s two footer controls
  carry `data-action-dialog-action`. These are the hooks a scan and a rendered-DOM check read;
  `footer-set` asserts the bar against the shell's source the way `header-set` asserts the record
  window's header. Do not remove or rename them to tidy up markup.
- **Both shells sit on one frame — `styles/recipes/modal-frame.css` — and no panel builds a pane
  system.** The frame is the record window's own, extracted: `mc-modal-frame` (the panel),
  `-header` / `-identity` / `-heading` / `-subtitle` / `-header-actions` / `-header-action`,
  `-body`, `-pane` (the primary pane, which stops at `size.record-pane` beside a context and fills
  the frame when alone via `:only-child`), `-context` (+ `-context-body` for a context that is not
  tabs), `-notice` (outside the scroll, directly above the bar; `:empty` collapses it), and
  `-actions`. `RecordWindow` keeps every `mc-record-window-*` name as a hook beside the frame's
  class; its own recipe is the tab strip only. Do not re-declare any of these in a shell's recipe,
  and do not give `ActionDialog` a `class` prop to reach past them. A form that needs something
  beside its fields hands `ActionDialog` a `context` snippet; a context pane implies the record
  width, whatever `width` said.
- **The frame owns expand, and each shell keeps its own control.** `internal/frame-expansion.svelte.ts`
  holds the state, the per-shell session memory (`recordWindowExpansion`, `actionDialogExpansion`
  — never persisted, never shared between the shells), the two control names, and the expanded
  geometry (`EXPANDED_FRAME_CLASSES`, utilities, since only a utility can replace the panel's own
  cap). The corner control's markup stays in each shell's source because `header-set` asserts the
  record window's set at the source. `ActionDialog` offers expand on the kinds with something to
  gain — `form` and `reading`, the Dialog kinds; `expandable` in the trait table — and never on a
  question. Both shells take a bindable `expanded`, which is also how a panel OPENS expanded by
  design; the caller's binding wins over the memory.
- **Both shells take an optional `menu` snippet, drawn first in the header as the "More"
  dropdown.** The record window calls it the kind's menu; `ActionDialog` draws it only on the kinds
  that show the corner controls, because a question is answered, never browsed. It holds what is
  done WITH the thing shown (copy its link, download a copy), and it follows the "a menu earns its
  glyph" ruling in `docs/conventions/design-corrections.md`: a caller with fewer than two live items
  passes no menu.
- **A primary pane that carries a section rail stops at `size.record-form`, not `size.record-pane`.**
  The frame recognises it by `data-record-rail` on the rail's container
  (`.mc-modal-frame-pane:has([data-record-rail])`, `styles/recipes/modal-frame.css`), so the rail
  is added to the pane's measure instead of being taken out of the fields beside it. A pane alone in
  its frame still fills it.
- **`ActionDialog` takes an optional `leading` snippet, drawn before the heading** (in
  `.mc-modal-frame-lead`, `styles/recipes/modal-frame.css`). It is for one small square that names
  what the panel is about, such as the directory record's picture; it is not a second toolbar, so
  actions still go in `menu` or the footer.
- **Where a modal panel sits on the screen is one module, in four named parts, and no panel
  touches the screen's edges.** _(owner ruling 2026-09-03)_ A panel's LOOK is its own recipe
  (`dialog.css`, `alert-dialog.css`); what it is MADE OF is the frame's; WHERE it sits is this:
  - `styles/recipes/modal-stage.css` — every placement rule. `mc-modal-stage` is the viewport pulled
    in by `size.modal-gutter` (32px) on every side, centring its panel with flex; flex is also the
    height cap, because a column flex item with `min-block-size: 0` shrinks to its container — fit
    first, then cap, in keywords alone, where `calc(100dvh - …)` fails the purity gate and
    `stretch` reaches only Chromium. `mc-modal-panel` is what makes any panel its well-behaved
    child (positioned, content-height, free to shrink, taking pointer events), and the panel
    recipes never restate a placement declaration (`test/modal-stage.test.ts` refuses one). The
    stage drops its gutter when its direct child says `data-expanded="true"`.
  - `internal/modal-stage.svelte` — the stage's one piece of markup, rendered by `Dialog.Content`
    and `AlertDialog.Content` around Bits' Content. It carries the modal z-layer (a fixed box is a
    stacking context, so a z-index on the panel alone leaves it beneath the scrim) and
    `data-modal-stage`, which the sweep, the story tests and the print sheet find it by.
  - `internal/modal-placement.ts` — the closed placement axis, `centered | anchored`, stamped on
    every panel as `data-modal-placement`. `Dialog.Content` takes it as `placement`; `AlertDialog`
    is always centred. `anchored` is the command palette, positioned against the viewport by its
    own insets; a new placement is a member here, a rule in the recipe, and a row in the sweep.
  - `modal-geometry/` — the diagnostic: a Playwright sweep over the Storybook dev server that
    loads every specimen in `src/stories/modal-geometry.stories.svelte` (each shell, already open,
    one story per way a panel can meet the screen; no trigger, no play function, so a measurement
    never races a story) at every screen size in its `matrix.ts`, prints the panel's size and
    edges, screenshots it, and fails an edge nearer than the gutter (or, expanded, an edge not
    touched). `pnpm --filter @magna-carta/design-system run modal-geometry`; its README says how to
    read a failure and how to add a screen or a panel. The arithmetic is `geometry.ts`, unit tested.
    So the panels carry NO `max-h-*` utility any more (the stage caps them; a `max-h-screen` would
    reach past it), only their `max-w-*`, and no app code knows how the stage works.
- **The frame is imported after `dialog.css` and `alert-dialog.css` and before `record-window.css`**
  in `styles/components.css`, because it overrides the panels' padding, gap and overflow at equal
  specificity and the record window's tab strip overrides Tabs at equal specificity. Moving the
  import breaks one or the other silently.
- **The standard for touching the frame is byte-identical screenshots** of the record window's four
  frame-bearing stories (default, editing-in-place, fits-without-scrolling,
  caps-and-scrolls-its-body) from the static catalog before and after. The extraction met it; a
  change to the frame that cannot is a change to the owner's pane system and needs the owner.
- **The unit test project carries `svelte()`** (in `vitest.config.ts`, at the top level AND on the
  `unit` project) because `.svelte.ts` runes modules — the close guard — do not compile without it;
  from the repo root only the top-level fallback is used, so a plugin on the project alone passes
  locally and fails in `pnpm test`. The package still has no `vite.config.ts`; that note is about
  the Storybook pipeline's plugin ORDER, which this does not touch.

## The directory-linking family: one mark, one field, one tab

**Every surface that names, picks or links a person or an organization goes through
`EntityIdentity`, `EntityPicker` and `RecordParties`** (`src/lib/components/entity-identity`,
`entity-picker`, `record-parties`). Three app surfaces had each hand-built a combobox over the
directory search before these existed; the one-implementation registry now refuses a fourth.

- **The picker never fetches.** It takes `search: EntitySearch` and owns the settle, the floor, the
  abort of a superseded question and the three states (`picker-search.ts`, tested on its own). The
  app supplies the directory — `apps/web/src/lib/directory/directory-picker-source.ts` is the one
  adapter. Same layering as `ActionDialog`'s `notice` slot: the design system knows how a search
  behaves, never what is searched.
- **A failed search is stated, never rendered as no matches.** The two are the same picture and not
  the same fact. A capped answer says so and is never re-sorted: the order is the server's.
- **An association carries its own identity apart from the entity's** (`RecordParty.identifier` vs
  `entityIdentifier`), which is what lets one person be on a record twice in two roles and never
  twice in one (`linkable-entities.ts`), and what lets removing a link leave the person in the
  directory. The remove control is the `unlink` glyph, never a waste bin, never the danger colour.
- **The tab's confirmation is an `ActionDialog`**, from the first commit — the attachments tab
  carries an allowance for its hand-composed one; this family does not.
- **`PARTIES_TAB_KEY`** is the agreement every record window imports, the twin of
  `ATTACHMENTS_TAB_KEY`.

## The table's own controls: three components, not a snippet per surface

**`DataTable.ClearFilters`, `DataTable.GridFigures` and `DataTable.LoadMore`** are the controls a
table's control row and counts strip are made of. Each was hand-built on several surfaces first —
the clear control seven times in three shapes, the figures strip five times with one already in the
opposite reading order, load-more three times in two places — and the drift is why they moved here.

- **What a surface varies is WHERE it puts them, never what they look like.** The owner's 2026-09-03
  placement: the clear control goes in the control row above the table, where the filters were set;
  the undo and redo pair goes in the footer. `docs/conventions/design-corrections.md` carries it.
- **`ClearFilters` is two acts and says which.** Column filters alone read "Clear Filters"; a
  surface whose own search or scope is also holding rows back passes `narrowing` and the control
  reads "Show Everything", because clearing a search under a button labelled Clear Filters is a lie
  about what the press will do. Neither is configured — both are derived. Its `grid` is optional:
  a surface can be narrowed before its grid exists.
- **It renders NOTHING when nothing is in play**, and so does `LoadMore` at the end of a list. That
  is the standing rule for a control that undoes a state — absence is the answer, never a disabled
  control.
- **`GridFigures` takes TEXT.** Money, durations and counts each format through their own home; a
  strip that took minor units and a currency would have to learn all three and still be wrong for
  the fourth. What it owns is the arrangement: label first, figure second, tabular, `·` between,
  and the "In view:" prefix under a filter — a total that silently changed meaning when a column was
  filtered is the most quietly wrong thing a footer can do.
- **The footer's inline "Show all" stays.** It is part of the tally sentence ("x of y · filtered on
  Status, Matter"), not a control in a control row, and the two are different things.

## The grid's frame, its scale, and its row marks

**A Tooltip is a dismissible layer with behaviour `close`.** An open hover label therefore outranks
the panel beneath it in Bits' layer stack, and Bits will not dismiss that panel on an outside press
while the label shows — which is why two top-bar panels could stand open at once. The top bar
settles it by state rather than by pointer: `TopBar.Root` declares an overlay band
(`internal/overlay-band.svelte.ts`) and `Popover.Root`, `DropdownMenu.Root` and `Dialog.Root` join
it where one exists, so opening any panel in the band closes the others. Everywhere else the join
finds no band and does nothing.

Three things about `DataTable.Grid` that a surface gets wrong by spelling them out itself.

- **A `sortColumnId` of null renders the rows as given.** `initialSort.columnId` accepts null and
  `setSort(null)` clears the sort, which is how a ranked answer keeps the server's relevance order
  until the reader sorts a column themselves (the Directory's search does this); a surface never
  re-sorts a capped best-of into a sorted-looking index of its own.

- **`frame` is `card` or `flush`, and it is a prop rather than three utilities.** A card is the
  hairline, rounded table-card, and its LAST ROW DROPS ITS HAIRLINE because the card's own bottom
  rule runs one a pixel below it. Flush is edge to edge inside a frame the surface already draws —
  a toolbar above, a footer below — so the table takes the frame's full height, the surface
  continues past the last record, and the last record KEEPS its hairline, because there is no
  bottom rule left for it to meet. Nine surfaces were each passing `rounded-none border-0` to get
  the paint, which gave them the paint and none of the rest: the file list's last file was the one
  row in the list with nothing under it.
- **`scale` is the reader's own multiplier, and it moves four things.** 1 is the design's own size,
  so a table nobody scales carries no inline declaration at all. It moves the row's text, its
  height, the padding inside it, and the glyphs that ride in a row — which wear
  `mc-table-grid-row-glyph` rather than a `size-*` utility, so they scale with the row. It moves
  NOT the hairlines (a scaled hairline is a blurred one), nor the header band or the footer strip,
  which are the frame around the list rather than the list. The four metrics are declared in the
  recipe as the tokens they already were and multiplied in the COMPONENT, written back as an inline
  style: `calc()` is neither a token reference nor a structural keyword, and the recipe layer is
  token-pure by gate (`components-css-token-purity`). Density is a separate axis and multiplies in;
  never derive one from the other, which is how the file manager's ten-step control came to have
  exactly one visible step.
- **A row mark is painted into the first cell's leading padding, never rendered ahead of its
  content.** The space is reserved on every row of a table that CAN mark one — a capability that
  cannot change under the reader — so marking a row lights a glyph and moves nothing. It is padding
  and not an inline box because an inline box only stays on the content's line while the content is
  inline too, and every surface composing an icon beside a name reaches for flex, which is
  block-level: the mark then took a line of its own ABOVE the content, and the row was two lines
  tall with its first column sitting low in it.

## The history family: one stack, one pair of controls, one set of keys

**`src/lib/components/history/` is the one home of undo and redo.** `HistoryStack` holds the steps,
`UndoRedoControls` is the split-control pair, and `historyShortcuts` is the keyboard handler. All
three are in `lint:one-ui`'s one-implementation registry: a second undo stack anywhere is the defect
the entry exists to prevent, and there were two before this landed
(`apps/web/src/lib/time/time-sheet-history.svelte.ts` and
`apps/web/src/lib/file-manager/move-history.ts`); both are gone, and both surfaces now render this
control over this stack. Design: [`docs/specs/2026-09-03-undo-redo-and-reversal-design.md`](../../docs/specs/2026-09-03-undo-redo-and-reversal-design.md).

- **A step is a command with an inverse, never a snapshot.** A snapshot restores a screen; an
  inverse restores the record. The snapshot model is why the Time Sheet writes back every row on
  every undo — it cannot know which fields moved — and why a snapshot taken before a re-read is
  unsafe. `HistoryStep` is `{ label, undo, redo }` and the surface decides what those do.
- **A step is pushed only where its inverse is real.** What is refused is refused out loud:
  `irreversibleAnnouncement` is the sentence, and it names where the repair lives, because "undo
  does not reach this" is only half an answer when the other half exists.
- **The outcome follows the inverse, never the pop.** `undo`/`redo` answer once the writes have
  answered; a failure leaves the step on the stack, still offered, with the failing label named. The
  control hands the outcome back through `onOutcome` and says nothing itself — the live region
  belongs to the surface, and a control that spoke would be a second voice on the same strip.
- **A walk in flight refuses the next one** rather than interleaving two sequences of inverses, so
  both halves disable while one runs. Only `push` grows the stack (bounded at `STEPS_KEPT`); a walk
  moves a step between the two sides, which is why neither side trims and walking back and forth
  cannot drop the far end.
- **`historyShortcuts` is a handler, not a window listener** — the surface attaches it to its own
  element, so two surfaces with stacks cannot receive each other's keys. It REACHES INSIDE TEXT
  FIELDS by default, which is what both existing surfaces do and is right on a rapid-entry grid: a
  reader who has typed into six cells and presses Ctrl+Z means the sheet, not the caret.
  `insideTextFields: "yield"` is the seam for a surface that is one long text field.
- **The one thing a surface varies is the register** — `variant: "ghost" | "secondary"` — because
  that is a fact about the chrome the pair sits in (a quiet counts footer, a toolbar of secondary
  buttons), not about undo. Closed set, no `class` prop to reach past it, and the bordered register
  also drops the caret's leading edge so the seam is not a double rule.
- **A module with no Svelte in it imports from the leaf paths**, `@magna-carta/design-system/history-stack`
  and `/history-shortcuts`, never the `./history` barrel: the barrel carries the CONTROL, and a
  plain module that pulls its component tree in stops loading anywhere a Svelte transform is not in
  play (it fails as `Unknown file extension ".svelte"` deep inside bits-ui, which reads like
  anything but the import that caused it). `.svelte` consumers take the barrel.
- **`DropdownMenu.GroupHeading` must sit inside a `DropdownMenu.Group`.** Without it bits throws
  `Context "Menu.Group | Menu.RadioGroup" not found` when the menu OPENS — not on render — so it is
  invisible until somebody presses the caret. Both hand-built copies of this control shipped without
  the group; this one has it, and the story that opens the menu is what pins it.

## The drag family: one gesture, and one question that tells it from an upload

`item-drag/` (`ItemDrag`, `carriesDraggedItems`, `carriesExternalFiles`) is the whole of dragging
one of OUR items somewhere else. It is registered in `lint:one-ui`, so a second set of drag
handlers is a defect rather than a choice.

- **Why it is a component and not a helper.** It ships a recipe of its own (the mark and the
  drag-image count), and a module with a stylesheet is a component wearing a different name.
- **The payload is a vendor media type, and it is the ONLY way a surface knows whose drag this is.**
  The same `dragover` reaches a folder row whether the pointer holds a file from the desktop or a
  row being filed; deciding by target treats one as the other the first time they overlap. Ask
  `carriesExternalFiles` / `carriesDraggedItems`, never `dataTransfer.types` directly. `Dropzone`
  declines a drag it can positively identify as ours, and the File Workbench's drop target asks the
  same question.
- **A refusal is the pointer.** A drop that cannot land is refused by NOT preventing the default, so
  the cursor says no before the reader lets go. Never a message after the fact.
- **A row is lifted into being draggable for the press it is under**, on `pointerdown`, and given
  its own behaviour back on `pointerup` or `dragend`. A table whose every row carries `draggable`
  permanently loses text selection on every surface that uses it, so this is deliberately NOT a
  `rowsDraggable` prop on `DataTable.Grid`. Markup that already declares `draggable` is left alone.
- **`FolderTree` takes `drag` and `dragKeyOf`** so a surface with several drop targets hands the
  rail ITS drag rather than running a second one; given neither, it builds its own over
  `onMoveFolder`, which is what the folder picker and the stories use.

## The maturity family, and the field primitives

- **`src/lib/components/maturity/` is the one home of the maturity vocabulary** — the stage model
  (`maturity.ts`: `MaturityStage`, `MATURITY_PRESENTATION`, `hasSurface`), `MaturityBadge`,
  `MaturityDot`, and `SoonAffordance` with its wording (`soon-affordance.ts`). It moved here from
  `apps/web/src/lib/maturity/` on 2026-09-02 because the ActionDialog shell renders the "soon" stage
  on a commit and a shell cannot import the app. The app imports `@magna-carta/design-system/maturity`
  and keeps only its registries' `stage` fields. `SoonAffordance` is in `lint:one-ui`'s
  one-implementation registry: a second composition of "disabled + badge + dependency" anywhere is
  the defect it exists to prevent. Only `soon` wears a mark (owner ruling in
  `docs/conventions/design-corrections.md`).
- **`LabelledField` is the label-over-control stack for a panel's own fields; `Form.Field` is for a
  superforms-validated form.** They are not interchangeable and one is not a shortcut for the other.
  `LabelledField` mints the control's id (`$props.id()`) unless given one, joins the hint and the
  error into `aria-describedby`, sets `aria-invalid` on an error, and hands the control its
  attributes as `children({ props })` to spread — formsnap's own idiom. Its recipe gap is space-8
  (the panels'); `mc-form-field` is space-4. That difference is deliberate and stated on the recipe;
  do not quietly align one to the other — it is the owner's to settle. The hint and error reuse
  `mc-form-description` / `mc-form-errors`, so the satellites are one recipe across both.
- **`FieldRow` is utilities, not a recipe** (`grid gap-12 sm:grid-cols-2|3`), because a breakpoint
  cannot be expressed with a custom property inside a media query. Its class strings are literal in
  `field-row/variants.ts` for Tailwind's scanner.

## The sidebar's two levels

**`Sidebar.MenuTrigger` + `Sidebar.MenuSub` are the rail's SUB-MENU**, added when the tools became
top-level rows and nine of them arrived in one group (owner's direction, 2026-09-16).

- **The trigger wears the destination row's recipe exactly** and differs in the one way that
  matters: pressing it opens the rows beneath instead of going anywhere. A row that looked like a
  category and navigated like a destination would be the `/tools` index again in miniature. Its
  chevron follows the group heading's convention — down while open, toward the inline start while
  folded — and rides the trailing column, so a long cluster name truncates and the chevron stays.
- **`MenuSub` is a real nested `<ul>` inside the trigger's `<li>`**, so the nesting a reader sees is
  the nesting a screen reader hears. Its indent and start-edge hairline are what make "these belong
  to the row above" legible at a glance rather than by measurement.
- **The expansion state is the CONSUMER's.** Neither part holds it: the app stores a member's folds
  as departures (`sidebar-preferences.svelte.ts`), and the story holds a `$state` for the same
  reason. A part that remembered its own fold would be a second answer to a question the preference
  store has already settled.
- **`MenuButton` gained a `trailing` snippet**, and the row is a three-track grid: icon, label
  (takes the slack, truncates), trailing (sized to its contents, never shrinks). A mark rendered
  among the children rides inside the label's own overflow, which clipped the maturity badge off
  every row long enough to need it. The collapsed rail hides the trailing column with the label.

## The navigation layout: a screen's two sides, drawn once

**`src/lib/components/navigation-layout/` is the one shape for a canvas with a navigational column
on the left and the chosen thing on the right** (owner ruling, 2026-09-11) — Settings, Magnus, and
any list-left / chosen-thing-right screen (Tools, Reports). Settings and Magnus had each drawn it
by hand at two widths with two scroll treatments.

- **It owns the landmark, the width, the scroll and the gutter — and nothing the navigation
  HOLDS.** `navigation` and `children` are snippets; grouped links, a control over rows, a plain
  list are all the consumer's to draw. There is no `items` prop, and `test/navigation-layout.test.ts`
  refuses one.
- **Both widths are tokens, no arithmetic.** The column is sized content-box: `size.popover` holds
  the rows and the gutter each side is what `standard` (space-24, the settings measure) and
  `narrow` (space-16, which lands on the global sidebar's width) differ in. A third width is a
  third gutter, not a `calc()`.
- **It cancels the canvas inset and takes the full height under the top bar**, so the canvas
  never scrolls on such a route; the two columns do, with `scrollbar-gutter: stable` so a
  scrollbar arriving never shifts what sits beside it. A screen that renders it beneath a masthead
  of its own is not this shape yet.
- **The height calc is CAPPED at the canvas, and the cap is not a plain 100%.** The viewport calc
  is a guess: it is right only while the chrome measures exactly the top-bar token and the
  viewport's `dvh` agrees with the height the shell was sized in (`h-screen`, which is `vh`). When
  it overshoots, the canvas — itself a scroll region — grows a scrollbar beside the two columns,
  and one surface shows three. `max-block-size: calc(100% + var(--mc-space-48))` bounds it from
  the parent instead. The `+ space-48` is the cancelled inset: a percentage resolves against the
  canvas's CONTENT box, which is already short by the inset the `-m-24` gives back, so capping at
  a bare 100% would pull both columns up by 48px and leave a band of bare canvas under them. Where
  the parent has no definite height (a catalog story's box) the percentage cannot resolve, the cap
  behaves as `none`, and the calc stands alone. What this does NOT reach is a sibling ABOVE the
  layout inside the canvas (the app's `PlatformNotice`): that pushes the layout down by its own
  height and the canvas scrolls by exactly that, which needs the shell's `<main>` to become the
  flex column the layout is a child of.
- **A title can SPAN both columns (`header`), and the navigation can PIN something under its
  scroll (`navigationFooter`).** Both are optional, and giving neither leaves the DOM byte-identical
  for the screens composing this today. The calendar asked for both and neither is calendar-specific:
  a title that names the SCREEN belongs over the whole canvas rather than over one column of it, and
  a rail with a picker under it is the shape of every navigation whose last element must stay in
  view while its list scrolls. The header sits inside the cancelled canvas inset and puts the gutter
  back itself; `navigationFooter` moves the scroll region and its reserved gutter off the `<nav>`
  onto an inner stack, because a pinned footer cannot sit inside the thing that scrolls past it. The
  landmark stays the `<nav>` either way.
- **`contentScrolls={false}` for a page that stages header / scrolling middle / pinned footer.**
  The column is then a bare full-height flex stack and the page owns its scroller; otherwise the
  page's middle would draw a second scrollbar inside a column that had already reserved a gutter.
- **The content column adds no tab stop.** A scroll region a keyboard can reach holds something
  focusable, and every product page does; the layout does not put a stop before every page's
  first control. A page of pure prose must bring a control — axe's `scrollable-region-focusable`
  says so, and the stories carry an action for that reason.
- **Narrow viewports stack the navigation above the content and scroll the layout as one**, below
  `lg`. Nothing in the design language decides a breakpoint; `lg` is where the safe-browse
  website shell already stacks its two panes, and a navigation pinned on top would eat the
  viewport on a long nav. A recipe cannot carry a breakpoint (a literal length is banned in
  `components.css`), so the stacking is `max-lg:` / `lg:` utilities on the elements.

### The row, the one thing the column does NOT draw itself

**`Row` is the second export of `./navigation-layout`** (as `Row`, as `NavigationLayoutRow`, and
the layout itself as both the default and `Root` — the default came first and every consumer imports
it that way, so it stays). The layout still imposes no structure on what the navigation holds; the
row is offered, never required. It became a part because its treatment had been written by hand
three times — the settings nav, the catalogue column Tools and Reports share, and the inline styling
in both — with a fourth two-sided screen already foreseen.

- **The element follows from `href`, and the part guesses nothing.** A string is an `<a>`; omitting
  it is a `<button>` (the shape a conversation rail takes); **`null` is a row with nowhere to go
  yet** — unlinked, `aria-disabled`, quieter, with the Soon mark in its `trailing` slot. `null` is
  the spelling the app's catalogue vocabulary already uses for the same fact. It is deliberately NOT
  a disabled control: a greyed-out button reads as broken, a quiet row reads as not yet.
- **A name WRAPS; it never truncates.** The column is 224px of content and a name beside a mark does
  not always fit one line, so the control height is a `min-block-size` and the recipe carries no
  `white-space` and no `text-overflow` — `test/navigation-layout.test.ts` refuses both. "Property
  Listin… Soon" has stopped naming the tool, which is the row's one job. The sidebar rail truncates
  because its label collapses to an icon; this column never does.
- **Every treatment is recipe, none is a call-site class.** Resting muted ink, the hover tint, and
  `current` (selected fill, firmer text, the gilt start-edge bar as an inset box-shadow — a border
  would bend around the rounded corners) all live in `navigation-layout-row.css`. A screen passing
  its own colours here is the defect the part exists to end.
- **`icon` and `trailing` are snippets.** The glyph is sized by `mc-navigation-layout-row-icon`,
  which the part applies itself; the trailing mark never shrinks.

### The group, the column's fold

**`Group` is the third export of `./navigation-layout`** (as `Group` and as `NavigationLayoutGroup`)
— a heading that folds what it holds. It exists because the owner asked whether the settings nav's
folds and the rail's were one component (2026-09-17); the answer is that the disclosure GRAMMAR is
one and the rows are not.

- **One grammar, and the sidebar settled it.** The heading IS the control — not a chevron beside a
  label, not a control in a row of its own — it keeps its own voice rather than dressing as a
  button, its hit target is the whole width, and the chevron points down while open and toward the
  inline start while folded. `Sidebar.GroupTrigger` says the same thing in the chrome register.
- **It composes `mc-field-label` rather than restating the caps voice**, the way the sidebar's
  trigger composes `mc-sidebar-group-label`. A recipe that retyped the register would be the second
  copy of it that FieldLabel exists to prevent.
- **Two levels, and the indent stagger is the recipe's**: `band` (a glyph, firmer ink, the column's
  rule under it) over `group` (a step in, quieter) over the rows (a step further). The settings
  column had that stagger in utilities and an inline `padding-inline-start`; it is one recipe now,
  so a two-sided screen cannot re-choose it.
- **The fold is the CONSUMER's.** Nothing is remembered here — the app stores a member's folds as
  departures from everything-open, and a part with its own memory would be a second answer to that.
  It takes `expanded` and reports the press through `onToggle`.
- **Folded means ABSENT.** The rows are removed rather than hidden, and the heading carries
  `aria-expanded` alone — an `aria-controls` naming an element that is not there is an invalid
  reference, and a `hidden` attribute would leave the rows under the keyboard's fingers.
- **The sidebar was NOT migrated onto it, deliberately.** `Sidebar.MenuTrigger` is a three-track
  grid with an icon column, a truncating label and a collapsed-rail tooltip — a different anatomy,
  and absorbing it would grow this part four props and stop it being one thing. Migrating
  `Sidebar.GroupTrigger` alone would split one visual fact across two class names in the rail
  (`mc-sidebar-group-chevron`, which the menu trigger also wears, against this part's own), which
  is worse than the duplication it would remove. What the two share is the grammar, and the grammar
  is written down here and in the sidebar's own note.

## Invariants that apply here

- **Tokens + components only (golden rule 2, machine-checked).** No Tailwind arbitrary values, no
  raw color literals, no `z-<number>`/`duration-<number>` numerals — the fitness gates fail CI with
  file:line. The documented escape (`fitness-allow: <justification>`) feeds an asserted inventory;
  every allowance is a reviewed test edit.
- **`components.css` values are `var(--mc-…)` or structural keywords — no literals, no escape
  valve (deliberate).** Recipes must tokenize lengths: focus-ring width/offset and the 1px
  **`--mc-border-width-default`** hairline are dimension primitives added to design-tokens for
  exactly this reason — when a recipe needs a length with no token, add the token (regenerate +
  re-pin the golden in the same commit), do not reach for a literal or a keyword like `thin`.
  Two reviewed widenings (2026-07-02): the exact form **`content: ""`** is structural (enables
  pseudo-element ornament; non-empty strings still violate), and **physical box properties are
  banned** (`width`/`margin-left`/`border-top`…) — recipes are logical-property only so RTL keeps
  working; the WebKit scrollbar recipe is the sole exemption.
- **`bits-ui` is imported only inside `src/`** (and the csp-spike probe) — gated.
- **Lucide deep imports only** (`@lucide/svelte/icons/<name>`) — gated.
- **Z and presence live in `floating.ts` only.** Apply `floatingContentClasses()` output to the
  inner `props` element, never the `wrapperProps` element (it carries Floating UI positioning —
  `FLOATING_WRAPPER_RULE`). Later `mergeClasses` inputs win, so caller overrides go last.
- **Reduced motion is structural:** every presence constant carries `motion-reduce:transition-none`
  (CSS-only). The first JS-driven animation must add the JS `prefersReducedMotion` gate — it does
  not exist yet.
- **Every component ships story-first**: stories cover every variant × state, run as behavior
  tests, pass axe (`a11y.test = "error"` — violations fail), and join the visual-regression matrix
  automatically. Each tier batch ends with an NVDA pass and an owner design review in Storybook.

## Dependencies & contracts

- `bits-ui` (pinned; upgrade together with `svelte`, deliberately), `clsx` + `tailwind-merge`
  (via `mergeClasses` only), `@magna-carta/design-tokens` (the styling contract).
- Storybook 10 + svelte-csf; the vitest browser project (`vitest.storybook.config.ts`) needs the
  Chromium Playwright binary (`tools/install-playwright-chromium.cmd`) — CI included.

## Gotchas

- **New token namespace in the generated theme → register it in `merge-classes.ts`** or
  conflicting utilities silently both survive. Named duration/z-style scales need
  `extend.classGroups` (tailwind-merge's `extend.theme` cannot model them); the theme-derived test
  will demand merge cases — follow its messages. Never hand-invent utility names outside the
  generated theme; unregistered ones fail silently.
- **No `vite.config.ts` in this package on purpose** — `svelte()` is registered in `.storybook/
  main.ts` `viteFinal` and must stay UNSHIFTED (docgen/csf transforms expect compiled output). A
  package `svelte.config.js` exists for svelte-check. Root-cwd runs log a harmless
  "no Svelte config found" warning three times.
- **Story class strings must be literal** — Tailwind's scanner cannot see computed classes.
- **New theme** = one `catalog-matrix.ts` entry (+ the design-tokens side: theme file, resolver
  context, terrazzo `themes` array).
- **Any new browser-mode vitest config must also be added to the root `vite.config.ts` projects
  list** — Vitest silently ignores projects nested inside a project config.
- **Storybook coverage toggle errors ("Cannot find package '@vitest/coverage-v8'") — flagged for
  Fable, deferred.** Tests run fine (CLI `vp test` green, and the Storybook test panel runs without
  the coverage toggle); only the addon's coverage feature fails, because Vite+'s test runner
  lazy-imports `@vitest/coverage-v8`, which isn't installed. Vite+ now runs upstream Vitest (the
  catalog `vitest` pin equals the version vite-plus depends on), so no fork stands in the way: to
  enable, add `@vitest/coverage-v8` at that same version to the catalog + root devDeps, install,
  and confirm coverage runs.
- **Node 25 ships a dead `localStorage` global that happy-dom cannot replace** — stub storage via
  `vi.stubGlobal` (see `theme-preference.test.ts`).
- **CSP (`test/csp-spike/VERDICT.md`):** Floating UI positioning is CSP-clean; Bits' scroll-lock
  RESTORE used `setAttribute("style", …)`, which strict `style-src` blocks. That was patched locally
  until upstream fixed it: as of 2.20.6 Bits restores the body through `style.setProperty` /
  `removeProperty` (CSSOM), so the scroll-lock half of `patches/bits-ui@2.20.6.patch` is gone. Never
  loosen `style-src` instead. The spike asserts the CSP-clean verdict and fails if a bits-ui upgrade
  regresses it — re-run on every bits-ui/svelte bump (`tools/run-csp-spike.cmd`).
- **The patch makes `onFocusOutside` preventable.** A focus event is not cancelable, so the
  `event.preventDefault()` Bits documents as the way to keep a layer open on focus leaving was a
  no-op and Bits closed the layer anyway — a submenu hosting a DatePicker closed the moment its
  calendar took focus. The patch wraps the focus event the way Bits already wraps a pointer event,
  so the prevented state is tracked; `context-menu/menu-field-layer.ts` relies on it. Re-check it
  on every bits-ui bump; upstream still passes the raw event as of 2.20.6.
- **Visual regression baselines are authoritative ONLY from the pinned Playwright container**
  (`update-baselines.cmd`/`.sh`; no Docker on the dev machine — first baselines land via CI).
  After any local VRT run, check `git status` for stray `visual-regression/baselines/*.png` —
  local Windows renders must never be committed.
- **`.cmd` files are ASCII-only** — multibyte characters (em-dashes) shear cmd.exe's parser under
  the UTF-8 codepage. `.gitattributes` pins `*.cmd` to CRLF.
- **Tokenize recipe lengths (focus-ring + border-width done):** the Button needed focus-ring
  width/offset tokens; the Tier 1 batch (Input/Card/Separator/Alert/Keyboard) needed
  `--mc-border-width-default`. Bare `0`, `calc(…)`, and `content: ""` in recipes likewise need
  tokens or a deliberate, reviewed gate widening.
- **Component-build conventions (Tier 1 batch, the loop every later component copies):**
  - **Single-element wrappers** are `WithElementRef<HTMLXAttributes, HTMLXElement>` + `mergeClasses("mc-x", className)`; **variant** components add the house `variants.ts` record (no DSL), as in button/badge/alert.
  - **Multi-part** components (Card, Alert) ship an index that exports the **house namespace shape** — bare part names (`Root`, `Header`, …) _plus_ prefixed aliases (`Card`, `CardHeader`, …) — so both `import * as Card` and `{ Card, CardHeader }` work.
  - **Name components in full** (golden rule 12): `Keyboard`, not `Kbd` — the HTML element stays `<kbd>`, but the component, recipe class (`mc-keyboard`), export, and story are spelled out.
  - **Component naming / casing standard** (owner-settled 2026-06-13; matches the Radix/shadcn ecosystem): components are **PascalCase**. A component that wraps a **single HTML element takes that element's own spelling** — `Input` (`<input>`), `Textarea` (`<textarea>` — lowercase `a`, as HTML spells the element), `Label`. A **compound concept or multi-part set is PascalCase per word** — `FileInput`, `RadioGroup`, `CardHeader`/`AlertTitle`. The **recipe class is the kebab-case of the component name** (`mc-input`, `mc-textarea`, `mc-file-input`, `mc-radio-group`). So `Textarea` (element-mirror) and `FileInput` (compound) are each correct, not inconsistent.
  - **svelte-csf `defineMeta({ component })` needs a directly imported component identifier**, not a namespace member: import the root component file alongside `import * as X` for multi-part stories (Card/Alert stories show this).
  - **Always render via an explicit `{template}` snippet — NEVER bare `<Story>…</Story>` element children** (when `component` is set, which it always is). svelte-csf renders the `component` with args and slots bare children INSIDE it, so the story content gets wrapped in a second copy of the component: it double-rendered Card (nested cards), nested an outer `<label>` around Label's row, and (Skeleton being a leaf with no `{@render children()}`) DROPPED the content entirely — an empty, invisible skeleton. All three passed their play functions, so this is invisible to the test gate — the trap is real. Define a `{#snippet template(args?)}` and pass `{template}` (Button/Alert/Input are the reference); a `{#snippet template()}` written _inside_ the `<Story>` tags is also fine (it's a named template, not bare children).
  - **Layout width is a utility, not the recipe:** `inline-size: 100%` is not tokenizable (and `%` fails the purity gate), so form controls (Input/Textarea) and Separator carry `w-full`/`h-full` in the component class; the recipe owns visual design only.
  - **Focus is a single shape on EVERY focusable control — no detached ring.** Outline at `space-0` offset in `focus-ring`; controls with a resting border (Input/Textarea) also turn the border `focus-ring` so border + outline read as one merged edge, and the borderless Button gets a flush outline. (Owner-directed: a focus ring sitting away from the control read as a "double shape".)
  - **Input is text-like only** — `type` is the closed text-like union (`Omit<…,"type"> & { type?: InputType }`, the exported `InputType`); file/checkbox/radio/range/color and the button types are out because the text-field recipe can't dress them. The story gives `type` an explicit `control: "select"` (a closed set is a dropdown, never a free-text control). `value`/`ref` are `$bindable`.
  - **FileInput is the styled `type="file"` control** — its own component (`mc-file-input`) because a file control's value is user-set and read-only (`input.files` is not generically assignable, so it does NOT two-way bind — read the selection from the element `ref` or a forwarded `onchange`), and its only reliably-styleable part is `::file-selector-button` (dressed to the secondary-button look; vertical centring via `align-content: center` + the button on `vertical-align: baseline` to share the filename text's baseline — NOT a flex row, which would strand the button on the baseline overlapping the top). This is the bare control only; the full upload UX (drag-and-drop, selected-file list, progress, validation, R2 wiring) builds on it in slice 2·1.
  - **Specialized inputs are dedicated components, not Input types** (the pattern FileInput sets) — they live in the **Compound Inputs** catalog category (see the taxonomy below). Planned, NOT built here — flagged so they aren't crammed into Input later:
    - **MoneyInput** (billing/trust UI slice): currency symbol + locale formatting, bound to **`@magna-carta/money`** (branded `Money` over minor-units — never floats), precision/rounding and validation from the money package. `type="number"` is the interim for raw amounts.
    - **PhoneInput** (compound): a country/dial-code selector + national-number field, with formatting and validation (libphonenumber-class). `type="tel"` Input is only raw text entry — `tel` is unvalidated by the platform, so a real phone field needs the compound. QoL idea: surface what the area/dialing code maps to (region) as a hint.
    - **Calendar / DatePicker family** (Tier 3/4, on bits-ui + **`@internationalized/date`**): BUILT, and since the owner's ruling of 2026-09-08 the interim is over — **`type="date"` is banned outright** and `lint:date-handling` fails one anywhere, this package included (`docs/conventions/dates.md`). The other native types (`datetime-local`/`month`/`week`/`time`) remain a thin interim. In particular **native `type="week"` is hard-locked to ISO 8601 (Monday-start, ISO week numbers) — not locale-aware, not configurable**; firm/locale-configurable week-start (Sunday/Saturday/Monday) requires the custom picker, where week-start is driven by locale and/or a firm setting (ADR-0040). `@internationalized/date` (the ADR-0055 civil date) supplies locale-aware `startOfWeek`/week-info.
    - **Country selector / State·Province·County (admin-subdivision) selector**: data-backed Selects (on the future Select/Combobox, Tier 3), populated from a reference dataset and searchable; Country feeds PhoneInput's dial code AND drives the subdivision list + postal format. Address-field family.
    - **AddressFields** — **BUILT** (2026-09-08, `src/lib/components/address-fields/`), so it has left this planned list. `address-format.ts` is the per-country table — the field SET, the labels and the ORDER, keyed by ISO 3166-1 alpha-2, with `INTERNATIONAL_FORMAT` for a country nobody has entered; `address-fields.svelte` puts the country FIRST because it decides the rest. Three rules it must keep: it never moves a value between fields when the country changes (the stored columns are named for their POSITION in an address, which is what makes the form a presentation of them); a value the new country's form has no line for is STATED, never dropped; and nothing is required, because an address a firm holds half of is still the address it holds. The table is a curated SHAPE, deliberately not a reference dataset. The CONSTRAINTS — postal-code patterns and administrative-area lists — are `@magna-carta/address-formats`, generated from the address-internationalization corpus, and reach the form as the optional `postalCodeNote` and `administrativeAreas` props, because this package links exactly one workspace package by design and the form stays domain-blind. A malformed code is the field's hint, never its error; the region list is a native datalist, because the region is not a closed choice. The optional `lookup` prop (`street-lookup.ts`, `street-suggestion-field.svelte`) turns the street box into a free-text combobox that offers real addresses: what is typed IS the street line, a chosen address replaces the parts it carries and leaves the rest, a group opens rather than fills, and after a failure it asks nothing until Try Again. Its three primitive traps — a choice writes the row's label into the input, `open` reaches bits one way only, an identical re-choice reads as no change — are each pinned in `apps/web/test/address-fields-street-lookup.test.ts`. Adding a country is one entry in `FORMATS`; removing one silently re-labels every address already entered under it.
    - **PaymentFields** (credit card): **do NOT build raw card-number (PAN) inputs** — wrap the payment processor's tokenized/hosted fields (Stripe-Elements-style) so raw card data never touches our app and **PCI-DSS** scope stays out. Card-type detection / Luhn / expiry / CVC formatting are the processor's, not ours.
    - **National / Tax ID** (SSN, EIN / NINO, Company No.): **jurisdiction-aware** (not US-hardcoded), masked display (show last 4), strict per-jurisdiction format. Sensitive **PII** — golden rule 4 (never logged) + the secrets/encryption invariants (encrypted at rest).
    - **ColorPicker** (theming/firm-settings, with 0·7b settings registry): bespoke (Bits has no color primitive), built on **Culori** so it speaks **OKLCH** and gamut-maps — NOT native `type="color"` (sRGB hex, no gamut, no OKLCH anchors). Its brand-color use feeds `@magna-carta/design-tokens`'s `scripts/generate-theme.ts` (brand hue/chroma/neutral-tint anchors → generated ramps); a generation-time contrast check already exists there. Note: launch theming is the curated theme **gallery** (ADR-0040 firm setting) — a custom-brand picker is the UI for the generation engine's custom path, a step beyond the gallery.
    - **Cross-cutting:** most of these need ONE shared **input-mask primitive** (phone/card/SSN/EIN/ZIP+4/date all format-mask — decide the masking approach once, not per component), and most depend on the Tier 3 **Select/Combobox** landing first.
      All owner-flagged 2026-06-13.
  - **The two auth compounds are BUILT** (they left the planned list above when the sign-in screen landed):
    - **PasswordInput** — composes Input (it does not restyle one, so the field keeps the single text-field recipe) and adds an in-field Show/Hide toggle: a real `type="button"`, `aria-pressed`, and an accessible name that CHANGES with the state ("Show password" / "Hide password") so a reader announces what pressing it will do. The toggle is its own small recipe rather than a ghost Button because it must fill the field's block extent and carry no control height of its own — the Button recipe's `min-block-size` + padding fight both. The revealed value is never logged or emitted (golden rule 4).
    - **VerificationCodeInput** — the segmented one-time-code control over **bits-ui PinInput**. Bits keeps ONE hidden input stretched across the row and the cells are presentational boxes marked `data-active` under the caret; that is what gives typing/backspace/arrow/paste behaviour for free AND what makes platform autofill work (`autocomplete="one-time-code"` on a single target, where six inputs would offer autofill six disjoint ones). The active cell takes the field's merged focus edge — the caret position IS the focus indicator — and disabled is read off the hidden input with `:has()`, since the state lives on the input while the muting lands on the cells. Digits are set in the **display serif at the 2xl step**: the second recipe (after Masthead) allowed through that door, because a code is a short ceremonial transcription where the reading face's tight sans makes 0/O and 1/l work harder than they should. Its `inputId` prop is what a `<Label for>` binds to; `inputRef` is bindable so a consumer can `focus()` it.
    - **Input gained a `size` axis** in the same pass (`sm | default | lg` → the same `--mc-density-control-*` heights the Button uses, via `input/variants.ts`), because the auth fields are large controls and a height is not a utility concern. It deliberately **shadows the native `size` attribute** (a character count — a pre-CSS layout mechanism this recipe set has no use for); field width is a utility. The one consumer that used the native form (the WHOIS query field) moved to a width utility.
  - **Disabled must read at REST, not only on hover** (owner-directed 2026-06-13): a `:disabled` rule mutes COLOUR (`action-disabled` / `action-disabled-foreground`), never just `cursor: not-allowed`. Place `:disabled` rules AFTER the active/checked rules so they win at equal specificity — Switch/RadioGroup/Accordion were fixed for exactly this (their disabled state was invisible until hover); Checkbox is the reference.
  - **Clickable means `cursor: pointer`** (owner-directed): every interactive surface — buttons, the selectable rows (menu/select/command/combobox items), and the select/combobox triggers — uses `cursor: pointer`, not the Radix/shadcn `default`. Disabled stays `cursor: not-allowed`. (The owner expects the cursor to signal selectability; do not reintroduce `cursor: default` on a clickable.)
  - **Select (Tier 4) — bits-ui quirks the Command/Combobox share:**
    - **`Select.Item` renders `label` as the row text** (the row is `<Select.Item value="…" label="…" />` — no children); the `label` (not the children) is what bits shows in the trigger Value and matches for typeahead. Pass children only for a richer row, and keep `label` so the trigger/typeahead still read it.
    - **`Select.Root` needs an `items` (value/label) list.** Bits unmounts the Item components when the listbox closes, so without `items` the trigger Value falls back to the raw value after closing (the label is gone) and typeahead-while-closed + form autofill don't work. Pass the same list that backs the rows.
    - **Multiple value is normalised to `items` (list) order.** Bits appends to the value array in SELECTION order, so the trigger would join labels in pick order; Root re-presents it in list order via a pure `$derived` fed through the **function-form `bind:value`** (getter returns the reordered value, setter writes raw selections back — no write-in-`$effect`). The discriminated-union value (string vs string[]) can't be statically narrowed through a wrapper, hence the one `as never` getter cast.
    - **`allowDeselect` defaults to true** (bits ships it false): a single select returns to the empty/placeholder state by re-clicking the selected option (multiple ignores it). Required fields that must keep a value pass `allowDeselect={false}`. bits closes a single select on a NEW pick but not on deselect, so Root also closes it when the single value clears (via `bind:open` + the value setter) — every single-select pick (set or clear) closes consistently.
    - **The trigger's role is `combobox` + `aria-haspopup="listbox"`** (the ARIA select-only combobox; Bits made the switch from `button` in 2.20). Query it as a combobox by name in tests; the listbox/options use `listbox`/`option` with `aria-selected`. The role is also what keeps a labelled trigger clear of axe's `label-content-name-mismatch`: a combobox's name is its field and its shown text is its value, whereas a button's shown text is its content and has to sit inside its name. `MergeFieldPicker`'s Popover trigger takes `role="combobox"` for the same reason. Any trigger that SHOWS a chosen value under a caller's label is one of these, never a plain button.
    - **Content sizing rides inline `style` on the element, not the recipe:** the panel uses the GENERIC `min-width: var(--bits-floating-anchor-width)` + `max-width: var(--bits-floating-available-width)` (`LISTBOX_PANEL_STYLE` in `internal/floating.ts`) and the viewport's `max-height: var(--bits-floating-available-height)` (not the `--bits-select-*` aliases) — Bits-owned variables, not `--mc-` tokens, so the components.css purity gate keeps them out of the recipe, and the generic names let the same `select-content` component serve Combobox too. The alignment and collision defaults are the shared ones (see the z-order and alignment gotchas below).
  - **Command (Tier 4) — the command palette:**
    - **A palette has no open/close of its own — host it in a Dialog** (the Cmd+K pattern): the Dialog supplies the trigger, focus trap, and dismissal on outside-click/Escape. Give `Dialog.Content` `class="overflow-hidden p-0"` + `showClose={false}` and the `Command.Root` `class="border-0 bg-transparent"` so the dialog chrome hosts a border-less palette edge-to-edge. (Testing the outside-click: the body has `pointer-events:none` while a dialog is open, so click the `.mc-dialog-overlay` scrim, not `document.body`.)
    - **The matcher is a seam:** `Command.Root` defaults to a plain case-insensitive substring match (value + keywords); pass `filter` to swap in a richer scorer or the firm search index. bits' own default is fuzzy (computeCommandScore).
    - **`Command.Empty` needs a `Command.Viewport`** inside `Command.List` — bits points the search Input's `aria-controls` at the Viewport node, and without it the combobox input fails axe's `aria-required-attr`. Structure: `List > Viewport > (Empty, Group > GroupHeading + GroupItems > Item)`.
    - **`Command.List` is keyed on `search === ""`** — bits re-creates the list node when the query crosses empty/non-empty, so a captured `within(listbox)` reference goes stale; query fresh after typing.
    - **Two axe tensions on a filterable listbox** (both inherent to the pattern, not defects): an EMPTY result set leaves the listbox with no `option` children (`aria-required-children`) — the "No results" message is the SR feedback, so leave showcase stories populated; and a SCROLLING command list driven by aria-activedescendant has no tabbable content (`scrollable-region-focusable`) — keep the showcase short/unbounded and bound height only where the run ends non-scrolling, or accept the documented exception. Command auto-highlights the first match as you type (assert that, not an ArrowDown to "first").
  - **Combobox (Tier 4) — the virtualized picker:**
    - **Reuses Select's listbox parts.** bits implements Combobox's Content/Item/Group/GroupHeading/Viewport/ScrollButtons with the SAME components as Select, so the Combobox index re-exports the Select wrappers (golden rule 1); only Root/Input/Content are Combobox-specific (Content differs only to avoid a scrolling Viewport — see virtualization).
    - **Filtering is consumer-controlled, and the input is DATA-SAFE.** bits' `inputValue` is non-bindable, has no change event, and is never reset on close — so typed-but-unchosen text would persist (bad data). The data-safe single-combobox pattern: the consumer owns the input text as `$state`, passes it as the controlled `inputValue`, updates it from the Input's `oninput` (this query also drives the `$derived` filter — what lets the list virtualize), sets it to the chosen label in `onValueChange`, and **resets it to the selected label (or empty) in `onOpenChange` when closing**. The value is then always one of the options. (A future single-select-combobox convenience could bake this in; for now it is the documented consumer pattern.)
    - **Root wires `aria-controls` itself.** bits' combobox Input sets `role="combobox"` + `aria-expanded` but NOT `aria-controls`, so `Combobox.Root` mints a listbox id (`$props.id()`) into context (`combobox/context.ts`); the Input consumes it for `aria-controls` and the Content uses it as the listbox element id.
    - **Virtualize with `internal/virtual-list` INSIDE `Combobox.Content`** — never a scrolling Viewport (it would fight virtua's own scroll). VirtualList wraps virtua's **`Virtualizer`** in its own `overflow-y-auto` container, so a `max-height` makes it FIT its content when there are few rows and cap + scroll + virtualize when there are many. **Hard-cap the visible rows** so the dropdown never stretches to the screen bottom: `style="max-height: min(var(--bits-floating-available-height, 18rem), 18rem)"` (≈8 rows; the cap value wants a token from the design-language workshop). The virtualized activedescendant listbox is the documented `scrollable-region-focusable` axe exception (disabled per-story with justification). A benign `ResizeObserver loop…` console message from virtua does not fail the test.
  - **Calendar / DatePicker / DateRangePicker (Tier 4) — the date family:**
    - **Values are `@internationalized/date` CalendarDate** (the civil date, ADR-0055) — never ZonedDateTime (the known weekday-shift bug). Calendar takes `type` ("single"/"multiple"); DatePicker holds one CalendarDate (NO `type` prop — passing one crashes the floating-layer render); DateRangePicker holds a `{ start, end }` range.
    - **`civilDateValue` / `civilDateText` / `civilDateTextOrEmpty` (`date-picker/civil-date-value.ts`) are the ONE conversion between the picker's value and the `YYYY-MM-DD` text a record holds** — six surfaces had written the same six lines, four with the same comment word for word. They sit beside the picker rather than in `@magna-carta/civil-time` (which owns what a date IS) because `CalendarDate` is this component's value type and nothing else's, and a package the Worker imports should not take on a date library to serve a conversion only a browser makes. `apps/web/src/lib/dates/` re-exports them. They do not re-answer "is this a date" — `parseDate` refusing IS the answer.
    - **`label` and `aria-label` name the field, and they land on DIFFERENT elements.** `label` is the primitive's own (it mints the id the segment group's `aria-labelledby` points at); `aria-label` is forwarded to the group. Both are declared props for a reason: the spread goes to `DatePicker.Root`, which renders NO DOM, so an `aria-label` left in `restProps` vanishes with no warning and leaves the field unnamed. Use `label` where a label is visible, `aria-label` where there is no room for one (the grid column filter's From/To range).
    - **A labelled DatePicker renders TWO SIBLINGS, not one element** — the primitive's Root is a context provider with no DOM, so the label and the segmented field come out side by side with nothing around them. In a flex column they stack; **in a grid they take two tracks and the label lands in the next column**. Give one a wrapper wherever it sits in a grid. The label's own `margin-block-end` is what makes the spacing work without a wrapper, which is exactly why the trap is quiet. **Open for the owner:** thirteen consumers wrap it in a `flex flex-col gap-4|gap-8`, and that gap ADDS to the label's margin, so the label-to-field distance is 8px or 12px depending on the surface. Having the component render its own wrapper and drop the margin would make it one element and one spacing — a visible change on every date field, so it is a design call, not a tidy-up.
    - **`size` is the Input's own scale, imported not redeclared** (`date-picker/variants.ts` takes `InputSize`) — a segmented date field and a text field share rows and filter menus, so a second height scale here would be a second answer to "how tall is a control".
    - **Each is a self-contained component that bakes the grid composition** (Header with prev/next + month/year jump-to selects, weekday head keyed BY INDEX — narrow labels repeat S/T and collide string keys — and week rows of Day cells from the `months`/`weekdays` snippet). DatePicker/DateRangePicker reuse the `mc-calendar-*` recipes; the range day states (`data-range-start/middle/end`, `data-highlighted`) add to the day recipe.
    - **Month/year navigation is native `MonthSelect` + `YearSelect`** in the header (not a static Heading), so any month/year is one pick away — essential for far-back dates like a birthdate. They are native `<select>`s (need an `aria-label`); query them as `combobox` by name and assert with `getByDisplayValue`. The year list defaults to ±111 years and is bounded by `minValue`/`maxValue`.
    - **"No past dates" / "earliest date" is the `minValue`/`maxValue` setting** — it flows through all three (pass-through), blocks out-of-range dates (`data-disabled`, unselectable) AND floors/caps the year dropdown. No past dates → `minValue={today(getLocalTimeZone())}`; a birthdate floor → `minValue` of 1900 so pre-1900 (bad data) is never offered. `isDateDisabled` / `isDateUnavailable` block individual dates. (Stories pin fixed CalendarDates for VRT determinism — never `today()` in a test.)
    - **Two bits quirks:** the `Header` is a `<header>` banner landmark — neutralize it with `role="presentation"` (axe `landmark-banner-is-top-level`); and the prev/next buttons are labelled "Previous"/"Next" by bits (its props win), so query those names, not "Previous month".
    - **DateTimeField is the one field for a moment** (`date-time-field/`, owner 2026-11-10): a day, a time of day, or both (`mode`), typed as Bits DateField and TimeField segments inside ONE `mc-date-field` box, with one Popover panel holding the compact `Calendar` beside a list of times. Its value is split on purpose — `date` is a CalendarDate, `time` the stored `HH:MM` string — because a record stores a civil day and a wall-clock time, never a ZonedDateTime. The list is a shortcut, not a constraint: `time-choices.ts` steps by `timeStep` and inserts an off-step time in its place so the list always marks what the field holds; `durationFrom` starts the list after a same-day start and labels each row with how long it runs. `allowNoTime` adds a first row (`noTimeLabel`) bound to `noTime`, which is how a record's "all day" is said. The times are printed by `formatWallClockTime` (formatters/wall-clock.ts), the display vocabulary's answer for a time with no day or zone. The panel opens with focus on the chosen day or time rather than on the month heading.
    - **DatePicker.Content needs `DatePicker.Portal`; DateRangePicker.Content self-portals** (no Portal export) — match each component's bits exports.
    - **DateRangePicker: `closeOnRangeSelect` defaults false** (stays open to adjust) and supports **drag-to-select** — bits' range calendar is click-only, so we drive the bound `value` from the day's pointerdown→pointerenter (a drag spans different days, so no bits `click` fires for it and the two paths coexist; `<svelte:window onpointerup>` ends the drag). The in-range band keeps `text-default` (the endpoints' white must not bleed onto it).
    - **`pointerdown` resets the selection to the pressed day ONLY when a COMPLETE range already exists** (`value.start && value.end`) — so pressing a day clears the old range at once instead of it lingering until the pointer reaches another day (the owner's "only changes once I cover the other date" feel). It deliberately does NOT reset while a selection is in progress (start picked, end not), so bits' native click-a-start-then-click-an-end still works. Both paths are covered by the story's play test (click-click, drag, and press-resets-at-once).
    - **The selection's darker edge is a grey `border-strong` ring drawn with PER-SIDE borders** (token-pure — `box-shadow` offsets would need bare `0`/`calc(… * -1)`, which the components.css purity gate rejects; `border-block` + `border-inline-*` need none). The ring frames selected cells only, never the seams where selected days touch: each endpoint is **open on the band-facing side** (start = `border-inline-end-width: var(--mc-space-0)` + left-rounded; end = opposite), and a lone date (`start===end`) is a full rounded ring. **Today is a full rounded ring on a `transparent` background — the colour BEHIND it does the work.** A standalone today sits on the white surface; inside a range, the day's CELL is painted the band colour via `.mc-calendar-cell:has(.mc-calendar-day[data-today][data-range-middle])`, so the rounded ring reveals GREY at its corners and today reads as a seamless rounded ring IN the band — not square (the owner rejected square), not a white cut-out (the owner rejected the white box), and not a rounded grey square leaking the white surface at its corners. **Today is declared BEFORE the endpoints** and the endpoint rules zero their band-facing border, so an endpoint that is today still reads open. Owner-settled (2026-06-16, option "endpoint rings open to band" + grey-blended rounded today) over a pill-outline, a full-box-on-every-endpoint, and a white-cut-out alternative.
  - **Form field family (Tier 4, formsnap + superforms):**
    - **Field/Control/Fieldset/Legend/ElementField are re-exported from formsnap unchanged** (pure logic carrying the generic `SuperForm` typing + the name/id/aria/aria-describedby/aria-invalid wiring); only Label/FieldErrors/Description are styled wrappers. Compose `Field > Control({#snippet children({ props })} → <Label/> + our input `{...props}`) > Description > FieldErrors`. The field's vertical spacing is the `mc-form-field` wrapper recipe (Field renders no DOM).
    - **superforms needs SvelteKit's `$app/*`** (navigation/stores/environment/forms) which the plain-Vite Storybook lacks — stubbed in `.storybook/sveltekit-stubs/` and aliased in `.storybook/main.ts` (`viteFinal` resolve.alias). Any superforms-backed story relies on these.
    - **Story validates client-side** (`superForm(defaults(zod4(schema)), { SPA: true, validators: zod4(schema), validationMethod: "oninput" })`) so it shows errors without a server (avoids the enhance/submit path). Set `warnings.duplicateId: false` (the story renders more than once). Error text uses `--mc-status-danger` and passes axe contrast in the flagship theme (revisit per theme).
    - **The form-story submit path needs a real `$app/forms` enhance stub, not a no-op** — superforms drives submission through SvelteKit's `enhance`, so a no-op lets the native submit navigate (a 404 in the catalog). The stub (`sveltekit-stubs/forms.ts`) mirrors enough of the enhance contract — `preventDefault`, hand superforms the submit params, stop on `cancel` (SPA mode always cancels after validating) — so submit validates in place with no fetch.
    - **Email-TLD validation uses the `tlds` package (the IANA root zone), not a hand-written set** — the address shape is a regex; the ending is checked against `new Set(tlds)` so a real-but-short (`.c`) or plausible-but-fake (`.zz`) TLD is rejected, only existing TLDs pass. `tlds` is pinned in the catalog and is **the same list the app's real form schemas import**, so there is one auto-published source to track. `psl` (public-suffix list) is the wrong tool here — it parses registrable domains (eTLD+1), a different question than "is this a valid TLD"; adopt it only if a real registrable-domain feature appears. The story's schema is a UI demo; the authoritative validator lives with the app's form slice (and reuses `tlds`).
  - **Future component families (owner-flagged 2026-06-13), beyond the Tier 3/4 plan:**
    - **Slider** (Inputs, Tier 3) — a value control on bits-ui Slider; value-driven fill like Progress.
    - **DropdownMenu / ContextMenu** (Overlays, Tier 3) — menus of actions on bits-ui Menu/ContextMenu; floating (the floating module) and likely the FIRST scroll-locking floats, so the CSP scroll-lock `pnpm patch` lands here.
    - **AI components** (new domain family, later — more complex): streaming-response surfaces + status indicators (token streaming, tool-call status, stop/regenerate). A richer composite; design separately when AI features land, likely its own catalog category.
  - **Status surfaces use the gated solid pairing:** an Alert is a solid `status.<v>` panel with `status.<v>-foreground` (the AA-gated pair); a status colour as **text on a light surface is ungated and can fail AA** — do not use it until `status.*-subtle` tokens exist.
  - **Animations pulse between token colours, not opacity** (no opacity token; opacity literals are banned) and carry a `prefers-reduced-motion` guard (Skeleton).
    - **The component is its own skeleton (owner ruling 2026-09-05, closing the 2026-06-13 evaluation).** `LoadingRegion` (`src/lib/components/loading-region/`) is the ONE loading state: a region renders its real markup over a `fixture` snippet under the `mc-loading` recipe, which greys every text leaf (any element with no element children and some text), media and controls, and keeps furniture (`th`, `label`, `legend`, `caption`, `dt`, `.mc-label`, `.mc-field-label`, `[data-loading-keep]`; `[data-loading-block]` makes a container one bone). Text is hidden with `-webkit-text-fill-color`, not `color`, because a utility in the utilities layer beats any `color` set here; the recipe is imported LAST in `styles/components.css` so it wins at equal specificity — keep it there. The region holds the whole state set — `failed`/`failure` first, `loading`/`fixture`, `empty`/`emptyState`, the children, and `refreshing` for a re-read that keeps the content — and is `inert` and `aria-busy` while loading, with one `role="status"` line that carries the sentence and then `finishedSentence(label)`; past `STALLED_AFTER_MILLISECONDS` it states the stall with Retry (`onRetry`), and every settle writes a User Timing measure and dispatches `mc-loading-settled`, which the app shell records as a breadcrumb. It has no colour or pulse props; `stalledAfter` is the one test seam. Fixture words come from `src/lib/loading-fixtures/` (the sample vocabulary), never typed inline; `fixture-shape` fails a fixture rendering a component its children do not, `silent-loading` a null branch that renders nothing, and `loading-label` a label outside the house voice (a capitalised gerund, never "Loading", no terminal punctuation — the finished and stalled sentences are derived from it). `Skeleton` is no longer exported: it is the internal box of the six components that render placeholder rows of their own shape (`DataTable.Grid` — count prop `placeholderCount` — `EventRail`, `RecordParties`, `RecordAttachments`, `CalendarGrid`, `FolderTree`), which are the `loadingHomes` declared in `tooling/lint-one-ui/registry.json`; `hand-placed-loading` fails the Skeleton, `mc-skeleton`, `aria-busy`, `animate-pulse` and loader-glyph signals everywhere else, on both sides of the line. phantom-ui and boneyard-js were evaluated and declined (`docs/research/2026-09-05-skeleton-loading-framework.md`): every measuring approach needs a fixture anyway, and once it exists the measuring is the part worth dropping.
- **Catalog model (owner-settled): one story per variant/instance; autodocs is the review surface.**
  - **Catalog taxonomy (owner-settled 2026-06-13): semantic categories as the story-title prefix, NOT a flat `Components/*`.** A story's `title` is `<Category>/<Component>`. Categories: **Inputs** (Input, Textarea, FileInput, Label, Checkbox, Switch, RadioGroup, + future Select/Slider), **Compound Inputs** (composed/specialized data entry — the dedicated-components list above), **Actions** (Button), **Data Display** (Badge, Card, Keyboard, Avatar), **Feedback** (Alert, LoadingRegion, Skeleton, Progress, Tooltip), **Layout** (Separator, Tabs, Accordion), **Overlays** (future — Dialog, Popover, DropdownMenu, ContextMenu), **Foundations** (the Design Tokens board). Established while the catalog was small and no VRT baselines were committed (re-titling changes story IDs, so it's cheapest before baselines exist). New components pick the matching category.
    - **Inputs vs Actions — the delineation** (owner question 2026-06-13): an **Input holds a VALUE** the user sets and a form reads (checked/selected/typed) — Checkbox/Switch/RadioGroup/Input/Select/Slider, even though they're "interactive", are Inputs because their job is state. An **Action triggers a one-shot operation** and holds no value — Button (and menu items). Test: "does it carry a value, or fire a command?" Menus (DropdownMenu/ContextMenu) are overlays OF actions → **Overlays**.
  - **One story per the component's main "variant" axis** (Button per variant; Alert/Badge per variant; Separator per orientation); a component with no variant axis is ONE story (Textarea, FileInput, Card, Label, Skeleton, Keyboard). **Every OTHER prop is a Control, not a story** — `size`, `disabled`, `href`, `placeholder` are toggled in the Controls panel, never enumerated as stories.
  - **Input is the deliberate exception — one story per `type`** (owner-settled 2026-06-13): the text-like types are not interchangeable, each carrying its own validation rules, mobile input-mode/keyboard, and autofill semantics (so `text`/`email`/`tel`/`url` differ even though their resting box looks alike). Each type's story sets the attributes that make it meaningful (e.g. `number` min/max/step, `tel` inputmode, email/url showing constraint validation), and `type` stays a `control: "select"` so any type is still toggleable. This is the one place `type` is enumerated rather than left a Control.
  - **No separate Playground** — the **first story IS the Docs-page Primary**, and autodocs wires the **Controls** panel to it.
  - **ALL controls live in the docgen "Properties" group — declare controllable props on the COMPONENT, not in story argTypes.** A prop defined only in a story's `argTypes` that has no matching component prop renders in a SEPARATE group that floats above "Properties" (the docgen group; its name is not settable, so you cannot merge into it via `table.category`). So commonly-controlled native attributes (`disabled`, `href`, `placeholder`) are declared EXPLICITLY on the component with a **JSDoc comment** (docgen reads it for the description) instead of being left to the `...restProps` spread — then they appear under "Properties" with descriptions, no floating, no extra category. Story `argTypes` are used ONLY to give enum props (`variant`, `size`, `orientation`) their explicit `control: "select"` + `options` (those props are already on the component, so they stay in "Properties").
  - **Bits-UI (Tier 2+) components MUST whitelist controls — `parameters.controls.include`.** Bits' prop types resolve to `Without<BitsPrimitive…Attributes, …>` mapped types that **materialize every HTML attribute** (`aria-*`, `data-*`, all `on*` handlers, the global attributes), and docgen turns each into a control — Tabs.Root showed **439** rows before the whitelist, 5 after. (Native Tier 1 wrappers don't hit this: svelte docgen leaves an imported `HTMLXAttributes` opaque, so Input shows ~5 with no whitelist.) So every Bits story sets `parameters: { controls: { include: [the meaningful props] } }` and uses `argTypes` to give its enum props `control: "select"`. The whitelist also trims the autodocs "Properties" table.
  - **Consolidated controls system — ONE rule, applied to EVERY story (do not deviate per-component):**
    1. **`args` holds ONLY the component's declared props** (the real API — they land in the "Properties" group). **Per-instance attributes go in the TEMPLATE, never `args`** — the accessible name (`aria-label`), a number field's `min`/`max`/`step`, etc. An undeclared attribute placed in `args` renders as a control FLOATING above "Properties" (ungrouped) — that's the bug to avoid (Input's per-type stories regressed this with `aria-label`/`min`/`max` in args; fixed by moving them to the template).
    2. **`ref` is hidden globally** (`preview.ts` `controls.exclude: ["ref"]`) — it's the bindable element reference, not a configurable prop.
    3. **Properties are alpha-sorted globally** (`preview.ts` `controls.sort: "alpha"`) — svelte-docgen's own order is non-deterministic across components, so force one order. (preview-config changes need a Storybook RESTART to re-bake the docs blocks, not just HMR.)
    4. **A prop Bits owns at mount is NOT a live control** — `value` (Tabs/RadioGroup), `type` (Accordion) don't switch behaviour when edited live, so they're the **variant axis (one story per value)** or a fixed per-story arg, never a misleading control. Two-way-bound state (`checked` via `bind:checked`) IS live and stays a control.
  - **autodocs is on** (`tags: ["autodocs"]` in `preview.ts`; `@storybook/addon-docs`): each component's **Docs page is the single review surface** — description → controllable Primary + Controls → the auto "Properties" table → every instance as its own labelled block. Storybook cannot auto-generate a variant matrix from types; the per-instance stories ARE the showcase.
  - **Behaviour not visible on a showcase story rides a hidden test-only story** tagged `["!dev", "!autodocs"]` — it runs in the test addon but is absent from the sidebar and the Docs page (Button's `Behaviour` story tests submit-proof type, disabled-blocks-click, and href→anchor, none of which a variant story shows). Where the behaviour IS on a visible instance story (Alert role, Input typed/disabled, Label focus), keep the assertion there.
  - **Every `play` wraps its assertions in named `step()` calls** (the play context's `step`, no import) — one step per beat (`"Starts unchecked"` → `"Clicking checks it"`). The play functions ARE the behaviour tests, but a bare list of `expect(...)` lines reads as noise in the Interactions panel; `step()` turns each into a labelled, collapsible checklist that doubles as living documentation of what the component guarantees. Keep element lookups above the steps; put each interaction + its assertions inside the step it proves. (Owner-directed 2026-06-13 — the panel must read as a checklist, not a wall of assertions.)
  - **Never two stories rendering the SAME thing** (duplicates stack on the Docs page — the owner saw "two cards on top of each other").
  - **Visual-tests addon** (`@chromatic-com/storybook`) is installed but **inert** until a Chromatic token is set; the recorded primary VRT is the self-hosted Playwright harness (Argos the named upgrade) — revisit which SaaS before relying on Chromatic.
- **`ContextMenu.GroupHeading` outside a `ContextMenu.Group` stops the menu OPENING, silently.** No
  console error, no failed render, no thrown exception a caller can see — the right-click simply does
  nothing, which reads as "context menus do not work here" and sends you looking at the trigger. A
  heading that names no group has no group to name: either wrap the items in `ContextMenu.Group`, or
  use the plain heading element the other menus use (`<p class="mc-table-filter-heading">`), which is
  what the grid's column filter menus do. Found the hard way, 2026-09-02.
- **`#NNNN` issue references in `src/` comments trip the raw-hex gate** (four hex digits) — cite
  issues in full URL form or use a justified `fitness-allow`.
- **No-emoji gate (golden rule 2)** is the fifth off-token scanner (`test/fitness/off-token.test.ts`):
  it bans the pictographic ranges (emoji planes U+1F000–1FAFF and Misc Symbols U+2600–26FF, where an
  emoji's base always falls) across the UI source sweep. Text symbols the codebase uses in comments —
  arrows (→ ↔) and the dingbat ✕ — are deliberately NOT banned. Docs + commit messages are
  golden-rule-2 surfaces too, enforced outside this UI-source sweep (review + commit hooks).
- **z-order (decided 2026-07-03):** anchor-positioned floating content (select/combobox
  listboxes, menus, popovers, tooltips) rides the `anchored` layer (1350) — ABOVE `modal`
  (1300), below `toast` — because a picker opened from inside a dialog painted beneath the
  panel at the old `dropdown` layer (visible but pointer-blocked; the Radix/Bits ecosystem norm
  is anchored content above dialogs). **Every floating Content part takes `anchored`** — the two
  context-menu parts were the last on `dropdown`, and a right-click menu raised inside the Upload
  dialog painted under the panel, there and unreachable (corrected 2026-09-11; the ContextMenu
  story "Inside a dialog" pins it). `dropdown` (1000, below `sticky`) stays a token for a
  non-portaled surface that should scroll under pinned bars; no floating part may name it, and
  `test/floating-surfaces.test.ts` refuses one. One home: `internal/floating.ts`; ordering pinned
  by `test/floating.test.ts`.
- **Where a surface opens, and how wide it may grow, is the component's — never the call site's
  (owner ruling, settings round 2026-09-11).** Select, Combobox, DropdownMenu and Popover Content
  all default to `align={FLOATING_ALIGN}` (`"end"`: the panel's end edge on the control's, growing
  toward the start — most controls that open one sit at the right of a row or a bar), hold
  `FLOATING_COLLISION_PADDING` off the viewport, and cap their width to
  `--bits-floating-available-width` (`FLOATING_PANEL_STYLE`; the listboxes also floor it at the
  anchor width, `LISTBOX_PANEL_STYLE`), so a long option wraps inside the panel instead of running
  it off the screen. All four constants live in `internal/floating.ts`; `test/floating-surfaces.test.ts`
  pins every part to them. A caller's explicit `align="start"` (a filter at the start of a
  toolbar) still wins, and a caller's `style` is composed AFTER the panel's own through
  `floatingContentStyle()` — never spread over it, or the width rules vanish. The ninety-five
  hand-written `align="end"` in `apps/web` are now redundant and harmless. A context menu is NOT
  one of these: it anchors to the pointer and keeps Bits' start alignment. **The Combobox anchors
  to the field box, not the input:** Bits anchors a combobox to the `<input>` alone, which sits
  inside the bordered field and short of the chevron, so Root shares the field box through
  `COMBOBOX_FIELD_ANCHOR`, Input fills it, and Content uses it unless a caller passes
  `customAnchor`. What the end alignment cannot promise: a panel wider than the room to the START
  of a left-anchored control has nowhere to go but rightward, and Bits' shift puts it on screen
  there rather than off it.
- **Workshop agenda (hairline weight under fractional DPR) — flagged for Fable design review:**
  the horizontal and vertical Separator can look unequal in weight even though both are correctly
  `1px` (`--mc-border-width-default`) — horizontal sets `block-size`, vertical `inline-size`, same
  token. This is **not a code defect**: at a fractional `devicePixelRatio` (e.g. 1.5 / Windows 150%
  scaling) a 1px hairline is sub-device-pixel, so its painted weight depends on where the _parent
  layout_ places it. Measured in the catalog at DPR 1.5: the horizontal rule landed on an integer
  device-pixel boundary (`top 76px → 114.0`) → crisp, full-strength row; the vertical rule landed on
  a fractional boundary (`left 55.24px → 82.86`) → antialiased across columns at partial opacity →
  reads thinner/lighter. The effect is positional and shifts with scaling and surrounding content;
  it converges at integer DPR (100% / 200%). A component-level fix can't reliably solve it (position
  is the consumer layout's, not the separator's). Open decision for Fable: accept as an
  environmental hairline artifact, or adopt a device-pixel-snapping hairline technique
  system-wide — deliberate, not a quick patch.
- **Sidebar collapse seam tearing — RESOLVED (owner-flagged "not acceptable"; fixed via View Transitions).**
  The collapse used to animate **layout** properties (the rail `inline-size`, the menu-button
  `grid-template-columns` `1fr→0fr`, the label `padding`), repainting the sidebar↔canvas seam every
  frame; at a fractional device-pixel ratio (Windows 150% scaling) that 1px border edge shimmered/tore.
  Profiling showed it was **not** a frame-rate problem (avg ~16.7ms/frame, 0 long frames) — purely the
  sub-pixel **paint seam**. Fix: the collapsed-state widths/tracks now change **instantly** and the
  collapse is composited via the **View Transitions API** — the Trigger flips state through
  `runViewTransition` (`internal/view-transition.ts`), `.mc-sidebar` carries `view-transition-name:
  mc-sidebar`, and the work canvas (in the shell/story) carries `view-transition-name: mc-app-canvas` so
  it morphs rather than ghosting. The browser tweens before/after layouts on the GPU, so the seam is
  sampled, never re-rasterized → no tear. Reduced-motion / unsupported browsers fall back to an instant
  collapse. **The UX principle this establishes platform-wide: animate only compositor properties
  (`transform`, `opacity`) — never `width`/`height`/`grid-template`/`top`/`left`/`margin`; for an
  unavoidable layout change, wrap the mutation in `runViewTransition`.** Chosen over a hand-rolled
  `translateX`/spacer rebuild because View Transitions is the project's motion stack (Svelte built-ins +
  View Transitions at 0 kB) and far less invasive. Only collapse-unrelated interaction colour
  (hover/active) still uses CSS transitions. (Play test asserts the now-deferred state flip via
  `waitFor`.)
