# Slice 3·5 — Operating accounting / general ledger — design

**Status:** design complete, awaiting owner review.
**Date:** 2026-07-09.
**White-paper home:** _Financial Core_ → Operating accounting / general ledger.
**Slice map:** [`2026-06-21-phase-3-financial-core-slice-map.md`](2026-06-21-phase-3-financial-core-slice-map.md).

Extends the append-only double-entry ledger (slice 0·3) to the firm's full operating books: the
chart-of-accounts product the schema deferred, a firm-scoped account resolver, accounts payable as a
liability subledger, fiscal-period close, and the financial-statement read primitives. QuickBooks is
a reserved integration seam, never a system of record.

## 1. Scope & non-goals

**In scope.** The chart-of-accounts product on the existing `ledger_account` schema; stable semantic
keys and the `resolveAccount` firm-scoped resolver; posting dimensions (`matter_id`, `location_id`)
on `ledger_line`; fiscal-period close as a monotonic lock date with an append-only close-event log;
vendor bills with disbursement-class debit routing; trial balance, balance sheet, income statement,
and accounts-payable aging as read models; the `accounting` integration category and the change-feed
seam.

**Non-goals.** No QuickBooks adapter Worker (Phase 7·2). No bank feed. No payment execution — a
vendor payment run moves money at a bank, which is a cross-system compensable flow and belongs to the
Phase 6 rails, where Cloudflare Workflows applies (ADR-0150). No posted year-end closing entries
(retained earnings is computed; see §4). No cost→accounts-receivable posting or LEDES coding — those
belong to 3·4, which owns the single WIP→A/R touch-point.

**Ordering.** 3·5 opens before 3·4. This closes slice-map coordination pin 4 in the favourable
direction: 3·4's finalize consumes the real account resolver and needs no interim resolution seam.

## 2. Package & boundaries

Two new packages, both following the `costs`/`timekeeping` house shape — pure async services taking
`(database, input, options)` and returning `{ effect: EffectWrite }`, no ambient clock, identity, or
randomness; no barrel, one `exports` subpath per file; the route commits through `runIdempotentEffect`.

**`@magna-carta/accounting-periods`** — a pure leaf, no input/output, modelled on `billing-core`.
Exports `assertPostingAllowed({ effectiveDate, lockedThrough, hardLockedThrough })` and its error
type. 3·2 (trust), 3·4 (billing), and 3·5 all depend on this leaf; none depends on the others. This
placement is deliberate: the ledger core states that consumer rules such as period close bind
elsewhere (`packages/ledger/src/validate.ts`), and ADR-0072 defers them to consumers. Enforcing period
membership inside the posting primitive would also make a correcting reversal refusable, the failure
mode `reverse-entry.ts` already anticipates for account closing.

**`@magna-carta/general-ledger`** — owns the chart, the resolver, vendor bills, the close service, and
the statement read models. Depends on `data-access`, `database`, `identifiers`, `money`, `ledger`, and
`accounting-periods`. It does **not** depend on `@magna-carta/costs`, and `costs` does not depend on
it (see §6).

## 3. Data model

All schema changes are expand-contract (ADR-0065): new columns are nullable or defaulted, and no
existing CHECK is narrowed. The migration takes a **monotonic timestamp identifier**, not a `00NN`
slot — the slice map's numbering instruction predates the monotonic-migration-ids decision. Sync
`main` before generating, since that stream touches `packages/database/src/migration.ts`.

**Column naming.** `packages/database/test/schema-conformance.test.ts` refuses any column matching
`/(amount|balance|total|price|fee|cost)(_|$)/` that does not end in `_minor` or `_rate_e4`. A column
named `cost_entry_id` therefore fails the gate. This slice follows the vocabulary 3·3 adopted for the
same reason (`disbursement_class`) and names the link `disbursement_entry_id`.

### 3.1 `ledger_account` — the chart-of-accounts product

