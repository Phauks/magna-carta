# Trust accounting (slice 3·2) — analysis for owner review

**Date:** 2026-08-04 · **Kind:** analysis, not a design and not a decision · **Status:** awaiting owner review

Trust accounting is the most invariant-heavy subsystem in the platform and the one where a wrong
default is an ethics violation rather than a bug. Nothing here is built, nothing here is decided, and
no code, schema, or migration follows from this document without the owner's approval. Every
suggestion below is labelled **Recommendation** and is a starting position for the owner to accept,
reject, or replace.

What this document is: the ledger-model options with their trade-offs, the invariants that must hold
by construction, where jurisdiction variance actually bites, the integration points against the built
3·1 and 3·3 subsystems, what the pre-alpha schema baseline condensation means for sequencing, the
audit and reporting obligations the rules impose, and a proposed slice breakdown in which each slice
names the owner decisions it needs answered before it can start.

Existing binding decisions in this area are ADR-0008 (append-only double-entry ledger), ADR-0009
(jurisdiction-configurable trust engine), ADR-0072 (the ledger core as built), ADR-0032 (fees never
touch trust), and ADR-0061 (money representation). This document proposes no ADR and supersedes
none.

---

## 1. What already exists, and one correction

### 1.1 On `main` today

The ledger substrate is built and is the right substrate. `@magna-carta/ledger` ships `postEntry`,
`reverseEntry`, `createAccount`, statement builders, and a fitness suite over four per-firm tables:

- `ledger_account` — type (`asset`/`liability`/`equity`/`income`/`expense`), single currency, a
  self-referencing `parent_account_id` that is the sub-ledger seam, and a soft-close `active` flag.
  Normal balance is derived in code, never stored.
- `ledger_entry` — a civil `effective_date` and a UTC `recorded_at`, plus a UNIQUE
  `reverses_entry_id` making a double reversal structurally impossible. No `UPDATE` ever touches this
  table.
- `ledger_line` — direction plus an always-positive `amount_minor`, posted to active leaf accounts
  only.
- `account_balance` — one row per account in normal-balance terms, with nullable
  `min_balance_minor` / `max_balance_minor` and a CHECK constraint. Because D1 has no interactive
  transactions, that CHECK is the only mechanism that aborts a whole batch on a business condition.

The close-precondition registry at `packages/matters/src/close-preconditions.ts` exists and
`CLOSE_PRECONDITIONS` is still an empty array. Trust would be its first consumer.

Slice 3·1 (time tracking, work-in-progress, rate engine) and slice 3·3 (costs and expenses) are
built, along with the shared `@magna-carta/billing-core` lifecycle they both consume. Per-firm
migrations use monotonic timestamp identifiers; the most recent is `20260804T160001`.

### 1.2 The correction

There is an approved design and a task-by-task implementation plan for the jurisdiction layer —
`docs/specs/2026-07-09-slice-3-2-trust-jurisdiction-schema-design.md` and its implementation plan —
and **neither has been built**. There is no `packages/trust-jurisdictions` in the repository.

More consequentially, that design consumes a typed research corpus of 56 jurisdictions by 16 fields
that lives in a **separate repository** (`magna-carta-research-archive`) and has not been vendored
here. What `docs/research/trust-rules/` actually contains today is the earlier narrative catalog —
five group files covering the 50 states, the District of Columbia, and the five territories against
13 fields, with confidence markers and explicit "needs verification" flags. It is genuinely useful
research and it is not the machine-readable corpus the design assumes.

So the jurisdiction engine is not a small remaining piece of an otherwise-started slice. It is
unstarted work whose first task is a repository vendoring step, and the plan's own completion
criterion (backfilling verbatim quotes and source tiers to all 896 cells so the generator's
provenance guard can become a hard failure) has not been met.

**Recommendation:** treat the 2026-07-09 design as a strong, still-valid proposal rather than as
settled ground, and re-confirm it with the owner as part of this review rather than inheriting it
silently. Its three load-bearing ideas — that a researched silence and an absence of research are
different types, that baseline resolution is asymmetric across rule categories, and that a field
earns a machine-readable value only when code must compute on it — are the best thinking in the
repository on this subject and should survive whatever else changes.

---

## 2. The ledger model

### 2.1 The account tree

Trust money is a liability: the firm holds it and owes it back. The bank account holding it is an
asset. Both sides live in the same ledger, and a trust movement is an ordinary balanced entry.

The shape that the phase-3 slice map assumes, and that the ledger's `parent_account_id` seam was
built for:

```
Trust Bank Account (asset, leaf)          <- one per real bank account
Client Trust Liability (liability, parent) <- one per real bank account
  |- Trust — <client or matter> (liability, leaf, min_balance_minor = 0)
  |- Trust — <client or matter> (liability, leaf, min_balance_minor = 0)
  |- ...
```

A receipt is `Dr Trust Bank / Cr <client leaf>`. A disbursement is the mirror. Because every trust
entry touches exactly one trust-bank leaf and exactly one client leaf under the matching parent, the
book side and the client side of a three-way reconciliation agree **by construction** rather than by
a nightly job. That is the single strongest argument for this shape and the reason it should be hard
to talk anyone out of it.

Three things about it need an owner answer before the first row exists.

