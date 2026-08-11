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
- `src/application.ts` — `composeInvoiceApplication`: **the** door any value reaches an invoice
  through, and the one place the no-ledger-entry-for-a-trust-application rule lives
- `src/earned-fee.ts` — `resolveEarnedFeeApplications` + `invoiceBackedEarnedFeePrecondition`: the
  satisfier for the port at `packages/trust/src/transfer.ts` that refuses every transfer by default,
  and `MAXIMUM_INVOICES_PER_TRUST_APPLICATION` (the per-transfer bound)
- `src/apply-trust-funds.ts` — `applyTrustFundsToInvoices`: trust's transfer and the applications
  merged into ONE batch
- `src/account-roles.ts` — the `firm_account_role` map, its configuration composer, and the resolver
  that refuses by name when a role is unmapped
- `src/numbering.ts` — the invoice sequence's tables, start value, scope convention, and renderer
- `src/line-amounts.ts` — `invoiceLineAmountMinor` (through `roundInvoiceLine`) and `aggregateMinor`
- `src/queries.ts` — the unbilled work-in-progress read (the hot one), the invoice list and detail,
  the per-matter receivable, and the aging read
- `src/arrangements.ts` — the fee agreement: `setBillingArrangement` (a fee change is a NEW
  version), the in-force/history reads, and `requireArrangementOfKind`
- `src/flat-fee.ts` — `addFlatFeeToDraft`: one `flat_fee` line, contributing time claimed at ZERO
- `src/contingency.ts` — `matter_recovery` record/void, `deriveContingencyFee` (always computed at
  composition, never stored), and `addContingencyFeeToDraft`
- `src/retainer.ts` — `readRetainerStatus` + the replenishment request record, and the
  `billing.retainer.replenishment_requested` topic (the notifications seam)
- `src/render-shape.ts` — the multi-matter render-shape firm setting and `readInvoiceRenderModel`
  (per-matter pages + summary), the model the PDF tail consumes
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
  hopeful. Same arrangement as `account_balance`, for the same reason. The delta statement is
  deliberately UNGUARDED: `... WHERE total_minor - applied_minor >= ?` would look safer and be
  strictly worse, because a zero-row UPDATE aborts nothing and the losing batch would commit with its
  trust entries — real client money — beside a balance that never moved.
- **BILLING COMPOSES NO LEDGER ENTRY FOR A TRUST APPLICATION.** Trust's transfer is two linked
  entries and its operating leg has already posted `Dr Operating Bank / Cr Accounts Receivable`. A
  second credit composed here leaves the ledger balanced, every entry valid, and nothing failing —
  while the receivable control account drifts below the invoice subledger by the total of every
  trust-funded fee the firm has ever taken. It is the single most likely bug in the subsystem, so it
  is structural (the one arm in `composeInvoiceApplication`), has its own test asserting the
  subledger still equals the control account, and is re-proved over stored rows by
  `trustApplicationsWithoutExactlyOneReceivableCreditStatement`.
- **The earned-fee precondition is billing's, the transfer is trust's.** Billing implements the port;
  `@magna-carta/trust` never learns what an invoice is, and no trust file changed to close this. The
  port's context (node, matter, amount, currency) is enough precisely because the precondition is
  constructed per request from applications billing already resolved — it is a re-check that trust is
  composing what billing authorized, not a fresh lookup. Never widen the port with an invoice
  reference.
- **Every application is append-only and its direction is its KIND.** Amounts are positive; a
  reversal subtracts because it is a reversal. A mistaken application is corrected by a new linked row
  (UNIQUE `reverses_application_id`), never an edit — an edit would move a balance whose money has
  already moved, with no record of having done so.
- **The number is drawn at finalize, inside the batch.** A number drawn at draft is burned by every
  abandoned draft, and gaps are the first thing an auditor asks about. The mechanism is
  `@magna-carta/sequence-numbering`; the allocation's composite primary key is the load-bearing
  backstop, and the caller wraps the whole commit in a bounded retry.
- **An unmapped account role REFUSES.** The product chart of accounts does not exist; a fact we do not
  have is not a fact we invent. Only the roles an invoice's lines actually need are resolved, so a
  firm that never bills a hard cost is not made to map `client_costs_advanced`.
- **One client per invoice, every line naming its matter.** Validated at draft composition through
  `matter_party` where `role = 'client'` — read via `readMatterClientEntityIds` in
  `@magna-carta/matters/matter-party`, the one home for that derivation, which trust attributes a
  client ledger with too — and re-proved over stored rows by `fitness.ts`.
  `matter.client_display_name` is display-only and is never the link.
- **One currency per invoice.** A claim whose entry currency differs from the invoice's is refused by
  name at `addClaimsToDraft`. Finalization aggregates every line under the INVOICE's currency, so a
  line that disagreed would be silently re-labelled rather than converted; the work-in-progress
  stores' USD CHECK constraints make this unreachable today, which is exactly why the guard is in the
  code and not left to the schema.