Four added columns. The five-value `type` CHECK is **not** widened, and normal balance stays derived
in code (`packages/ledger/src/normal-balance.ts`), per ADR-0072.

| Column              | Type            | Notes                                                       |
| ------------------- | --------------- | ----------------------------------------------------------- |
| `code`              | text, nullable  | Account number. No canonical industry scheme exists; ours is seeded, and firms may renumber. |
| `semantic_key`      | text, nullable  | Unique per firm where non-null. The rename-proof handle the resolver targets. |
| `statement_section` | text, nullable  | Drives balance-sheet vs income-statement placement. Classification only — never normal balance. |
| `system_account`    | integer, dflt 0 | A seeded account. May be renamed or renumbered, never deactivated. |

Accounts are created through `createAccount`, never raw INSERT, so the leaf-only and parent-match
guards run. The seeded chart is a **default, not a lock**: firms rename, renumber, add, and deactivate
non-system accounts freely. Semantic keys are what keep renamed accounts findable.

Seeded semantic keys — precisely the targets slice-map pin 4 requires 3·4 to resolve:
`operatingCash`, `trustCash`, `accountsReceivable`, `clientCostsAdvanced`, `accountsPayable`,
`clientTrustLiability`, `ownersEquity`, `feeIncome`, `costRecoveryIncome`, `taxPayable`.

### 3.2 `ledger_line` — posting dimensions

Two added columns, both nullable and indexed: `matter_id` (references `matter`) and `location_id`
(references `location`).

Dimensions belong on the **line**, not the entry: one vendor bill can carry lines for two matters.
`location_id` is independent rather than derivable — a rent expense has an office but no matter, and
per-office roll-ups are a 3·6 deliverable.

Dimensions and child accounts answer different questions and both survive. **Accounts enforce
bounds**: the per-client trust subledger stays a child account row, because the no-negative trust
invariant is enforced by `min_balance_minor = 0` against the `account_balance` bounds CHECK, which is
per account-balance row and has no dimension equivalent. **Dimensions enable segmentation**: matter
profitability, per-office roll-ups, and the per-matter advanced-cost subledger. This amends ADR-0072,
which contemplated accounts alone.

Practice area is deliberately **not** a column. The only `practice_area` in the schema is free text on
`utbms_code`; the real referent is `matter.matter_type_id`, reachable by join once the line carries
`matter_id`. Denormalizing it is a cache, and the measure-first rule governs. Timekeeper is likewise
excluded: at finalize, many timekeepers' work aggregates into one receivable line, so the grain is
wrong; realization reads `time_entry.timekeeper_user_id`, where that grain lives. Cash-versus-accrual
basis is a reporting filter over one accrual-capable ledger, not a property of a posting.

### 3.3 `accounting_lock` — one row per firm database

`locked_through` (date, nullable), `hard_locked_through` (date, nullable, reserved), `updated_at`.
Written only by the close service.

A dedicated table rather than a firm setting: a setting is reachable by the generic settings route,
and a lock that any settings write can move is not a lock.

### 3.4 `period_close_event` — append-only

`id`, `action` (`close` | `reopen`), `closed_through`, `previous_locked_through`, `actor_user_id`,
`reason`, `created_at`. Never updated or deleted.

Every enumerated column in this slice carries an explicit CHECK in the DDL — `period_close_event.action`,
`vendor_bill_line.disbursement_class`, and `vendor_bill.currency` (`USD`) — because Drizzle text enums
are type-level only. This is the defense-in-depth the ledger tables already apply to `direction`.

### 3.5 `vendor_bill` and `vendor_bill_line`

`vendor_bill` — `id`, `vendor_id` (a Directory entity), `bill_number`, `bill_date`, `due_date`,
`amount_minor`, `currency`, `status`, `ledger_entry_id`, `created_at`, `updated_at`, `created_by`.

`vendor_bill_line` — `id`, `vendor_bill_id`, `line_index`, `amount_minor`, `disbursement_class`
(`hard` | `soft`, CHECK), `matter_id` (nullable), `disbursement_entry_id` (nullable, references
`cost_entry`), `ledger_account_id`, `description`.

