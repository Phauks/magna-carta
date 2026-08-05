# Slice 3·4 — Billing and invoicing — implementation plan

**Design:** [`2026-08-05-billing-design.md`](2026-08-05-billing-design.md)
**Date:** 2026-08-05
**Status:** Plan proposed. No product code in this cycle; this document is what a build cycle
executes against.

Four build sub-slices. Each is independently mergeable and leaves the platform working. The
ordering is a real dependency chain except where noted: 3·4·4 can run in parallel with 3·4·3 once
3·4·1 has landed.

| Sub-slice | Deliverable                                             | Depends on                                  |
| --------- | ------------------------------------------------------- | ------------------------------------------- |
| **3·4·1** | The invoice spine: draft, claim, finalize, post, number | shipped 3·1, 3·3, ledger, matters numbering |
| **3·4·2** | Value reaching an invoice, including from trust         | 3·4·1; shipped `@magna-carta/trust`         |
| **3·4·3** | Arrangements and taxes                                  | 3·4·1                                       |
| **3·4·4** | Presentation, delivery, LEDES, guidelines               | 3·4·1 (parallel with 3·4·3)                 |

## Global constraints

These bind every task and are not restated per task.

- **The ledger is touched in exactly one place.** Only invoice finalization and the application path
  compose `ledger_*` statements. The work-in-progress packages continue to compose none, and their
  existing fitness scans stay green.
- **No trust rule is reimplemented.** Trust entries are composed only by
  `composeTrustToOperatingTransfer`; billing merges the returned statements. A source scan asserts
  that no file in the billing package composes a `trust_*` statement or imports the composition
  guard.
- **Everything commits through the chokepoint.** Services validate in memory and return
  `EffectWrite`; routes commit through `runDomainEffect` / `runIdempotentEffect`. No service holds a
  D1 binding, reads a clock, or generates randomness ambiently — `ClockPort`, `actorUserId`, and
  `randomSource` are injected, in the shipped service shape.
- **Money is integer minor units through `@magna-carta/money`.** Rounding only through the named
  helpers: `roundInvoiceLine` for line totals, `roundTax` for tax, `roundLedger` for aggregation,
  `allocate` for splits.
- **Full names, no shorthand**, and no process references in source, tests, config, or
  consumer-facing strings.
- **Migrations are registered in `apps/worker/src/per-firm-migrations.ts`** as well as the drizzle
  journal, and each sub-slice lands its schema in **one** migration, not several — a slice that
  accretes migrations holds the pre-alpha baseline collapse hostage.
- **Every task is test-first**, and every task that touches a shipped package re-runs that package's
  full suite before it is considered done.

## Commands

```
vp run bootstrap                 # once per worktree
pnpm check:scoped                # inner loop
pnpm test                        # unit + integration
pnpm run lint:process-refs       # process-reference source scan
pnpm run lint:decisions          # decision-fragment frontmatter
```

---

# Build sub-slice 3·4·1 — The invoice spine

The whole point of this sub-slice is the finalize batch. Everything before it exists to make that
batch composable, and everything after it in the slice hangs off what it creates.

## Task 1 — Identifiers, permissions, package scaffold

Register the new identifier prefixes (`invoiceLine`, `invoiceWipClaim`, `invoiceApplication`,
`creditNote`, `creditNoteLine`, `clientCredit`, `invoiceDelivery`, `billingArrangement`, `taxRate`)
alongside the existing `invoice`. Add the six `billing:*` permissions to the registry with the
comment block explaining why drafting, finalizing, applying, and crediting are separate keys, and
seed them onto the existing Billing role. Create `packages/billing` with its `CLAUDE.md`, tsconfig
pair, and vitest config, depending on `@magna-carta/billing-core`, `data-access`, `database`,
`identifiers`, `ledger`, `money`, `trust` (types plus the transfer composer), and `zod`.

**Done when** the prefix registry test passes, the permission registry snapshot is regenerated, and
the empty package builds.

## Task 2 — Extract the sequence-numbering idiom

Move the counter, guarded-increment, and allocation statement builders out of
`packages/matters/src/numbering/counter-statements.ts` into a small shared package parameterized by
table names and the owning-row column, together with the conflict predicate and the bounded-retry
helper. Matters consumes it and keeps its table names and behaviour bit-for-bit; the whole matters
suite is the proof.

**Done when** matters' numbering and matter-service suites pass unchanged against the extracted
package, and the extracted package has its own suite covering the losing-draw race.

## Task 3 — Schema: the invoice spine in one migration

`invoice`, `invoice_line`, `invoice_wip_claim`, `invoice_matter_balance`, `invoice_number_counter`,
`invoice_number_allocation`, `firm_account_role`. With them:

