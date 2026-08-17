# Slice 3·5 — Operating accounting / general ledger — design

**Status:** Design. No product code in this cycle.
**White paper:** _Financial Core_ (Operating accounting / general ledger, Billing, Costs and
expenses, Trust accounting), _Reports_, _Plugin system_.
**Slice map:** [`2026-06-21-phase-3-financial-core-slice-map.md`](2026-06-21-phase-3-financial-core-slice-map.md)
owns this slice's ordering, gates, and the phase-wide invariants; this document does not restate them.
**Invariants:** [`docs/conventions/invariants.md`](../conventions/invariants.md), plus the local
`CLAUDE.md` of [`packages/ledger`](../../packages/ledger/CLAUDE.md),
[`packages/trust`](../../packages/trust/CLAUDE.md), and
[`packages/billing`](../../packages/billing/CLAUDE.md).

**Supersedes** the design and implementation plan on the dormant `slice-3-5-operating-general-ledger`
branch (dated 2026-07-09, cut from a 2026-07-04 merge base, never landed). Section 0.3 states exactly
what in it no longer holds and why, because two of its load-bearing choices were correct then and are
wrong now.

---

## 0. Why this is designable now, what it is not, and what changed

### 0.1 The substrate is finished

Everything this slice classifies already exists and is in use. The append-only double-entry ledger is
the whole posting engine: balanced entries, positive amounts with direction as data, leaf-only
postings, single currency, no future dating, materialised balances written only inside the posting
batch under a bounds CHECK that aborts the batch. Trust accounting is complete — the sub-ledger tree,
the composition guard, holds, the authorization posture, the three-way proof and its freeze, the
bank-charge carve-out. Billing is complete — the invoice spine, all four fee models, the trust
application, credit notes, client credits, write-offs, reversals, the delivery record. Time and costs
landed earlier. Financial reporting's first sub-slice landed: `@magna-carta/reporting`, read-only at
four checkable layers, bitemporal, and materialising nothing.

So this slice invents no money concept. It **completes the chart** the baseline schema deliberately
deferred, adds the two subsystems the firm's own books need that no other slice owns (a general
journal and accounts payable), assembles the statements a firm's accountant reads, and reserves the
accounting integration seam. The `ledger_account` comment says so in as many words: _"no
chart-of-accounts product (Phase 3 adds it on this schema)"_.

### 0.2 What is not finished, and what that costs

- **No cash arrives.** The payments subsystem is designed and unbuilt, and
  `composeInvoiceApplication` refuses the `payment` kind for every rail. Until payments' first
  sub-slice lands the manually recorded receipt, the only way money reaches the operating bank
  account in these books is a general journal entry a person types. The books are correct and they
  are sparse. Section 12.1 states this precisely, because it is the single largest limit on how
  useful this slice is on the day it ships, and it is not this slice's to fix.
- **No operating bank reconciliation.** Trust has one and it is the template; the operating side
  needs a statement importer and a payments clearing account that is not built. Scoped out
  (section 13).
- **No timekeeper cost rate.** Matter and practice-area profitability is therefore not computable —
  the gap `@magna-carta/reporting` already named. This slice adds the posting dimension that
  profitability would read and does not pretend the figure follows.
- **No QuickBooks adapter and no bank feed.** Those are Phase 7·2. This slice reserves the seam and
  fixes its direction; it writes no adapter.

### 0.3 The prior design, and the two things in it that stopped being true

The dormant branch's design was written when 3·5 was expected to land **before** 3·4. It did not:
billing shipped first, with its own interim answer to the account-resolution problem, and that
inverts slice-map coordination pin 4.

| The prior design said                                                                               | What happened                                                                                                                                                                                                                                        | This design does instead                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add `ledger_account.semantic_key` and a `resolveAccount(semanticKey)` resolver; 3·4 will consume it | 3·4 shipped `firm_account_role` — nine role keys, a refusing resolver, a configuration composer — and every billing posting path resolves through it. The payments design extends it with two more roles.                                            | **Adopt `firm_account_role` as the resolver.** A `semantic_key` column would be a second map a firm could edit into disagreement with the first (section 5.2) |
| "3·5 opens before 3·4, so no interim resolution seam is required"                                   | The interim seam is the shipped mechanism and has nine stored roles behind it                                                                                                                                                                        | Extend the shipped seam; move nothing a firm has already configured                                                                                           |
| Widen `cost_entry.source` with a fourth value, `vendorBill`                                         | SQLite cannot widen a CHECK without a destructive table rebuild, which the schema policy forbids against a table holding data — billing's own `invoice_delivery.channel` note records exactly this                                                   | Hold the link on this slice's own table (`vendor_bill_line.disbursement_entry_id`) and derive provenance from it. `cost_entry` needs no change at all         |
| Seed `trustCash` and `clientTrustLiability` into the chart as semantic keys                         | Trust creates its own bank leaf and liability root through `createAccount`, deliberately carrying no classification, and binds them on `trust_account`. A chart that also seeded them would produce two answers to "which account is the trust bank" | The chart **reads** trust's registration and classifies those accounts; it never mints or maps them (section 2.3)                                             |
| Accept the close-versus-posting race and cover it with a fitness function                           | Billing shipped the pattern that closes exactly this class of race: aim a value the table's CHECK forbids at exactly the offending rows, so a stale read aborts its own batch                                                                        | Use that pattern; keep the fitness function as the backstop rather than the mechanism (section 8.5)                                                           |
| `vendor_bill.status`                                                                                | The house pattern derives state and refuses status columns — no status on `trust_hold`, none on `invoice_application`, no `sent` on `invoice`, and `invoice_matter_balance` carries a bounds-checked delta instead                                   | Derive a bill's state from an append-only payment table plus a bounds-checked balance row, the shape A/R already has (section 6.3)                            |

Everything else in the prior design is reused rather than re-derived: the monotonic lock date, the
hard/soft debit routing and its tax reasoning, retained earnings computed rather than posted,
dimensions on the line rather than the entry, and the accounting integration category. Where a
paragraph of it is still right, this design says the same thing and does not pretend to have invented
it.

---

## 1. The one rule the whole design hangs off

> **The operating books are a classification laid over the one ledger, not a second ledger — and
> nothing this slice adds may reach an account trust registered.**

Both halves are structural rather than aspirational.

The first half means there is exactly one `ledger_entry` table, one `ledger_line` table, one
`account_balance` per account, and one posting primitive. The chart of accounts is metadata on
`ledger_account`: a number, a statement classification, a system-account marker. A trial balance is a
read. Nothing in this slice composes a `ledger_entry` insert of its own — a source scan asserts it —
and nothing writes a balance except `postEntry`. The consequence that matters: a firm's operating
books and its trust books are provably the same set of rows, so a bar-audit pack and a balance sheet
cannot disagree about what happened.

The second half is the subject of the next section, and it is the reason this slice needs a design at
all rather than a schema migration.

---

## 2. Trust money is not the firm's money, and the books make confusing them unrepresentable

A general ledger that can post a trust balance into operating income is a malpractice generator. This
section states what already makes that impossible, what this slice newly threatens, and what it adds
to close the gap.

### 2.1 What is already structural, and is not restated here

`@magna-carta/trust` owns no-commingling and fees-never-touch-trust as one composition guard, and it
is the only supported way to build an entry touching client money. An entry with a line on a trust
account may touch nothing outside that trust account — which refuses firm money in a client ledger,
client money in an operating account, and a processor or bank fee netted out of a deposit, all from
one check. The firm's own bank-charge cushion goes through a **second, narrower door** that admits
exactly two lines and cannot express a movement of client money at all. Both are re-proved over
stored lines by trust's fitness suite, so a caller that lied to the guard about a row it was writing
is detectable rather than permanent.

