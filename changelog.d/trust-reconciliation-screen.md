---
category: Added
audience: public
---

**Trust reconciliation screen.** Reconciliation, under Money in the sidebar, lists each trust account's reconciliations and opens one to tick off the bank statement: start date and balance carried over (or typed for the first), any end date, the end balance from the statement, deposited, withdrawn, cleared balance and the difference worked as you tick. Lines filter by type and by Uncleared, Needs Review or New; each has its own notes with Needs Review and Mark Resolved. IOLTA interest sits in its own box. Every tick saves at once and shows on other people's screens, with Undo, Redo, History (undo any change), Save and Restore Points. Several statement files can be attached. The report prints at any time, marked DRAFT on every page until the reconciliation is finished. The PDF composer gained a page watermark for it. Backed by `packages/trust/src/bank-reconciliation.ts` and the `20261119T191138_trust-bank-reconciliation` per-firm migration (additive).

## Public

**Reconcile a trust account.** A new Reconciliation screen lets you tick off each bank statement against the trust account, see the difference as you go, keep notes on any line, undo any change, and print a draft or final report.