- the partial unique index `(source_kind, source_id) WHERE released_at IS NULL` on claims;
- the `invoice_matter_balance` CHECK `applied_minor >= 0 AND applied_minor <= total_minor`;
- `RAISE(ABORT)` triggers freezing `invoice`, `invoice_line`, and `invoice_wip_claim` on any
  `UPDATE`/`DELETE` once the owning invoice's stored status is not `draft`;
- `RAISE(ABORT)` triggers making `invoice_number_allocation` unconditionally append-only;
- indexes: `invoice_line (matter_id, invoice_id)`, `invoice (client_entity_id, status)`,
  `invoice (status, due_date)` for aging, and the keyset composite for list reads.

**Done when** a migration test asserts every column, every CHECK, and — one test per trigger — that
the frozen tables actually refuse. A trigger nobody tried to violate is a trigger that does not
exist.

## Task 4 — Draft assembly and the claim

`createInvoiceDraft`, `addClaimsToDraft`, `removeClaim`, `updateDraftLine`, `voidDraft`. The claim
composes the claim insert plus the mirror `UPDATE` on the entry's `invoice_id`, and the code says in
place that the mirror is a mirror and the partial unique index is the guard. Client resolution
through `matter_party` where `role = 'client'`, with a named refusal when a line's matter resolves
to a different client than the invoice's.

**Done when** two concurrent drafts claiming one entry produce exactly one winner and one aborted
batch; a released claim can be re-claimed; and voiding a draft releases every claim and nulls every
mirror.

## Task 5 — The account-role resolver

The `firm_account_role` map, its configuration service, and the resolver that refuses by name when a
role is unmapped. Refusal messages name the missing role and where it is configured.

**Done when** finalization against an unconfigured firm refuses with the named error rather than
posting anywhere, and each of the nine roles has a test.

## Task 6 — Finalize: the one batch

The largest task in the slice, and it is one task because its whole content is atomicity. In one
composed effect: the number draw (ensure-row, guarded increment, allocation insert, bounded retry on
a lost race); the letterhead, client, matter, and totals snapshot onto the invoice; the status
transition to `final`; the `invoice_matter_balance` rows; the `billed` transition on every claimed
time and cost entry through `@magna-carta/billing-core`'s `assertTransition`; and the
accounts-receivable posting via `postEntry` with the resolved role accounts.

**Done when** a finalize that fails at any point leaves no number consumed, no entry locked, and no
posting; a concurrent number draw converges; the posted entry balances and its debit equals the
invoice total; and the whole thing replays correctly under a repeated `Idempotency-Key`.

## Task 7 — Reads

Unbilled work-in-progress per matter (the hot read, served from the mirror column, no join); invoice
list and detail; the per-matter and per-invoice balance read; a first accounts-receivable aging read.
All keyset-paginated on the shipped cursor contract.

## Task 8 — Routes, fitness, and the load profile

The chokepoint routes with route metadata, `idempotency: required` on every mutation, and a
regenerated OpenAPI snapshot. Three fitness functions: the subledger tie-out (unpaid balances sum to
the accounts-receivable control account), one client per invoice, and no claim on a frozen invoice.
The `InvoiceVolume` corpus and the four measurements, including the finalize-batch ceiling that sets
the maximum claim count.

**Done when** the batch ceiling is a measured number in a named constant with the measurement that
produced it recorded, not a guess.

---

# Build sub-slice 3·4·2 — Value reaching an invoice

## Task 1 — Schema: applications, credit notes, client credits

One migration: `invoice_application` (with the UNIQUE `reverses_application_id`), `credit_note`,
`credit_note_line`, `client_credit`, and unconditional append-only triggers on all four.

## Task 2 — The one application door

`composeInvoiceApplication` — the single supported way any value reaches an invoice, taking a kind,
an amount, a matter, and a source reference; composing the application row and the
`applied_minor` delta; and composing the ledger entry **for every kind except `trust_transfer`**,
which arrives with its own. The exception is the slice's most dangerous detail and carries both a
comment saying why and a test asserting exactly one accounts-receivable credit per trust
application.

**Done when** over-application aborts the batch on the CHECK rather than being pre-checked away, and
a multi-matter payment allocates by `allocate` and sums to the payment exactly.

## Task 3 — The invoice-backed earned-fee precondition

The billing-side implementation of trust's `EarnedFeePrecondition`, constructed per request from
resolved applications, asserting the five conditions in the design's section 8.2 and refusing by
name on each. **No change to `@magna-carta/trust`.**

**Done when** each of the five conditions has a refusing test; a transfer against a draft invoice
refuses; a transfer exceeding the matter's unpaid balance refuses in the pre-check **and** aborts on
the CHECK when the balance is consumed concurrently after the read.

