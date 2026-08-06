# @magna-carta/billing — CLAUDE.md

**Purpose.** The invoicing domain module: the draft invoice and its lines, the work-in-progress claim
that stops two drafts billing the same hour, the finalize batch that turns a working document into an
evidentiary financial record, the firm-account-role seam every billing posting resolves through, and
the reads and fitness queries over all of it. Validates in memory and composes statements for the
caller to commit through `@magna-carta/data-access`'s chokepoint; never runs logic mid-transaction,
never calls external services, holds no D1 binding.

**White paper:** _Financial Core — Billing_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0008, ADR-0061,
ADR-0072, ADR-0079.) **Invariants:**
[`docs/conventions/invariants.md`](../../docs/conventions/invariants.md).

## Key files / entry points

- `src/draft.ts` — `createInvoiceDraft` / `addClaimsToDraft` / `removeClaim` / `updateDraftLine` /
  `voidDraft`, and `MAXIMUM_CLAIMS_PER_INVOICE` (the measured batch ceiling)
- `src/finalize.ts` — `finalizeInvoice`: **the** batch, and the whole point of the subsystem
- `src/account-roles.ts` — the `firm_account_role` map, its configuration composer, and the resolver
  that refuses by name when a role is unmapped
- `src/numbering.ts` — the invoice sequence's tables, start value, scope convention, and renderer
- `src/line-amounts.ts` — `invoiceLineAmountMinor` (through `roundInvoiceLine`) and `aggregateMinor`
- `src/queries.ts` — the unbilled work-in-progress read (the hot one), the invoice list and detail,
  the per-matter receivable, and the aging read
- `src/statements.ts` / `src/types.ts` / `src/billing-validation.ts` / `src/fitness.ts`

## Invariants that apply here

- **A finalized invoice is immutable, enforced ONLY by the database.** `RAISE(ABORT)` triggers freeze
  `invoice`, `invoice_line`, and `invoice_wip_claim` the moment the owning invoice's stored status
  leaves `draft`. There is no un-finalize and `void` is unreachable from `final`: a bill issued in
  error is corrected by a credit note, a second permanent record rather than the erasure of the
  first. Never add a service-level "allow edit when…" path — the trigger is the guarantee and the
  service refusal in front of it is only a nicer error message.
- **The CLAIM is the concurrency control; the entry's `invoice_id` is a MIRROR.** The partial unique
  index `(source_kind, source_id) WHERE released_at IS NULL` is what makes a losing draft's whole
  batch abort. A guarded `UPDATE … WHERE invoice_id IS NULL` looks like it would and does not — a
  zero-row UPDATE is not an error in SQLite, so the loser would commit having changed nothing. The
  mirror exists for the "what is still unbilled on this matter" read, which must not join.
- **Status moves at finalize, not at claim.** A claimed entry stays editable, because bill review is
  exactly when a firm fixes a narrative or a duration. The `billed` transition rides the finalize
  batch, through `@magna-carta/billing-core`'s `assertTransition` — billing may drive an entry INTO
  `billed` and never back out.
- **Bill review edits the LINE.** The line takes a snapshot when it is composed; editing the entry's
  narrative afterwards does not change what the client was told. Two records, both true, and it is
  what makes a finalized invoice re-renderable years later from its own rows alone.
- **No stored total, no stored balance on the invoice.** Both derive from `invoice_matter_balance`,
  so a payment never has a reason to touch the header and can never drift from the subledger. Never
  add a `total_minor` or `balance_minor` column to `invoice`.
- **The bounds CHECK is the guarantee, not a pre-check.** The `applied_minor` bounds on
  `invoice_matter_balance` are the only mechanism that can abort a whole D1 batch on a business
  condition, which is what makes "this invoice has enough unpaid balance" structural rather than
  hopeful. Same arrangement as `account_balance`, for the same reason.
- **The number is drawn at finalize, inside the batch.** A number drawn at draft is burned by every
  abandoned draft, and gaps are the first thing an auditor asks about. The mechanism is
  `@magna-carta/sequence-numbering`; the allocation's composite primary key is the load-bearing
  backstop, and the caller wraps the whole commit in a bounded retry.
- **An unmapped account role REFUSES.** The product chart of accounts does not exist; a fact we do not
  have is not a fact we invent. Only the roles an invoice's lines actually need are resolved, so a
  firm that never bills a hard cost is not made to map `client_costs_advanced`.
- **One client per invoice, every line naming its matter.** Validated at draft composition through
  `matter_party` where `role = 'client'`, and re-proved over stored rows by `fitness.ts`.
  `matter.client_display_name` is display-only and is never the link.
- **Hard costs credit Client Costs Advanced; soft costs credit Cost Recovery Income.** The firm is
  being repaid for money it advanced, not earning. `cost_entry.disbursement_class` already carries
  the distinction. That account runs negative until operating disbursements land — a documented open
  position, not a bug.
- **Money discipline.** Integer minor units everywhere; rounding only through the named helpers.
  `roundInvoiceLine` is half-AWAY-from-zero because an invoice line may be negative (a discount, a
  write-down); `roundTax` is half-up; `roundLedger` is banker's. Aggregating already-collapsed
  scale-2 amounts goes through Money's own addition and NO rounding helper, because there is no
  boundary there to decide.
- **Clock and randomness injection.** No wall-clock reads and no ambient randomness — `ClockPort` and
  `randomSource` only.

## Dependencies & contracts

- Depends on `@magna-carta/billing-core` (the shared work-in-progress freeze contract),
  `@magna-carta/data-access`, `@magna-carta/identifiers`, `@magna-carta/ledger` (the posting),
  `@magna-carta/money`, and `@magna-carta/sequence-numbering`.
- **It does NOT depend on `@magna-carta/trust`, and must not compose a trust statement.** When the
  application path lands, trust entries are composed only by `composeTrustToOperatingTransfer` and
  billing merges the returned statements into its own batch. Billing never reimplements a trust rule.
- Pure and synchronous: returns `EffectWrite` for the caller to commit.

## Gotchas

- D1 has no interactive transactions — read before composing, or assert inside the batch.
- **`.all()` + `results[0]`, never `.first()`** — the node-sqlite test adapter has no `.first()`.
- **A guarded UPDATE cannot abort a batch.** Where finalization needs a business condition to abort,
  it aims a value the table's CHECK forbids at exactly the offending rows
  (`refuseFinalizeOnFrozenWorkInProgressStatements`). A guard that could store a row is a write, not
  a guard.
- **Releasing ONE claim nulls its `invoice_line_id` in the same statement**, because the line is
  deleted in the same batch and the claim's foreign key would otherwise refuse. Voiding a whole draft
  keeps its lines and its claim links — the invoice is frozen at that point anyway.
- **A new migration must be registered in `apps/worker/src/per-firm-migrations.ts`** as well as the
  drizzle journal — the Durable Object applies the lineage from there.
- The invoice-number allocation carries a no-overwrite BEFORE INSERT trigger, so a losing draw
  surfaces as an append-only refusal rather than a UNIQUE constraint. `isNumberAllocationConflict`
  recognizes both shapes; they are the same event.