This slice **reuses that guard and adds no exception to it.** Nothing below is a flag on
`assertTrustComposition`, and nothing below widens the second door. That is the single most important
sentence in this design.

### 2.2 The general journal is a third door, and it is refused rather than guarded

A general journal entry — a person typing debits and credits into a form — is a new way to reach
`postEntry` that has never existed. It is exactly the shape that would defeat everything above: the
ledger primitive is account-agnostic by design and has no concept of "trust", so a journal entry
naming a matter leaf and an income account would be balanced, leaf-only, single-currency, correctly
dated, and would post client money into fee income.

The answer is not to teach the journal the trust rules. It is to make the journal **incapable of
naming a trust account**:

`composeGeneralJournalEntry` resolves every line's account through **trust's own**
`loadTrustAccountRoles` — the same read the composition guard uses — and refuses the whole entry by
name (`journal-entry-touches-trust`) unless every line resolves to `outside`. The refusal names the
account, says that client money moves through the trust movement and disbursement paths, and points
at them.

Four properties make this a guard rather than a comment:

1. **It is the inverse of a rule trust already owns, computed from trust's own resolver**, not a
   second implementation of it. If trust registers a new tier of account tomorrow, the journal
   refuses it the same day, with no edit here. A locally reimplemented "is this account trusty?"
   predicate would be a second answer, and the day the two disagreed the journal would be the one
   that let money through.
2. **The dependency edge runs one way and can never invert.** `@magna-carta/general-ledger` depends
   on `@magna-carta/trust`, exactly as `@magna-carta/billing` already does. Trust states in its own
   contract that the chart of accounts is not its concern and takes operating account ids from its
   callers, so trust will never depend on the general ledger; the cycle is closed by a rule that is
   already written down.
3. **A fitness query re-proves it over stored rows.** `generalJournalEntriesTouchingTrustStatement`
   joins `general_journal_entry` through its ledger entry to `ledger_line` and to trust's registered
   accounts; zero rows is healthy. It catches the case the pre-check cannot: a trust account
   registered _after_ a journal entry posted to it. That is a real sequence — a firm could
   hand-create an account, journal against it, then register it as a trust bank leaf — and it is
   detectable only over stored rows.
4. **The refusal is not the only barrier.** Even without it, an entry mixing a matter leaf with an
   income account is refused by the trust guard the moment anyone tries to compose it _through_ the
   guard — but the journal does not go through the guard, which is the whole point. So the refusal is
   the mechanism and the fitness query is the proof, and neither is a substitute for the other.

The same refusal binds the vendor-bill composer and the bill-payment composer (section 6), for the
same reason and through the same call: a vendor bill line naming a trust account would be a firm
expense paid out of client money.

### 2.3 What a chart of accounts may and may not reference

The chart is metadata on `ledger_account`, and trust's accounts **are** `ledger_account` rows. So the
question is not academic: the chart's columns exist on the trust bank leaf, on the client-trust
liability root, on every client node, and on every matter leaf.

**A chart MAY classify a trust-registered account for statement presentation, and must.** A trust
bank account is an asset the firm holds, and the client-trust liability is a liability of exactly
equal size. A balance sheet that omitted them would understate both sides and would hide the one
relationship an examiner most wants to see tie out. They are presented in their own reserved
sections, `trustAssets` and `clientTrustLiability`, which net to zero against each other.

**A chart MAY NOT assign a trust-registered account to any operating role.** No `firm_account_role`
row may name a trust-registered account. Three mechanisms, in order of when they fire:

- `composeAccountRoleConfiguration` refuses by name (`role-account-is-trust-registered`) at
  configuration time, resolving through trust's registration read. This is the good error: it reaches
  a person who is choosing an account, and it says why.
- `firmAccountRolesOnTrustAccountsStatement` is a fitness query over stored rows. It is what catches
  a role mapped to an ordinary account that later became a trust bank leaf.
- And if both were absent, the first posting through the misconfigured role would be refused anyway —
  by the trust guard if it were composed there, and by nothing at all if it were the journal, which
  is precisely why the first two exist.

**A chart MAY NOT re-section a trust-registered account.** The two reserved sections above are
derived from trust's registration, not stored as a firm's choice, so a firm cannot move its client
trust liability into "other income" through the chart admin surface. The section read resolves
trust-registered accounts first and the firm's `statement_section` second; the firm's value on such
an account is ignored, and the chart surface presents those rows read-only with the reason stated.

**A chart MAY NOT re-type a trust-registered account, or any account carrying lines.** `type` drives
normal balance, and normal balance drives the sign of every stored balance on the account. Changing
`type` on an account with lines would invert every historical figure on it silently. This is refused
for every account, not only trust's — see section 4.3.

**A chart does NOT carry a "this is a trust account" flag.** Trust registration is already a stored
fact in three places (`trust_account.bank_ledger_account_id`,
`trust_account.client_liability_account_id`, `trust_ledger_node.ledger_account_id`). A denormalized
flag would be a fourth, free to disagree with the other three, and the disagreement would be silent
in exactly the direction that matters — a stale `is_trust = 0` on a real trust leaf. The read is a
join, owned by `packages/trust/src/statements.ts` (that package owns SQL over its own tables and sits
inside the schema-name-sync net), and `@magna-carta/general-ledger` calls it.

### 2.4 The three statements the books make about trust, and which are new

- **The segregation identity.** For each trust account, the bank leaf's balance equals the sum of its
  matter leaves plus its firm-funds node. This is already true by construction — the guard's
  bank-or-reallocation shape is what makes the book side and the client side move together — and it
  is already proved by trust's own three-way proof, whose `book = client + firm funds` split exists
  for this reason. **This slice does not re-derive it.** The balance sheet _presents_ the two sides,
  and the assembler asserts the sections it printed net to zero, refusing the statement rather than
  printing a balance sheet that says the firm is short of client money. The figure comes from trust's
  own reads, which are the owner.
- **No trust account is on the income statement.** Trust accounts are asset or liability by `type`,
  the income statement reads income and expense sections only, and the reserved sections above cannot
  be reassigned. Three independent reasons, none of which is a filter someone has to remember to
  apply.
- **Retained earnings excludes trust**, because it is computed as income less expense and no trust
  account is either.

### 2.5 What the separation does not and cannot promise

Trust's own note is inherited verbatim and belongs here too: the no-negative floor guards the firm's
**book**, not the bank. Nothing in these books prevents a trust bank overdraft caused by an item the
firm never recorded. Reconciliation catches those, and neither the product nor its user documentation
may say the platform prevents trust overdrafts.

---

## 3. Double-entry — yes, and nothing new enforces it

The operating books are double-entry, and they are double-entry for the same reason and by the same
mechanism the ledger already is: `validateEntry` refuses an entry with fewer than two lines, mixed
currencies, or debits unequal to credits, before anything is composed; the schema refuses a
non-positive amount and an unknown direction; the account-balance CHECK aborts the batch on a bounds
violation. Every posting path this slice adds — the general journal, the vendor bill, the bill
payment — goes through `postEntry`, which means it goes through `validateEntry`.

So the answer to "what enforces that every posting path balances" is: **the one path they all share,
and a source scan that asserts they share it.** `@magna-carta/general-ledger` composes no
`ledger_entry` or `ledger_line` insert of its own, updates no `account_balance`, and imports no
statement builder from `packages/ledger/src/statements.ts` other than the reads. The scan is modelled
on the purity scan `@magna-carta/reporting` already carries and on the source scan that asserts
billing composes no `trust_*` statement — the same fitness-function shape, aimed at a different rule.

Where double-entry becomes newly **visible** is the statements, and that is where this slice adds its
own assertion: the trial balance carries its own proof that total debits equal total credits at the
requested knowledge instant, and **refuses** rather than printing a trial balance that does not foot.
A trial balance is the one report whose whole purpose is to be checkable, so a soft failure in it is
worse than no report.