`vendor_bill` records **what the firm owes the vendor**. `cost_entry` records **what the firm may bill
the client**. They are different obligations with different lifecycles, and 3·3 already models the
vendor link (`cost_entry.vendor_id`) and the classification (`cost_entry.disbursement_class`), so
this slice reuses rather than restates them.

**One shipped CHECK widens.** `cost_entry.source` currently admits `manual | grid | recovery`. A
bill-originated cost needs a fourth value, `vendorBill`, or provenance is lost. This is an
expand-contract change to a table 3·3 owns and must be called out explicitly in the plan.

## 4. Fiscal-period close

**A monotonic lock date, not period rows.** `locked_through` is a scalar: every effective date at or
before it is closed. Accounting close is a high-water mark — one never closes March while February
stays open — so a scalar makes the illegal state unrepresentable, where a table of open/closed period
rows makes it representable and then requires overlap and gap validation to police it. This is the
shape Odoo, Xero, and QuickBooks all enforce with; ERPNext ships both and hand-writes overlap
validation to keep its period rows honest.

**Enforcement.** `assertPostingAllowed` runs in the service, before composition, on every posting path
— trust (3·2), billing finalize (3·4), and general-ledger journal entries. Backdating stays legal
within the open window, which is what the phase-wide effective-dating invariant actually promises;
future-dating stays refused by `validateEntry`.

**Reversals are permitted, always.** `reverseEntry` takes a fresh caller-supplied `effectiveDate`
rather than copying the original's, so reversing a closed-period entry means dating the reversal into
the open period. This is the behaviour every surveyed system converges on, and it means a period lock
can never trap a correction.

**Reopen is permissioned and audited.** Soft close by default: `ledger:reopenPeriod` moves the scalar
back and appends a `period_close_event` with actor and reason.

`hard_locked_through` is reserved for a future jurisdiction that demands inalterability.
`assertPostingAllowed` accepts and honours it from the outset — a posting at or before it is refused
and **no permission reopens it** — but this slice ships no route that ever sets it, so the column is
always null. Building the guard now costs one comparison; retrofitting it into every posting path
later would not.

**Retained earnings is computed, never posted.** It is `Σ(income − expense)` up to the cutoff — a pure
function of an append-only ledger. Posted closing entries would have to be reversed on reopen, and
GnuCash's own manual warns that real closing entries degrade its reports. Period-end balance snapshots
may be materialized later for performance; closing journal entries will not be.

**Concurrency.** The lock is read before the batch composes, so a close committing between the read
and the batch is a time-of-check race that a D1 batch cannot abort on a cross-row predicate. This is
the same race the leaf-only invariant already accepts on the creation side, and it is answered the
same way: a fitness function re-proves the invariant table-wide (§9).

## 5. The account resolver

`resolveAccount(database, semanticKey): Promise<LedgerAccountId>` — a firm-scoped lookup on
`ledger_account.semantic_key`. It refuses an unknown key with a named domain error rather than
returning null, because every caller is posting money and none can proceed without an account.

3·4's finalize resolves `accountsReceivable`, `feeIncome`, `costRecoveryIncome`, `clientCostsAdvanced`,
and `taxPayable` through it. Because 3·5 lands first, no interim seam is required.

## 6. Accounts payable

A vendor bill for an expert witness is simultaneously a payable to the vendor and an advance to the
client. The `disbursement_class` on each bill line routes the debit:

