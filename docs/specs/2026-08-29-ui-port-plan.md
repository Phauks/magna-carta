# Porting the mockups into the application — the component contract, the slice sequence, and the anti-duplication gate

**Status:** plan, for the owner. Written 2026-08-29, before any porting agent starts.

**What this covers.** The owner has authorized porting the design mockups — the matter file manager
(the Docket), the four financial matter tabs (The Matter Ledger: Time, Fees, Costs, Billing) and the
Time Sheet — into `apps/web` and `packages/design-system`, with one explicit requirement: _"use
agents to make sure they hook into the actual app and do not duplicate ui elements."_ This document
exists to make that guarantee **structural rather than hopeful**. It names every shared element as
ONE component with one public API before any screen is written, sequences the work so components
land before their consumers, and proposes the fitness function that mechanically rejects a second
implementation.

**What it is not.** It is not a redesign, and it decides nothing the owner has already decided. The
two ruling ledgers — [`file-manager-rulings.md`](../conventions/file-manager-rulings.md) (sixteen
rounds, roughly 150 rulings) and [`time-tab-rulings.md`](../conventions/time-tab-rulings.md) (seven
rounds, all four financial tabs plus the record window) — are the acceptance criteria of this port.
Every settled ruling must survive it.

**Where this sits.** [`CLAUDE.md`](../../CLAUDE.md) now records two standing directions that shape
everything below: **UI is built in the repository and reviewed on the deployed site**, and **`main`
is production** — a merge deploys within minutes with no second gesture. The mockups are therefore
the last of their kind; what survives them is the ruling ledgers (the regression memory) and the
harnesses that pin them.

---

## 0. The governing principle: this is a faithful transfer, not a redesign

**The port must not cost the owner a second review of every screen.** That is the whole risk, and it
is the risk this section exists to remove. Four requirements bind every porting slice below.

### 0.1 The mockup transfers as closely as the framework allows

The mockups were authored on the design system's own tokens, spacing scale and type ramp. The
published artifact is therefore not an approximation of the product's look — it **is** the product's
look, rendered by hand. So the visual result of a port must be indistinguishable from the artifact
it came from.

What changes in a port is the **wiring**, never the appearance or the interaction model:

| Changes                                      | Does not change                                            |
| -------------------------------------------- | ---------------------------------------------------------- |
| Hand-rolled JS → Svelte 5 runes              | Markup structure and element order                         |
| `innerHTML` string building → components     | Class names' semantic intent, spacing, type, colour        |
| Module-scope mutable fixtures → real API     | What a control does, when it appears, what it says         |
| `document.getElementById` → bound references | Keyboard model, focus order, hover and active treatments   |
| `localStorage` reads → the preference seam   | Copy, verbatim, including tooltip and disabled-reason text |

A porting agent's default is to **transcribe**, not to re-derive. Where a mockup's CSS rule has a
token equivalent it uses the token; where the mockup already used a token value it uses the same
one. Re-choosing a spacing value because "it looked about right" is a redesign, and it is the thing
this rule forbids.

### 0.2 No redesign decisions during the port

A porting slice makes no design judgments. Where the mockup and an existing design-system component
genuinely conflict:

1. **The component wins on structure.** We do not fork a component to match a mockup's markup.
2. **The component is extended so the ruled behavior and appearance survive.** The extension is the
   deliverable, not a compromise on the ruling.
3. **The conflict is reported, never silently resolved.** It goes in the slice's deviation list
   (§0.3) with both readings stated, so the owner can correct it in one line.

If a conflict cannot be resolved by extending the component, the slice **stops and asks** rather
than guessing. A guess here is a design decision the owner did not make, wearing the costume of an
implementation detail.

### 0.3 Every deviation is recorded and surfaced

**Each slice ships a deviation list.** This is the artifact the owner reviews — a short diff — in
place of re-reviewing the screen. It is part of the slice's definition of done, and a slice is not
done without it. A port with no deviations reports none, in as many words.

Each entry states three things:

- **What differs** from the mockup, concretely and visually ("the version-history rail's markers
  are 1px larger").
- **Why**, from a closed list of legitimate reasons: a **framework constraint** (Svelte or Bits UI
  cannot express the mockup's construction), a **real-data reality** (the fixture had one shape and
  the API has another), an **API that cannot answer** (the fact does not exist server-side yet), an
  **accessibility fix** (the mockup's construction fails axe or the keyboard model), or a
  **design-system conflict** per §0.2.
- **What it looks like instead**, so the owner can accept or correct without opening the screen.

"It seemed better this way" is not on the list. Neither is "the component did not support it" — that
is §0.2's extend-the-component path, not a deviation.

### 0.4 The rulings are the named acceptance criteria

Every slice below names the ruling ids it satisfies. Those ids are not decoration: the slice's tests
are written against them, and the harness checks that already cover them are translated into tests
that run against the **real screen** (§6). The owner's prior corrections then re-assert themselves
mechanically, which is the only durable answer to "does the port still have what round eleven gave
us".

A slice that cannot satisfy a ruling it names — because the server cannot answer it — says so in the
deviation list and carries the ruling forward to the slice that can.

---

## 1. Why a component contract, and why before the code

The mockups were built the way mockups are built: one HTML file per surface, machinery duplicated
where it was cheaper to copy than to factor. That was correct for their purpose and is fatal if it
ports literally. Three facts make the risk concrete:

1. **The mockups already discovered the answer and wrote it down.** `machinery.js`'s `mountSurface`
   builds all three WIP ledgers from one factory; `wip-shared.js`'s `recordModal` builds all four
   record windows from one shell. Round six recorded that this is "real, not a resemblance", verified
   by measurement. Round seven then promoted the record window from the artifact's shape to **the
   product's one component** (M3, binding, cross-surface), enforced there by a source-level fitness
   function. The port inherits that finding; it does not get to re-litigate it.
2. **The one-table ruling is already binding and already built.** TB2 ("one table system across the
   matter surfaces — any behavior gap between two tables is a defect by definition") landed in this
   repository this session as `DataTable.Grid`. Its own header comment states the ruling. Every table
   in this port is that component or it is a defect.
3. **The failure mode is silent.** A second table renders correctly, passes typecheck, passes lint,
   and looks right in review. It is discovered a round later when a ruling is fixed in one place and
   not the other — which is exactly how round nine found L11b (the pin glyph carried star geometry
   in one surface) and round twelve found L32b (the convert flyout still spoke category names). At
   nine surfaces and roughly 150 rulings, discovery-by-review does not scale.

So: components first, named, with their public API and their binding rulings, and a gate that
rejects the second implementation.

---

## 2. The component contract

**How to read this.** Each entry is ONE component with ONE home. `EXTEND` means the design system
already has it and the port extends it in place — building a sibling is a defect. `NEW-DS` means it
belongs in `packages/design-system` because more than one surface consumes it. `NEW-APP` means it is
domain-shaped and belongs in `apps/web/src/lib/<area>/`, still as one component with one home.

The API sketches are the contract the porting slices build to, not final signatures; a slice may
refine a prop name and must not add a second component.

### 2.1 The table family

#### T1. `DataTable.Grid` — the platform's one table (EXTEND)

**Home:** `packages/design-system/src/lib/components/data-table/` (built; extend in place).

**Already carries:** type-aware stable sorting with empties-last, the one-mechanism per-column
filters (text / set-with-counts / range / date range), in-header filter control at the cell's right
edge sharing one hover unit with reserved space, column show/hide, drag-reorder with anchored
columns leading, pinning at measured sticky offsets, resize grips with double-click fit, the
selection model (click / Ctrl / Shift / Ctrl+A scoped to the table / arrows / click-empty-clears),
activation as its own event, the scope-honest totals row ("Total" / "In view"), zebra, density, the
filtered-empty state that says why, and the footer with counts, filter state, selection and
"Select none".

**Extensions the port requires:**

| Extension                                                                                                           | Binding rulings          |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Conformance fixes to what shipped** (see §2.1a — four settled rulings the landed filter contradicts)              | L1, L2, L3               |
| **Row groups above a rule** — pinned items sit above everything, separated by a rule, in user-arranged order        | L11, P10, L38            |
| **Row marks** — a `rowMarks` seam for the pin glyph, clipboard cut/copy marking, and quieter deleted/inherited rows | L11b, L24, L38, S19, N28 |
| **The Scale control** — labelled-by-tooltip slider, 50–200%, scaling row height, row icons and the file area's text | L39b                     |
| **Row-level expansion** — a row states its impact in-line and expands to the affected list                          | N28, A22                 |
| **A totals-row/footer `end` grammar** that renders identically across four tabs from labelled figures               | L8, TL12, TL13           |
| **Icon-view sibling surface** sharing the same selection state and Ctrl+A scope (a layout, not a second table)      | L26, L43, A23            |

**Consumers (nine, and every one of them is this component):** file browse, Deleted Files, Search
Results, History, archive members, Time, Fees, Costs, Billing, the Time Sheet, and the review list's
row rendering.

#### T1a. The four conformance defects already in the landed grid

Found while reading `data-table-grid-filter.svelte` for this plan. These are not port work; they are
existing deviations from settled rulings, and slice 1 fixes them:

1. The set filter's narrow field carries `placeholder="Type to narrow the choices"`. **L3 struck
   that string everywhere**, and **L2** (global placeholder ruling) requires every ghost text to be
   the field's own name.
2. The set filter's select-all is a static `"Select all"` checkbox row. **L1** requires ONE reactive
   control that says what pressing it will do: everything on reads "Select none", anything off reads
   "Select all".
3. The set filter renders a `"Clear This Filter"` button. **L1** is explicit: a set filter with
   everything selected IS no filter, so a set filter carries **no Clear control at all**.
4. The text filter's `placeholder="Contains…"` is a description, not the field's name (**L2**).

That the platform's newest, most carefully built component already carries four ruling deviations is
the argument for §5's gate in miniature. Conformance is not a one-time act.

#### T2. `GridColumnsMenu` — the display-settings home (EXTEND)

**Home:** the same directory. Already carries the per-column checkbox with pin toggle and the zebra
row.

**Extends with:** the file-extension setting, the sidebar file-counts setting (T8), and the ordering
rule that display settings sit beneath the column list under a hairline in one family.

**Rulings:** L3, L6, L33, L35, L38, T8, TL9 (no reset control on the financial surfaces).
**Consumers:** all nine table surfaces.

#### T3. `GridColumnFilter` — one filter mechanism, parameterized (EXTEND)

Explicitly **not** per-column copies: one control parameterized by column type.

**Rulings:** L2, L30, L34, L34b, L36, L42, L44, X4, X5→L1, TB2a, TB2b, TC1, L1, L3, A27 (the
document-reference filter is this mechanism parameterized, not a new one).
**Consumers:** every table surface.

### 2.2 The record family

#### R1. `RecordWindow` — the two-pane record shell (NEW-DS)

**The single most important component in this port.** The owner ruled ONE of these across time
entries, fees, costs, invoices **and** the Time Sheet's full-entry window (M3, binding,
cross-surface). It is already enforced at the source in the mockup by a fitness function; that
function ports with it (§5).

**Home:** `packages/design-system/src/lib/components/record-window/`.

**Public API:**

```
heading: string
subtitleHtml → subtitle: Snippet          // the entry number is the subtitle's only home (M8/TL11)
record: Snippet                            // LEFT pane: the record, dense, TOP-ALIGNED
tabs: RecordWindowTab[]                    // RIGHT pane: context in tabs; { key, label, count?, content: Snippet }
defaultTab?: string                        // a record WITH attachments opens on that tab (M3)
actions: Snippet                           // the fixed-geometry bottom action bar (BV3)
onEdit / onPrint: () => void               // header controls, in this order, always four
editDisabledReason?: string                // disabled with the reason, never absent (M5)
expanded: bindable boolean                 // remembered for the session (M4)
open: bindable boolean
```

**The shell knows nothing about time, fees, costs or invoices.** A record type contributes its left
pane, its tab set and its action bar, and nothing else. The header action set is **exactly Edit,
Print, expand, close, in that order** — this is the clause the fitness function asserts.

**Binding rulings:** M1 (two panes, left dense and top-aligned), M2 (History is its own scrollable
tab), M3 (attachments a tab on every record type), M4 (fullscreen toggle), M5 (invoice takes the
same treatment), round seven M1 (the description wraps and grows), M3 (one window, four header
controls, source-enforced), M4 (Print layers ABOVE the window, never replacing it), M5 (Edit in the
header, out of the sidebar), M8 (each fact has one home), X2 (the three altitudes), BV3 (one action
bar, fixed geometry, disabled-with-reason never absent), P5 (capped at the viewport, only the body
scrolls), TD8 (fits without scrolling), TV4 (locked records open read-only with the reason stated
once), B1 (a bill states "draft" once).

**Consumers:** the Time record, the Fee record, the Cost record, the Invoice window, the Time
Sheet's full-entry window, and — by M3's own logic — any future record type.

#### R2. `RecordAttachments` — the attachments tab (NEW-DS)

**Home:** beside `RecordWindow`. One implementation for every record type; the mockup already
factored it that way (`wipAttachmentsTabHtml` / `wireWipAttachments`).

**API:** `attachments: Attachment[]`, `canEdit`, `onAttachUpload`, `onAttachExisting`, `onDetach`,
`onOpen`, `documentSource` (the matter's documents, with folders), `preview?: Snippet`.

**Behaviors that are ruled, not optional:** MANY files per record; any of them **removes** and
detaching is not deleting; a record that HAS attachments **opens on this tab**; two attach sources
where **"From the Matter…" is offered first** and picking an existing document **references** it
rather than copying; a document already attached is not offered again.

**Rulings:** M3 (round six), M9 (round seven), CR1 (superseded into this), the Time Sheet's
time-entry↔file association.
**Consumers:** all four record types, plus the Time Sheet row.

#### R3. `StatusChip` + the status register (EXTEND `Badge`)

`Badge` already ships the pale-tint status register (neutral / success / warning / danger / info /
accent) on the AA-gated `status.*-subtle` token pairs. **Extend it; do not build a chip.**

**What is new** is the **register itself** — one exported map from status key to label + tone +
tooltip, so no surface can invent a tone:

- The WIP chain: Draft / Submitted / Approved / Billed / Void.
- The invoice's derived standing: Draft / Unpaid / Partially Paid / Paid / Void.
- Fee charges off their invoice: Finalized / Paid / Credited.
- The file-manager safety value set: **Error / Warning / Info / "Not scanned"**, plus the bare filled
  circle-check for a clean typed file.

**Rulings:** X6 (one register, every column titled Status), X7 (void renders through the chip alone —
no strikethrough, no dimming, anywhere), TS1 (superseded in part), TS2 (one chip per row), TS7 (the
meaning rides the hover, never printed beneath), L47b (the safety value set), F12 (the analysis
severity vocabulary), I42 (the clean verdict is the filled circle-check), B1.
**Consumers:** all nine table surfaces, the record window's Billing tab, the details panels, the
folder aggregate chips, File Analysis.

#### R4. `RecordChain` — the chain and its lock (NEW-DS)

The stepper (Draft → Submitted → Approved → Billed → Paid) with its lock note. **Quiet by
construction:** it renders in the record's Billing tab and only where the review gate is on.

**Rulings:** TS3 (the chain, its language matching the billing-corrections model), A1 (de-emphasized
across all four tabs; gate reads default-OFF; vocabulary ABSENT rather than disabled when off), TS7,
X3 (states its fact and links its object; does not lecture), TV4.
**Consumers:** the four record types' Billing tabs; the read-only window's single lock line.

#### R5. `EventRail` — the history presentation (NEW-DS)

A marker per event on a hairline, the action semibold, one metadata line (instant · actor), any
recorded detail quoted beneath, oldest first, the latest marker filled. Scrolls inside its tab.

**Rulings:** TV5, M2, M8 (Date Entered and Entered By are the History tab's FIRST event), R5 (every
reclassification is on the record's history, first event), I44 (local time on every surface), L23
(never "Just now"), N27 (the actor column is "Source" where a non-person actor is possible).
**Consumers:** every record window's History tab; the file manager's version and safety histories;
the History view's details-panel presentation.

#### R6. `PrintSheet` — the printable unit (NEW-DS)

Every unit is printable; the sheet layers **above** the record window rather than replacing it, and
its Print hands that same sheet to the browser.

**Rulings:** TA1, TA2, M4 (round seven — layers above; the round-seven defect note is the reason),
TV6 (the panel keeps an icon-only Print), M6 (the memo is **absent by construction** from the sheet —
proved by test, not promised).
**Consumers:** time entry, fee, cost, invoice, the row menus, the details panel.

### 2.3 The ledger surface family

#### S1. `WipLedgerSurface` — the parameterized ledger template (NEW-APP)

`apps/web/src/lib/wip/`. The app-side twin of the mockup's `makeWipSurface`: one chain, one verb
set, one panel, one review list, one dialog family, one record window. A surface contributes only
its **columns, its fields and its own words**.

**Rulings:** F2 (Time and Fees are similar screens off ONE parameterized template; Costs runs off it
too), TB2 carried up to a whole surface, TT2 (controls share the tabs row), TT4 (button cluster
order), L7 (the footer states figures and is not a navigation surface), L8, X1, X2.
**Consumers:** Time, Fees, Costs. (Billing is a sibling built on the same table and record window
but is an overview-that-drills-down, per BV4 — recorded so nobody forces it into this template.)

#### S2. `DetailsPanel` — the smaller details, one opener (NEW-APP)

**Rulings:** X1 (**selection is not presentation** — the panel opens ONLY from its explicit toggle;
open, it follows the selection; closed, selection never opens it; the open state persists per tab),
N29 (the same ruling issued cross-surface on the file manager, with persistence), TV3, TV1
(superseded in part), TL15 (no heading, no captions), TV6, BV2 (the billing sidebar cut to a
fraction), A14 (unselecting reaches the panel), N22c (a history row presents in the panel and keeps
the reader in the list).
**Consumers:** all four financial tabs, the file manager's inspector host, History.

#### S3. `ReviewList` — the approval queue as a long list (NEW-APP)

One shared component for Time and Costs. Every submitted item on one list, inline Approve and Kick
Back per row, bulk over the selection, ArrowUp/ArrowDown walking it with A and K on the tooltips,
everything readable without opening anything.

**Rulings:** TR2 (supersedes TS9's one-at-a-time queue), TS4, TS8 + CK1 (the reason is optional and
recorded when given), CR2 (a cost under review shows its receipt beside it), A1 (reachable as a
plain icon control with its count on the hover, never a headline button), TL14.
**Consumers:** Time, Costs.

#### S4. `RecordMenu` — the counted, scoped context menu (NEW-APP)

The multi-selection menu that **speaks for the whole selection**. Counted verbs; scoped verbs; verbs
disabled with their reason; verbs omitted where they are one-item gestures.

**Rulings:** A20 (the full per-action record), A25 (Cut/Copy/Paste are their own group bounded by
the separator rule), L5 (Duplicate as a verb beside a Copy **flyout** of copyable values), TL1
(refined by L5), TL14, A1 (chain verbs live here when the gate is on), A28 (destination-scoped
actions exist only where a current folder exists), A3 (no "acknowledge first" in a label), A26
(Share, Soon-disabled with its honest dependency), A19 (the keyboard handler actually exists).
**Consumers:** every table surface.

#### S5. `SoonAffordance` — the honest dependency (EXTEND the maturity system)

`apps/web/src/lib/maturity/` already owns the stage vocabulary and its badge/dot. Extend it with the
disabled-control-with-reason composition rather than hand-writing `disabled` + a title per call
site.

**Rulings:** the `ui-design.md` standing rule ("a capability the backend does not serve yet still
renders, disabled, with the Soon badge and one honest line naming what it waits on"), TD10 (the badge
alone carries the dependency; the explainer sentence is struck), X4 (disabled choices stay visible
with their Soon badge), A18, A26, I25, D3.
**Consumers:** everywhere. This is what keeps the API-gap list (§4) honest on screen.

#### S6. `TotalsBar` — one footer grammar across four tabs (NEW-DS, or a `GridFooter` extension)

The surface hands the bar **labelled figures**; the bar renders them identically everywhere. Same
composition, same type size, same scope-honest "In view:" prefix under filters, same hover captions.

**Rulings:** L8 (ONE design, verified by measurement across four tabs), TL13, TL12, TL10 (superseded
in part), L7 (no navigation seam in the footer), L20 ("Select none", not "Clear"), L25 (selecting
must not reflow the footer), L42, L44.
**Consumers:** Time, Fees, Costs, Billing, and the file manager's own footer.

### 2.4 The dialog and input family

#### D1. `Combobox` — every dropdown is typable (EXTEND)

The design system's `Combobox` exists and already documents the data-safe controlled-input pattern.
The port's job is to make it **the one dropdown**, not to add a second.

**Rulings:** TC1, X4 (capture and edit forms, Amend, delivery and credit-note dialogs — all of
them), L3 (the "Type to narrow the choices" hint is struck), L6 (**no focus or selection ring around
dropdown entries** — highlight by fill alone, in both the hover and the keyboard path), L2 (the
placeholder is the field's name), CP1 (the payee combobox is firm-directory-backed with an inline
"Add payee" action row), A11 (a firm-editable vocabulary with filter-and-add), I27c/I27d (anchored
to whatever opened it, never a modal; a flyout beside its menu item when opened from a menu),
A10 (template picking at scale — still open, and this is the mechanism it will use).
**Consumers:** rate, category, activity, staff, billing disposition, matter (L4), payee, document
type, destination folder, the set-filter narrow field.

#### D2. `DestinationPicker` — one folder picker, three callers (NEW-APP)

**Rulings:** A16 (upload's destination modal: current folder default, root, or any folder), A22 (the
folder-delete dialog's destination options, excluding the deleted subtree), D2b (**every** restore
asks — original location / nearest surviving ancestor / choose a folder, with Home as the picker's
first row and a "Follow the restore to its new location" checkbox; a batch asks ONCE), D3
(extraction out of a deleted archive uses the same shape), P3.
**Consumers:** upload, folder delete, file restore, archive extraction.

#### D3. `SaveStateIndicator` — per-row save state under auto-save (NEW-DS)

Client truth derived from the request lifecycle: `unsaved` (incomplete, or not yet acknowledged) /
`saving` (in flight) / `saved` (acknowledged). **No new server state.**

**Rulings:** the Time Sheet's auto-save model (timer-manager design §5.3, §7 hygiene under
auto-save).
**Consumers:** the Time Sheet's rows; any future spreadsheet-shaped surface.

#### D4. `UndoRedo` — the stacks, the controls, the history dropdown (NEW-APP)

Ctrl+Z / Ctrl+Y (and Shift+Ctrl+Z), with **visible controls that say what will be undone**, living
in the footer.

**Rulings:** A15 (the stacks: moves between folders, drag-and-drop, cut/paste), A15b (the controls
live in the FOOTER, away from Back/Forward/Up — the owner relocating A15's placement), T7 (a tree
folder move is undoable like any other), A19.
**Consumers:** the file manager; the Time Sheet (where the timer-manager design records undo/redo as
client-session state replayed through the same idempotent create/PATCH path).

#### D5. `NameValidation` — one collision rule, four birthplaces (NEW-APP)

**Rulings:** L45 (creation auto-disambiguates; a **deliberate rename that would collide is refused
with inline validation naming the exact sibling** — never a silent failure, never an auto-mangle;
paste/copy disambiguates; an upload into a collision disambiguates per the copy convention; names
compare case-insensitively), L17, A9 + A21 (renaming governs selection and display, never
editability; extensions shown means what was typed stands, hidden means the stored extension
reattaches), I39 (clicking the name in the inspector renames it inline).
**Consumers:** new folder, rename (list, tree and inspector), paste, upload.

#### D6. `ReclassifyDialog` — a charge in the wrong ledger (NEW-APP)

**Rulings:** R1 (movable only while it is still the firm's own to change; the refusal always says
which), R2 (what carries is stated **before** the move, **per pair**, never in general), R3 (the
entry number is KEPT, and its prefix is provenance, not a type assertion), R4 (a record arriving
incomplete OPENS incomplete rather than being refused, and cannot be claimed onto a bill), R5.
**Consumers:** Time, Fees, Costs — the record menu and the record window.

### 2.5 The file-manager family

#### F1. `FolderTree` — the left rail (EXTEND `Tree`)

The design system ships `Tree`. Extend it; the file manager does not get a second tree.

**Rulings:** N9 (carets expand and collapse), N10 (no reflow on selection), N11 (reserved themed
scrollbar space), N12/T4 (right-click works in the rail), N13 (ONE expand/collapse toggle), T1 (New
folder beside the toggle), T2 (the heading IS the root row, named Home, selectable; no "Folders"
label), T3 (the rail's home icon matches the breadcrumb's), N20 (Home returns to the root), T5/T6b/
T6c/T6e/T6f→T6h/T6g (colour and icon are two separate flyouts; the palette runs in rainbow order and
includes pink; swatches are **true squares measured as rendered, including the menu label's pip**;
hover keeps its colour with an outline; the selected colour is an **inset Lucide check in a
contrasting ink**), T7 (folders move by dragging, never into themselves or a descendant, undoable),
T8 (the sidebar file-counts setting lives in the columns menu), N23 (no "Views" heading), N24 (rail
spacing on the token rhythm), S17b (Search Results always sits in the views group), L29 (both side
panels resize identically, arrow keys move them, double-click restores).

#### F2. `InspectorTabs` — the tabbed inspector (NEW-APP, over `Tabs`)

**Rulings:** I1 (Preview / Details / Version History / Hashes / Safety; Hashes its own tab; Preview
separate from Details), I18 (no horizontal scrollbar — if anything scrolls sideways it is the tab
strip), I30/I33 (the strip scrolls sideways only, never wraps, tall enough for its own scrollbar),
I14/N14 (an active toggle shows no dark fill), I12 (folders show content statistics), I13, I41 (the
placeholder is "Select a file or folder." alone), I38 (Details carries NO safety sentence — an open
finding is one row like every other, a Flag icon opening the Safety tab), I11, I37, L37 (an unset
document type shows BLANK, never "Unfiled"), I27b (document type is editable from the field that
displays it), I40 (the preview fits its panel; an image previews AS the image), N29.

#### F3. `SafetyPanel` — findings, history, and the signature sheet (NEW-APP)

**Rulings:** I7 (safety is its own tab, because safety has a history), I8 (engine version its own
labelled attribute on its own line), I9 + I31 (a signature match is its own line; the modal is
header/body/footer with the name decoded into its four documented parts, an NVD link where a CVE is
embedded, and a source line), I10 (say what the bytes actually read as), I19, I23, I24, I29 (the
scanner's own declaration, never our cheerful phrasing), I34 + I37 (copy and download render from
ONE text so they cannot disagree; small icon buttons out of the reading's way), I36, F7 (a clean file
gets no preamble), F13 (the check can be RE-RUN from three places; append-only history; nothing is
blocked).

**P14's recommendation binds here:** the panel is built from the publicly decodable signature name
and, where a CVE is embedded, the public record for it. **The hand-written signature library is
dropped.** The honest failure is "this signature is not in the firm library yet".

#### F4. `HashPanel` — digests and the tamper check (NEW-APP)

**Rulings:** I3 (recomputed when the tab is opened, never recited), I45 (**every algorithm row shows
BEFORE computation**, value pending, filling as each digest lands), I46 (every version is hashable;
the scope is picked from the field that displays it; every Version History row carries a verify
affordance), I47 (the stored ingest digest is the tamper check: a match is **silent**, a difference
is an unmistakable integrity warning naming both values), I48 (no recorded digest shows an honest
note, never fake agreement), I49 (Verify All across every version, appearing only when a file has
more than one), I21, I22, I26, I28, I32 (verify against a file from disk, hashed in the browser,
never uploaded).

#### F5. `FileAnalysis` — every open finding, actionable (NEW-APP)

**Rulings:** F1, F2 (act on the files from there; Reveal stays as one action), F3, F4, F5, F6, F8
(Copy All and Download All Issues), F9, F10 (counts by severity), F11 (ignoring is **per issue**,
reversible, with an ignored view), F12 (Error / Warning / Info; the count chips ARE the band
filters), F14 (bulk ignore with honest, scoped counts; a severity with nothing present is ABSENT),
A28.

#### F6. `MatterSearch` — the field, the scope dropdown, the results view (NEW-APP)

**Rulings:** S1 (next to the matter status chip; searches the whole matter, not just files), S2, S3
(no `x` clear), S4, S5, S6, S7 (a result names its full breadcrumb), S8 + S11 (a full results page
that looks and behaves like the other file pages), S9 + S15 ("Open full results" on the scope line,
fitting it; the panel is 380px), S10, S12, S13, S14, S16 (ONE ticking index-status source feeds the
label, the progress bar and the results note), S17b (always in the views group; an empty click
focuses the field), S18 (no "Everywhere" scope — the vocabulary is "Everything on this matter /
Files only / This folder"), S19 (Include deleted files, off by default, matches marked and carrying
the deleted file's own menu), S20 (**the results header is the view's header, in a `#viewbar` slot
ABOVE the table** — the root cause was rendering into the state pane below it), A27, N21.

#### F7. `FileIcon` — type identity within Lucide (EXTEND, and a correction)

`FileIcon` ships and resolves content type / extension to a Lucide glyph. **It currently maps pdf to
the generic `file-text`, which I50 supersedes.**

I50's mapping is binding: pdf → `file` + a red "PDF" badge; docx → `file-text` + extension badge
(blue); legacy doc → `file-text` + "DOC" badge (blue); xlsx → `file-spreadsheet` + extension badge
(green); image → `file-image`; video → `file-video-2`; audio → `file-audio-2`; archive →
`file-archive`; program → `file-cog` (red). **Badges are REAL TEXT, never drawn glyphs, and ride the
icon at every size.**

**Rulings:** I15 (**every icon is Lucide**, from the installed package, never hand-authored path
data — binds the app, not just the mockup), I50, L32 (the File Type column always shows the
extension), P17 (folding the safety state into the icon is an **open owner question**, recorded, not
built).

#### F8. `ArchiveBar` and archive browsing (NEW-APP)

**Rulings:** P12 (enter zip files from the list), P12c (members render on the matter's own table —
same columns, same row height; columns a member cannot answer are **EMPTY, never invented**), P12d (a
deleted zip is browsable **without being restored**), D3 (restoring from inside a deleted archive is
an EXTRACTION, Soon-disabled on P2's engine), S20 (the archive bar moved into the `#viewbar` slot for
the same root cause as the results header), A28 (inside an archive is not a destination).

#### F9. `ErrorPane` — the file-manager error surface (NEW-APP)

**Rulings:** P4 (technical explanation, first steps, a working report path through the standard
in-house pipeline; Retry and Report must actually do something), P4b (a real reporter: what is sent
is listed, screenshot opt-in, and it states that no document, file name or matter content leaves the
firm), P5b (**it is a PANE, not a dialog** — it scrolls inside its own container; P5's dialog cap
never applied here), P5, golden rule 4.

### 2.6 Formatters and shared vocabulary (NEW-DS, `packages/design-system` or a small shared module)

Small, but each is a ruling that will otherwise be re-implemented per surface.

| Module           | Rule                                                                                                                 | Rulings        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | -------------- |
| `formatDuration` | **BOTH forms, wherever a duration renders**: decimal leads, clock form beside it, quieter and smaller                | M8             |
| `formatInstant`  | The viewer's **local** time on every surface; stored instants are UTC; never "Just now"                              | I44, L23, TL8  |
| `formatVersion`  | Bare numbers — "12", never "v12"; tabular figures off; "version 12" where a bare number would dangle in prose        | I43, I35, P9   |
| `personName`     | The person's name, always; **never "You"**; a former member's name is history, not a join against current membership | L14, L14b, TK1 |
| `placeholderOf`  | Every ghost text is the FIELD'S NAME, never a description or an instruction                                          | L2             |

---

## 3. The slice sequence

**The rule: components before screens.** Each slice is sized to land and be reviewed on the deployed
site independently, names its dependencies, and ships its deviation list (§0.3).

**Definition of done, every slice, no exceptions:**

1. The named rulings are satisfied, or the deviation list says why not and names the slice that will.
2. **The deviation list is written** — what differs from the mockup, why (from §0.3's closed list),
   and what it looks like instead. "None" is a valid list and is stated explicitly.
3. Tests: the translated harness checks for the rulings this slice names (§6), plus component tests.
4. `pnpm check:scoped` clean; the anti-duplication gate (§5) clean.
5. Docs: the ledger's status column reconciled in the same commit where this slice changed a row's
   truth (the ledgers' own opening instruction), plus a `changelog.d/` fragment and a `status.d/`
   fragment with `vp run status-build`.
6. Reviewed on the deployed site, not locally, per the standing direction.

### Phase A — the shared components (no screen ships in this phase)

| #   | Slice                                                                                                                                                     | Size | Depends on |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| A1  | **Grid conformance + row groups + row marks.** Fix §2.1a's four defects; add the pinned-rows-above-a-rule group, the row-mark seam, and the Scale control | M    | —          |
| A2  | **`RecordWindow` shell + `EventRail` + `PrintSheet`.** The shell knows no domain; the fitness function (§5) lands **with it**, not after                  | L    | —          |
| A3  | **`RecordAttachments`.** Both sources, detach-is-not-delete, opens-on-that-tab                                                                            | M    | A2         |
| A4  | **Status register + `RecordChain` + `SoonAffordance`.** One map, one stepper, one honest-dependency composition                                           | M    | —          |
| A5  | **Formatters and vocabulary** (§2.6). Small, pure, unit-tested, and the earliest possible landing so nothing re-implements them                           | S    | —          |
| A6  | **`Combobox` conformance.** L6's no-ring rule, L2 placeholders, filter-and-add, the anchored-flyout composition                                           | M    | A5         |
| A7  | **The dev gallery route** — `/developer-console/record-window`, joining the `table-states` precedent, every state of A2–A4 on one surface                 | S    | A2–A4      |

**Why A7 matters:** the standing direction forbids a second implementation for review, and permits
exactly this — "where a screen needs a reviewable state that real data cannot reach, build the
dev-only gallery beside it". It is also where the translated harness checks run (§6).

### Phase B — the file manager (the larger ledger, and the one the owner called "really good")

| #   | Slice                                                                                                      | Size | Depends on            |
| --- | ---------------------------------------------------------------------------------------------------------- | ---- | --------------------- |
| B1  | **`FileIcon` I50 correction + `FolderTree` extension** (colour/icon flyouts, drag-move, counts setting)    | M    | A1, A5                |
| B2  | **Browse: the list, the columns, the footer, selection, the menus.** The port's first real screen          | L    | A1, A4, A5, B1, S4    |
| B3  | **The inspector**: tabs, Details, Preview, Version History                                                 | L    | A5, B2                |
| B4  | **Safety + Hashes**: `SafetyPanel`, `HashPanel`, the signature sheet built on the public decode            | L    | B3                    |
| B5  | **Actions**: rename with `NameValidation`, copy/cut/paste, delete with the A22 dialog, `DestinationPicker` | L    | B2, D2, D5            |
| B6  | **Undo/redo** with the footer controls and the history dropdown                                            | M    | B5                    |
| B7  | **Views**: Deleted Files, History (with N28's child-awareness), File Analysis                              | L    | B2, **server S4, S6** |
| B8  | **Search**: the field, the scope dropdown, the index status, the results view in the `#viewbar` slot       | L    | B2, **server S7**     |
| B9  | **Archive browsing** + the error pane                                                                      | M    | B2, B7                |

### Phase C — the financial tabs

| #   | Slice                                                                                                | Size | Depends on                    |
| --- | ---------------------------------------------------------------------------------------------------- | ---- | ----------------------------- |
| C1  | **`WipLedgerSurface` template + `DetailsPanel`**, mounted once on Time as the proof                  | L    | A1–A6                         |
| C2  | **The Time record window** (left pane, tabs, action bar, the M7 one-line arithmetic)                 | L    | A2, A3, C1, **server S1, S2** |
| C3  | **Fees**, off the same template — the corrected model (F1: a fee is a directly recorded flat charge) | M    | C1, C2, **server S3**         |
| C4  | **Costs**, off the same template — no hard/soft classes anywhere (C1), payee optional                | M    | C1, C2, **server S3**         |
| C5  | **`ReviewList`** for Time and Costs, behind the default-off gate                                     | M    | C1, C4, **server S5**         |
| C6  | **`ReclassifyDialog`**                                                                               | M    | C2–C4, **server S8**          |
| C7  | **Billing**: the invoice list, the footer figures, the invoice window on `RecordWindow`              | XL   | A2, C1, **server S9**         |

### Phase D — the Time Sheet

| #   | Slice                                                                                     | Size | Depends on              |
| --- | ----------------------------------------------------------------------------------------- | ---- | ----------------------- |
| D1  | **The sheet**: rows, in-place cell editing, the day's totals, full table machinery        | XL   | A1, A5, **server S10**  |
| D2  | **`SaveStateIndicator` + auto-save wiring** (idempotent create on a client-minted row id) | L    | D1, **server S10**      |
| D3  | **The stacked entry dialog** — `RecordWindow` above the sheet modal, both viewport-capped | M    | A2, D1                  |
| D4  | **The timer chip and its manager**, and the time-entry↔file association                   | L    | D1, **server S11, S12** |

### The server slices that must precede specific screens

Named from the ledgers' own consolidated registers and the six recent specs. **A port cannot invent
server capability** — each of these is a real vertical slice (schema → data-access → API → tests),
and the screens above are blocked on them or ship the fact Soon-disabled.

| #   | Server slice                                                                                                                                                                                                                                                                                                                                                                      | Blocks  | Source                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------- |
| S1  | **The listing enrichments**: `createdAt` (entered date), dual attribution, resolved rate, activity code, categories, disposition beyond a boolean, invoice linkage + invoice number                                                                                                                                                                                               | C2      | time gaps 1, 2, 4, 23         |
| S2  | **Entry numbers** — a matter-scoped sequence on the record via `@magna-carta/sequence-numbering`                                                                                                                                                                                                                                                                                  | C2      | time gap 3; TL7               |
| S3  | **The memo column** — nullable `memo` TEXT on all three tables, served and settable, **excluded by construction** from every client-facing projection (invoice render model, LEDES, print sheet, portal)                                                                                                                                                                          | C2–C4   | time gap 20; M6               |
| S4  | **Status-history endpoint** — the audit events an entry's History tab renders                                                                                                                                                                                                                                                                                                     | C2, B7  | time gap 6                    |
| S5  | **Review-gate firm setting** (`reviewGateEnabled`), plus **unsubmit**, **un-approve**, **optional kick-back reason**, **delete-draft**, **enterer-may-work-a-draft**                                                                                                                                                                                                              | C5      | time gaps 5, 7, 8, 9, 10, 17  |
| S6  | **The many-attachment relation** — attach + **detach** (detach must not delete), counts on the listing, and the by-reference variant that records which it was                                                                                                                                                                                                                    | A3, B7  | time gaps 19, 22; M3, M9      |
| S7  | **Deleted-files reads** — `deleted_by`, `deleted_from_path`, the partial index, the deleted listing and the restore route; the search index's deleted facet (tag-and-filter, not removal-on-delete)                                                                                                                                                                               | B7, B8  | deleted-files design §7; S19  |
| S8  | **Reclassification** — its own route, not a `PATCH` of a kind field: delete-and-insert in one transaction, the entry number carried across a table whose sequence never minted it, the audit event, and the refusals the client cannot be trusted to enforce; plus `reclassified_from` provenance and the `incomplete` flag                                                       | C6      | time gap 21; R1–R5            |
| S9  | **The billing reads** — per-matter invoice listing, application history, attribution and events, draft claims, unbilled entries, display names without N+1. **Plus the pending ADR** that revises finalized-is-immutable before BM1's adjustment routes exist                                                                                                                     | C7      | billing gaps 1–6; time gap 12 |
| S10 | **The sheet's contract** — the cross-matter per-person **range listing** with denormalized matter title, period totals, and the save-with-nothing changes (`matter_id` nullable, `narrative` loses `min(1)`, zero duration legal pre-completion, a completeness predicate gating every downstream consumer, and the provisional `TMP-nnnn` code beside its permanent replacement) | D1, D2  | timesheet §7; timer §9.8      |
| S11 | **The timer DO slims to tick state** — one live feed with an entry-id pointer                                                                                                                                                                                                                                                                                                     | D4      | timer §9.2                    |
| S12 | **`time_entry_file`** — the entry↔file association table, served as `{fileId, name}` pairs, constrained to the entry's matter                                                                                                                                                                                                                                                     | D4, A3  | timer §9.8                    |
| S13 | **Cross-matter refile** — its own route with its own permission; it is a cross-matter write, not a `PATCH` of `matterId`                                                                                                                                                                                                                                                          | C2 (L4) | time gap 18                   |

**Also carried, honestly Soon rather than blocking:** P1 (always-store-and-commit, spec written not
built), P2 (archive entry and extraction — D3 and A18's dependency), the conversion engine (A18),
client-portal document sharing (A26), manual payment receipt and the invoice artifact (C7's Soon
controls).

---

## 4. What is real, what is Soon, what needs a server slice — per screen

| Screen           | Real today                                                                    | Named Soon                                                               | Blocked on                 |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------- |
| File browse      | Folders, files, versions, upload, delete (soft), the scan pipeline            | Convert (A18), Share (A26), version compare (I25), save-new-version (P6) | —                          |
| Deleted Files    | Soft delete exists                                                            | —                                                                        | **S7**                     |
| History          | The audit trail is written                                                    | Deleted-row Restore keeps its existing Soon                              | **S4**                     |
| Search Results   | The text index exists                                                         | —                                                                        | **S7** (the deleted facet) |
| File Analysis    | Findings exist; **re-run is real** (the pipeline exists — F13 needed no Soon) | —                                                                        | —                          |
| Archive browsing | Reading a zip                                                                 | Extraction writes (P2), and D3's restore-into-matter                     | —                          |
| Time             | Listing, capture, void, kick-back (submitted only)                            | Internal memo until S3                                                   | **S1, S2, S4, S13**        |
| Fees             | The arrangement read/write exists in full                                     | —                                                                        | **S3** and the fee routes  |
| Costs            | Listing, capture, void                                                        | Vendor inline-create until CP1's route                                   | **S1, S3, S4**             |
| Review           | Per-entry submit/approve/kick-back                                            | —                                                                        | **S5**                     |
| Billing          | Invoice reads exist, filtered by client and status                            | Record Payment, Print/PDF/LEDES, credit-note numbering                   | **S9**                     |
| Time Sheet       | Per-entry create/PATCH; `grid-batch` for bulk create                          | Spell-check; internal memo                                               | **S10, S11, S12**          |

---

## 5. The anti-duplication enforcement

**The proposal: `pnpm run lint:one-ui`**, a source-scan fitness function in this repository's own
tradition (`lint:process-refs`, `lint:icon-sizes`, `lint:status`, `lint:unwired-writes`). It runs in
`pnpm check` and in the pre-push scoped gate.

The mockup already proved the technique: round seven records that `recordModal` "is checked at the
source, not by intention: a fitness function fails if any domain symbol leaks into it, if it calls
anything but the four generic shell utilities, or if the header set is not exactly Edit / Print /
expand / close." That check ports.

### 5.1 What is mechanically detectable, and the rule for each

| #   | Rule                                                                                                             | Detection                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **No `<table>` outside the design system.** A tabular surface is `DataTable.Grid`.                               | Scan `apps/web/src/**/*.svelte` for `<table`, `<thead`, `<tbody`, `<th`, `role="grid"`, `role="columnheader"`. Allow-list: none. Failure names the file and points at `DataTable.Grid`.                                                                                                                                                                                           |
| 2   | **No second record window.** A record opens in `RecordWindow`.                                                   | Any `Dialog.Root` in `apps/web` whose subtree contains two panes, a tab strip **and** a footer action bar — detected structurally as a `Dialog.Content` containing both a `data-record-tabs` marker and an action-bar class. Simpler and stricter: a naming rule — a `.svelte` file matching `*-modal.svelte` / `*-window.svelte` under a matter area must import `RecordWindow`. |
| 3   | **The record window's header set is exactly four, in order.** Edit, Print, expand, close.                        | Parse `record-window.svelte` and assert the header renders exactly those four controls in that order. This is an assertion on the component, not a scan of consumers — the one place it can be wrong.                                                                                                                                                                             |
| 4   | **No domain symbol inside the shell.** The shell knows nothing of time, fees, costs, invoices, files.            | Scan `packages/design-system/src/lib/components/record-window/**` for the domain vocabulary (`timeEntry`, `invoice`, `cost`, `fee`, `matter`, `narrative`, `timekeeper`). A hit is a leak.                                                                                                                                                                                        |
| 5   | **No hand-rolled select.** Every dropdown is `Combobox` (or `Select` where the set is closed and short).         | Scan `apps/web/src/**/*.svelte` for `<select`. Zero tolerance; the design system's own `Select` wraps the native element and is the only legitimate home.                                                                                                                                                                                                                         |
| 6   | **No raw `<dialog>` and no hand-built overlay.** Dialogs come from the design system.                            | Scan for `<dialog`, and for a `position: fixed` + `inset: 0` pair in a component's `<style>` block (a hand-rolled scrim).                                                                                                                                                                                                                                                         |
| 7   | **No hand-drawn glyphs.** I15 binds the app.                                                                     | Scan `apps/web` and `packages/design-system` for `<svg` carrying a `<path d=` outside `packages/design-system/src/lib/components/brand-mark/`. Icons come from `@lucide/svelte/icons/*`.                                                                                                                                                                                          |
| 8   | **One status register.** No surface invents a tone.                                                              | Scan for `Badge` usages whose `variant` is a literal in a file that does not import the status register; require the register's mapper.                                                                                                                                                                                                                                           |
| 9   | **L2, the global placeholder ruling.** Every ghost text is the field's name.                                     | Scan `placeholder="…"` values: fail any containing a verb phrase marker (a leading imperative verb from a small list — Type, Enter, Select, Choose, Search, Add), a trailing `…` after a preposition, or more than three words. This is the mockup's own verifier sweep, ported.                                                                                                  |
| 10  | **The one-implementation registry.** Every component in §2 is declared once.                                     | A manifest (`tooling/lint-one-ui/registry.json`) mapping component name → its single home path. The check fails if a second file exports a symbol of that name, and fails if a registry home is missing. This is what makes the contract enforceable rather than aspirational.                                                                                                    |
| 11  | **No `document.getElementById` / `innerHTML` in ported surfaces.** The mockups' idiom must not survive the port. | Scan `apps/web/src/lib/{file-manager,wip,matters}/**` for `getElementById`, `querySelector` outside an `$effect` measuring pass, and `innerHTML`.                                                                                                                                                                                                                                 |

### 5.2 What is not mechanically detectable, stated honestly

A gate that claims more than it delivers is worse than none, so:

- **"Is this the same behavior?"** cannot be scanned. Two surfaces can both use `DataTable.Grid` and
  still disagree about what a right-click offers. Rules 1–11 stop a second _implementation_; only the
  translated harness checks (§6) catch a second _behavior_.
- **Visual duplication** — a hand-composed panel that looks like `DetailsPanel` but is not it — is
  only caught by rule 10's registry if the author names it something recognizable. An author who
  names it `matter-side-thing.svelte` and composes it from primitives defeats the scan. The
  mitigation is review and the ledger, not the gate.
- **Copy drift** — the same fact stated two ways on two screens — is a docs-style problem the
  existing vocabulary linters (`lint:custodian-vocabulary`, `lint:conflicts-vocabulary`) address by
  enumeration. A `lint:ledger-vocabulary` in that mould is worth adding for the settled word sets
  (L47b's safety values, F12's severities, X6's status register) and is **not** proposed as part of
  this slice — it should follow the port, once the words are in the code.
- **Rule 2's structural detection is heuristic.** The naming-rule form is reliable; the structural
  form has false negatives. Prefer the naming rule and accept that a determinedly odd file name
  escapes it.
- **Rule 9 will have false positives.** A legitimate placeholder could read as a phrase. The
  documented escape is the existing `fitness-allow: <justification>` convention, which feeds an
  asserted inventory — every allowance is a reviewed edit, exactly as the off-token gate works.
- **Rule 4's word list must match identifiers, not prose.** Found while building the shell: the
  domain vocabulary includes ordinary English (`cost`, `fee`, `matter`, `time`), so a scan over raw
  file text fires on a comment saying a long tab "costs the window nothing" — and a check that
  fires on its own component's prose is a check somebody switches off within a week. The scan
  strips comments and string literals and matches identifier-shaped occurrences. What it therefore
  cannot catch: a domain type imported under an innocuous alias. That is review's job, not the
  gate's.
- **Event order is the caller's, and nothing checks the caller.** `EventRail` renders events exactly
  as handed over rather than sorting them, because two events can share an instant and the recorded
  order is then the only truth about which came first — and because specific events are ruled to be
  first regardless (the entry event; the reclassification event), which a tie-breaking sort would
  silently reorder. The consequence is that a consumer handing it newest-first renders newest-first
  and no scan will say so. This is a **harness check at the consumer**, not a source rule: each
  surface that mounts a rail asserts its first event is the oldest.

---

## 6. What the harnesses become

`tooling/file-manager-rulings/index.mjs` is **151 Playwright checks, each with its own id, covering
135 distinct ruling ids** (a ruling corrected more than once carries `L34`, `L34b`, and so on), run
against a `file://` URL of the mockup. They are the regression memory, and the ledger's own
opening instruction makes them authoritative over the status column. They are also **selector-coupled
to the mockup's DOM**: 30 checks address `#inspector`, 23 address `#rows tr`, 11 each `#searchInput`,
`#insBtn` and `#ctx`. Those ids do not exist after the port.

The translation is three-way.

### 6.1 Become component tests (roughly 45 checks) — the largest and best group

Every check that asserts a **component's own behavior** with no surface context becomes a Vitest
browser-mode test beside the component, in the design system's story-first convention (stories
double as behavior tests and carry per-story axe checks).

Examples: the pin glyph is Lucide `pin` and renders filled when pinned (L11b, L38); a swatch's
computed border radius is 0 including the menu label's pip (T6c, T6g); the selected colour's check
sits INSIDE the swatch box with no outline (T6h); a version label reads "12" with tabular figures off
(I35, I43); the filter button sits at the header cell's right edge with its space reserved (L34b,
L30); a folder row is exactly as tall as a file row (L28); the dialog is capped at the viewport and
only its body scrolls (P5); the header action set is exactly four in order (M3).

These get **stronger** in translation: they run in CI on every push, against the shipping component,
in both themes and both modes, with axe.

### 6.2 Become a browser harness over the dev gallery (roughly 60 checks)

Checks that need a **composed surface in a specific state** — a state real data cannot reliably reach
— point at `/developer-console/*` instead of a mockup file. The `table-states` and `sign-in-screens`
routes are the precedent, and this is exactly the use the standing direction permits.

The harness keeps its current shape (a flat `check(id, label, fn)` list, so a failing ruling is named
by its id) and changes only its target URL and its selectors — from mockup ids to the components'
own test hooks. Two adaptations:

1. **Selectors become stable data attributes** on the design-system components, not app markup, so a
   surface reshuffle cannot break a component's ruling check.
2. **The fixture moves into the gallery route** as a deterministic in-repo fixture (the `table-states`
   page already does this: "no clock, no randomness, so the page reads the same on every render and a
   screenshot pass is never chasing data").

Examples: the multi-selection menu's counted verbs and disabled reasons (A20); analysis severity
bands as filters (F12, F14); the restore dialog's three destination options and the follow checkbox
(D2b); the results header in the `#viewbar` slot above the table (S20); undo/redo controls in the
footer saying what will be undone (A15b); History's child-aware single row with impact behind a count
(N28).

### 6.3 Cannot survive, and why (roughly 45 checks)

Stated honestly rather than quietly dropped. Each one names its replacement.

| Group                                                                                                                                                                              | Why it cannot port                                             | Replacement                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checks asserting the **absence of a mockup artifact** (N19: drop the tree/breadcrumb/version-id mock state toggles)                                                                | The artifact does not exist                                    | None needed; the ruling is satisfied by construction                                                                                                          |
| Checks over **fixture-specific data** (Motion to Compel version 3 deliberately mismatches; the x:902 orphaned path; Site Photographs' eight photographs)                           | The fixture is the mockup's                                    | The gallery fixture reproduces the same **shapes**, and the check moves with it; where it cannot, the ruling moves to an integration test against seeded data |
| Checks over **hand-rolled machinery** (the JS keydown handler's Escape branch ordering; the `ICONS.plus` undefined defect; the aggregate-fill re-render eating an open rename)     | They assert defects in an implementation that is being deleted | The **ruling** survives as a behavior test; the **defect check** does not                                                                                     |
| Checks that assert **`localStorage` persistence directly** (N29's persisted panel state)                                                                                           | The app persists through the preference seam, not raw storage  | A test against the seam, plus the behavior test that the panel state survives a remount                                                                       |
| Checks whose ruling is **still open** (I15 was open, then settled by I50; A10 template picking at scale; P8 concurrent authorship credit; P6 save-new-version awaiting a decision) | There is nothing settled to assert                             | They stay in the ledger as `open`; no test is written for an undecided thing                                                                                  |

**The `time-tab-rulings` ledger has no harness today** — round six and seven record verification "by
measurement" performed ad hoc. Phase C should build one on the same shape as it goes, pointed at the
financial gallery routes. Building it retroactively is how the file-manager ledger got two rows
marked `settled` while the screen still had the defect (round seven's own finding: "the harness
asserted the wrong property").

### 6.4 Keep the reconciliation discipline

Both ledgers open by insisting the status column is reconciled **before** a round is read as work,
because a stale `open` sends the next round to rebuild what already exists. That discipline transfers
verbatim: the first step of any porting slice is running the translated checks for the rulings it
touches, and any row they contradict is corrected in the same commit, before a line of the screen
changes.

---

## 7. Risks and sequencing hazards

`main` is production. A merge deploys within minutes, the gate of record is blocked account-side, and
the verification that stands between a change and real users is the scoped local gate plus whatever
tests the change carries. Everything below is shaped by that.

### The three biggest

**1. A half-ported screen reaching production.** The port replaces working surfaces (Time and Costs
are built and read real data) with richer ones. A slice that lands the new table but not its menus
ships a screen that is worse than what it replaced, to real users, immediately. **Mitigation:** every
Phase B and C slice is additive behind the maturity stage until its screen is whole — the new surface
builds beside the old one, the section's `stage` in `sections.ts` flips only when the slice's rulings
pass, and the old surface is deleted in the same commit that flips it. No slice lands a screen in a
state it would not want reviewed.

**2. The shared components are the blast radius.** `DataTable.Grid` will have nine consumers.
`RecordWindow` will have five. A refinement to either during Phase C or D changes every screen that
already shipped, in production, without those screens' own tests necessarily running. **Mitigation:**
the component's tests are the contract and they run on every push; a component change that alters
rendered output requires the visual-regression matrix, and it must name the consumers it affects in
its deviation list. This is also the argument for Phase A landing whole before any screen ships —
the components should stop moving before they acquire consumers.

**3. Server slices that change a contract, mid-port.** Four are genuinely dangerous. **S10** makes
`matter_id` nullable on `time_entry` and drops `narrative`'s minimum — that is a **migration on the
billing spine**, and its safety is a completeness predicate that every downstream consumer must
honor; a consumer that misses it can bill against an incomplete row. **S8** (reclassification) moves
rows between tables in one transaction and carries an entry number across a table whose sequence
never minted it — the uniqueness assumption on the receiving table must be relaxed for **reading**
without relaxing it for **minting**. **S9** requires a **pending ADR that revises an accepted
decision** (finalized-is-immutable) before its routes may exist; building the routes first would
implement a model the Decision Log contradicts. **S3**'s memo requires exclusion **by construction**
from every client-facing projection — a decision about which columns those readers select, made once,
not a filter applied per call site; getting it wrong leaks internal text onto a client's bill.
**Mitigation:** each of these lands as its own slice, with its own tests, never bundled with a UI
slice, and never in the same merge window as another of them.

### The rest, briefly

- **Never land mid-flight:** a `DataTable.Grid` change and a consumer's port in the same merge; a
  schema migration and the UI that depends on it in the same merge; two of the four dangerous server
  slices in the same window.
- **Migrations:** S3 (memo column, three tables), S7 (`deleted_by`, `deleted_from_path`, a partial
  index), S8 (provenance columns, the `incomplete` flag, the sequence-uniqueness relaxation), S10
  (nullable `matter_id`, `provisional_code`), S12 (`time_entry_file`), and the **removal** of the
  hard/soft cost class from the schema per C1 — which is a destructive migration on a column the
  built Costs page may still read.
- **Contract changes:** S1, S4, S5, S6, S9, S13 all change OpenAPI. The committed snapshot and the
  generated client move with each one, and `passive-dev-orchestrator` is **already** in that file set
  (`apps/api-worker/openapi/openapi.json`, `packages/api-client/src/types.gen.ts`) — its active-work
  note names it as a collision surface in as many words.
- **Concurrent streams:** `slice-0-7b-app-shell` is building in `apps/web` and `packages/design-system`
  — the same two packages this whole port lives in. Any porting agent runs `vp run worktrees` before
  starting and takes **one file per agent**; the repository's own rule is that overlapping ownership
  turns a fast parallel pass into a serial repair job.
- **The ledgers are cross-cutting files.** Both are in `docs/conventions/`, both are edited by every
  round, and at least one agent is editing `time-tab-rulings.md` right now. Status reconciliation
  must be a small, surgical edit at the end of a slice, never a rewrite.
- **P17 and the other open owner questions** (A10, P8, P6, TP4, TP6) must not be silently decided by
  a porting agent. They render as they render today, and a port that touches one records it as a
  deviation and asks.

---

## Appendix — the component contract at a glance

| Component               | Home                        | Kind    | Consumers                                                  |
| ----------------------- | --------------------------- | ------- | ---------------------------------------------------------- |
| `DataTable.Grid`        | design-system/data-table    | EXTEND  | 9 table surfaces + review list                             |
| `GridColumnsMenu`       | design-system/data-table    | EXTEND  | all table surfaces                                         |
| `GridColumnFilter`      | design-system/data-table    | EXTEND  | all table surfaces                                         |
| `RecordWindow`          | design-system/record-window | NEW-DS  | time, fee, cost, invoice, Time Sheet                       |
| `RecordAttachments`     | design-system/record-window | NEW-DS  | all 4 record types + Time Sheet                            |
| `StatusChip` + register | design-system/badge         | EXTEND  | all surfaces                                               |
| `RecordChain`           | design-system/record-window | NEW-DS  | 4 record types                                             |
| `EventRail`             | design-system               | NEW-DS  | all record windows, version + safety history, History view |
| `PrintSheet`            | design-system               | NEW-DS  | 4 record types, row menus, details panel                   |
| `WipLedgerSurface`      | web/lib/wip                 | NEW-APP | Time, Fees, Costs                                          |
| `DetailsPanel`          | web/lib/wip                 | NEW-APP | 4 financial tabs, inspector host, History                  |
| `ReviewList`            | web/lib/wip                 | NEW-APP | Time, Costs                                                |
| `RecordMenu`            | web/lib/wip                 | NEW-APP | all table surfaces                                         |
| `SoonAffordance`        | web/lib/maturity            | EXTEND  | everywhere                                                 |
| `TotalsBar`             | design-system/data-table    | NEW-DS  | 4 financial tabs + file manager footer                     |
| `Combobox`              | design-system/combobox      | EXTEND  | every dropdown on every surface                            |
| `DestinationPicker`     | web/lib/file-manager        | NEW-APP | upload, folder delete, restore, extraction                 |
| `SaveStateIndicator`    | design-system               | NEW-DS  | Time Sheet                                                 |
| `UndoRedo`              | web/lib/file-manager        | NEW-APP | file manager, Time Sheet                                   |
| `NameValidation`        | web/lib/file-manager        | NEW-APP | new folder, rename ×3, paste, upload                       |
| `ReclassifyDialog`      | web/lib/wip                 | NEW-APP | Time, Fees, Costs                                          |
| `FolderTree`            | design-system/tree          | EXTEND  | file manager rail                                          |
| `InspectorTabs`         | web/lib/file-manager        | NEW-APP | file manager                                               |
| `SafetyPanel`           | web/lib/file-manager        | NEW-APP | inspector, File Analysis                                   |
| `HashPanel`             | web/lib/file-manager        | NEW-APP | inspector                                                  |
| `FileAnalysis`          | web/lib/file-manager        | NEW-APP | file manager                                               |
| `MatterSearch`          | web/lib/file-manager        | NEW-APP | matter chrome + results view                               |
| `FileIcon`              | design-system/file-icon     | EXTEND  | every file surface                                         |
| `ArchiveBar`            | web/lib/file-manager        | NEW-APP | archive browsing                                           |
| `ErrorPane`             | web/lib/file-manager        | NEW-APP | file manager                                               |
| Formatters (§2.6)       | design-system               | NEW-DS  | everywhere                                                 |
