---
category: Added
audience: internal
---

Slice 3·5 — operating accounting / general ledger: the design and implementation plan for the product
chart of accounts, the general journal, accounts payable, period close, the financial-statement read
primitives, and the accounting integration seam. No product code in this cycle. **Supersedes the
design and plan on the dormant `slice-3-5-operating-general-ledger` branch**, whose two load-bearing
choices were correct in July and are wrong now.

**The operating books are a classification laid over the one ledger, not a second ledger.** Four
additive columns on `ledger_account` — a code, a statement section, a system-account marker, a
description — with the five-value `type` CHECK untouched and normal balance still derived in its one
home. One posting primitive, and a source scan asserting `@magna-carta/general-ledger` composes no
`ledger_entry` or `ledger_line` insert and no `account_balance` update. The consequence that matters:
a firm's operating books and its trust books are provably the same rows, so a bar-audit pack and a
balance sheet cannot disagree about what happened.

**The general journal is a third door onto the posting primitive, and it is refused at the door rather
than guarded.** The ledger is account-agnostic by design, so a journal entry naming a matter leaf and
an income account would be balanced, leaf-only, single-currency, correctly dated, and would post client
money into fee income. `composeGeneralJournalEntry` therefore resolves every line through **trust's
own** `loadTrustAccountRoles` and refuses the whole entry unless every line is outside trust — the
inverse of a rule trust owns, computed from trust's resolver rather than reimplemented, so a new tier
of trust account is refused the day it exists with no edit here. A fitness query re-proves it over
stored rows, catching the sequence no pre-check can: an ordinary account journalled against and later
registered as a trust bank leaf. The same refusal binds the vendor-bill and bill-payment composers.
Nothing in the slice is a flag on `assertTrustComposition` and nothing widens the bank-charge carve-out
door.

**What a chart may and may not reference is stated as a rule with three mechanisms behind it.** It may
and must classify a trust-registered account for statement presentation — a trust bank account is an
asset and the client-trust liability an equal liability, and omitting them hides the one relationship
an examiner checks. It may not map one to any `firm_account_role` (refused at configuration, proved by
a fitness query, and refused again by trust's guard at composition for every path but the journal), may
not re-section one (the two reserved trust sections are derived from trust's registration, never stored
as a firm's choice), and may not re-type one. There is deliberately no `is_trust` flag: registration is
already stored in three places, and a fourth would be free to go stale in exactly the direction that
matters.

**The shipped account-role map is the resolver, and this closes slice-map pin 4 in the direction the
build order took.** Billing landed before the general ledger, with `firm_account_role`, nine roles, a
resolver that refuses by name, and a configuration composer that the payments design already extends.
The prior design's `semantic_key` column is refused because it would be a second map from meaning to
account, editable independently of the first, and the disagreement would look correct in both surfaces.
Instead: the map moves into a pure leaf both consumers can depend on (the `billing-core` precedent,
with a no-behaviour-change gate), exactly two roles are added (`accounts_payable`, `owners_equity`, and
deliberately no default expense account), and three configuration guards land — no trust-registered
account, no parent account, and the account's `type` must match the role's declared normal balance,
because mapping `fee_income` to an asset account inverts the sign of every future invoice posting while
the entry still balances and the batch still commits.

**Two corrections to the prior design's schema plan.** Widening `cost_entry.source` with a fourth value
is unbuildable — SQLite cannot widen a CHECK without a destructive rebuild of a table holding data, the
constraint billing's own `invoice_delivery.channel` note records — so the bill-to-cost link lives on
`vendor_bill_line.disbursement_entry_id` and provenance is derived from it, the same shape
reversed-status already takes, leaving `cost_entry` untouched. And a `vendor_bill.status` column becomes
a derived state: an append-only payment table plus a bounds-checked `paid_minor` delta, the
`invoice_matter_balance` arrangement, so two payments racing for one remainder abort rather than
overpay.

**Period close is proposed as an addition to the slice's scope, with the race closed rather than
accepted.** A monotonic lock date in its own table (a setting any settings write can move is not a
lock), checked inside `postEntry` because a lock only the general journal honours is not a lock and
because period membership is a property of the ledger's own `effective_date` column — the same class of
rule as no-future-dating. A reversal always passes, dated into the open period, or fixing a mistake in a
closed month would require reopening it and reopening would become routine. The close-versus-posting
race is closed with billing's refuse-on-frozen-work pattern: the posting batch aims a value the lock
column's date CHECK forbids at the row only when the lock has moved since the read, so a stale read
aborts its own whole batch, where the prior design accepted the race and covered it with a fitness
query. Retained earnings is computed and never posted.

**Four statement primitives that refuse rather than degrade**, bitemporal in the shape financial
reporting shipped, with the temporal contract moved down into a shared leaf so exactly one validation of
a period-plus-knowledge-instant triple exists. A trial balance that does not foot, a balance sheet that
does not balance, trust sections that do not net to zero, and any posting account no section would place
each refuse by name — dropping an unclassified account leaves a statement that does not foot, and
lumping it into "other" asserts a classification nobody made. Re-sectioning is bounded so it can only
move an account within one statement, by a per-type DDL CHECK on the section vocabulary plus an
immutable `type` on any account carrying lines. Nothing is materialised.

**QuickBooks is a sync because it has no inbound operation and nowhere to put a remote figure.** The
`accounting` category's descriptor declares export operations only, with a fitness assertion rejecting
any import-shaped operation name, so a capability that does not exist cannot be called. No
`quickbooks_id` on `ledger_entry`, no `external_balance`, no table reconciling the two books — the only
remote state is an append-only dispatch row recording what left. An export refusal is a dispatch outcome
retried through the outbox; a divergence caused by editing the remote is not detectable, is not
simulated, and is stated as outside what the platform asserts, because detecting it needs the read-back
that would make the remote authoritative. The bank feed is reserved with no table, no port method, and
no column.

**Seven ADR fragments; five sub-slices, each shippable alone.** Sixteen questions flagged for the owner.
The load-bearing ones: whether a starter chart ships at all (recommended yes, with no seeded role
mapping — the mapping is where money goes); cash basis versus accrual (accrual, with the derived cash
view deferred because it is not a tax basis and must not be presented as one); whether period close is
in scope for this slice at all (recommended yes, and a clean cut if not, since nothing else reads the
lock); and whether these books ship ahead of payments' manual receipt. **Three things are scoped out
rather than half-built**: cash does not arrive until payments' first slice lands, so the operating bank
balance moves only through a typed journal entry; there is no operating bank reconciliation until an
importer and the payments clearing account exist; and per-office or per-matter income statements are not
designed, because the dimension columns land here and the paths that produce income are in slices this
one does not own.
