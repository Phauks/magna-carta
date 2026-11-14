# Trust — the reconciliation screen, statement PDFs and the month's report

**Date:** 2026-11-14
**Scope:** Owner request of 2026-11-13: a trust reconciliation screen that takes the bank's statement
PDFs month by month, cross-references them against the trust book and the client ledgers, and prints
a report of what was and was not reconciled, with notes;. Check printing was split into its own
thread by the owner and gets its own design.
**Status:** Design. Screen layouts await the owner's pick from the board in the project files
(`trust-reconciliation/`: reconciliation A, B or C). The data model below is
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

How other products do the same work, with sources, is in the project files
(`trust-reconciliation/findings.md`). The short version: QuickBooks reconciles bank to register and
leaves the client leg to a manual trial-balance comparison; Clio reconciles both legs and locks a
finished month.

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

## 3. Checks, where they meet reconciliation

Check printing is designed separately. The one seam: a printed check writes its number into the
trust movement's `reference`, which the matcher already reads, and the report's check register
section reads the check register rather than re-deriving it.

## 4. Capabilities

Unchanged: recording or importing a statement, matching and adding notes run under `trust:manage`;
closing a reconciliation is unchanged.

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

1. Check printing (its own design).
2. A bank feed or aggregator (refused earlier; a PDF or CSV is the only producer of statement rows).
3. Operating-account reconciliation. The proof is trust-specific; operating reconciliation belongs to
   the general ledger.