## Task 4 — Apply trust funds end to end

The service composing the trust transfer through `composeTrustToOperatingTransfer` and merging its
statements with the application into one batch, with the operating and receivable account
identifiers resolved through the role map.

**Done when** a partial application leaves the correct unpaid balance; a held (disputed) trust
balance refuses with trust's own refusal; and the source scan confirming billing composes no trust
statement itself passes.

## Task 5 — Credit notes and client credits

The credit-note write path, its contra-revenue posting, the application up to the unpaid remainder,
and the overflow into an open `client_credit` row. The three discharge paths recorded (refund,
return to trust as two linked entries through the trust composer, application to a later invoice),
each as an explicit operation the firm chooses.

**Done when** a credit note against a fully applied invoice creates a client credit and moves no
money on its own, and the return-to-trust discharge composes a trust deposit through trust's
composer rather than a hand-built entry.

## Task 6 — Reversals, write-offs, matter close, routes

Reversal applications with the UNIQUE link; write-offs; the billing close precondition registered
with its commit guard (soft on a receivable with a recorded override, hard on an open client credit);
routes, OpenAPI, and the apply-funds load measurement.

---

# Build sub-slice 3·4·3 — Arrangements and taxes

## Task 1 — Schema and the arrangement write path

`matter_billing_arrangement` (effective-dated, append-only, closing the prior row's `valid_to` in the
rate-engine shape) and `tax_rate`, in one migration.

## Task 2 — Flat fee

The single `flat_fee` line composed from the arrangement, with claims on every contributing time
entry carrying a null `invoice_line_id` and a zero claimed amount.

**Done when** a flat-fee invoice shows one line, every contributing entry locks as billed, and the
realization read can still attribute the covered work.

## Task 3 — Contingency and retainer, recorded only

The arrangement records the contingency share and the retainer target and threshold. Nothing
computes a settlement; nothing raises an alert. The advance-deposit destination is recorded per
arrangement with no platform default.

**Done when** a contingency matter refuses hourly fee-line composition with a message naming the
arrangement, and the retainer threshold is readable by the automations slice without any trust write.

## Task 4 — The tax mechanism

The `TaxPolicyPort`, the firm-rate implementation, ordered and optionally compounding components,
per-line taxability resolved at draft with the hard/soft default, aggregate-base computation with a
single `roundTax`, and the rate snapshot at finalize.

**Done when** an unconfigured firm produces no tax line at all; a configured rate produces a tax
total equal to rate times base to the penny; and per-line attribution via `allocate` sums to the tax
total exactly.

## Task 5 — Discounts, adjustments, configuration routes

Negative lines through `roundInvoiceLine`, the configuration surface for arrangements, tax rates, and
the numbering scheme, and the OpenAPI regeneration.

---

# Build sub-slice 3·4·4 — Presentation, delivery, LEDES

## Task 1 — The presentation snapshot

Every rendering input copied at finalize, and a test proving a finalized invoice re-renders
identically after the source Location, client, matter title, and tax rate have all changed.

## Task 2 — Delivery records and emission points

`invoice_delivery` (append-only), the delivery-state read the apply-funds surface shows, and the six
outbox topics emitted in the same batch as the writes that cause them, carrying identifiers and
non-privileged fields only.

## Task 3 — The canonical invoice shape and the export port

The canonical shape composed from a finalized invoice, and the exporter port in the shipped
port-and-canonical pattern.

## Task 4 — LEDES 1998B and LEDES XML 2.0/2.1

Two adapters against the port, reading UTBMS codes from the line snapshots.

**Done when** each exporter round-trips a fixture invoice against the published field order, and an
invoice missing a code required by the format refuses with the offending lines named.

## Task 5 — Billing guidelines and pre-finalize validation

Guidelines on the client Directory entity (rate caps, required codes, increment and block-billing
rules), validated **before** finalization, refusing with every offending line listed.

## Task 6 — Documentation

The package `CLAUDE.md`; the user-facing guides in `docs/user/` for creating a bill, reviewing it,
finalizing it, and applying trust funds — the last written carefully, since it is the surface where a
member takes client money; the changelog and status fragments; and the ADR fragment moving from
proposed to accepted with whatever the owner ruled on the flags.

---

# Named later slices

Payment rails and processors, surcharging, and payment plans (Phase 6); recurring and batch bills,
reminders, dunning, and the evergreen replenishment alert (3·7); settlement disbursement statements
and lien handling (a later financial slice, once a real matter demands it); aging and realization
report rendering (3·6); the operating chart of accounts, accounts payable, and the operating
disbursement that closes the Client Costs Advanced position (3·5); the invoice user interface and the
client-portal invoice surface.