**What double-entry costs, stated plainly.** A small firm's bookkeeper who thinks in "money in, money
out" is being handed a model with two sides, and the first thing they will ask for is a cash-basis
view. Section 7 answers that, and the answer is a presentation over one accrual book rather than a
second single-entry book. There is no arm of this design in which the platform keeps two sets of
books.

---

## 4. A ledger that can be edited is not a ledger

### 4.1 The operating ledger is the same ledger, so it inherits append-only whole

No UPDATE and no DELETE ever targets `ledger_entry` or `ledger_line`. There is no void, no adjust, no
"unpost", and no status column on an entry. The sanctioned mutations remain exactly the two the
ledger already names — the in-batch `account_balance` delta and `ledger_account.active` (soft close) —
plus, new here, the chart's own classification columns, which describe an **account** and never a
posting.

### 4.2 The correction mechanism is a reversing entry, and it records who and why

`reverseEntry` already exists, already refuses a double reversal by UNIQUE index, and already takes a
**fresh caller-supplied effective date** rather than copying the original's. This slice adds no
correction mechanism; it adds a **record** beside the one that exists.

A general journal entry — original or reversing — carries a `general_journal_entry` sibling row:
the memo a person wrote, the actor, the entry it reverses when it is a reversal, and the stated
reason. Append-only from birth, RAISE(ABORT) triggers on UPDATE and DELETE, including the BEFORE
INSERT guard that catches `INSERT OR REPLACE` (which fires neither of the other two) — the three-
trigger arrangement `invoice_delivery` uses, for the same reason: this is an evidence table.

Why the sibling row rather than the entry's `description`: a reversal a person made deliberately, for
a reason they stated, is a different record from a reversal a machine made to unwind a mistake, and a
free-text description cannot be relied on to tell them apart. The reason is also the thing an
examiner asks about, and it belongs in a column, not in prose.

**A reversal is always permitted**, whatever the period lock says, dated into the open period. That
follows from `reverseEntry`'s existing signature and it is the property that stops a period lock from
trapping a correction. Section 8.3 states it as a rule rather than a coincidence.

### 4.3 The one real hazard the chart introduces, and how it is closed

Classification-on-the-account is safe **because an entry names its accounts by handle**: renumbering
`code` or renaming an account restates no historical figure. The role map already says this in as
many words about re-pointing a role.

Re-sectioning is different. Moving an account's `statement_section` changes what every **past**
statement prints, because a statement is assembled from classification at read time. Moving an
account from an expense section to an asset section would silently rewrite last year's profit.

The guard is that the section vocabulary is a **refinement of `type`**, not a free choice:

- Each `type` admits a closed set of sections (`asset` → `currentAssets`, `fixedAssets`,
  `otherAssets`, `trustAssets`; `income` → `feeIncome`, `otherIncome`; and so on), asserted by a
  DDL CHECK, not only in TypeScript — drizzle text enums are type-level only and this repository
  already states that reasoning twice on the ledger's own columns.
- `type` itself is **immutable on an account that carries lines**, refused by a service pre-check and
  re-proved by a fitness query. Nothing in this repository can re-type such an account today, and the
  chart admin surface must not become the first thing that can.

Together those mean a re-section can only move an account **within one statement** — from
"current assets" to "other assets", never from the income statement to the balance sheet. That is the
property that makes the whole classification approach honest, and it is worth the CHECK.

---

## 5. The chart of accounts

### 5.1 Four columns on `ledger_account`, and no widening of the type CHECK

Additive, expand-contract, all nullable or defaulted; the five-value `type` CHECK is untouched and
normal balance stays derived in code in its one home.

| Column              | Shape              | What it is                                                                                                                                                                             |
| ------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`              | text, nullable     | The account number a firm's accountant reads. Unique per firm where non-null (partial unique index). **Not a handle** — it is a caption, and a renumber must not move a posting target |
| `statement_section` | text, nullable     | Balance-sheet or income-statement placement. Classification only, never normal balance. Constrained per `type` by DDL CHECK (section 4.3)                                              |
| `system_account`    | integer, default 0 | A seeded account. May be renamed and renumbered; never deactivated, never re-typed                                                                                                     |
| `description`       | text, nullable     | What a firm's own note about the account says. Present because the alternative is firms encoding it into the name, which is also the caption                                           |

Accounts are created through `createAccount`, never a raw INSERT, so the leaf-only and parent-match
guards run and the balance row lands in the same batch.

**The chart is a default, not a lock.** Firms rename, renumber, add, and deactivate non-system
accounts. What keeps a renamed account findable is the role map, which is a handle, not the name and
not the number.

**Unclassified accounts refuse rather than defaulting.** An account with a null `statement_section`
is refused **by the statement assembler**, by name, listing the accounts that need classifying. It is
neither silently dropped (the statement would not foot) nor lumped into "other" (that asserts a
classification nobody made). Same posture as the unmapped role and the unresolved jurisdiction, for
the same reason: a fact the platform does not have is not a fact it invents. Trust's own accounts are
classified by derivation, so a firm that has opened a trust account never sees this refusal for it.

### 5.2 The account resolver already exists, and this slice does not add a second one

This is the resolution of slice-map coordination pin 4, in the direction the build order actually
took.

`firm_account_role` maps nine role keys to ledger account ids, refuses by name when a role is
unmapped, names where to set it, and is the door every billing posting resolves through — finalize,
credit notes, write-offs, client credits. The payments design extends it with `payments_clearing` and
`merchant_fees` on the same reasoning. It is the resolver.

**A `semantic_key` column on `ledger_account` is refused**, and the reason is not tidiness: it would
be a _second_ map from meaning to account, editable independently of the first, and a firm could put
`semanticKey = 'accountsReceivable'` on one account while `firm_account_role` pointed at another.
Both would look correct in their own surface. One of them would be where the money went.

So this slice does three things to the seam that exists:

**(a) Give it a home both consumers can depend on.** The map currently lives in
`@magna-carta/billing`. The operating books need to read and configure it, and billing must not
depend on the general ledger nor the general ledger on billing. The answer is the one this repository
already reached for when `@magna-carta/billing-core` was extracted to hold a contract two packages
share: extract the map into a pure leaf, `@magna-carta/account-roles`, on which `general-ledger`,
`billing`, and later `payments` all depend and none of which depends on the others. The extraction is
mechanical — one module and its test — the table and every stored row are untouched, and the gate is
that no behaviour changes. It is nonetheless a refactor of shipped code in an area this slice does not
own, so it is flagged (**G10**) rather than assumed.

**(b) Add the two roles the operating books need**, and only two:

| Role               | Type      | Why                                                                                                                   |
| ------------------ | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `accounts_payable` | liability | The credit side of every vendor bill and the debit side of every bill payment                                         |
| `owners_equity`    | equity    | The balance sheet needs an equity section, and an opening-balance journal entry needs somewhere to put the difference |

There is deliberately **no** `operating_expense_default` role. A vendor bill line names its expense
account explicitly and refuses if it does not — a default expense account is exactly the kind of
plausible-looking fallback that makes a misposting invisible.

Retained earnings is **not** a role, because it is not an account (section 8.4).

**(c) Add three guards at configuration time**, all cheap and all structural:

1. **No trust-registered account** (section 2.3).
2. **No parent account.** A role must resolve to a leaf, or every posting through it would be refused
   by the ledger's leaf-only rule at commit — after the caller had already composed a whole invoice.
   Refusing at configuration turns a commit-time abort into a sentence someone can act on.
3. **The account's `type` must match the role's expected normal balance.** Mapping `fee_income` to an
   asset account is a silent sign inversion on every future invoice, and nothing downstream would
   notice: the entry balances, the batch commits, the balance moves the wrong way. This is the
   cheapest high-value guard in the slice — one static table of role-to-type, asserted at
   configuration.

Guard 3 also means the role vocabulary gains a declared type per role, which is a small addition to
the extracted leaf and is what makes the guard possible at all.

### 5.3 A starter chart, if one ships

A seeded chart is a real product decision, not an engineering one: it is the platform expressing an
opinion about how a law firm's books should be organized, and a firm's accountant may disagree. Two
arms:

- **Ship a starter chart** as `system_account` rows, adoptable at provisioning, renameable and
  renumberable, never deletable. A firm is usable on day one and a bookkeeper edits from a working
  base. The cost is that the platform's opinion becomes most firms' chart by inertia.
- **Ship no chart**, and require a firm to author one (or import one) before it can finalize an
  invoice — which is already the effect of the unmapped-role refusal. Nothing is asserted, and the
  firm cannot bill until its accountant has done a morning's work.

Flagged (**G1**). The recommendation is the first arm with the second arm's honesty: seed a small
chart of `system_account` rows covering exactly the roles the platform itself needs plus a short list
of common law-firm expense accounts, mark it as a starting point in the user documentation, and never
seed a role mapping the firm did not confirm — the mapping is where the money goes, and a
platform-chosen mapping is the platform deciding which account a firm's fee income lands in.

`packages/fixtures/src/demo-chart-of-accounts.ts` remains demo data and does not become the product
chart; its own comment says so, and it stays as it is.

---

## 6. Accounts payable

### 6.1 Two records, two obligations

A vendor bill for an expert witness is simultaneously a **payable to the vendor** and, when the cost
is advanced on a client's behalf, a **recoverable from the client**. Those are different obligations
with different lifecycles and different owners: `vendor_bill` records what the firm owes; `cost_entry`
(3·3's table) records what the firm may bill. 3·3 already models the vendor link and the hard/soft
classification, so this slice reuses both and restates neither.

`vendor_bill` — `id`, `vendor_id` (a Directory entity, the same `vendor` party-role 3·3 uses),
`bill_reference`, `bill_date`, `due_date`, `amount_minor`, `currency` (`USD` CHECK), `entry_id`
(the posting), `created_at`, `created_by`.

`vendor_bill_line` — `id`, `vendor_bill_id`, `line_index`, `amount_minor`, `disbursement_class`
(`hard` | `soft`, CHECK), `matter_id` (nullable), `location_id` (nullable),
`disbursement_entry_id` (nullable, references `cost_entry.id`), `ledger_account_id`, `description`.

The link column is named `disbursement_entry_id` rather than `cost_entry_id` because the schema
conformance gate refuses any column matching the money-ish name pattern that does not carry a
`_minor` or `_rate_e4` suffix, and `cost_entry_id` matches it. 3·3 adopted the same vocabulary for
the same reason.

### 6.2 The debit routing, and why misrouting it is a tax error

- **`hard`** — `Dr Client Costs Advanced` (matter-tagged) `/ Cr Accounts Payable`. No
  profit-and-loss impact. An advanced client cost is a loan to the client, not the firm's deductible
  expense (_Canelo v. Commissioner_, 53 T.C. 217 (1969), aff'd 447 F.2d 484 (9th Cir. 1971)). At
  invoice finalize, billing posts `Dr Accounts Receivable / Cr Client Costs Advanced`, clearing the
  asset with no income — which is exactly what billing's shipped rule already says: hard costs credit
  Client Costs Advanced, soft costs credit Cost Recovery Income.
- **`soft`** — `Dr <the line's expense account> / Cr Accounts Payable`, and at finalize
  `Dr Accounts Receivable / Cr Cost Recovery Income`. Expense when incurred, income when reimbursed.