- **Direction comes from the sign; the line carries the magnitude.** A negative invoice line is a
  first-class shape (no positivity CHECK, `roundInvoiceLine` is half-away-from-zero for it, and
  `postingRoleForLine` has discount and adjustment arms), so a role subtotal can net negative on a
  bill whose total is positive. That posts as a DEBIT of its magnitude — a ledger line is always a
  positive amount plus a direction. A per-matter subtotal that nets negative is refused by name
  (`invoice-matter-total-negative`) before the balance CHECK can abort the batch on a column name.
- **A numbering scope is opened deliberately.** The scope key selects which counter the number is
  drawn from, so an unrecognized one is refused (`unknown-number-scope`) unless the caller passes
  `createNumberScope`. It is never normalized to rescue a near-miss: folding `nyc` into `NYC` merges
  two sequences a firm may have meant to keep apart. Gaplessness is what an auditor asks about, and a
  typo must not be able to redefine which sequence it is a property of.
- **Hard costs credit Client Costs Advanced; soft costs credit Cost Recovery Income.** The firm is
  being repaid for money it advanced, not earning. `cost_entry.disbursement_class` already carries
  the distinction. That account runs negative until operating disbursements land — a documented open
  position, not a bug.
- **The fee agreement is append-only and versioned; invoice lines pin the version.** A fee change is
  a NEW `matter_billing_arrangement` version — dense per matter by trigger, one in force by partial
  unique index, and the ONLY update a version ever takes is the one-time close of its `valid_to`
  when superseded. Lines an arrangement composes (flat fee, contingency) carry
  `billing_arrangement_id`, so what a finalized bill was computed under is permanent. Absence of an
  arrangement means hourly; never backfill one.
- **A contingency fee is DERIVED at composition, never stored as a decided number — and it is
  OFFSET, never re-billed.** The stored facts are the agreement (share + costs-before-or-after
  election) and the `matter_recovery` rows (void-with-reason their only edit);
  `deriveContingencyFee` recomputes the WHOLE entitlement from them on every call, and the line
  charges the entitlement minus every contingency fee already on a FINALIZED bill across the
  MATTER'S WHOLE CONTINGENCY-AGREEMENT CHAIN — never scoped to the version, because an amendment
  (even at the same share) mints a new version without minting a new recovery — so a later recovery
  bills exactly its own increment, a re-compose after finalize refuses
  (`contingency-nothing-unbilled`), and a draft carries at most one contingency line
  (`contingency-fee-already-on-draft`). A share change re-levels to the in-force share: a raise
  bills the difference, a cut that leaves billed above entitlement refuses and is a fitness
  finding. Net-after-costs deducts the matter's advanced (hard)
  costs, never soft costs, and only `approved`/`billed` entries — a draft cost is a claim nobody
  confirmed. A basis that SHRINKS after billing (a voided recovery, a late cost) cannot be caught on
  the write path; `contingencyBilledBeyondEntitlementStatement` is the mechanism that surfaces it.
- **A non-hourly matter refuses hourly time claims by name** (`matter-not-billed-hourly`) — charging
  a flat-fee or contingency client by the hour would bill the same agreement twice. Costs stay
  claimable on every matter, and a retainer matter still bills hourly: a retainer FUNDS work, it
  does not price it.
- **The retainer floor is business configuration, never trust's floor.** `retainer_threshold_minor`
  is the replenishment ask; the trust leaf's `min_balance_minor` is the structural no-negative floor
  and is never repurposed. Retainer reads use trust's AVAILABLE figure (holds excluded) through
  trust's own reads, and the replenishment request moves no money and writes no trust table.
- **The render shape is SNAPSHOT at finalize, like the letterhead.** `invoice.render_shape` is
  resolved (per-invoice override, else the firm setting in `render-shape.ts`) inside
  `finalizeInvoice` and never read live afterwards; a null column (drafts, invoices finalized before
  the column) derives as `combined`. The derivation is a read; no PDF machinery lives here.
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
  `@magna-carta/matters` (`matter-party` — the matter-to-client link, read from its one home),
  `@magna-carta/money`, and `@magna-carta/sequence-numbering`.
- **`billing-core`'s `IllegalTransitionError` never reaches an HTTP boundary from here.** The
  finalize claim loop catches it and rethrows `BillingValidationError("work-in-progress-not-billable")`
  naming the entry and the state it is in — the same contract timekeeping and costs hold.
- **It depends on `@magna-carta/trust` for the transfer composer and its types, and must not compose
  a trust statement itself.** Trust entries come only from `composeTrustToOperatingTransfer`; billing
  merges the returned statements into its own batch and reimplements no trust rule — not the
  composition guard, not the available-not-balance ceiling, not one-client-per-entry, not the
  jurisdiction refusals. A source scan asserts that no file here composes a `trust_*` statement.
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