**Granularity — client, matter, or both.** The bar rules speak of a "client ledger". The firm
operates on matters, and the close-precondition hook is a matter-level event. Three options:

| Option | Shape                                                          | Consequence                                                                                                                                                               |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A**  | One leaf per client per trust account                          | Matches the rules' vocabulary exactly. A matter-close zero-balance check has to ask about a portion of a shared balance, which is not a balance the ledger knows.         |
| **B**  | One leaf per matter per trust account                          | Matter close is a direct balance read. Reports must roll matters up to produce the client ledger a bar examiner asks for. Account count scales with matters, not clients. |
| **C**  | Three levels: trust account parent, client parent, matter leaf | Both readings are direct. Costs a deeper tree and one more account per client.                                                                                            |

**Recommendation: option C**, and it is the decision that most needs to be made first. `createAccount`
refuses a parent that already carries postings, which is correct — it is the creation-side half of
the leaf-only invariant — and it means you cannot later insert a client tier above matter leaves that
have already posted. Getting this wrong is not an expand-contract migration; it is a rebuild of the
account dimension.

**A trap in option C worth naming.** A posting batch updates `account_balance` only for the accounts
its lines touch, and lines only touch leaves. A parent account therefore has an `account_balance` row
that stays at zero forever. Any report or check that reads a parent's stored balance will silently
read zero rather than the roll-up. The roll-up is a `SUM` over descendant leaves, and that has to be
stated somewhere enforceable — a fitness query asserting that no non-leaf account carries a non-zero
stored balance, and a review rule that trust totals are never read from a parent row.
**Recommendation:** add that fitness query in the same slice that creates the first parent.

**Creation timing.** Lazily at the first trust receipt, or eagerly at matter open. Lazy avoids an
account per matter for the majority of matters that never hold trust money, at the cost of the
receipt path having to create the account, its `account_balance` row with `min_balance_minor = 0`,
and the posting in one batch. **Recommendation: lazy**, with creation and first posting in a single
batch so a created-but-unbounded account cannot exist even for an instant.

**Where the bounds are written.** `min_balance_minor = 0` must be set in the same batch that creates
the account and its balance row, never as a follow-up write. A trust leaf that exists for one batch
without its floor is a trust leaf that can be overdrawn in that batch.

### 2.2 The firm's own money in trust

Every researched jurisdiction permits a lawyer to keep firm funds in a trust account for the sole
purpose of paying bank service charges, in the amount necessary for that purpose and no more. Several
(Maryland Rule 19-407(a)(4), for one) require a record identifying which funds in the account are the
attorney's own.

That permitted carve-out has to have a modeled home, because the alternative is firm money hiding
inside a client's ledger — which is the definition of commingling.

**Recommendation:** a designated firm-funds leaf under the same trust account parent, distinct from
every client leaf, so "the firm's own money in this trust account" is a balance you can read, report,
and bound. Whether it carries a maximum bound, and whether the platform enforces a cap at all when no
jurisdiction states a dollar figure, is an owner decision.

### 2.3 Three-way reconciliation

Three totals must agree, per trust account, as of a statement date:

- **bank** — the institution's statement ending balance, adjusted for deposits in transit and
  outstanding disbursements.
- **book** — the firm's own record of the account, which is the trust-bank leaf's balance.
- **client** — the sum of every client or matter leaf under that account's parent, plus the firm-funds
  leaf.

Book and client agree by construction if the composition guard in section 3.3 holds. The bank side is
the only genuinely external input, and it is the only side that can catch an item the firm never
recorded.

**Clearing status cannot live on the ledger.** `ledger_entry` takes no `UPDATE`, ever. Marking an
item cleared is a mutation. It therefore needs its own table keyed by entry identifier — a
reconciliation-item row recording that this entry cleared on this statement — and that table is the
one place where the reconciliation workflow's state lives.

**Stored or re-derived.** The slice map leaves this open: does the reconciliation report re-derive the
book side live, or read stored rows? **Recommendation: stored, immutable.** A reconciliation is an
attestation about a moment. If a reversal posts next week with a backdated effective date, a
re-derived "as of last month" report changes after it was signed, which is exactly what an archived
artifact exists to prevent. Store the three totals, the outstanding-item list, the statement
reference, the reconciler's identity, and the timestamp, as an immutable row set; a correction is a
new reconciliation superseding the old by link, never an edit. Slice 3·6 then renders from stored
rows and re-derives only for the live, not-yet-reconciled view.

**The bank side's input path.** Manual entry of statement date, ending balance, and cleared-item
marking is sufficient and is what most firms will use. An imported statement (OFX, CSV, or a banking
integration) is a Phase 7 integration concern. **Recommendation:** manual only in this slice, with
the import path named as a seam and the reconciliation model shaped so an importer becomes another
producer of the same rows.

**What "signed" means** is an owner decision with three plausible readings: an attestation by a named
authenticated user recorded in the row; a cryptographic hash chain over the artifact; or a real
e-signature through the built signing engine. They differ by an order of magnitude in effort.

### 2.4 What the no-negative invariant does not do

It prevents the **book** from going negative. It cannot prevent the bank account from being
overdrawn, because an overdraft can arise from an item the firm never recorded — a bank fee, a
returned deposit, a forged or duplicated check. Reconciliation is what catches those, which is why the
reconciliation workflow is a correctness feature and not a reporting convenience.