Billing's note that Client Costs Advanced "runs negative until operating disbursements land" is the
open position this slice closes: these are the operating disbursements.

### 6.3 A bill's state is derived, and its balance is bounds-checked

No `status` column. A bill's state is: unpaid (no payment names it), part-paid, paid. That is derived,
in exactly the arrangement `invoice_matter_balance` already carries and for exactly the same reason —
so that a payment has no reason to touch the header and can never drift from the subledger:

- `vendor_bill_payment` — append-only, three triggers, one row per payment made against a bill, each
  naming its own ledger entry.
- `vendor_bill_balance` — `amount_minor` frozen by a shape trigger, `paid_minor` delta-updated
  **inside the posting batch** under a bounds CHECK (`0 <= paid_minor <= amount_minor`). The delta
  statement is deliberately unguarded, for the reason billing states at length: a guarded
  `UPDATE … WHERE amount_minor - paid_minor >= ?` cannot abort a batch, because a zero-row UPDATE is
  not an error in SQLite and the losing batch would commit with its ledger entry beside a balance
  that never moved. The CHECK is the guarantee; two payments racing for one remainder abort rather
  than overpay.

A/P aging then has the same shape as A/R aging, buckets in SQL, and reads one subledger.

### 6.4 A bill entered in error

The ledger entry is reversed (section 4.2) and an append-only `vendor_bill_reversal` row names it,
with the actor and the reason. The bill row itself is never edited and never deleted; its balance
becomes unreachable because the entry behind it is reversed and no further payment may name a reversed
bill (trigger).

**Vendor credits** — a credit memo the vendor issues, which is the real-world correction for a bill
that was wrong rather than a bill that should not exist — are deliberately **not** designed here. They
are the mirror of billing's credit note, they need the same care about what a credit may be attributed
to, and designing them alongside four other subsystems would get one of them wrong. Named in
section 13 and flagged (**G9**).

### 6.5 Paying a bill, and where the money may come from

`Dr Accounts Payable / Cr Operating Bank`, plus the `vendor_bill_payment` row. The credit account is
**resolved through the `operating_bank` role**, not supplied by the caller. That is the structural
answer to "may A/P pay from anything but an operating account": the composer has no parameter for it.
A trust account is refused twice over — it is not what the role resolves to, and the trust refusal of
section 2.2 binds this composer too.

Flagged (**G7**) because a firm with two operating banks has a legitimate need the single role cannot
express, and the fix is either a second role or a caller-supplied account restricted to accounts
classified in an operating-cash section. The recommendation is the second role
(`operating_bank_secondary`) if and when a firm asks, and never a free caller-supplied account.

**Executing** the payment at a bank — a payment run, an ACH file, a positive-pay file — is out of
scope. That is money moving in another system, which is the cross-system compensable flow the Phase 6
rails own. This slice records that the firm paid.

### 6.6 What status a bill-originated cost enters at

A vendor bill the firm has entered is a confirmed obligation. Whether the cost is **billable to the
client** is a separate judgement nobody has made yet. So a bill-originated `cost_entry` enters at
`draft` — 3·3's own vocabulary for a cost nobody has reviewed — and the firm's ordinary cost review
promotes it. Flagged (**G8**), because a firm whose bookkeeper enters bills and whose lawyers never
review costs would find every advanced cost sitting unbilled forever, and the alternative
(`submitted`) is defensible.

`cost_entry.source` stays `manual` and is **not** widened: the honest provenance of a bill-originated
cost is that a `vendor_bill_line` names it, which is a link and therefore derivable, exactly as
"reversed" is derived from the reverses link rather than a flag. Widening the CHECK would cost a
destructive rebuild of a table holding data (section 0.3).

### 6.7 The two writes ride one batch, composed by the route

A hard-cost bill writes a ledger entry, a `vendor_bill` and its lines and balance, and a `cost_entry`
— all in the same per-firm database, so one D1 batch commits them atomically. The **route** composes
them: `recordVendorBill` returns its statements, 3·3's cost capture returns its own, and the route
spreads both into one `runIdempotentEffect`. Neither package imports the other. This is the
established pattern, and both alternatives lose: a single service owning both writes buys atomicity a
shared batch already provides at the price of a dependency edge from `general-ledger` to `costs`; a
`cost.recorded` outbox message introduces eventual consistency to solve a problem one batch solves,
and misuses the outbox, which exists for external consequences.

