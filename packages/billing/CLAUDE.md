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
- `src/apply-authorization.ts` — `applyEarnedFeesUnderAuthorizationPolicy`: THE entrance for taking
  earned fees, which asks trust's shared disposition first and then either applies directly or
  queues; plus the queue row itself (`submitTrustApplicationRequest`) and its approval
  (`composeTrustApplicationApproval`). The routing arm lives here, one level above
  `composeTrustToOperatingTransfer`'s refusal — that refusal is the last guard before a posting and
  must never become a route, or a composer meant to move money would start writing queue rows.
- `src/apply-trust-funds.ts` — `applyTrustFundsToInvoices`: trust's transfer and the applications
  merged into ONE batch
- `src/account-roles.ts` — the `firm_account_role` map, its configuration composer, and the resolver
  that refuses by name when a role is unmapped
- `src/numbering.ts` — the invoice sequence's tables and scope convention. The SHAPE is not here:
  it is the `invoice` purpose on the register in `@magna-carta/sequence-numbering`
- `src/line-amounts.ts` — `invoiceLineAmountMinor` (through `roundInvoiceLine`) and `aggregateMinor`
- `src/queries.ts` — the unbilled work-in-progress read (the hot one), the invoice list and detail,
  the per-matter receivable, the aging read, and the two registers the Invoices and Payments Applied
  reports are taken over (`readInvoiceRegister`, `readApplicationRegister`), the work in progress by
  age (`readWorkInProgressByAge`, which shares the breakdown's one definition of unbilled), and
  `readMatterCaptions` for a report that gathers matters from several domains
- `src/arrangements.ts` — the fee agreement: `setBillingArrangement` (a fee change is a NEW
  version), the in-force/history reads, and `requireArrangementOfKind`
- `src/flat-fee.ts` — `addFlatFeeToDraft`: one `flat_fee` line, contributing time claimed at ZERO
- `src/contingency.ts` — `matter_recovery` record/void, `deriveContingencyFee` (always computed at
  composition, never stored), and `addContingencyFeeToDraft`
- `src/retainer.ts` — `readRetainerStatus` + the replenishment request record, and the
  `billing.retainer.replenishment_requested` topic (the notifications seam)
- `src/credit-note.ts` — the four corrections after finalization: `issueCreditNote` (the split
  against what the bill can still absorb, and the `client_credit` for what it cannot),
  `composeInvoiceWriteOff`, `applyClientCreditToInvoice`, `composeApplicationReversal`
- `src/delivery.ts` — `recordInvoiceDelivery`: one append-only attempt at getting a bill to its
  client, and the `billing.invoice.delivered` topic. The delivery-state reads live in
  `src/statements.ts` (`readInvoiceDeliveries`, `readInvoiceDeliveryState`, and the batched
  `readInvoiceDeliveryStates`), and the state rides `readInvoiceDetail`
- `src/close-precondition.ts` — `matterClientCreditClosePrecondition`: the hard block on closing a
  matter over money the firm has conceded it owes back
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
  is structural at three layers: `composeInvoiceApplication` composes no posting for ANY kind (the
  caller's posting is named to it, never built by it); the `invoice_application_entry_paired`
  trigger refuses a trust application that names an entry at all; and it is re-proved over stored
  rows by `trustApplicationsWithoutExactlyOneReceivableCreditStatement`, with its own test asserting
  the subledger still equals the control account.
- **THE ENTRY IS RECORDED ON THE ROW THAT OWNS THE POSTING, and the pairing is a trigger.** None for
  a trust transfer (above). None on the application for a **credit note** either: one note is ONE
  posting across however many per-matter applications it produces — including none at all, when the
  bill it corrects is already paid in full — so `credit_note.entry_id` carries it. Exactly one on
  the application for every remaining kind. `billingCompositionsWithoutTheirReceivablePostingStatement`
  proves the mirror condition to the trust one: a non-trust application that moved a balance with no
  receivable posting behind it, or with two.
- **A CORRECTION IS A SECOND RECORD, AND THE BILL'S TOTAL NEVER MOVES.** `credit_note` and
  `credit_note_line` are append-only from birth and refused by trigger against anything but a
  finalized invoice. A note lands as an application against `applied_minor`; never reduce
  `total_minor`, which would be a negative unpaid receivable and would rewrite what the client was
  told. What the note cannot absorb opens a `client_credit` — because in the ordinary case that
  money has already left the client's trust ledger and become the firm's, which is a firm-funds
  decision and not an invoicing one.
- **A CLIENT CREDIT'S "OPEN" IS DERIVED — never a status column.** `amount_minor` is frozen by a
  shape trigger and `discharged_minor` is delta-updated inside a posting batch under a bounds CHECK,
  the same arrangement `invoice_matter_balance` carries, so two discharges racing for one remainder
  abort rather than overdraw. Only the exit that moves no money is built (setting it against a later
  bill of the SAME client, on any of their matters); a refund from operating and a return to trust
  both move real money out of a firm account and belong with the operating-disbursement path.
- **A REVERSAL REFUSES A TRUST TRANSFER AND A CREDIT NOTE, BY NAME.** Putting money back into a
  client's ledger is a trust movement, composed and authorized there — reversing one from here would
  make billing a writer of trust statements, which the source scan forbids and the earned-fee seam
  exists to prevent. A credit note is a permanent document the client may already hold; unwinding
  its application while the document stood would orphan any credit it opened. Reversing a reversal
  is refused too: it would re-apply value under a kind whose whole meaning is that it subtracts.
- **A CREDIT IS ATTRIBUTABLE, and for a derived fee that attribution is load-bearing.**
  `credit_note_line.credits_invoice_line_id` (held by trigger to a line of the same bill on the same
  matter) is what makes "already charged" mean charged AND NOT SINCE CREDITED. Both the contingency
  offset and `contingencyBilledBeyondEntitlementStatement` read billed net of it. Never revert either
  to the gross charge: a finalized line cannot be edited, so the credit note is the only record that
  can answer a shrunk basis, and a gross comparison leaves the matter reported forever with the
  correct remedy already applied.
- **A DELIVERY IS A RECORDED ATTEMPT, AND "SENT" IS NOT AN INVOICE STATUS.** `invoice_delivery` is
  append-only from birth (three triggers, including the BEFORE INSERT guard that catches
  `INSERT OR REPLACE`, which fires neither of the other two), and a second delivery of the same bill
  is a second row. Never add a `sent` column or status to `invoice`: a bill goes out possibly several
  times by several channels, and a status would force the finalized row — frozen, with no
  un-finalize — to stay mutable for its least load-bearing field. Two triggers bound what a row may
  describe: a delivery names a **finalized** bill, and cannot predate that bill's `issue_date`. The
  channel vocabulary is closed at five and `client_portal` is enumerated before anything can produce
  it, because SQLite cannot widen a CHECK without a destructive rebuild of what is now an
  evidence table.
- **THE DELIVERY RECORD IS SURFACED, NEVER A GATE.** Finalization alone gates an earned-fee transfer;
  `readInvoiceDeliveryState` rides `readInvoiceDetail` so the surface deciding to move client money
  cannot forget to show it. Never promote it to a precondition on `applyEarnedFeesUnderAuthorizationPolicy`
  or into `invoiceBackedEarnedFeePrecondition`: a hard gate would be satisfied by firms recording
  deliveries that never happened, which converts a compliance record into a checkbox and makes the
  record worse than not having one. The state reports the **earliest** success, not the latest — when
  the client was first given the bill is the question — and carries attempt counts, because a bill
  never sent and a bill chased three times without landing are both "not delivered" and are not the
  same situation.
- **NOTHING HERE PERFORMS A DELIVERY.** No renderer, no transmission, no client-facing channel. Every
  row is a delivery the FIRM made out of band and is reporting, with the firm's own date on it, which
  is why only the two checkable things are checked. `billing.invoice.delivered` carries identifiers,
  the channel and the outcome — never `recipient_reference`, which is the client's own fact and
  resolves behind the deep link through this package's access-checked read.
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
- **The SHAPE of the number is the firm's, and finalize renders nothing.** The `invoice` purpose is
  on the numbering register like every other run since the owner's ruling of 2026-09-19; finalize
  calls `planSchemeDraw` and composes what it returns. The built-in default is a five-digit count,
  which is byte-for-byte what this run rendered when the renderer lived here. Never add a render
  function back to this package: a second renderer is exactly what the register replaced.
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
- **A numbering scope is opened deliberately, and a second one needs the office code on the
  scheme.** The scope key selects which counter the number is drawn from, so an unrecognized one is
  refused (`unknown-number-scope`) unless the caller passes `createNumberScope`. It is never
  normalized to rescue a near-miss: folding `nyc` into `NYC` merges two sequences a firm may have
  meant to keep apart. Gaplessness is what an auditor asks about, and a typo must not be able to
  redefine which sequence it is a property of. The scope is the LETTERHEAD, not a rendered value —
  the purpose is `scopeSource: "owner"` on the register, so finalize passes the key rather than the
  template deriving it. That leaves one thing for finalize to hold: a bill drawn under a non-
  firm-wide scope whose scheme carries no `location_code` part is refused by name, naming the
  settings screen. Silently rendering `00042` under two letterheads, where the firm-wide run has
  already issued `00042`, is a duplicate invoice number in a run an auditor reads end to end. The
  mirror is refused too: a firm-wide bill under a scheme that DOES print the office code has no code
  to print, and is refused as `invoice-numbering-needs-letterhead` rather than reaching the renderer
  and failing as a server error. The web app names no letterhead today, so for it that refusal is
  what adding the part means — never let it fall back to rendering the part empty.
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
  the write path; `contingencyBilledBeyondEntitlementStatement` surfaces it firm-wide and
  `readContingencyResidual` states it per matter as an amount against the fee lines a correction
  would be aimed at. Neither issues anything: what the firm owes back after a settlement collapses is
  a decision with a client in it. `readContingencyResidual` deliberately refuses NOTHING about the
  basis — a basis that vanished resolves to an entitlement of zero, because that is the worst case it
  exists to report, where `deriveContingencyFee` (the composition path) refuses it by name.
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
- **`.all()` + `results[0]`, never `.first()`** — for one spelling of "no row", not because `.first()`
  is missing. Every adapter behind the statement interface implements it, so an existing `.first()` call
  is not a bug; it just returns `null` where the rest of the platform's reads return `undefined`. Stated
  once in [`packages/data-access/src/idempotency-statements.ts`](../data-access/src/idempotency-statements.ts).
- **A guarded UPDATE cannot abort a batch.** Where finalization needs a business condition to abort,
  it aims a value the table's CHECK forbids at exactly the offending rows
  (`refuseFinalizeOnFrozenWorkInProgressStatements`). A guard that could store a row is a write, not
  a guard.
- **Releasing ONE claim nulls its `invoice_line_id` in the same statement**, because the line is
  deleted in the same batch and the claim's foreign key would otherwise refuse. Voiding a whole draft
  keeps its lines and its claim links — the invoice is frozen at that point anyway.
- **A new migration must be registered in `apps/api-worker/src/per-firm-migrations.ts`** as well as the
  drizzle journal — the Durable Object applies the lineage from there.
- The invoice-number allocation carries a no-overwrite BEFORE INSERT trigger, so a losing draw
  surfaces as an append-only refusal rather than a UNIQUE constraint. `isNumberAllocationConflict`
  recognizes both shapes; they are the same event.