**Recommendation:** never state, in the product or in user documentation, that the platform prevents
trust overdrafts. It prevents the firm's own records from showing a negative client balance, which is
a different and honest claim.

---

## 3. Invariants that must hold by construction

"By construction" means enforced by a schema constraint, a type, or a chokepoint that code cannot
route around — not by a check some caller is expected to remember.

### 3.1 No negative client trust balance

`min_balance_minor = 0` on every client trust leaf, enforced by the `account_balance` bounds CHECK.
A disbursement that would overdraw fails the CHECK, and because the whole posting is one D1 batch,
the entire batch rolls back: the idempotency record, the entry, the lines, the balances, and the
outbox row. This is the existing mechanism and it needs no new machinery. (ADR-0009, ADR-0072;
`docs/conventions/invariants.md`.)

One known rough edge, already documented in the ledger package: reversing a deposit whose funds have
since been disbursed fails the bounds CHECK at commit. That is the correct outcome and a
user-hostile error. **Recommendation:** the trust layer owes a domain-level pre-check that turns it
into a named refusal explaining that the funds are gone, while leaving the CHECK as the actual
guarantee.

### 3.2 No commingling

Distinct from no-negative, and not expressible as a balance bound. No-negative prevents
overdraft-by-disbursement; no-commingling prevents firm money sitting in a client trust ledger except
the bank-charge carve-out, and prevents client money sitting anywhere but a trust account. The
phase-3 slice map already identifies this as needing its own structural guard and assigns it to 3·2.

**Recommendation:** a composition guard in the trust service — the one place trust entries are built
— that refuses any entry in which a client trust leaf is credited from a firm income or expense
account, or in which a trust leaf and an operating bank account appear on the same entry. Backed by a
fitness query over posted lines so a bypass is caught even if a future caller finds one.

### 3.3 Fees never touch trust

Trust and IOLTA deposits land gross; processor and bank fees debit the operating account only, never
netted from a trust deposit. The ledger primitive is account-agnostic — it enforces balanced,
leaf-only, and bounds, with no concept of "trust" — so it cannot enforce this itself. The slice map
assigns structural ownership to 3·2, with 3·4 and the payments phase inheriting.
(ADR-0032; `docs/conventions/invariants.md`.)

**Recommendation:** the same composition guard as 3.2 carries this rule, and the guard is exported as
the only supported way to compose a trust entry, so 3·4's apply-funds path and the payments phase's
card rail inherit it by calling it rather than by remembering it.

Note that `docs/conventions/invariants.md` currently files this rule under the Trust heading while
citing Payments and ADR-0032. The slice map flags reconciling that attribution as 3·2's job.

### 3.4 Trust-to-operating transfer rules

The earned-fee transfer is where most real-world trust violations happen, and it is the operation
most in need of an explicit owner ruling.

**Shape.** Two options: a single entry touching both bank accounts, or two linked entries — a trust
disbursement (`Dr <client leaf> / Cr Trust Bank`) and an operating receipt (`Dr Operating Bank /
Cr Accounts Receivable`). **Recommendation: two linked entries.** The two sides clear on different
bank statements, reconciliation runs per account, and a single entry would put an uncleared operating
receipt inside a trust reconciliation. The link is a shared transfer identifier, not a mutation.

**Preconditions.** Money may leave trust for the firm only when it has been earned, and in practice
that means an invoice or an itemized statement exists and the client has been given it. Whether the
platform **hard-requires** a finalized invoice before permitting an earned-fee transfer, or warns and
records an override, is an owner decision with real consequences in both directions: a hard
requirement is the ethically correct default and will be experienced as friction by firms that
invoice out of band.

**Amount ceiling.** A transfer must be limited by the client's **available** balance, not merely by a
positive balance — see holds, below.

