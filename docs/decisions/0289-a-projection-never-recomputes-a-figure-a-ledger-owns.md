---
number: 289
slug: a-projection-never-recomputes-a-figure-a-ledger-owns
status: Proposed
date: 2026-08-13
area: Reports
summary: "Every quantity the reporting surface prints is classified, and the class is a property of the read rather than of the presentation. Class 1 — owned elsewhere (the three-way proof, an invoice total, a matter's unpaid receivable, a trust account's client-ledger total as of a date) — is read through the owning package's own function or statement, never re-implemented, never rounded a second way. Class 2 — a decomposition of a class-1 aggregate, such as a per-client breakdown of a client-ledger total or a journal whose closing balance is a book balance — is new SQL, and each one ships with a fitness test asserting it sums to the aggregate its owner produces over the load-profile fixture book; a decomposition that cannot be proved equal to its aggregate is not shipped. Class 3 — counts, ratios, hours, distributions — is genuinely new and is the only class allowed to be original, and it is deliberately the class that touches no money the ledger has an opinion about. The load-bearing corollary is that nothing recomputes the three-way reconciliation: where a period contains a CLOSED reconciliation the pack prints the frozen attestation verbatim from trust_reconciliation, and where the live proof at the pack's knowledge instant differs it prints both, labelled, with the difference explained as ledger movement since the attestation — never a third number and never a silent preference. A negative-space regression test fails if the reporting package ever grows its own SUM over ledger_line restricted to trust node accounts, which is the exact shape that would quietly become a second client-ledger total."
---

**A report is a re-presentation of a figure some other package already owns, or it is a
decomposition proved equal to one, or it is not about money.**

**Context:** A reporting surface is the natural place for a second answer to appear. The arithmetic
is easy, the tables are right there, and a `SUM` over trust node accounts is four lines. But the
three-way reconciliation is a proof a firm signs and a regulator reads, the receivable control
account is reconciled against the invoice subledger by a fitness query, and the contingency
entitlement is derived on every call precisely so it is never a stored decision. A report that
recomputes any of them differently — by a rounding boundary, by including the firm's cushion in a
client total, by keying a journal on `trust_movement` instead of on the ledger entry — produces a
second answer to a question that has one, and the second answer is the one printed on the document
handed to an examiner.

**Decision:** Three classes, assigned per read.

**Class 1, owned elsewhere.** `computeTrustThreeWayProof`, `selectTrustClientLedgerTotalAsOfStatement`,
`selectTrustBookBalanceAsOfStatement`, `selectTrustFirmFundsTotalAsOfStatement`,
`readAccountsReceivableAging`, `readContingencyResidual`, an invoice's derived total. The report
**calls these**. They are not references in a design document; they are the implementation.

**Class 2, a decomposition.** Per-client and per-matter breakdowns, a journal with a running balance,
an aging split by office. These are new statements, and each ships with an agreement test over the
load-profile fixture book: the per-matter closing balances sum to the client-ledger total the proof's
own client leg uses; the journal's closing bank balance equals the book balance statement; the as-of
aging at today equals the live aging read bucket for bucket. No agreement test, no merge.

**Class 3, new here.** Counts, ratios, hours, distributions. Arithmetic stated once in the reporting
package and tested there. It is deliberately the class with no money the ledger has an opinion about.

**Nothing recomputes the reconciliation.** A closed period prints its frozen attestation verbatim —
the totals, `closed_by`, `closed_at`, which leg disagreed and by how much. Where the live proof at
the pack's knowledge instant differs, both appear, labelled, with the difference named as the ledger
having moved since the attestation, which ADR-0246 already establishes is not a fault. Never a third
figure, never a silent preference between the two.

**Considered and rejected:** **A reporting package with its own SQL over everything**, on the
grounds that it keeps report code together — it puts the trust invariants' arithmetic outside the
package that owns and re-proves them, outside the schema-name-sync net, and one refactor away from
disagreeing with the proof. **Re-deriving the reconciliation at report time so the pack always shows
current figures** — ADR-0246 rejected read-time derivation for the reconciliation itself and the same
reasoning binds here; a signed attestation that changes is not one. **Trusting review to catch a
second answer** — the divergence would be a rounding boundary or a predicate, both invisible in a
diff and both wrong only on some data.

**Consequences:** Adding a report figure is a slower act than it looks: either find its owner and
call it, or write the agreement test. That friction is the point. A fitness function fails if the
reporting package ever grows its own `SUM` over `ledger_line` restricted to trust node accounts,
because that specific shape is how a second client-ledger total would arrive without anybody
deciding to write one.
