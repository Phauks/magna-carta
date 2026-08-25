# Matter time tab — the owner's standing rulings

Every ruling the owner has issued on the time surface, cumulative, newest round last. **A ruling here
is settled.** It is not re-derived, re-proposed, or re-litigated by a later round, and a round that
silently reverts one is a regression, not a redesign. The review surface is The Timesheet mockup;
rulings bind the app screen when the design ports.

Status values: `settled` (built in the mockup and confirmed) · `regressed` (was settled, a later
round undid it) · `open` (asked for, not yet built) · `superseded` (a later ruling replaced it, with
the pointer).

Rulings from the file manager's ledger that generalize beyond that surface
([`file-manager-rulings.md`](file-manager-rulings.md)) bind here too — Lucide-only icons, no inert
controls, say what a control will do, the person's name never "You", never "Just now", filter
controls inside the column header, active filters unmissable, dialogs capped with scrolling bodies.

## R1 — round one: the owner's first review, and the two-package analysis

The round was driven by the owner's corrections plus a principles-not-duplication analysis of a
legacy billing package (two screenshots: its time-entry window and its matter Time & Fees list) and
of Clio's current time-entry surface.

| #   | Ruling                                                                                                                                                                                                             | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| TK1 | **A timekeeper's name is history, not a join against current membership.** A former member's entries always render the person's name; "No longer a member" is data loss and is not allowed.                        | settled |
| TS1 | Draft / Submitted / Approved / Billed / Void each carry a distinct semantic-token treatment: draft quiet, submitted amber, approved green, billed info-blue, void danger-muted with the row struck.                | settled |
| TS2 | One chip per row: the chip is workflow status. Billing disposition renders through the Billable column and the Amount dash — never a second chip.                                                                  | settled |
| TL1 | The context-menu item says "Copy", not "Copy Narrative".                                                                                                                                                           | settled |
| TL2 | The billed-text column is named "Info", not "Narrative". The dialog field matches, captioned that it appears on the bill exactly as written.                                                                       | settled |
| TL3 | Billable and non-billable entries both carry a category. Non-billable uses the platform's seeded vocabulary; billable uses a firm-editable internal taxonomy (recommended shape: internal codes mapping to UTBMS). | settled |
| TL4 | Activity codes are first-class: an Activity column and a dialog select, honest that the catalog requires the code at capture only on e-billing matters.                                                            | settled |
| TL5 | The stat tiles are too loud on this tab: a quiet summary line, the table unmistakably the page's subject. The loud tile treatment belongs to Overview.                                                             | settled |
| TL6 | Staff renders as an initials avatar beside the always-visible name — never avatar-only.                                                                                                                            | settled |
| TD1 | Billed text ("Info") and the internal memo are two fields with two audiences; a memo never appears on a bill, and the dialog makes the distinction unmistakable.                                                   | settled |
| TD2 | Billing disposition is richer than a boolean: next invoice / hold / no charge belong to the model, not a yes/no.                                                                                                   | settled |
| TD3 | The rate is shown resolved with its explanation, with a permission-gated per-entry override — named rate cards, never a bare number field.                                                                         | settled |
| TD4 | The rounding increment is a firm setting rendered read-only in the live arithmetic preview, never a per-entry choice — per-entry increments are inconsistent billing a client can spot.                            | settled |
| TD5 | The Log Time dialog offers Save & Close and Save & Add Another (dialog stays open, resets duration and Info, keeps date, disposition and category, focuses quick entry).                                           | settled |
| TD6 | The timer lives where the work happens: start a timer from the dialog instead of typing hours; the stopped timer reopens Log Time prefilled. It is the matter's single server-side timer, not a form stopwatch.    | settled |
| TD7 | The live arithmetic states itself: worked time, units of the firm increment, rounding direction, hours × rate = amount. Amounts are pre-tax by definition.                                                         | settled |
| TX1 | No per-entry tax UI. The platform's recorded stance holds: tax composes at invoicing; WIP never carries hand-entered tax.                                                                                          | settled |
| TB1 | The path from time to invoice is a seam, not a surface: the unbilled figure links toward Billing, Soon-badged against the billing slice. No invoicing is built on the time tab.                                    | settled |

**Rejected on analysis, recorded so nobody re-imports them:** modal record prev/next navigation ·
title-bar delete (void stands) · single-entry print · a matter picker inside the matter tab · a
merged two-line hours+description cell (breaks column machinery and row-height consistency) · a
list-level disposition dropdown and a separate Advanced Search (the column filters and the matter
search are the mechanisms) · a list-level Inc.-tax toggle (WIP is pre-tax) · per-entry minute
increments · activity-code management on this tab (a firm-settings surface).

## Open owner questions

| #   | Question                                                                                                                                                          | Status                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| TP1 | Flat fees in the Time surface? Recommendation: no — the invoice is where time and fees become one ledger; a combined WIP roll-up belongs to Billing if wanted.    | open — owner question |
| TP2 | Human-readable entry reference numbers — dispute-resolution value versus legacy identity.                                                                         | open — owner question |
| TP3 | Delegated time entry (assistant enters for attorney): permission model plus actor-versus-timekeeper audit attribution. The audit trail already records the actor. | open — owner question |
| TP4 | Who may override the resolved rate (`overrideRateE4` is ungated today).                                                                                           | open — owner question |
| TP5 | A firm-level Timesheet week grid (days × matters, rapid catch-up) as the next time surface — the `grid-batch` endpoint already ships.                             | open — owner question |
| TP6 | Column defaults chosen this round (Category on; Billable and Worked off) — confirm or correct.                                                                    | open — owner question |
| TP7 | Per-entry tax exemption override — the only per-entry tax concept that could ever be needed; deferred until a firm with a configured tax policy asks.             | open — deferred       |

## API gaps the mockup is honest about

The listing and capture contracts need, in rough priority order: the historical timekeeper name
served forever (TK1's backend half — denormalize at capture; `timekeeperName` becomes non-nullable);
the resolved rate on the listing; `utbmsActivityCodeId` on the listing; a billable-side category
vocabulary and column; the non-billable category on the listing; billing disposition beyond the
boolean; an internal memo column; delegated capture with dual attribution; a permission on the rate
override.
