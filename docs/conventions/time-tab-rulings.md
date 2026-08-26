# Matter time tab — the owner's standing rulings

Every ruling the owner has issued on the time surface, cumulative, newest round last. **A ruling
here is settled.** It is not re-derived, re-proposed, or re-litigated by a later round, and a round
that silently reverts one is a regression, not a redesign. The review surface is The Timesheet
mockup; rulings bind the app screen when the design ports.

Read this file before changing the surface, and check the built surface against it after. Do not
rebuild the surface from scratch: edit it. Regeneration is what loses these.

Status values: `settled` (built in the mockup and confirmed) · `regressed` (was settled, a later
round undid it) · `open` (asked for, not yet built) · `superseded` (a later ruling replaced it,
with the pointer).

Rulings from the file manager's ledger that generalize beyond that surface
([`file-manager-rulings.md`](file-manager-rulings.md)) bind here too — Lucide-only icons, no inert
controls, say what a control will do, the person's name never "You", never "Just now", filter
controls inside the column header sharing one hover, active filters unmissable, consistent row
heights, dialogs capped at the viewport, selection presenting details in a panel while the reader
stays in the list (N22c).

## R1 — round one: the owner's first review, and the two-package analysis

The round was driven by the owner's corrections plus a principles-not-duplication analysis of a
legacy billing package (its time-entry window and its matter Time & Fees list) and of Clio's
current time-entry surface.

| #   | Ruling                                                                                                                                                                                                             | Status                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| TK1 | **A timekeeper's name is history, not a join against current membership.** A former member's entries always render the person's name; "No longer a member" is data loss and is not allowed.                        | settled                                                                                                        |
| TS1 | Draft / Submitted / Approved / Billed / Void each carry a distinct semantic-token treatment: draft quiet, submitted amber, approved green, billed info-blue, void danger-muted with the row struck.                | settled                                                                                                        |
| TS2 | One chip per row: the chip is workflow status. Billing disposition renders through the Billable column and the Amount dash — never a second chip.                                                                  | settled                                                                                                        |
| TL1 | The context-menu item says "Copy", not "Copy Narrative".                                                                                                                                                           | settled                                                                                                        |
| TL2 | The billed-text column is named "Info", not "Narrative". The dialog field matches.                                                                                                                                 | revised — round three (TD11 struck the "appears on the bill exactly as written" caption; the Info name stands) |
| TL3 | Billable and non-billable entries both carry a category. Non-billable uses the platform's seeded vocabulary; billable uses a firm-editable internal taxonomy (recommended shape: internal codes mapping to UTBMS). | settled                                                                                                        |
| TL4 | Activity codes are first-class: an Activity column and a dialog select, honest that the catalog requires the code at capture only on e-billing matters.                                                            | settled                                                                                                        |
| TL5 | The stat tiles are too loud on this tab: a quiet summary, the table unmistakably the page's subject. The loud tile treatment belongs to Overview.                                                                  | superseded by TL10 (the quiet summation now lives in the footer; the quiet-not-loud principle stands)          |
| TL6 | Staff renders as an initials avatar beside the always-visible name — never avatar-only.                                                                                                                            | settled                                                                                                        |
| TD1 | Billed text ("Info") and the internal memo are two fields with two audiences; a memo never appears on a bill, and the dialog makes the distinction unmistakable.                                                   | settled — refined by TD10                                                                                      |
| TD2 | Billing disposition is richer than a boolean: next invoice / hold / no charge belong to the model, not a yes/no.                                                                                                   | settled                                                                                                        |
| TD3 | The rate is shown resolved with its explanation, with a permission-gated per-entry override — named rate cards, never a bare number field.                                                                         | settled                                                                                                        |
| TD4 | The rounding increment is a firm setting rendered read-only in the live arithmetic preview, never a per-entry choice — per-entry increments are inconsistent billing a client can spot.                            | settled                                                                                                        |
| TD5 | The Log Time dialog offers a save-and-close and a save-and-continue (dialog stays open, resets duration and Info, keeps date, disposition and category, focuses quick entry).                                      | superseded by TD5b (the button names)                                                                          |
| TD6 | The timer lives where the work happens: start a timer from the dialog instead of typing hours; the stopped timer reopens Log Time prefilled. It is the matter's single server-side timer, not a form stopwatch.    | settled — extended by TT1                                                                                      |
| TD7 | The live arithmetic states itself: worked time, units of the firm increment, rounding direction, hours × rate = amount. Amounts are pre-tax by definition.                                                         | settled                                                                                                        |
| TX1 | No per-entry tax UI. The platform's recorded stance holds: tax composes at invoicing; WIP never carries hand-entered tax.                                                                                          | settled                                                                                                        |
| TB1 | The path from time to invoice is a seam, not a surface: the unbilled figure links toward Billing, Soon-badged against the billing slice. No invoicing is built on the time tab.                                    | settled                                                                                                        |