A fitness query proves the pair: every `vendor_bill_line` with `disbursement_class = 'hard'` and a
non-null `matter_id` carries a non-null `disbursement_entry_id`. That guards a future call site that
composes the ledger statements and forgets the cost capture — a coding error, not a drift, since the
two writes share one batch.

---

## 7. Cash basis versus accrual

**The books are accrual, and they have to be.** A receivable _is_ the accrual: billing posts
`Dr Accounts Receivable` at finalize, and accounts payable posts `Cr Accounts Payable` when a bill is
entered. Both exist and both are shipped or designed. There is no arm in which the ledger is a
cash-basis book.

**A cash-basis view is a presentation over that one book, not a second book.** An income statement on
the cash basis reads only entries touching a cash account — which is derivable, since cash accounts
are the ones classified in a cash section and named by the `operating_bank` role.

**What that costs, precisely.** A cash-basis presentation derived this way is **not** the same figure
a cash-basis taxpayer would report, because a cash-basis firm would never have posted the receivable
in the first place; timing differences around the year boundary, write-offs, and credit notes all
resolve differently. So this design will not call the derived view a tax basis, and the platform must
not present it as one. That is a sentence in the user documentation, not a footnote.

Flagged (**G2**), in two parts: which presentation is the default, and whether a cash-basis view is in
scope at all for the first sub-slices. The recommendation is **accrual as the default** — it is what
the ledger holds — and **the cash-basis view deferred out of sub-slice 3**, because a wrong number
here is a number a firm might put on a tax return, and it deserves its own small design rather than a
filter added while four other things are being built.

---

## 8. Period close

Period close is **not** named in the slice map's scope for 3·5 or in the roadmap summary. It is
proposed as an addition, and the case for it is: financial statements nobody can rely on are not worth
assembling, and a period that can be reopened silently is exactly that. Flagged (**G3**) so the owner
can cut it — sub-slices 1, 3, 4, and 5 do not depend on it, so cutting it costs nothing structural.

### 8.1 A monotonic lock date, not period rows

`accounting_lock` is one row per firm database (`id` pinned to a constant by CHECK):
`locked_through` (civil date, nullable), `hard_locked_through` (civil date, nullable, reserved),
`updated_at`. Every effective date at or before `locked_through` is closed.

Accounting close is a high-water mark — one never closes March while February stays open — so a
scalar makes the illegal state **unrepresentable**, where a table of period rows makes it
representable and then requires overlap and gap validation to police it. It is also the shape the
established products converge on.

A dedicated table rather than a firm setting, and the reason is not preference: a setting is
reachable by the generic settings route, and a lock any settings write can move is not a lock.

`period_close_event` is append-only (three triggers): `action` (`close` | `reopen`, DDL CHECK),
`closed_through`, `previous_locked_through`, `actor_user_id`, `reason`, `created_at`.

### 8.2 Where the check lives, and why it is inside the posting primitive

A period lock that only the general journal honours is not a lock. Trust movements, invoice
finalization, and vendor bills all post into periods, and a rule enforced in four callers is a rule
the fifth caller skips.

So the check lives in **`postEntry`**, alongside the account snapshots it already loads before
composing: one extra row read, and `validateEntry` gains a `lockedThrough` input, pure, in exactly
the shape the pre-loaded account snapshots already take.

The ledger's own design notes that consumer rules bind elsewhere, and this looks like it contradicts
that. It does not: **period membership is a property of the ledger's own `effective_date` column**,
the same class of rule as "no future dating", which `validateEntry` already enforces and nobody calls
a consumer rule. A firm-configured _value_ is compared against a column the ledger owns. That is the
distinction, and it is why the placement is defensible rather than convenient.

Flagged (**G12**) anyway, because the consequence reaches other people's slices: after this, a trust
movement or an invoice finalization backdated into a closed period **refuses**, with a named error.
That is correct behaviour and it is a behaviour change in shipped subsystems, so the owner should see
it before it lands rather than after a firm hits it.

### 8.3 A reversal is always permitted

`reverseEntry` takes a fresh caller-supplied effective date rather than copying the original's, so
reversing a closed-period entry means dating the reversal into the open period. The lock check
therefore **exempts an entry carrying `reverses_entry_id`** from the closed-period refusal on the
original's date, and applies it normally to the reversal's own date.

This is the property that stops a lock from trapping a correction, and it is the behaviour every
surveyed system converges on. Without it, a firm that closed a month with a mistake in it would have
to reopen the month to fix it, which makes reopening routine, which makes the lock meaningless.

### 8.4 Retained earnings is computed, never posted

It is `Σ(income − expense)` up to the cutoff — a pure function of an append-only ledger, and
therefore not a fact worth storing. Posted closing entries would have to be reversed on reopen, and
would have to be re-posted on every re-close, which turns a derivation into a state machine. There is
no `retained_earnings` account, no `owners_equity` posting at year end, and no year-end close routine
that writes anything.

The balance sheet's equity section is therefore: the `owners_equity` account's balance, plus computed
retained earnings, and the assembler says which is which.

### 8.5 The close-versus-posting race, closed rather than accepted

The hazard: a posting composed against `lockedThrough = 2026-06-30` commits after a close moved it to
2026-07-31. D1 has no interactive transactions, so a read-then-compose cannot be atomic.

The posting batch **proves its own read** using the pattern billing shipped for exactly this class of
problem — aim a value the table's CHECK forbids at exactly the offending rows:

```
UPDATE accounting_lock SET locked_through = <a value the DDL CHECK forbids>
 WHERE id = <the singleton> AND locked_through IS NOT <the value that was read>
```

When the lock has not moved the statement matches nothing and is a no-op. When it has moved, it
matches the one row, the CHECK fires, and the **whole batch** rolls back — the entry, the lines, the
balances, the idempotency record, and the outbox row together. `accounting_lock.locked_through`
therefore carries a DDL CHECK asserting it is a valid civil date, so that there is a forbidden value
to aim.

This is strictly better than accepting the race and covering it with a fitness function, which is
what the prior design did. The fitness query stays as the backstop — an entry whose effective date is
at or before `locked_through` should not exist — because the guard cannot see a lock that moved
between two batches that both committed.

### 8.6 Reopen, and the reserved hard lock

Soft close by default: a distinct capability moves the scalar back and appends a `period_close_event`
with the actor and a **required** reason. What an operator may do to a closed period, and whether
closing or reopening takes a second person on trust's authorization-policy precedent, are the owner's
(**G4**, **G5**).

`hard_locked_through` is reserved for a future jurisdiction that demands inalterability. The check
honours it from the outset — a posting at or before it is refused and **no permission reopens it** —
and this slice ships no route that ever sets it, so the column is always null. Building the guard now
costs one comparison; retrofitting it into every posting path later would not. Whether it ever gets a
route is flagged (**G6**).

---

## 9. Financial-statement read primitives

### 9.1 Bitemporal, in the shape reporting already shipped

Every statement takes the same temporal pair `@magna-carta/reporting` established and defended: a
civil-date period on the **effective** axis plus a `knownAsOf` instant on the **knowledge** axis,
filtering `effective_date <= periodEnd AND recorded_at <= knownAsOf`. The claim it buys is the one
that document states: for a given triple, every figure is a pure function of rows that can never
change.

The contract is defined **once**. `temporal.ts` currently lives in `@magna-carta/reporting`, and
reporting depends on the domain packages rather than the other way round, so the general ledger
cannot import it from there. The answer is to move the temporal contract down into the pure leaf this
slice introduces anyway for the lock (`@magna-carta/accounting-periods`), with reporting importing
from it — one validation of a temporal triple in the repository, no duplication, no inverted edge.
Flagged (**G11**) because it edits shipped code in another slice's area.

