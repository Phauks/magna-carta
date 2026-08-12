---
number: 243
slug: billing-invoice-model-and-earned-fee-satisfier
status: Proposed
date: 2026-08-05
area: Billing
summary: "A DRAFT INVOICE IS A WORKING DOCUMENT AND A FINALIZED INVOICE IS AN EVIDENTIARY FINANCIAL RECORD, and the transition between them is the only interesting moment in the subsystem: in one batch a number is drawn from an allocation ledger, the accounts-receivable entry posts, every claimed time and cost entry locks to billed, and per-(invoice, matter) balance rows are created with a bounds CHECK that makes over-application structurally impossible. That CHECK is the answer to the trust subsystem's unanswered T4: an earned-fee transfer requires a FINALIZED invoice with sufficient UNPAID BALANCE ATTRIBUTABLE TO THAT MATTER, named as an explicit application, with no override — enforced not by the pre-read but by the balance CHECK riding the same batch as the trust entries, exactly the layering trust already uses for its no-negative floor. The precondition is implemented in billing and requires NO CHANGE to the trust package, which is the test that the seam sits in the right place; billing never composes a trust entry, never writes a trust table, and never reimplements a trust rule. Claims and lines are SEPARATE TABLES — a partial unique index on the active claim is the concurrency control (a guarded UPDATE cannot be, because a zero-row UPDATE is not an error in SQLite, the same lesson the matter-number allocation row encodes) — which also makes a flat fee representable as N claims to zero lines, and a consolidated bill as N claims to one. SENT IS NOT A STATUS: delivery is append-only rows, because a re-send is not a change to a financial record, and making the frozen row mutable for its least load-bearing field is how an append-only table stops being one. Finalization POSTS to the ledger rather than deriving accounts receivable, and that is settled empirically rather than by preference — the shipped trust transfer's second leg already credits accounts receivable, so a derived model would leave a growing negative asset equal to every fee ever taken from trust; the invoice tables are the subledger and a fitness query proves the tie-out. TAXES TAKE THE JURISDICTION-REFUSING POSTURE: mechanism only, per-firm configured rates, no taxability catalog and no default, because the trust analysis's own three-bucket asymmetry classifies a tax rate as a DATA FACT and a wrong silence states a wrong fact. The genuinely hard case is stated rather than solved: a credit note after the fee has already left trust is a FIRM-FUNDS question — the trust ledger is not rewound, the credit beyond what is applied becomes an open client credit, and the platform names the three real exits (refund from operating, return to trust as two linked entries, apply to a future invoice) and moves no money on its own."
---

**A finalized invoice is the earned-fee satisfier, and the invoice-matter balance CHECK is what makes
that a guarantee rather than a hope.**

**Context:** Time and cost work-in-progress ship, the ledger ships, and the trust subsystem ships
with its earned-fee port **refusing every transfer** on the stated grounds that what evidence permits
money to leave trust had not been settled (flag T4). Billing is the convergence slice and the only
place in Phase 3 that touches the ledger.

**Decision:**

1. **Three states — `draft`, `final`, `void` from draft only.** A draft is editable and disposable; a
   finalized invoice is frozen by database trigger and corrected only by credit note. Delivery is
   append-only rows, not a `sent` status.

2. **Finalization is one batch:** number draw through the matter-numbering allocation idiom (drawn at
   finalize, so an abandoned draft burns no number and the sequence has no gaps by construction), the
   presentation snapshot, the `billed` lock on every claimed entry, the `invoice_matter_balance` rows,
   and the accounts-receivable posting. Any failure rolls all of it back.

3. **The earned-fee precondition, stated exactly.** A transfer of amount A from matter M's trust leaf
   is permitted if and only if the caller names applications against invoices that are `final`, belong
   to the same client, bill matter M, and have at least that much unpaid balance for M, summing to A.
   The pre-check produces a refusal a person can act on; the **balance CHECK riding the same batch is
   the guarantee**, so a concurrent transfer, payment, or credit note that consumes the balance aborts
   the entire batch — trust entries, transfer link, applications, and idempotency record together.
   Hard requirement, no override.

4. **The seam holds without touching trust.** The precondition is built in billing from the
   application it already resolved, so trust's existing context is exactly enough. Billing merges
   trust's composed statements and composes no trust entry itself, enforced by a source scan.

5. **Claims and lines are separate tables**, with a partial unique index on the unreleased claim as
   the concurrency control. A guarded `UPDATE` is a mirror, never a guard.

6. **Balances are per (invoice, matter)**, because a trust transfer draws on one matter leaf; the
   invoice total is a `SUM`, mirroring trust's roll-ups-carry-no-balance rule.

7. **Finalization posts; accounts receivable is not derived** — the shipped trust transfer's second
   leg already credits it. The invoice tables are the subledger, with a tie-out fitness query. Hard
   costs credit **Client Costs Advanced** (an asset, no income), which runs negative until 3·5 records
   the operating disbursement — named openly rather than hidden in a clearing account.

8. **Taxes: mechanism, no policy, no default.** Per-firm rates behind a `TaxPolicyPort`, computed on
   the aggregate base per rate with a single `roundTax`, snapshot at finalize.

9. **A credit note after a completed transfer is a firm-funds question.** The excess becomes an open
   client credit with three named exits; the platform records the obligation, makes it un-loseable,
   and discharges nothing on its own.

10. **Account roles refuse rather than guess.** An unmapped role refuses finalization by name, in the
    jurisdiction resolver's posture, until 3·5's chart populates the map.

**Considered and rejected:** _a `sent` status_ (makes the frozen row mutable for its least
load-bearing field); _deriving accounts receivable from invoice state_ (leaves the shipped trust
transfer's credit unbalanced, and takes a real balance-sheet asset out of the ledger); _a guarded
UPDATE as the double-claim guard_ (a zero-row UPDATE is not an error, so the loser commits having
changed nothing); _one balance per invoice_ (a trust transfer draws on one matter leaf and needs that
matter's ceiling); _releasing billed work-in-progress back to draft on a full credit note_ (requires
widening the `billed`-is-terminal freeze that time and costs both consume, against the white paper's
stated rule that post-bill corrections are new adjusting entries); _widening trust's port with an
invoice reference_ (would make trust know what an invoice is, for no gain); _a platform tax catalog_
(a tax rate is a data fact, and a wrong silence states a wrong fact); _computing settlement
disbursement statements now_ (lien priority policy with no verified source — the mistake the trust
analysis exists to prevent); _rewinding trust on a credit note_ (the entries are append-only and the
money is genuinely gone from the client ledger).

**Consequences:** the earned-fee port stops refusing and starts having an answer that a bar examiner
could read; over-collection on an invoice becomes unrepresentable rather than merely unlikely; a firm
that invoices out of band must finalize an invoice here before taking its own fees, which is friction
and is the point; and the Client Costs Advanced position is a visible open item until the operating
general ledger closes it.