**Rejected on analysis, recorded so nobody re-imports them:** modal record prev/next navigation ·
title-bar delete (void stands) · a matter picker inside the matter tab (confirmed by the owner in
round three — TP-M) · a merged two-line hours+description cell (breaks column machinery and
row-height consistency) · a list-level disposition dropdown and a separate Advanced Search (the
column filters and the matter search are the mechanisms) · a list-level Inc.-tax toggle (WIP is
pre-tax) · per-entry minute increments · activity-code management on this tab (a firm-settings
surface). ~~Single-entry print~~ — **reversed by the owner in round three (TA1): every unit is
printable.**

## R2 — round two: the build round

Round two built every R1 ruling into the mockup and the owner reviewed it as built. No new rulings
were issued inside the round itself; its product was the built surface plus the open questions put
to the owner (TP1–TP7 below) and the API-gap register. Three shapes chosen by judgment in this
round were corrected by the owner in round three, recorded there so the correction is visible as a
correction: the toolbar composition (a Start Timer button beside Log Time → TT1), the dialog's
button names ("Save & Add Another", a primary labelled "Log Time" → TD5b), and the dialog's tall
single-column layout that scrolled (→ TD8).

## Open owner questions

| #   | Question                                                                                                                              | Status                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| TP1 | Flat fees in the Time surface?                                                                                                        | settled — round three: fees are their own surface, never merged here; the invoice is where time and fees become one ledger |
| TP2 | Human-readable entry reference numbers.                                                                                               | settled — round three: yes (TL7)                                                                                           |
| TP3 | Delegated time entry (assistant enters for attorney).                                                                                 | settled — round three: yes, dual attribution (TD9)                                                                         |
| TP4 | Who may override the resolved rate (`overrideRateE4` is ungated today).                                                               | open — owner question                                                                                                      |
| TP5 | A firm-level Timesheet week grid (days × matters, rapid catch-up) as the next time surface — the `grid-batch` endpoint already ships. | open — and round three recorded that THAT surface carries the matter picker (TP-M)                                         |
| TP6 | Column defaults (Category on; Billable, Worked, and now Entry Number and Date Entered off) — confirm or correct.                      | open — owner question                                                                                                      |
| TP7 | Per-entry tax exemption override — deferred until a firm with a configured tax policy asks.                                           | open — deferred                                                                                                            |