Omitting `knownAsOf` means "now" and produces a **live** statement, stamped `computedAt` and
explicitly not claimed to reproduce — the same first-class labelled mode reporting carries.

### 9.2 The four primitives, and what each asserts and refuses

| Primitive                  | Asserts                                                                                      | Refuses rather than degrading                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Trial balance**          | Every account's balance in normal-balance terms at the triple, and that debits equal credits | If it does not foot, or if any account with lines is unclassified                               |
| **Balance sheet**          | Assets = liabilities + equity, equity including computed retained earnings                   | If it does not balance; if the trust sections do not net to zero; if an account is unclassified |
| **Income statement**       | Income less expense for the period, by section                                               | If an income or expense account is unclassified                                                 |
| **Accounts-payable aging** | Unpaid vendor-bill balance by bucket, vendor, and office, on both axes                       | Nothing to refuse; it reads one subledger                                                       |

Aggregation rounds **half-even (banker's)** through the money package's ledger boundary. The half-up
mode used at invoice and tax boundaries must not be used here, and the money package's own rounding
helpers are the only way any of it happens.

### 9.3 This slice owns these figures; reporting renders them

`@magna-carta/reporting`'s design already promised this: the trial balance, income statement, and
balance sheet "wait on slice 3·5's chart of accounts. This slice renders them when 3·5 assembles
them; it does not invent a partial book." That is the split, and it is honoured from this side too —
this slice assembles and does no rendering, no export, no scheduling, and no PDF.

Which makes these figures **class 1** under reporting's own discipline: owned here, called there,
never re-implemented. A decomposition reporting later adds (a trial balance by office, say) carries
reporting's agreement test proving it sums to the aggregate this slice produces.

### 9.4 Nothing is materialised

Inherited whole, and it binds harder here than anywhere: a general ledger is where the temptation to
store a period-end balance is strongest, and this financial core has no stored derived figure
anywhere. No rollup table, no cached total, no period snapshot, no closing entries (section 8.4). Every
aggregate is computed in SQL and returned as a handful of rows; nothing streams whole tables into the
Worker to add them up there.

### 9.5 The performance shape, and the denormalization held in reserve

The weak point reporting named is worse here. A trial balance as of a date reads `ledger_line` joined
to `ledger_entry` for the dates, across **every** account rather than one — so SQLite either drives
from `ledger_entry_effective_date_index` and joins per line, or scans. Over a firm with years of
history that is the cost centre of this slice.

The named remedy is the same one reporting held in reserve and did not need: a copy of
`effective_date` onto `ledger_line`, written by the ledger package inside the posting batch, enabling
a composite `(account_id, effective_date)` index. It duplicates an immutable column of the same row's
parent — both written once in one batch, neither ever updated — so it cannot drift, which is
categorically different from storing a computed balance.

It is **not built up front.** Golden rule 10 governs, and the measurement is a task in the statements
sub-slice, at one month and at twelve over the load-profile book. Reporting measured its own reads and
found the denormalization unwarranted; this slice is the more likely place to earn it, and if it does,
the change lands in `packages/ledger`'s posting batch with the measurement in an ADR.

---

## 10. Posting dimensions on `ledger_line`

Two columns, both nullable and indexed: `matter_id` (references `matter`) and `location_id`
(references `location`).

Dimensions belong on the **line**, not the entry: one vendor bill carries lines for two matters.
`location_id` is independent rather than derived from the matter, because a rent expense has an office
and no matter at all.

**Dimensions and child accounts answer different questions and both survive.** Accounts enforce
**bounds** — the per-matter trust leaf must stay a child account row, because the no-negative
invariant is the `account_balance` bounds CHECK, which is per balance row and has no dimension
equivalent. Dimensions enable **segmentation** — per-office expense roll-ups, and the per-matter
advanced-cost view. Neither replaces the other.

Practice area is deliberately not a column: the referent is `matter.matter_type_id`, reachable by join
once the line carries `matter_id`, and denormalizing it is a cache under golden rule 10. Timekeeper is
excluded because the grain is wrong — at finalize many timekeepers' work aggregates into one
receivable line, and realization reads `time_entry.timekeeper_user_id`, where that grain lives.

**The honest limitation, and it is a scope-out.** The general journal and vendor bills populate these
columns. Trust, billing, and cost postings are **not retrofitted** — they write null, which is
additive and breaks nothing. So a per-office or per-matter _income statement_ would be assembled from
a dimension that the paths producing income do not write, and would be silently partial. Per-office
and per-matter income statements are therefore **not designed in this slice**: the columns land so the
seam exists and so the paths this slice owns populate them from day one, and the statements that need
full population wait for the owning slices to fill them in. Saying "we have dimensions, here is a
per-office profit figure" would be the worst outcome available.

---

## 11. QuickBooks as a sync, and never a system of record

A sync that can be read back as authority has quietly become the system of record. So the property is
made structural in four ways, none of which is a policy statement.

### 11.1 The direction is one-way out, because there is no inbound operation

The `accounting` integration category is registered with a `CapabilityDescriptor` declaring
**export operations only** — the shape of a journal export and its acknowledgement. There is no
`pullJournal`, no `applyRemoteEntry`, no `fetchBalance`, no `reconcileAgainstRemote`. A capability
that does not exist cannot be called by a future route, and a fitness assertion rejects any operation
name in the accounting category matching an import shape, so the absence is enforced rather than
observed.

The change feed is `LEDGER_ENTRY_POSTED_TOPIC`, which `postEntry` already emits, consumed through the
transactional outbox with the ordinary at-least-once and dead-letter behaviour and the ordinary
consumer dedup on the outbox row id.

### 11.2 There is nowhere to put a remote figure

No `quickbooks_id` on `ledger_entry`. No `external_balance` anywhere. No table reconciling the two
books. The only remote state stored is a **dispatch record**: `accounting_export_dispatch`,
append-only, keyed on the ledger entry id plus the connection, holding what was sent, when, and what
the remote said. It records that a fact **left**; it has no column that could hold a fact that came
back.

That is the load-bearing schema decision in this section. A design with a remote balance column has
already lost the argument, because the day someone renders that column beside the platform's own
figure, a reader has two answers and no rule about which is right.

### 11.3 On conflict, the platform does nothing, and says which nothing

A conflict has exactly two shapes:

- **The remote refuses an export.** Detectable. It is a dispatch outcome: recorded on the dispatch
  row, retried through the outbox, surfaced as a diagnostic through the standard error pipeline with a
  correlated identifier. The platform's books are unaffected, because the export failing changed
  nothing about what happened.
- **The remote accepts an export and someone then edits it in QuickBooks.** **Not** detectable, and
  the platform must not pretend otherwise. Detecting it would require reading remote balances back,
  which is the read that would make the remote authoritative. So it is outside what the platform
  asserts, and that is stated in the user documentation in those words: the platform's books are the
  firm's books; the export is a convenience for the firm's accountant; an edit made on the far side
  does not come back.

Flagged (**G13**): should an export be refused when the remote reports its own period closed?
Recommendation **no** — the remote's period state is the remote's business, and refusing on it would
be the platform taking instruction from the system it is exporting to, which is the read-back in a
different coat.

### 11.4 Nothing reads the remote to answer a question about the firm's books

A source scan asserts that no domain package imports the accounting adapter's port, and that the port
surface returns no monetary figure into one. The adapter is its own Worker behind a typed port and
receives plaintext credentials at call time only, per the existing plugin isolation rule; credentials
live in the envelope-encrypted per-firm secret store with an integration connection grant, and
QuickBooks' OAuth credential kind means the framework's refresh lock applies unchanged.

**The adapter Worker is Phase 7·2.** This slice reserves the category, fixes the direction, defines the
descriptor and the dispatch record, and writes no adapter.

### 11.5 The bank feed, which is the one import that would be legitimate

A bank feed is an import, and unlike a remote general ledger it is not a competing book — a bank
statement is **evidence**, which is a different kind of thing. The platform already has the right
shape for it: trust's `trust_bank_statement` plus its line table, its guided import, its matching
suggestions that nothing may act on automatically, and its one-line-clears-one-entry rule.

So an operating bank feed lands later as an `operating_bank_statement` mirroring that shape, and this
slice reserves nothing beyond the category registration — deliberately, because reserving a shape for
an importer whose reconciliation surface does not exist would be designing the retrofit in. Named in
section 13.

---

## 12. Scope, permissions, and the surfaces this slice does not design

### 12.1 Firm scope is structural and unchanged

Each firm has its own D1 database, so there is no cross-firm query to prevent. Every read and write
here goes through `@magna-carta/data-access`'s per-firm chokepoint, and `@magna-carta/general-ledger`
holds no binding of its own — the same pure-service shape every domain package in this repository has.

### 12.2 Permissions

A `ledger:` namespace and an `accountsPayable:` namespace, both binding `resource: "firm"` — every one
of these spans matters and clients by construction.

| Key                           | Grants                                                                     |
| ----------------------------- | -------------------------------------------------------------------------- |
| `ledger:viewChart`            | Read the chart of accounts and the role map                                |
| `ledger:manageChart`          | Create, rename, renumber, reclassify, deactivate accounts; configure roles |
| `ledger:viewStatements`       | Trial balance, balance sheet, income statement                             |
| `ledger:post`                 | Compose a general journal entry and reverse one                            |
| `ledger:closePeriod`          | Move the lock forward                                                      |
| `ledger:reopenPeriod`         | Move the lock back                                                         |
| `accountsPayable:viewBills`   | Read vendor bills and the aging                                            |
| `accountsPayable:manageBills` | Enter a bill, record a payment, reverse a bill                             |

Reads are separated from writes because a firm's bookkeeper or outside accountant reads far more than
they write, and a member who may read a trial balance must not thereby be able to post to the ledger.
Close is separated from reopen on the reasoning that split `trust:firmFunds` off `trust:manage`:
moving a lock forward is routine and moving it back is the act somebody will be asked about.

Seeding is flagged (**G14**). The narrow default is Owner and Admin only, with a firm that wants a
bookkeeper to read statements reaching for a direct grant, which leaves a record — the posture
reporting adopted.

### 12.3 Deferred surfaces, named and not designed

No screens. Golden rule 2 governs whatever is built later; this slice names what each surface must
show so the backend shape is right:

- **Chart of accounts** — the tree with codes, types, sections, balances; which accounts are
  system accounts; which are trust-registered and therefore read-only, with the reason visible; which
  roles are mapped and which are not, because an unmapped role is what stops a firm billing.
- **General journal entry** — a balanced two-sided form that will not submit unbalanced, the memo and
  reason as first-class fields rather than a description, the effective date with the open window
  shown, and the reversal action on a posted entry.
- **Vendor bill** — the vendor from the Directory, the lines with their hard/soft class and matter,
  what each line will post to, and the resulting cost entries stated before submission so the person
  entering the bill can see that a hard cost becomes a client receivable.
- **Accounts-payable aging** — buckets, per vendor, drill to bills, with the payment action.
- **Statements** — the three, with the temporal triple visible and the live-versus-reproducible
  distinction on the face of the page, because a reader cannot tell them apart from the figures.
- **Period close** — the current lock, the close action, the reopen action with its required reason,
  and the close-event history.

---

## 13. What this slice deliberately does not design

Each with the reason and, where there is one, the home it waits for.

- **Cash receipts.** Recording a client's payment is billing's application plus a ledger entry through
  the role map, and the payments design owns it (its own flag K1 asks whether the manual receipt is
  payments' first slice; the recommendation there is yes). **Until that lands, the operating bank
  balance in these books moves only when someone types a journal entry.** This is the largest limit on
  the slice's usefulness on the day it ships, it is not fixable from here, and it is flagged
  (**G15**) so the owner decides whether these books ship ahead of it or wait.
- **Operating bank reconciliation.** Needs an operating bank statement importer and the payments
  clearing account, neither of which exists. Trust's reconciliation is the template and should be
  followed rather than re-invented.
- **Vendor credits, recurring bills, purchase orders, 1099 tracking.** Real accounts-payable features,
  none load-bearing for a firm's first month of books, each deserving its own design.
- **Payroll.** Firms use a payroll provider; the books receive a journal entry. Designing payroll here
  would be designing a subsystem nobody asked for.
- **Per-office and per-matter income statements.** The dimension exists; the paths that produce income
  do not write it yet (section 10).
- **Profitability.** No timekeeper cost rate exists anywhere in the schema, and approximating it from
  billing rates produces a number that looks like margin and is not — the gap reporting already named.
- **A cash-basis presentation.** Flagged (G2); deferred out of the statements sub-slice on the
  recommendation, because a wrong figure here is one a firm might put on a tax return.
- **Multi-currency.** Single registered currency per entry, accounts pinned to USD. A foreign-currency
  operating account is a schema change, not a silent extension.
- **Budgets, forecasting, and management dashboards.** Not accounting.
- **The QuickBooks adapter Worker and the bank feed.** Phase 7·2.
- **Every screen.**

---

## 14. Flagged for the owner

Numbered so they can be answered down. **The ones above the divider decide what gets built.**

| #       | Question                                                                                                                                                                                                                                      | Recommendation                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1**  | **Does a starter chart of accounts ship?** A seeded chart makes a firm usable on day one; it also makes the platform's opinion most firms' chart by inertia. The alternative is that a firm cannot bill until its accountant authors one.     | **Yes** — a small chart of system accounts covering the roles the platform needs plus common law-firm expense accounts, marked as a starting point. But **seed no role mapping** the firm did not confirm: the mapping is where the money goes. |
| **G2**  | **Cash basis or accrual, and is a cash-basis view in scope?** The book is accrual and cannot be otherwise. A derived cash view is not a tax basis and must not be presented as one.                                                           | **Accrual is the default**, and **defer the cash view** out of the statements sub-slice to its own small design.                                                                                                                                |
| **G3**  | **Is period close in scope for 3·5 at all?** It is not in the slice map's scope for this slice. Statements nobody can rely on are not worth assembling; against that, it adds a sub-slice and a behaviour change in shipped subsystems.       | **Yes**, as its own sub-slice. Nothing else in the slice depends on it, so it is a clean cut if the answer is no.                                                                                                                               |
| **G4**  | **Who may close a period, and does closing take a second person?** Trust's authorization policy is the precedent for a two-person requirement on an act somebody will be asked about.                                                         | Close on its own capability, seeded to Owner and Admin; **one person for close, and see G5 for reopen.** A two-person close is a policy the firm should be able to turn on later, not a default.                                                |
| **G5**  | **What may an operator do to a closed period?** Reopen with a reason and an audit row? Post into it under a permission without reopening? Never?                                                                                              | **Reopen only, on its own capability, with a required reason and an append-only event.** No "post into a closed period" permission — that is a lock nobody can rely on.                                                                         |
| **G6**  | **Does the hard lock ever get a route?** The guard is honoured from day one and no route sets it.                                                                                                                                             | **Not until a jurisdiction requires it.** Keep the column and the comparison; ship no route.                                                                                                                                                    |
| **G7**  | **May accounts payable pay from anything but an operating account?** The composer resolves `operating_bank` and has no parameter for an alternative. A firm with two operating banks has a legitimate need it cannot express.                 | **No caller-supplied account, ever.** If a firm asks, add a second role rather than a free parameter.                                                                                                                                           |
| **G8**  | **At what status does a bill-originated cost enter the cost store?** `draft` respects the billability review; a firm whose lawyers never review costs would leave advanced costs unbilled forever.                                            | **`draft`.** The alternative (`submitted`) is defensible and is a one-line change if the review never happens in practice.                                                                                                                      |
| **G9**  | **Vendor credits now or later?** They are the mirror of billing's credit note and need the same care about attribution.                                                                                                                       | **Later**, its own design. A bill entered in error is reversed with a reason in the first pass.                                                                                                                                                 |
| **G15** | **Do these books ship ahead of payments' manual receipt, knowing the operating bank line will be sparse until it lands?**                                                                                                                     | **Yes.** The chart is what billing already needs to stop refusing unmapped roles, and every sub-slice is useful without cash arriving. But the user documentation must say what the books cannot yet show.                                      |
|         | **— these decide how it is built, not whether —**                                                                                                                                                                                             |                                                                                                                                                                                                                                                 |
| **G10** | **Extract the account-role map out of `@magna-carta/billing` into a shared leaf.** Touches shipped billing code. Without it, either billing depends on the general ledger or the general ledger depends on billing, and both edges are wrong. | **Yes**, with a no-behaviour-change gate. Precedent: `@magna-carta/billing-core`.                                                                                                                                                               |
| **G11** | **Move the temporal contract out of `@magna-carta/reporting` into the shared periods leaf**, so one validation of a temporal triple exists. Touches shipped reporting code.                                                                   | **Yes.** The alternative is a second temporal validator, which is a second answer to a bitemporal question.                                                                                                                                     |
| **G12** | **Does the period-lock check live inside `postEntry`?** It makes a trust movement or an invoice finalization backdated into a closed period refuse — correct behaviour, and a behaviour change in shipped subsystems.                         | **Yes.** A lock only one caller honours is not a lock; period membership is a property of the ledger's own effective-date column, like no-future-dating.                                                                                        |
| **G13** | **Should an accounting export refuse when the remote reports its own period closed?**                                                                                                                                                         | **No.** The remote's period state is the remote's business; refusing on it is the read-back in a different coat.                                                                                                                                |
| **G14** | **Who is seeded `ledger:viewStatements`?** A bookkeeper reads statements and posts nothing.                                                                                                                                                   | **Owner and Admin only**, narrow by default; a bookkeeper gets a direct grant, which leaves a record.                                                                                                                                           |
| **G16** | **Are trust accounts on the firm's balance sheet?** Correct accounting includes them — the firm holds an asset and an equal liability. Some accountants present a firm balance sheet without them.                                            | **Include**, in their own labelled sections that net to zero, and refuse the statement if they do not net. Omitting them hides the one relationship an examiner checks.                                                                         |

---

## 15. Fitness functions this design owes

In the `packages/ledger/src/fitness.ts` tradition of re-proving over the whole table what a pre-check
can race on. Zero rows is healthy; each has a test that asserts it is non-vacuous.

1. **`generalJournalEntriesTouchingTrustStatement`** — a general journal entry whose lines reach a
   trust-registered account. Catches the account registered as trust _after_ the journal posted.
2. **`firmAccountRolesOnTrustAccountsStatement`** — an operating role mapped to a trust-registered
   account.
3. **`firmAccountRolesOnParentAccountsStatement`** — a role mapped to an account that has children.
4. **`firmAccountRolesWithMismatchedTypeStatement`** — a role whose account's `type` disagrees with
   the role's declared normal balance.
5. **`accountsWithLinesAndNoStatementSectionStatement`** — an account carrying postings that no
   statement would place.
6. **`accountsWithSectionInconsistentWithTypeStatement`** — the DDL CHECK's table-wide twin, for rows
   written before the CHECK existed or by a path that bypassed it.
7. **`entriesPostedIntoAClosedPeriodStatement`** — an entry whose effective date is at or before
   `locked_through` and which is not a reversal. The backstop behind section 8.5's guard.
8. **`hardCostBillLinesWithoutTheirCostEntryStatement`** — a matter-tagged hard bill line with no
   `disbursement_entry_id`.
9. **`vendorBillBalancesInconsistentWithTheirPaymentsStatement`** — `paid_minor` against the sum of
   the bill's payment rows, the mirror of the invoice-subledger proof.
10. **A source scan** asserting `@magna-carta/general-ledger` composes no ledger insert, no balance
    update, and no `trust_*` statement — the shape billing's trust source scan already has.
11. **A source scan** asserting no domain package imports the accounting adapter port, and that the
    accounting category declares no import operation.

Every one of these runs from a single `assertGeneralLedgerFitness`, so a query added to the list is
automatically part of every proof — the arrangement the ledger's own fitness module uses.

---

## 16. Test plan

- **The trust refusal, from three directions.** A journal entry naming a matter leaf, a client node,
  a liability root, a trust bank leaf, and a firm-funds node — each refused by name. A journal entry
  over purely operating accounts, accepted. A role configuration naming each of those, refused. A
  vendor bill line naming one, refused.
- **The segregation identity, over rows the real composers wrote.** Seed a trust account through
  `openTrustAccount`, deposit and disburse through trust's own composers, then assert the balance
  sheet's trust sections net to zero and that the income statement contains no trust account. Fixtures
  never insert with raw SQL, which would bypass every invariant being tested.
- **Sign inversion.** A role mapped to an account of the wrong type is refused at configuration; the
  fitness query finds one written around the composer.
- **Re-section and re-type.** A section change within a statement is accepted; one across statements
  is refused by the DDL CHECK; a `type` change on an account with lines is refused.
- **Period close.** A posting inside the window commits; one at or before the lock refuses by name; a
  reversal of a closed-period entry, dated into the open window, commits. **The race test**: compose a
  posting against a read lock value, move the lock in another batch, commit the posting, and assert
  the whole batch rolled back — the entry, the lines, the balance, and the idempotency row.
- **Statements refuse rather than degrade.** An unclassified account with lines makes each statement
  refuse by name. A hand-broken balance makes the trial balance refuse rather than print.
- **Reproducibility.** Assemble a trial balance at `knownAsOf = T`; post a backdated entry with
  `recorded_at > T`; re-assemble at `T` and assert every integer identical; re-assemble live and
  assert the figures moved and the labelling says so.
- **Accounts payable end to end.** A hard-cost bill from entry through the cost entry it created,
  through invoice finalize, asserting the profit-and-loss is untouched and Client Costs Advanced
  clears. A soft-cost bill asserting the expense lands and reimbursement is income. Two payments
  racing for one remainder, asserting one aborts.
- **Migration.** Every new CHECK and unique index enforces; the lineage applies to a fresh database;
  the snapshot is refreshed in the same commit.
- **Load profile.** A `GeneralLedgerVolume` sub-profile beside the existing ones, measuring the trial
  balance and balance sheet at one month and at twelve, and the A/P aging — with the
  `ledger_line.effective_date` denormalization argued from the measurement if it is the cost centre,
  and not before.

---

## 17. Consequences

A firm gets its own books on the ledger it already has: one set of rows behind both the bar-audit pack
and the balance sheet, a chart its accountant can renumber without moving a single posting target, a
general journal that cannot reach client money, vendor bills that route an advanced cost to the client
and a firm expense to the profit-and-loss without anybody remembering which is which, and four
statements that refuse rather than printing a figure they cannot stand behind.

Trust and operating stay separate because the two ways to mix them are both closed by construction:
the composition guard already makes a commingled entry unrepresentable, and the one new door this
slice opens is refused at the door, proved over stored rows, and unable to be widened by a flag.
QuickBooks stays a sync because the platform has no operation that reads a book back and no column
that could hold one.

And the three things these books cannot do on the day they ship are named rather than approximated:
cash does not arrive until payments' first slice lands, there is no operating bank reconciliation
until an importer exists, and profitability is not computable at all for want of a cost rate that is
nowhere in the schema.