- **`hard`** — `Dr Client Costs Advanced (matter-tagged) / Cr Accounts Payable`. No profit-and-loss
  impact. An advanced cost is a loan to the client, not the firm's deductible expense
  (_Canelo v. Commissioner_, 53 T.C. 217 (1969), aff'd 447 F.2d 484 (9th Cir. 1971)). At finalize,
  3·4 posts `Dr Accounts Receivable / Cr Client Costs Advanced`, clearing the asset with no income.
- **`soft`** — `Dr <expense account> / Cr Accounts Payable`, and at finalize
  `Dr Accounts Receivable / Cr Cost Recovery Income`. The mirror image: expense on payment, income on
  reimbursement.

Misrouting the debit is a tax error, not a cosmetic one.

**A hard-cost bill writes two records in one batch.** The ledger entry and the `cost_entry` row live in
the same per-firm database, so a single D1 batch commits both atomically. The route composes them:
`recordVendorBill()` returns its statements, `captureCost()` returns its own, and the route spreads
both into one `runIdempotentEffect`. Neither package imports the other. This is the established
pattern — `apps/worker/src/routes/files.ts` already merges three services' effects into one batch.

Two alternatives were rejected. A single service owning both writes would add a dependency edge from
`general-ledger` to `costs` to buy atomicity a shared batch already provides. Routing the WIP row
through a `cost.recorded` outbox message would introduce eventual consistency to solve a problem one
batch solves, and would misuse the outbox, which exists for external consequences.

Payment of a bill posts `Dr Accounts Payable / Cr Operating Cash` and records that the firm paid.
Executing the payment at a bank is out of scope.

## 7. Statement read models

Trial balance, balance sheet, income statement, and accounts-payable aging. All are keyed on
`effective_date`, never `recorded_at`, and reproducible as of any past date — the property 3·6's
reproducibility requirement depends on and the period lock protects.

Aggregation rounds **half-even (banker's)** per the named general-ledger boundary in ADR-0061; the
half-up mode used at invoice and tax boundaries must not be used here.

This slice owns assembly. Rendering, export, and scheduling belong to 3·6.

## 8. Integration seam

The `accounting` integration category is registered with a CapabilityDescriptor, and
`LEDGER_ENTRY_POSTED_TOPIC` (already emitted by `postEntry`) is the change feed a future adapter
consumes. Credentials would live in the envelope-encrypted `firm_secret` store with an
`integration_connection` grant (ADR-0092); QuickBooks uses the OAuth credential kind, so the
framework's Durable-Object refresh lock applies. The adapter Worker itself is Phase 7·2.

Sync, never system of record. A Workflow step history is not a ledger (ADR-0150).

## 9. Permissions, settings, identifiers

**Permissions** (`packages/access-control/src/registry.ts`): `ledger:viewStatements`, `ledger:post`,
`ledger:manageAccounts`, `ledger:closePeriod`, `ledger:reopenPeriod`, `accountsPayable:viewBills`,
`accountsPayable:manageBills`.

Reads are gated separately from writes. A bookkeeper who may read a trial balance must not thereby be
able to post to the ledger, and the firm's accountant typically reads far more than they write.

**Settings.** None. A `ledger.fiscal_year_start` setting was specified and then cut: enforcement is
the scalar lock date, and nothing in this slice reads a fiscal-year boundary. It lands with the
consumer that needs it — 3·6, which renders period boundaries. The lock state itself is not a setting
either (§3.3).

**Identifiers** (`packages/identifiers/src/registry.ts`): `vendorBill`, `vendorBillLine`,
`periodCloseEvent` — prefixes spelled out in full.

**Fitness functions.** Three, in the `packages/ledger/src/fitness.ts` tradition of re-proving what a
pre-check can race on:

1. No `ledger_entry` exists with `effective_date <= accounting_lock.locked_through`.
2. Every `vendor_bill_line` with `disbursement_class = 'hard'` carries a non-null
   `disbursement_entry_id`. This guards a future call site that composes the ledger statements but
   forgets the cost capture — a coding error, not a consistency drift, since the two writes share one
   batch.
3. `SUM(lines) = balance` still holds with the dimension columns present.

## 10. Routes

Chokepoint routes under `/v1`, each declaring full `RouteMeta`; problem responses are RFC 9457.

| Method | Path                             | Permission                 |
| ------ | -------------------------------- | -------------------------- |
| GET    | `/v1/ledger/accounts`            | `ledger:viewStatements`    |
| POST   | `/v1/ledger/accounts`            | `ledger:manageAccounts`    |
| PATCH  | `/v1/ledger/accounts/{id}`       | `ledger:manageAccounts`    |
| POST   | `/v1/ledger/entries`             | `ledger:post`              |
| POST   | `/v1/ledger/entries/{id}/reverse`| `ledger:post`              |
| GET    | `/v1/ledger/trial-balance`       | `ledger:viewStatements`    |
| GET    | `/v1/ledger/balance-sheet`       | `ledger:viewStatements`    |
| GET    | `/v1/ledger/income-statement`    | `ledger:viewStatements`    |
| POST   | `/v1/ledger/periods/close`       | `ledger:closePeriod`       |
| POST   | `/v1/ledger/periods/reopen`      | `ledger:reopenPeriod`      |
| POST   | `/v1/accounts-payable/bills`     | `accountsPayable:manageBills` |
| GET    | `/v1/accounts-payable/aging`     | `accountsPayable:viewBills`   |

These are the ledger's first HTTP surface. Route changes require re-emitting the committed OpenAPI
snapshot and regenerating `@magna-carta/api-client`; neither is hand-edited.

## 11. Testing & load profile

Vitest unit tests per service; Miniflare integration over the real write paths (fixtures never use raw
SQL inserts, which would bypass the ledger invariants); a migration test asserting each new CHECK and
unique index enforces; the three fitness functions; an end-to-end test walking a hard-cost bill from
capture through finalize and asserting the profit-and-loss is untouched. A `GeneralLedgerVolume` load
profile joins the existing set. Determinism: one seed, fixed clock, seeded identifiers.

## 12. Seams & deferrals

Deferred with a named home: the `ledger.fiscal_year_start` firm setting, which lands with 3·6, its
first reader; the QuickBooks adapter Worker and bank feed (Phase 7·2); vendor payment
runs and payment execution (Phase 6 rails, a Workflows saga); posted closing entries and materialized
period-end snapshots (only if measured); `hard_locked_through` enforcement (a future inalterability
jurisdiction); denormalized `matter_type_id` on the line (only if practice-area roll-ups measure slow);
statement rendering, export, and scheduling (3·6); the user interface (follows the design-system
ledger-voice components, as 3·1 and 3·3 do).

## 13. Decisions to record

Four ADR fragments in `docs/decisions/pending/`:

1. **Posting dimensions on `ledger_line`** — amends ADR-0072. Accounts enforce bounds; dimensions
   enable segmentation; the trust subledger keeps child accounts.
2. **Fiscal-period close as a monotonic lock date** — scalar over period rows; soft close, permissioned
   and audited; retained earnings computed, never posted.
3. **Chart-of-accounts product and the firm-scoped account resolver** — seed-and-fork with stable
   semantic keys; closes slice-map coordination pin 4.
4. **Accounts payable as a liability subledger** — disbursement-class debit routing; the payable and
   the recoverable cost are separate records committed in one batch by the route.

Plus a `changelog.d/` fragment and a `status.d/` fragment. None of the rendered files is edited on this
branch.

## 14. Starting anchors on `main`

`packages/ledger/src/validate.ts` (period close is stated as a consumer rule) ·
`packages/ledger/src/reverse-entry.ts` (reversal takes a fresh effective date) ·
`packages/ledger/src/normal-balance.ts` (the derivation) ·
`packages/ledger/src/fitness.ts` (the re-proof pattern) ·
`packages/database/src/per-firm-schema.ts` (`ledger_account`, `ledger_line`, `cost_entry`) ·
`packages/database/test/schema-conformance.test.ts` (the column-name gate) ·
`apps/worker/src/routes/files.ts` (multi-service effect composition) ·
`packages/fixtures/src/demo-chart-of-accounts.ts` (explicitly not the product chart).