## R3 — round three: the chain, the details panel, and the printable unit

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Status  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| TD9  | **Delegated entry.** Log Time carries a Staff field defaulting to the signed-in member; setting it to another member is permission-gated. The record keeps BOTH people — the timekeeper (whose work) and the enterer (who typed it) — and the details panel shows both. The rate resolves for the chosen timekeeper.                                                                                                                                                                                                                                                                                                          | settled |
| TL7  | **Entry numbers.** Every entry carries a matter-scoped reference: matter number, dot, four-digit sequence in capture order — `2026-0147.0042`. Never reused; a void keeps its number. Available as a column (off by default), always in details and on the printed sheet. Column header reads "Entry Number", never an abbreviation.                                                                                                                                                                                                                                                                                          | settled |
| TA1  | **Every unit is printable.** A single time entry prints alone (a fee will, on its future surface); reports and invoices combine, but the unit stands by itself. Print lives in the context menu and the details panel; the sheet carries the entry number, both dates, both people, the facts, Info, and the history. Reverses the round-one rejection.                                                                                                                                                                                                                                                                       | settled |
| TP-M | **The matter stays implicit on this tab.** No matter field, no matter picker here; the firm-level Timesheet week grid is the surface that carries the matter picker. (The owner: one person has many matters, and it depends on the manner in which matters are entered.)                                                                                                                                                                                                                                                                                                                                                     | settled |
| TS3  | **The editing chain is visible.** A DRAFT is editable, full stop. Every later state locks, and the surface says WHY and what would unlock it: submitted and approved kick back to draft; a billed entry is evidence on a finalized invoice, which is never edited or un-finalized — the correction is a credit note recorded beside the bill, and money already collected comes back as a client credit, the payment standing behind the invoice. The chain renders as a stepper (Draft → Submitted → Approved → Billed → Paid) with a lock note, in the details panel. Chain language matches the billing-corrections model. | settled |
| TS4  | **Kick Back reaches approved entries** (the un-approve): it returns them to draft with a recorded reason. The API today kicks back submitted only — recorded as a gap.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | settled |
| TS5  | **How an entry is a draft is unmistakable.** Log Time saves as a draft by explicit label — Save & Close saves the draft, and the dialog's footer says "Saves as a draft, entered by …". Submit for Review is its own visible step, in the details panel and the context menu.                                                                                                                                                                                                                                                                                                                                                 | settled |
| TV1  | **Clicking a row presents the entry's full details** in a panel beside the list (the Docket's N22c pattern): every field, both dates, both attributions, the entry number, the chain and its lock note, the invoice linkage, and the status history with timestamps and actors. Explicit close; clicking the row again or the space beneath the rows lets go.                                                                                                                                                                                                                                                                 | settled |
| TV2  | **A billed entry names its invoice** — number, finalized date, paid or unpaid with the operative date — with an Open in Billing affordance, Soon against the billing screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | settled |
| TT1  | **The toolbar is reworked to fewer, clearer controls.** Log Time is the one button, beside the filter-clear and column controls. The timer starts inside Log Time (TD6's own logic), and the top-bar timer chip is its always-visible handle: running, a click stops it and logs the time; idle, a click opens Log Time.                                                                                                                                                                                                                                                                                                      | settled |
| TD5b | **The dialog's buttons are "Save & Close" (primary) and "Save & New".** The primary is never labelled "Log Time". Supersedes TD5's names; the save-and-continue reset behavior stands.                                                                                                                                                                                                                                                                                                                                                                                                                                        | settled |
| TD8  | **The Log Time dialog fits without scrolling.** No horizontal scroll ever; no vertical scroll at common sizes (verified 1600×900, 1366×768, 1280×720, 1024×640 — short viewports tighten the rhythm instead of growing a scrollbar). Hours, Rate and the resulting Amount sit together in ONE arithmetic cluster, the rounding sentence beneath them.                                                                                                                                                                                                                                                                         | settled |
| TD10 | The memo field is labelled **"Internal Memo"**; the Soon explainer sentence is struck — the badge alone carries the dependency, its hover naming what it waits on. Refines TD1.                                                                                                                                                                                                                                                                                                                                                                                                                                               | settled |
| TD11 | **"Appears on the bill exactly as written." is struck** from the Info field. Revises TL2's caption; the Info name stands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | settled |
| TL8  | **Two dates.** The date the entry was ENTERED is saved and shown beside the date the work was FOR: a Date Entered column (off by default), always in details and on the printed sheet.                                                                                                                                                                                                                                                                                                                                                                                                                                        | settled |
| TL9  | **The reset-to-default (rows/columns) control is removed** from this surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | settled |
| TL10 | **The summation lives in the table footer**: matter totals when unfiltered, in-view totals labelled "In view:" when a filter is in play, voids never counted, scope-honest hover captions kept, the Billing seam beside the unbilled figure. Supersedes TL5's placement above the table.                                                                                                                                                                                                                                                                                                                                      | settled |

**Notes recorded this round:**

- TT1's exact composition — removing the toolbar Start Timer in favor of the dialog timer plus the
  top-bar chip as the running timer's handle — is judgment applied to "rework it, fewer clearer
  controls", recorded for the owner to correct if a dedicated toolbar control is wanted.
- The Staff select excludes departed members (there is nobody to capture new work for), while TK1
  keeps their names on every historical entry.
- Entry-number capture order is the entered date, tie-broken by record identity; the owner fixed
  the shape as "matter number + sequence" and left the exact rendering to the design — recorded
  as `2026-0147.0042` (dot separator, four digits).

## API gaps the mockup is honest about

Consolidated across rounds, in rough priority order. The per-matter listing and capture contracts
need:

1. **The two dates:** `createdAt` (the entered date) is stored but not served on the listing (TL8).
2. **Dual attribution:** delegated capture — the create route refuses a foreign
   `timekeeperUserId` today — plus a served enterer attribution; the audit trail already records
   `actorUserId`, so the capture half exists (TD9).
3. **Entry numbers:** no matter-scoped sequence exists on the record (TL7); the platform's
   sequence-numbering machinery (`@magna-carta/sequence-numbering`) is the natural home.
4. **Invoice linkage:** `time_entry.invoice_id` exists on the row but the listing serves neither
   it nor the invoice number a billed entry should name (TV2).
5. **Un-approve:** kick-back is submitted-only in the API; TS4 wants approved → draft as well.
6. **Status history:** no endpoint serves an entry's audit events (entered / submitted / approved
   / kicked back / billed / voided, each with actor and instant) — the details panel's History
   section renders exactly that (TV1).
7. Carried from earlier rounds: the historical timekeeper name served forever (TK1's backend
   half — denormalize at capture); the resolved rate on the listing; `utbmsActivityCodeId` on the
   listing; a billable-side category vocabulary and column; the non-billable category on the
   listing; billing disposition beyond the boolean (TD2); an internal memo column (TD10); a
   permission on the rate override (TP4).
