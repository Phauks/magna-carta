# Trust — check printing and the reconciliation screen

**Date:** 2026-11-14
**Scope:** Owner request of 2026-11-13: a trust reconciliation screen that takes the bank's statement
PDFs month by month, cross-references them against the trust book and the client ledgers, and prints
a report of what was and was not reconciled, with notes; and check printing from a trust account, set
up from a scan of the firm's own blank check stock.
**Status:** Design. Screen layouts await the owner's pick from the board in the project files
(`trust-reconciliation/`: reconciliation A, B or C; check layout X, Y or Z). The data model below is
the same for every option.
**Builds on:** [`2026-08-14-trust-pdf-statement-import-design.md`](2026-08-14-trust-pdf-statement-import-design.md)
(the PDF read of a statement, unchanged here except for the defaults in section 5) and the shipped
three-way reconciliation in `packages/trust` (`reconciliation.ts`, `three-way-proof.ts`,
`matching.ts`).

---

## 1. What exists, and what this adds

| Exists today                                                               | Adds                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A statement recorded by hand or from a CSV, opened as a reconciliation     | A statement read from its PDF, the PDF kept beside it                |
| One statement line matches exactly one ledger entry                        | One statement line may match several entries (a deposit slip)       |
| The close freezes the proof and takes one free-text note                   | A note on any line or outstanding item, printed with the month       |
| No document a firm can hand an examiner                                    | The month's report as a PDF, composed by `@magna-carta/pdf-compose`  |
| A trust payment records `method = 'check'` and a free-text reference       | A check register: numbered, printed, voided, never deleted           |
| Nothing about paper                                                        | Check stock: a layout per account, placed over a scan of a blank check |

How other products do the same work, with sources, is in the project files
(`trust-reconciliation/findings.md`). The short version: QuickBooks reconciles bank to register and
leaves the client leg to a manual trial-balance comparison; Clio reconciles both legs and locks a
finished month; neither lets a firm place fields over its own check.

## 2. Reconciliation additions

### 2.1 One line, several entries

The match table already allows several rows per statement line; the refusal is in the composer
(`statement-line-already-matched` in `matching.ts`). The change: a line may carry several live
matches **when their amounts sum to the line's amount and every entry moves in the line's
direction**. The check moves from "is this line already matched" to "would this match make the
line's matched total exceed its amount". A line is cleared when its matched total equals its amount;
a line partly matched is still unmatched for the proof, and the screen says how much is left.

`readUnmatchedTrustBankStatementLines` and the fitness re-proof change in the same way: they compare
sums, not counts. An entry still matches at most one line (an entry cannot clear twice).

Suggestion stays a suggestion. For a deposit line with no single equal receipt, the candidates are
the outstanding receipts dated on or before the line, nearest first; the screen shows a running sum
and the person ticks the ones on the slip. No subset-sum search runs on its own.

### 2.2 Notes

A new append-only `trust_reconciliation_note`: reconciliation, subject (a statement line, a ledger
entry, or the month itself), text, author, time. A note is superseded by a later note on the same
subject, never edited. Notes may be added after a month closes, because an outstanding check's story
continues; a note added after the close prints under its own heading so the frozen record stays
distinguishable from what was said later.

### 2.3 Changes after close

The report's "changes since this month closed" section lists, for the previous closed month, any
match withdrawn after its close and any ledger entry dated inside its period recorded after its
close. Both are reads over existing append-only tables; nothing new is stored.

### 2.4 The report

Composed on request from frozen figures plus live reads, never cached as the record: the frozen
close is the record, the PDF is a rendering of it. Sections: the summary (statement, in transit,
outstanding, adjusted bank, book, client total, difference), the items not reconciled at close with
their notes, stale outstanding items (older than a threshold the firm sets, 90 days by default), the
changes since the previous close, the client-ledger checks (none below zero, the firm's cushion,
dormant matters), the trial balance by client, the period's check register, the matched items, and
the signature block. The statement PDF, when kept, is appended.

## 3. Check printing

### 3.1 The register

A new `trust_check`: trust account, check number, the `trust_movement` it pays (a disbursement whose
method is `check`), status, printed-at, printed-by. Statuses are written as append-only events
(`trust_check_event`: `numbered`, `printed`, `spoiled`, `voided`), and the current status is the
last event. Rules:

- A number is unique per trust account and is never reused, including after a void.
- A check is numbered only at print, from the account's next number, in one batch with the
  `numbered` events, so two people printing at once cannot take the same number.
- After the print dialog, the person answers per check: printed, or spoiled. A spoiled check is
  voided with its number kept and the payment returns to the print queue for a new number.
- Voiding a check that already left the office is a different act: it does not reverse the
  payment. Reversing money is a trust movement under the authorization policy, not a check event.
  The screen says so and links to the payment.
- The amount, payee and date come from the movement and cannot be edited on the check.

The movement's existing `reference` is written with the check number when it is numbered, so the
matcher's reference signal works for printed checks without change.

### 3.2 Check stock

A new `trust_check_stock`: trust account, name, page layout (`check_top`, `check_middle`,
`check_bottom`, `three_per_page`), the scan's file id (kept in the firm's R2 like any other upload,
straightened from its four corners in the browser before upload), the field list, and a whole-page
offset. Fields are stored in **thousandths of an inch from the check's top-left corner**, with a
width, a text size and an alignment; inches because check stock is specified in inches, and an
integer so nothing drifts in floating point.

Fields: date, payee, amount (numbers), amount in words, memo, payee address, matter reference, and
the check number when the stock is blank (not preprinted). The **MICR band**, the bottom 0.625 inch of
the check, is refused for every field: printing over it causes the bank's reader to reject the check.
Printing the MICR line itself (blank stock with magnetic toner) is not in this design.

Versions: a saved layout is a new row; a printed check records which layout version it printed with.

### 3.3 Printing

The browser asks the API for a PDF of the selected checks; `@magna-carta/pdf-compose` places each
field at its stored position on a letter page, with the voucher stubs (payee, amount, matter, check
number) repeated below or above for the stock's layout. The scan never prints. A test page prints
the same layout with sample values and a thin outline of each field, for holding against a real
check.

Amount in words is produced by one pure function, tested to the cent, with a fill of asterisks to
the end of the line so nothing can be written in after it.

## 4. Capabilities

Printing a check and saving a layout run under `trust:manage`, like recording a statement. Voiding a
printed check also runs under `trust:manage`, because it moves no money. Closing a reconciliation is
unchanged.

## 5. Defaults taken for the PDF import's open flags

The 2026-08-14 design left four flags with the owner. The owner's request to upload statement PDFs
is taken as a decision to build the import; the following defaults are built and listed for him to
overrule:

- **S1:** a statement whose lines do not add up to its closing balance is refused, naming the gap.
- **S2:** a scanned statement may be imported, with the read-out kept and the source marked on
  every line.
- **S4:** one line may match several entries (section 2.1).
- **S5:** the PDF is kept for the jurisdiction's trust-record retention period; an erasure request
  does not reach it while that period runs.

## 6. Not in this design

1. Printing the MICR line on blank stock.
2. Positive pay files to the bank (a later integration, and it needs the bank's format).
3. Operating-account checks. The operating disbursement path is still deferred in billing; check
   stock and the register are keyed to a bank account so they extend to operating when it lands.
4. Electronic signatures printed on checks.
