# The money surface — CLAUDE.md

**Purpose.** The one frame every money section of a matter renders inside: Time, Fees, Costs,
Billing and Trust. It owns the toolbar under the section strip, the notices band, the details
panes, the counts strip and the pane toggle, and the two view settings a reader chooses once for
all five. A ledger declares its columns, cells, panel and figures and decides nothing about the
frame.

**White paper:** _Design system, UI consistency & design quality_ —
[`docs/Magna-Carta-White-Paper.md`](../../../../../docs/Magna-Carta-White-Paper.md).
**Rulings:** [`docs/conventions/design-corrections.md`](../../../../../docs/conventions/design-corrections.md)
(the financial ledgers; the file manager).

## Key files / entry points

- `index.ts` — exports `MoneySurface`, `MoneyToolbar`, the section registry and the two
  preference codecs
- `money-surface.svelte` — the surface: `FullHeightSection` > `LedgerPanes` > the list column
  (toolbar, notices, the ledger's `list` snippet, `beneath`, `DataTable.GridFooter` ending in
  `DetailsPanel.Toggle`), with the ledger's `panel` beside it
- `money-toolbar.svelte` — the strip: the coins glyph, the five sub-parts as links, the way out to
  the section's firm-wide twin past a rule, Clear Filters while the grid is filtered, the ledger's
  `acts`, then the density and layout controls
- `money-sections.ts` — `moneySections` read from `matterStrip`'s Money group (a module-load
  failure if the group and `MoneySectionSlug` disagree), `moneySectionHref`, `billHref`,
  `moneySectionFirmDestination`, and the two preference codecs
- `apps/web/test/money-sections.test.ts` — the registry's facts, pinned without a browser

## Local conventions

- **Every money section renders inside `MoneySurface`, and nothing under Money draws its own
  frame, acts row, counts strip or pane toggle.** A ledger passes `list`, `panel`, and optionally
  `acts`, `notices`, `beneath` and `figures`; its `list` snippet receives `{ density, tableClass }`
  and MUST hand both to its `DataTable.Grid` (`density={density}`, `class={tableClass}`), because
  the flush layout takes the grid's frame away and the framed one gives it back.
- **`notices` is passed only when it has content** (`notices={hasNotice ? notices : undefined}`),
  so the band never renders empty.
- **The sub-part links come from `matterStrip`'s Money group**, never a list written here. Adding a
  money section is an edit to `$lib/matters/sections.ts` and to `MoneySectionSlug`; the module
  refuses the two disagreeing.
- **The way out names a sidebar DESTINATION, never an address.** All five sections have a firm-wide
  twin — `/time`, `/fees`, `/costs`, `/billing`, `/trust` — and `moneySectionFirmDestination`
  answers with that destination's id so the href, the label and the glyph all come from
  `$lib/navigation/destinations.ts`. The rail and the toolbar therefore cannot call one place two
  things, and a destination that is announced but not `shipped` answers null: a way out to a Soon
  page is worse than no way out. So a section names its twin here once and the registry's shipped
  flag decides when the link appears.
- **One bill has one address, and `billHref` is it.** Every surface that sends a reader to a bill —
  the cost and time ledgers from a billed row's menu, the invoice window's list of the matters a
  bill charges, the cost record window and its details panel — calls `billHref(matterId,
  invoiceId)`. It was spelled by hand in three files and one of them did not encode the identifier.
  A bill opens on the matter it charges rather than at the firm's scale, because the acts against it
  are that matter's.
- **The ledger keeps its own panel-open preference** (its key is unchanged) and hands the surface
  `panelOpen` and `onTogglePanel`; the surface renders the toggle, the ledger stores the answer.

## Invariants that apply here

- **Two reader preferences, one key each, shared by all five sections:**
  `magna-carta-money-surface-layout` (`flush` | `framed`, default `flush`) and
  `magna-carta-money-surface-density` (`comfortable` | `compact`, default `comfortable`). They
  are created inside the surface through `$lib/preferences/persisted-preference.svelte.ts`; a
  ledger never reads or writes them.
- **The view controls sit on the toolbar; the pane toggle ends the counts strip.** Density and
  layout are settings about how the table is shown, so they live where the file manager's
  list/icons toggle lives. Showing a pane is not, so its toggle rides the strip beneath the table,
  last on the line, on every surface that has a pane.
- **Golden rule 2** — tokens and design-system components only; the wrappers here are layout
  utilities and the rule tokens (`border-border-default`), nothing styled by hand.

## Dependencies & contracts

- Composes `$lib/components/full-height-section.svelte`, `$lib/records/index.ts` (`LedgerPanes`),
  `$lib/details-panel/index.ts` (`Toggle`), `@magna-carta/design-system/data-table`
  (`GridFooter`, `DataTableGridState`) and `@magna-carta/design-system/button`.
- Reads `$lib/matters/sections.ts` for the section registry and links to
  `/matters/{matterId}/{slug}`, the address the section strip links to.
- Reads `$lib/navigation/destinations.ts` for the firm-wide twin behind the way out — the only
  place this area reaches outside the matter.

## Gotchas

- The `list` snippet handed to `LedgerPanes` is named `column` inside the surface: a snippet named
  `list` in the same scope as the `list` prop would render itself.
- `apps/web/vitest.config.ts` reads `test/**/*.test.ts` only, so the registry's test lives in
  `apps/web/test/`, not beside the module.