**Direction.** Client-to-client transfers within trust (moving funds between two clients' ledgers)
are the classic misappropriation pattern. **Recommendation:** refuse them outright at the composition
guard. A genuine case (a client with two matters) is expressible as matter-to-matter within one
client if the tree is option C, which is another argument for that shape.

### 3.5 Void, not delete

The ledger already gives this: no `UPDATE` on entries or lines, corrections as linked reversals, a
UNIQUE reversal link. The trust layer adds nothing to the ledger side and must not introduce a
status or soft-delete column on entries.

What does need care is everything trust adds **around** the ledger. A completed reconciliation, a
hold, a bank statement record — each must inherit the same discipline: immutable once completed,
superseded by link rather than edited. It is easy to build an append-only ledger and then hang a
mutable table off it that quietly becomes the real record.

### 3.6 Disputed funds and holds

Many jurisdictions require that when the lawyer and another person both claim an interest in trust
property, the disputed portion is kept separate until the dispute is resolved, with undisputed
portions distributed promptly. That is not a balance bound and not a separate account — the money has
not moved.

**Recommendation:** a hold model. A hold row reduces the **available** balance without moving money;
available equals stored balance minus active holds; disbursement authorization reads available, not
balance. The `account_balance` CHECK still guards the floor at zero, so a hold is a domain-level
restriction layered above a structural one, which is the right ordering — the structural guarantee
never depends on the domain layer being correct.

### 3.7 Inherited invariants

These bind here without being trust-specific: append-only everywhere; effective-dated with backdating
allowed and future-dating refused; a single registered currency per entry, so a foreign-currency
trust account is a schema change and never a silent extension; matter numbers frozen at assignment,
which trust ledger labels depend on; and rule numbers never hard-coded, which is the whole subject of
section 4.

---

## 4. Jurisdiction variance

### 4.1 The posture

The custodian design's treatment of retention (ADR-0213, "Proposed — owner decision pending") is the
precedent this analysis follows deliberately. Its formulation: the platform ships the **mechanism**
and supplies **no policy**; anything jurisdiction-specific is flagged as an owner or verified-catalog
decision rather than a default the design invents; a catalog, if built, is verified against primary
legal text, shipped one jurisdiction at a time, with an explicit "not encoded for your jurisdiction"
state and never a silent generic fallback.

Trust is the harder case, because unlike custody retention there is genuinely no way to ship a useful
trust subsystem with **zero** encoded jurisdiction facts — the no-negative floor, the segregation
rule, and the fees-never-touch-trust rule are universal enough to enforce for everyone. The line this
analysis proposes is the 2026-07-09 design's three-bucket asymmetry, which is the sharpest available
formulation:

- **Rigor** rules (retention floors, reconciliation cadence, record completeness) may resolve to the
  strictest observed value when a jurisdiction is silent. A wrong silence over-complies, which is
  safe.
- **Restriction** rules (prohibited disbursement methods) may resolve to "off" **only** on an
  explicitly recorded finding that the rule is silent. A wrong silence here under-restricts, which
  hands a lawyer a payment method the rule forbids.
- **Data** facts (who receives IOLTA interest, where unclaimed funds escheat, which body takes an
  overdraft report) assert something about the world. A wrong silence states a wrong fact, and these
  must never be defaulted.

**Recommendation: adopt this asymmetry as the governing rule of the jurisdiction engine**, and adopt
with it the type-level distinction between "the rule is silent" and "we never researched this" — the
South Carolina IOLTA case in that design, where the two were conflated and the resolved answer told a
South Carolina firm that IOLTA participation was optional when Rule 412(b)(1) says the opposite.

### 4.2 What actually varies

Drawn from the in-repository catalog, which is verified against primary text for most states and
carries explicit verification flags where it is not. Every item below is a **place where a default
would be wrong**, not a list of values to encode:

- **Governing rule citation.** Not 1.15 everywhere. Texas uses TDRPC 1.14. Kentucky uses SCR
  3.130(1.15) with IOLTA in SCR 3.830. Maryland renumbered to 19-301.15 with the operative mechanics
  in a separate Chapter 400. Nebraska uses section 3-501.15 with the trust regime in Article 9. New
  York uses 22 NYCRR Part 1200.
- **Records retention.** Five to eight years. Missouri is six, measured from the **later** of
  termination of representation or the last disbursement — a different clock, not just a different
  number. Alabama is six.
- **Reconciliation.** Maryland mandates a monthly reconciliation that ties the bank balance to the
  sum of client-matter balances — three-way in substance. Missouri requires a reconciliation each
  statement cycle without using the phrase. Texas does not mandate reconciliation at all; the state
  bar recommends it. Alabama requires monthly trial balances and quarterly reconciliations.
- **IOLTA.** Mandatory in most states. Nebraska is opt-out by written declination filed by February 15. Guam has no program at all. Recipients differ (bar foundation, legal services corporation,
  access-to-justice foundation), as do comparability rate floors and remittance cadence.
- **Advance and flat fees.** Missouri exempts an advanced flat fee of $2,000 or less from the
  trust-deposit requirement. Texas recognizes a true non-refundable retainer as the lawyer's
  property. Most states follow the ABA "deposit and withdraw as earned" model. This directly changes
  where a payment lands, so it is the highest-consequence data fact in the set.
- **Prohibited disbursement methods.** Cash withdrawal, ATM access, debit card, check payable to
  Cash, overdraft protection, and electronic transfer without written authorization are each banned
  in some jurisdictions and unaddressed in others.
- **Overdraft notification.** Universal in substance, but the receiving body differs (Bar Counsel,
  Office of Disciplinary Counsel, Counsel for Discipline, the state bar's Office of General Counsel)
  and the deadline differs (Alabama: not cured within three business days; Nebraska: five banking
  days).
- **Unclaimed funds.** Escheat to the state treasurer in most, to a bar foundation or client
  protection fund or the clerk of court in others; dormancy periods span months to years; some are
  reclaimable, some have de minimis thresholds.
- **Annual compliance.** Maryland's IOLTA compliance report is a condition precedent to practising
  law, enforced by decertification. Vermont's is biennial, not annual.
- **Separate interest-bearing account thresholds.** Maryland states a net-interest test; several
  states delegate the call to the lawyer's judgment. That distinction is not a value difference — a
  delegated judgment is a rule the engine must **not** pretend to make.

### 4.3 What follows

**Recommendation:** every jurisdiction fact carries its citation, a verbatim quote, a source tier, and
a confidence; a fact without a verbatim quote is not shippable as a machine-readable value; and the
resolver refuses outright rather than falling back when a field was never researched.

**Recommendation:** per-jurisdiction attorney review is a shipping gate, recorded per jurisdiction so
Nevada can ship reviewed while a territory has not been. The product surfaces "not verified for your
jurisdiction" rather than hiding it — a firm that knows the platform has not encoded its state will
check; a firm shown a confident wrong answer will not.

**Owner decision:** all 56 jurisdictions at once, or Nevada first with an explicit not-encoded state
for the rest. The custodian precedent argues for one at a time. The counter-argument specific to
trust is that the research corpus already covers all 56 at usable confidence, so the marginal cost of
breadth is review rather than research. This is a real trade and it is the owner's call.

---

## 5. Integration points

### 5.1 Slice 3·1 — time tracking (built)

**No coupling, and that is the finding.** Time is work-in-progress and never posts to the ledger;
trust is money movement and never reads work-in-progress. The two streams were designed to be
parallel and they are. The convergence is at 3·4.

**Recommendation:** resist adding a trust-balance read to any time surface. The temptation ("show the
timekeeper the client's trust balance") creates a dependency for a display, and the same information
belongs on the matter financial surface.

### 5.2 Slice 3·3 — costs and expenses (built)

Also work-in-progress, also no ledger touch. One real seam exists, and it needs an answer now rather
than later.

**Paying a hard cost from trust.** If a firm advances a court filing fee out of the client's trust
funds, that is simultaneously a trust disbursement and a cost — and it must **not** become a client
receivable, because the client already funded it. The white paper explicitly defers pay-from-trust
("not enabled now but easy to add"). The question is whether `cost_entry` gains a nullable link to
the trust disbursement **now**, while the table is young and pre-alpha, or later as an
expand-contract migration.

**Recommendation:** add the nullable column in this slice under the build-when-in-the-area rule, and
build no workflow on it. A nullable column on a pre-alpha table is nearly free; the same column added
after firms have cost rows is a migration on live financial data. **Owner decision** because it puts a
trust concept into a built package's schema without a consumer.

### 5.3 Slice 3·4 — billing (not built)

The convergence slice, and the one with the sharpest boundary question.

Applying trust funds to an invoice is the trust-to-operating transfer of section 3.4, triggered by
billing. 3·4 owns the accounts-receivable lifecycle and the work-in-progress conversion; 3·2 owns the
trust side.

**Recommendation:** 3·2 publishes a domain operation — an apply-funds or disburse-from-trust
composer that returns statements — and 3·4 merges those statements into its own finalize batch.
3·4 must never write trust tables or compose trust entries itself. That keeps the composition guard
unbypassable and keeps a single owner for the fees-never-touch-trust rule, which is what the slice map
means by "3·4 inherits it".

**Sequencing consequence:** 3·2 must publish that seam before 3·4 completes, which makes 3·2 a hard
input to 3·4 rather than a soft one. The slice map describes 3·2 as "converging" on 3·4; in practice
the apply-funds seam is a build dependency.

### 5.4 Slice 3·5 — operating general ledger (not built)

The phase-3 slice map's coordination pin 4 pairs 3·4 with 3·5 over the product chart of accounts and
the firm account resolver. **That pin hits 3·2 as well, and the slice map does not say so.** Trust
creates the first real (non-demo) `ledger_account` rows in the product: the trust bank asset, the
client trust liability parent, and every client leaf. The demo chart at
`packages/fixtures/src/demo-chart-of-accounts.ts` is explicitly demo-only.

**Recommendation:** 3·2 does not invent a chart-of-accounts numbering scheme. It creates accounts
through `createAccount` and carries whatever classification columns 3·5 will need as nullable
additions, co-designed with 3·5 rather than guessed. **Owner decision:** accept an interim
account-resolution seam in 3·2, or hold trust behind 3·5's chart product.

### 5.5 Slice 3·6 — reports, and 3·7 — automations

3·6 renders; 3·2 produces. The stored-versus-re-derived question in section 2.3 is the read contract
between them. 3·7's evergreen replenishment alert reads a trust balance against a firm-configured
threshold — read-only, and explicitly not `min_balance_minor`, which is the structural floor and not
a business threshold.

### 5.6 The payments phase (Phase 6)

Phase 3 records money movement; Phase 6 processes it. Two inheritances run forward:

- **Fees never touch trust** is enforced at the rail by routing trust and operating payments to
  **separate deposit destinations**, and by the composition guard 3·2 owns. A card payment into trust
  lands gross and its processor fee debits operating as a separate entry.
- **Surcharge legality** reuses the jurisdiction machinery — surcharging is banned in some states,
  capped in others, must be disclosed and network-registered, and debit is never surcharged. ADR-0032
  and ADR-0047 both already name this reuse.

**Recommendation:** the jurisdiction profile carries the processor-fee and surcharge fields in this
slice even though nothing consumes them until Phase 6. Reference data is a package release, so adding
a field later is cheap — but researching it later means researching 56 jurisdictions twice.

### 5.7 Slices 1·1 and 1·2 — matters, locations, protected fields

**The close precondition.** `CLOSE_PRECONDITIONS` is empty and trust is its first consumer: a matter
with a non-zero trust balance cannot close. **Owner decision:** hard block, or advisory notice? The
custodian design chose advisory for custody packets on the reasoning that a blocking gate trains
firms to unlink. Trust is different — a closed matter with client money in it is precisely the
condition that produces unclaimed funds and disciplinary exposure. **Recommendation: hard block**,
with the failure message naming the balance and the two legitimate exits (disburse to the client, or
begin the unclaimed-funds process).

**Location binding.** The trust account is bound to a Location, and the jurisdiction is **derived**
from that office's state rather than chosen by a user — the rules require the account to be in the
state of the lawyer's office. A multi-office firm runs several profiles at once, one per office. Pass
resolved values into the trust package rather than importing the locations package into it.

**Protected fields.** The bank account and routing numbers are the sensitive identifiers here.
**Recommendation:** the full account number is `protected()`; the account's display name and last
four digits are not, because a list view that triggers a decrypt-and-audit per row is the wrong cost
shape. **Owner decision** on whether that split is acceptable.

---

## 6. The schema baseline condensation, and what it means for sequencing

Two decisions sit here. ADR-0178 replaced sequential migration numbers with monotonic timestamp
identifiers and collapsed both lineages to one clean baseline each, and that is done. ADR-0135 —
still open, still on the roadmap backlog — collapses the **per-firm** lineage again into a single
genesis baseline before the first real alpha firm is onboarded, gated on two conditions: no durable
per-firm database to preserve, and **all in-flight slice branches merged**.

Four consequences for trust:

**The pre-collapse window is the only cheap window for the account tree.** Once a real firm's database
exists, the account tree shape is live client-money data and every correction is an expand-contract
migration against it. Before the collapse, a wrong shape is absorbed into the baseline. Section 2.1's
granularity decision is therefore not merely "decide early" — it is "decide while it is still free".
**Recommendation: build trust before the collapse and before the first alpha firm**, and treat that
window as the reason to do it now rather than later.

**A long-lived trust branch blocks the collapse.** Gate 2 is "all in-flight slice branches merged",
and each branch pins specific migration identifiers. A slice that accretes eight trust migrations
over six weeks holds the collapse hostage for six weeks. **Recommendation:** land trust schema in the
fewest, largest migrations the slice breakdown permits, land them early in the slice rather than one
per sub-slice, and merge sub-slices rather than parking a branch.

**The jurisdiction package is not a migration, and that is a sequencing advantage.** Rules are shared
reference data compiled into a package; firm choices are rows in the firm's own database. A rule
correction is a package release, not a migration against every tenant. So the corpus and resolver work
can run fully in parallel with the ledger work, on its own branch, without touching the migration
lineage or contending for the collapse. **Recommendation:** run them as separate parallel streams for
exactly this reason.

**Migration identifiers no longer collide across branches**, so parallel trust sub-slices are safe on
that axis. The remaining mechanical contention is the access-control permission registry and the
per-firm schema file, which are ordinary merge conflicts rather than correctness hazards.

---

## 7. Audit and reporting obligations

### 7.1 What the rules require the firm to keep

Where jurisdictions enumerate records — and several deliberately decline to, requiring only "complete
records", which is itself the verified finding — the enumerated list is consistent enough to design
against:

receipt and disbursement journals; per-client ledger records showing source, amount, purpose, payee,
and running balance; retainer and fee agreements; accountings rendered to clients and third persons;
bills for fees and expenses; disbursement records; checkbook registers, bank statements, deposit
records, and cancelled or substitute checks; **electronic-transfer records**; reconciliations; the
trust-related portions of client files; and, in Missouri explicitly, records of credit-card
transactions with clients.

Two of those have direct data-model consequences that are easy to miss:

**The electronic-transfer authorization memo.** Maryland requires, for each disbursement by electronic
transfer, a written memorandum authorizing the transaction and identifying the responsible attorney.
**Recommendation:** record an authorizing user on every trust disbursement in this slice, not later.
It is one column and one required field; retrofitting it means a period of disbursements with no
recorded authorizer, which is precisely the gap an examiner asks about.

**A record identifying the firm's own funds in the account.** Section 2.2's designated firm-funds leaf
satisfies this structurally rather than by a report.

### 7.2 Retention

Five to eight years across the corpus, with different clocks (from termination of representation; from
the later of termination or last disbursement; from record creation).

**Recommendation:** the platform's retention default is **indefinite**, and a jurisdiction's period is
a **purge floor, never a deletion trigger**. A single global eight-year floor satisfies every
researched jurisdiction, and no jurisdiction's rules produce "delete the trust record because a timer
expired". This mirrors the custodian design's position on retention and is the same reasoning.

### 7.3 What 3·2 must produce for 3·6 to render

Client ledger (per client or matter, chronological, with running balance); trust journal (receipts and
disbursements per account by effective date); a trial balance of client ledgers; the three-way
reconciliation; and a dormant-funds aging list.

**Reproducibility is a hard requirement, not a nice-to-have.** Reports read `effective_date`, never
`recorded_at`, and an as-of-a-past-date client ledger must reproduce exactly. The append-only ledger
gives that for the money; the reconciliation, hold, and statement tables must inherit the same
immutability or the guarantee is only half true.

### 7.4 Unclaimed and dormant funds

Destination, dormancy period, diligence requirement, reclaimability, and de minimis thresholds all
vary by jurisdiction, and escheat is an outbound obligation with a deadline.

**Recommendation:** this slice ships the aging visibility and carries the jurisdiction fields; the
escheat workflow itself is a later slice. **Owner decision** on whether that split is acceptable,
since a firm that can see dormant funds but cannot process them has a visible obligation and no
tool.

---

## 8. Proposed slice breakdown

Five sub-slices. Each names the owner decisions that must be answered **before** it starts, because
each of those decisions changes the shape of what the sub-slice builds rather than merely its
behaviour. All of this is a **Recommendation**.

### 3·2·1 — Account model, sub-ledgers, and the structural guards

The trust account and its Location binding; the account tree; client and matter leaves with
`min_balance_minor = 0` written in the creation batch; the designated firm-funds leaf; the
composition guard enforcing no-commingling and fees-never-touch-trust; the parent-balance fitness
query; permissions; protected bank identifiers; the load-profile extension.

**Blocked on:** T1, T2, T3, T13, T14.

### 3·2·2 — Movement operations and the close precondition

Receipt, disbursement, trust-to-operating transfer as two linked entries, the refusal of client-to-client
transfers, the hold model and available-balance semantics, the authorizing-attorney record, the
domain pre-check that turns a bounds-CHECK rollback into a named refusal, and the zero-balance close
precondition as the registry's first consumer.

**Blocked on:** T4, T5, T12, and T6 if the `cost_entry` column lands here.

### 3·2·3 — Jurisdiction reference data and resolver (parallel stream, no migration)

Corpus vendoring from the research archive; the per-jurisdiction typed overlay; the generator with its
refuse-rather-than-guess guards; the resolver with the three-bucket asymmetry; the firm settings
overlay that may only tighten a restriction, never loosen one.

**Blocked on:** T7, T8. Not blocked on anything in 3·2·1 or 3·2·2, and touches no migration — this is
the stream that can start first.

### 3·2·4 — Three-way reconciliation

The reconciliation-item table, the manual bank-side entry, cleared-item matching, the outstanding
list, the three-total tie-out, and the immutable archived artifact.

**Blocked on:** T9, T10, T11. Depends on 3·2·1 and 3·2·2.

### 3·2·5 — Compliance surfacing

Binding the resolved jurisdiction requirements to real behaviour: prohibited-method refusals, the
reconciliation cadence reminder, the retention purge floor, the annual or biennial compliance prompt,
the dormant-funds aging list, and the "not verified for your jurisdiction" surface.

**Blocked on:** T7, T15, T16. Depends on 3·2·3 and 3·2·4.

---

## 9. Owner decision points

| Flag    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1**  | **Sub-ledger granularity: client leaves, matter leaves, or a three-level tree?** Recommendation: three-level (trust account parent, client parent, matter leaf). This is the first and least reversible decision — `createAccount` refuses a parent that already carries postings, so a client tier cannot be inserted above matter leaves later.                                                                                                                                                              |
| **T2**  | **Create a client trust leaf lazily at first receipt (recommended) or eagerly at matter open?** Lazy avoids an account per matter for matters that never hold trust money; it requires create-plus-post in one batch.                                                                                                                                                                                                                                                                                          |
| **T3**  | **The firm's own funds in trust: a designated leaf under the trust parent (recommended), or refuse firm funds in trust entirely?** Every researched jurisdiction permits the bank-charge carve-out. Refusing it is stricter than the rules and would be a deliberate product choice.                                                                                                                                                                                                                           |
| **T4**  | **Trust-to-operating transfer: hard-require a finalized invoice, or warn and record an override?** Recommendation: hard-require. This is the operation where real violations happen, and the friction is the point. Shape recommendation (two linked entries, not one) is separate and lower-stakes.                                                                                                                                                                                                           |
| **T5**  | **Is available balance (stored balance minus active holds) the disbursement ceiling?** Recommendation: yes, with holds as the model for disputed funds. The alternative — a separate disputed-funds account — moves money that has not moved.                                                                                                                                                                                                                                                                  |
| **T6**  | **Does `cost_entry` gain a nullable trust-disbursement link now, with no workflow built on it?** Recommendation: yes, under build-when-in-the-area. It puts a trust concept into a built package's schema without a consumer, which is why it needs an explicit answer.                                                                                                                                                                                                                                        |
| **T7**  | **Jurisdiction rollout: all 56 at once, or Nevada first with an explicit not-encoded state for the rest?** The custodian precedent argues one at a time; the counter-argument is that the corpus already covers 56 at usable confidence, so the marginal cost is review rather than research.                                                                                                                                                                                                                  |
| **T8**  | **Is per-jurisdiction attorney review a hard shipping gate?** Recommendation: yes, recorded per jurisdiction, with an unreviewed jurisdiction surfacing as not-verified rather than resolving.                                                                                                                                                                                                                                                                                                                 |
| **T9**  | **Reconciliation: stored immutable artifact (recommended) or re-derived at read time?** The slice map leaves this open. Stored is the only shape under which a signed attestation about last month cannot change next week.                                                                                                                                                                                                                                                                                    |
| **T10** | **Bank-side input: manual entry only in this slice (recommended), with import as a named seam?**                                                                                                                                                                                                                                                                                                                                                                                                               |
| **T11** | **What does "signed" mean for a reconciliation — attestation by a named user, a hash chain, or a real e-signature through the signing engine?** These differ by an order of magnitude in effort and the rules do not compel the strongest reading.                                                                                                                                                                                                                                                             |
| **T12** | **Matter close with a non-zero trust balance: hard block (recommended) or advisory?** The custodian design chose advisory for custody; trust is the case where a soft gate produces unclaimed funds and disciplinary exposure.                                                                                                                                                                                                                                                                                 |
| **T13** | **Protected bank identifiers: full account number `protected()`, display name and last four not?** Recommendation: yes — a list view that decrypts and audits per row is the wrong cost shape.                                                                                                                                                                                                                                                                                                                 |
| **T14** | **Chart of accounts: accept an interim account-resolution seam in 3·2 (recommended), or hold trust behind 3·5's chart product?** Trust creates the first real product accounts, so coordination pin 4 reaches 3·2 and not only 3·4.                                                                                                                                                                                                                                                                            |
| **T15** | **Retention: indefinite by default, with the jurisdiction period as a purge floor and never a deletion trigger?** Recommendation: yes, mirroring the custodian position.                                                                                                                                                                                                                                                                                                                                       |
| **T16** | **Unclaimed funds: aging visibility in this slice with the escheat workflow deferred (recommended), or both together?** A firm that can see dormant funds but cannot process them has a visible obligation and no tool.                                                                                                                                                                                                                                                                                        |
| **T17** | **Sequencing: build trust before the pre-alpha per-firm baseline collapse?** Recommendation: yes. The pre-collapse window is the only period in which the account tree shape is free to get wrong, and a long-lived trust branch is itself a blocker on the collapse.                                                                                                                                                                                                                                          |
| **T18** | **Two-person disbursement authorization: every disbursement, or only those over a threshold?** Shipped as ALL, with a seam for a per-firm threshold setting. No firm is live, so loosening the rule later costs a setting and tightening it later costs a conversation with every firm that got used to the looser one. A threshold is also a number this analysis has no basis for choosing — no researched jurisdiction states one.                                                                          |
| **T19** | **A firm with only one member holding `trust:manage`.** Shipped as: the two-person requirement binds when the firm has two or more such members, and a lone manager's own approval is recorded on the decision as `sole_trust_manager` and surfaced on the client ledger. The alternative — a hard rule — makes a solo practitioner unable to disburse at all. The exception is not a setting: the database counts active members holding the capability and refuses the basis the moment a second one exists. |
| **T20** | **Does approving need its own permission?** Shipped as: no — `trust:manage` covers submitting and approving, and approver-differs is the control. A second permission would have to be seeded, mapped into the default roles, and reasoned about in every firm's role design, to express a distinction the differs rule already enforces. Revisit if a firm needs approval restricted to a narrower group than the members who can compose movements at all.                                                   |
| **T21** | **Does a pending disbursement request expire?** Shipped as: no. An expiry silently invalidates a request nobody decided, which is a state change with no author; the available-balance re-check at approval already refuses a stale request on the ground that actually matters. A submitter withdraws what they no longer want.                                                                                                                                                                               |

---

## 10. Owner-review checklist

Work through these in order; items 1 to 4 gate everything else.

1. **Confirm the posture.** Analysis only. No trust code, schema, migration, or package is written
   until you say so. Confirm that this remains the standing rule for trust, as it is for custodian
   retention.

2. **Rule on the account tree (T1).** Client leaves, matter leaves, or the three-level tree. This is
   the first decision and the least reversible one, because a parent cannot be inserted above accounts
   that have already posted. Nothing in 3·2·1 can start without it.

3. **Rule on sequencing (T17).** Does trust build before the pre-alpha per-firm baseline collapse?
   A yes makes the tree decision cheap to get wrong; a no makes it permanent.

4. **Re-confirm or replace the 2026-07-09 jurisdiction design.** It is approved and unbuilt, and its
   corpus lives in a separate repository that has not been vendored. Confirm whether it still stands
   as written, and confirm the corpus vendoring is wanted here (roughly 18 MB, PDFs excluded).

5. **Rule on jurisdiction breadth and the review gate (T7, T8).** All 56 at once or Nevada first; and
   whether attorney review is a hard per-jurisdiction shipping gate.

6. **Rule on the transfer rules (T4, T5).** Whether an earned-fee transfer out of trust hard-requires
   a finalized invoice, and whether holds and available balance are the model for disputed funds.
   These two decide what 3·2·2 builds.

7. **Rule on the boundary decisions (T3, T6, T12, T13, T14).** Firm funds in trust; the `cost_entry`
   link column; hard block or advisory on matter close; protected bank identifiers; the interim chart
   seam.

8. **Rule on reconciliation (T9, T10, T11).** Stored or re-derived; manual bank entry only; and what
   "signed" means.

9. **Rule on retention and unclaimed funds (T15, T16).** Indefinite with a purge floor; aging now with
   escheat deferred, or both together.

10. **Confirm the two honest limitations** so they are not later mistaken for gaps: the no-negative
    invariant prevents the firm's book from going negative and cannot prevent a bank overdraft, which
    is what reconciliation is for; and a jurisdiction field that was never researched must refuse to
    resolve rather than fall back to a baseline.

11. **Approve or amend the slice breakdown in section 8** — five sub-slices, with the jurisdiction
    reference-data stream (3·2·3) startable first and in parallel because it touches no migration.

12. **Decide what happens next.** Nothing proceeds to spec, plan, or build without this checklist
    answered.
