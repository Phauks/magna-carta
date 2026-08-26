# Slice 3·5 — Operating accounting / general ledger — implementation plan

Companion to [`2026-08-17-general-ledger-design.md`](2026-08-17-general-ledger-design.md). Ordered,
reviewable steps. **Every sub-slice leaves `main` shippable and is useful with nothing after it
built** — the boundaries were chosen for that property rather than for even size.

**Supersedes** the implementation plan on the dormant `slice-3-5-operating-general-ledger` branch.
Two of its tasks are unbuildable as written (a `cost_entry.source` CHECK widening, and a
`semantic_key` resolver that would sit beside the shipped `firm_account_role` map); the design's
section 0.3 records why.

---

## Sub-slice order, and why

```
3·5·1 Chart of accounts + the role map's new home   ──►  3·5·2 General journal + period close
        │                                                          │
        └──────────────►  3·5·3 Financial statements  ◄────────────┘ (statements do not need the lock,
        │                                                             but a lock makes them mean more)
        └──────────────►  3·5·4 Accounts payable
        └──────────────►  3·5·5 The accounting integration seam
```

- **3·5·1 first**, because everything else posts into or reads from the chart, and because it closes a
  live gap on `main` on its own: billing currently refuses to finalize an invoice whose account roles
  are unmapped, and there is no product surface to map them. This sub-slice is the one that makes
  billing usable, which is a reason to ship it before anything else in this slice.
- **3·5·2 second.** The journal needs somewhere to post. The period lock wants to land while there are
  four posting paths rather than ten — the build-when-in-the-area case for a check inside the primitive.
- **3·5·3 third.** Statements need classification (3·5·1) and are honest with or without the lock;
  putting them after 3·5·2 means a closed period is a thing they can label rather than a thing they
  cannot see.
- **3·5·4 fourth**, because it is the only sub-slice that coordinates with another slice's table
  (3·3's `cost_entry`), and nothing else waits on it. Its accounts appear on the balance sheet through
  the `accounts_payable` role classified in 3·5·1, so 3·5·3 does not need revisiting.
- **3·5·5 last and small.** It is a category registration, a descriptor, a dispatch record and two
  fitness scans. The adapter is Phase 7·2.

**If the owner cuts period close (flag G3), remove 3·5·2's close half and keep its journal half.**
Nothing in 3·5·1, 3·5·3, 3·5·4, or 3·5·5 reads the lock.

---

## Global constraints

Stated once; they bind every task.

- **Owner flags gate what is built.** G1 (starter chart) gates 3·5·1's seed task. G3 (is close in
  scope) gates half of 3·5·2. G10 and G11 (the two extractions) gate 3·5·1 Task 1 and 3·5·3 Task 1.
  G12 gates where the lock check goes. Everything else shapes output and blocks nothing.
- **One posting primitive.** No task composes a `ledger_entry` or `ledger_line` insert, updates
  `account_balance`, or reaches a trust table. Every posting goes through `postEntry`; every account is
  created through `createAccount`. The source scan that asserts this lands in 3·5·1 Task 1, **before**
  the first line of service code, so nothing is ever written into a package the scan does not yet
  police.
- **Nothing this slice adds may reach a trust-registered account.** The refusal resolves through
  trust's own `loadTrustAccountRoles` and is never reimplemented locally. Applies to the journal, the
  role configuration, the vendor bill, and the bill payment.
- **Nothing is materialised.** No rollup table, no cached total, no period-end snapshot, no closing
  entries. If a measurement demands relief, the first thing to reach for is the
  `ledger_line.effective_date` denormalization argued in the design — written by the ledger package
  inside the posting batch, never backfilled by a reader.
- **Bitemporal or live, never ambiguous.** A statement read takes `(periodStart, periodEnd, knownAsOf)`
  and filters both axes. A read that cannot honour `knownAsOf` does not accept the parameter, and its
  response carries `computedAt`.
- **Refuse rather than default.** An unmapped role, an unclassified account, a statement that does not
  foot, a trust account where an operating account belongs — each refuses by a named error that says
  what to do next. Nothing resolves to a plausible fallback.
- **Money discipline.** Integer minor units at every SQL boundary through the money package's guard.
  Statement aggregation rounds half-even through the ledger boundary; the half-up invoice and tax modes
  must not appear in this slice.
- **Injected clock and randomness.** No wall-clock read, no ambient randomness — `ClockPort` and
  `randomSource` only, so a fixture run is deterministic.
- **Pure services, committed by the caller.** Each service takes `(database, input, options)` and
  returns `{ effect }`; the route commits through `runIdempotentEffect`. No package holds a D1 binding.
- **Golden rule 13 binds the code.** No source comment, test name, config value, or OpenAPI
  `description` may cite an ADR, a spec, a slice number, or a plan task. State the reasoning inline or
  point at a file by path. A forward-looking schedule note ("the adapter lands in Phase 7·2") is the
  one permitted shape. `pnpm run lint:process-refs` is the gate.
- **Golden rule 12 binds the names.** `@magna-carta/general-ledger`, `@magna-carta/account-roles`,
  `@magna-carta/accounting-periods`; `resolveAccountRole`, not `resolveRole`; "the data-access layer",
  never an abbreviation.
- **Migrations.** Four across the slice (3·5·1, 3·5·2, 3·5·4, 3·5·5). Each is registered in
  `apps/worker/src/per-firm-migrations.ts` **as well as** the drizzle journal, and every hand-written
  migration refreshes the per-firm snapshot in the same commit. Timestamp ids, never `00NN`. A CHECK is
  never widened against a table holding data.
- **Every enumerated column carries an explicit DDL CHECK.** Drizzle text enums are type-level only;
  the ledger's own `direction` and `type` columns already state this reasoning.
- **Docs are part of the task.** A `changelog.d/` fragment, the `status.d/3-5-operating-general-ledger.md`
  update rendered with `vp run status-build`, the `roadmap.d/financial.md` node evidence re-rendered
  with `vp run register-build`, and a `docs/user/` guide for any surface a person operates.
- **Cross-cutting edits go behind a sync.** `packages/ledger/src/statements.ts`,
  `packages/access-control/src/registry.ts`, `packages/identifiers/src/registry.ts`,
  `packages/database/src/per-firm-schema.ts`, and `apps/worker/src/per-firm-migrations.ts` are
  contended. Run `vp run worktrees` and sync `main` before touching one.

## Commands

```
pnpm install                                    # first in the worktree
pnpm exec vp run bootstrap                      # second
pnpm check:scoped                               # inner loop
pnpm test packages/general-ledger               # filter by PATH, never by test name
pnpm run lint:process-refs                      # golden rule 13
node packages/fixtures/src/load-profile/measure-cli.ts
pnpm --filter @magna-carta/database run refresh-per-firm-snapshot
```

---

# Sub-slice 3·5·1 — The chart of accounts, and the role map's new home

**Shippable alone, and it closes a real gap:** after this, a firm can see and configure its chart, and
billing stops refusing to finalize invoices for want of a mapping surface.

## Task 1 — The two leaf packages, and the source scans, before any service code

Both extractions are refactors of shipped code with a no-behaviour-change gate, so they go first and
land as their own reviewable commit.

- **`@magna-carta/account-roles`** — extract `packages/billing/src/account-roles.ts` and its test into
  a pure leaf: the role vocabulary, the map read, the resolver that refuses by name, the configuration
  composer, and the statement builders. `@magna-carta/billing` imports from the leaf; **no billing
  behaviour changes, no stored row moves, `firm_account_role` is untouched.** The gate is billing's
  existing test suite passing unmodified except for import paths.
- **Add the declared type per role** to the vocabulary — the static role-to-`AccountType` table the
  configuration guard needs. Data only in this task; the guard lands in Task 4.
- **`@magna-carta/general-ledger`** — the new domain package. `package.json`, `tsconfig` registered
  through `tooling/tsconfig-refs`, no barrel, one `exports` subpath per file, no D1 binding.
- **`test/purity.test.ts`** — the source scan, modelled on `packages/reporting/test/purity.test.ts`
  and on billing's no-trust-statement scan. Over this package's own sources it rejects: any
  `INSERT INTO ledger_entry` / `ledger_line`, any `UPDATE account_balance`, any `trust_` statement
  literal, and any import of a trust composer. It asserts it has sources to check, so it cannot pass
  vacuously.

**Done when** the purity scan runs green over a package holding only its types, billing's suite passes
against the extracted leaf with no test edited beyond an import, and `pnpm check` is clean.

## Task 2 — The chart columns

Migration 1 of 4. Additive only; the five-value `type` CHECK is untouched.

- `ledger_account.code` (text, nullable) with a **partial unique index** where non-null.
- `ledger_account.statement_section` (text, nullable) with a **DDL CHECK constraining the section to
  the account's `type`** — the closed vocabulary per type, spelled out in the migration.
- `ledger_account.system_account` (integer, default 0, CHECK in `(0,1)`).
- `ledger_account.description` (text, nullable).
- Index on `statement_section` (every statement read groups by it).

Update `packages/database/src/per-firm-schema.ts` to match, refresh the per-firm snapshot in the same
commit, and register the migration in `apps/worker/src/per-firm-migrations.ts`.

**Done when** a migration test asserts each CHECK and the partial unique index enforce, the lineage
applies to a fresh database, and `check-snapshots` reports no drift.

## Task 3 — The trust-registration read, in the trust package

`selectTrustRegisteredLedgerAccountsStatement` in `packages/trust/src/statements.ts` — that package
owns SQL over its own tables and keeps it inside the schema-name-sync net. It returns, for a set of
ledger account ids, which are a trust bank leaf, which a client-liability root, and which a
`trust_ledger_node` of each kind, with the trust account they belong to.

A thin `readTrustRegisteredAccounts` beside it. This is a **read** — nothing in trust changes, and the
edge runs `general-ledger` → `trust`, the same direction billing already takes.

**Done when** the read distinguishes all five registered kinds and returns nothing for an ordinary
operating account, over the node-sqlite substrate.

## Task 4 — The chart service and the three configuration guards

`packages/general-ledger/src/chart.ts`:

- `createChartAccount` / `renameChartAccount` / `renumberChartAccount` / `reclassifyChartAccount` /
  `deactivateChartAccount`, each returning an effect. Creation goes through `createAccount` so the
  leaf-only and parent-match guards run and the balance row lands in the same batch.
- **A trust-registered account is read-only through this surface**, refused by name.
- **A system account may be renamed and renumbered, never deactivated and never re-typed**, refused
  by name.
- **`type` is immutable on an account carrying lines** — pre-check through
  `selectAccountHasLinesStatement`, which already exists.
- `readChartOfAccounts` — the tree with codes, types, sections, balances, the system-account marker,
  and, for each row, whether it is trust-registered and therefore read-only, with the reason as a
  named value rather than prose the surface has to invent.

`packages/general-ledger/src/role-configuration.ts` — the three guards in front of the extracted
configuration composer:

1. **No trust-registered account** (`role-account-is-trust-registered`), resolved through Task 3.
2. **No parent account** (`role-account-is-a-parent`) — `selectAccountSnapshotsStatement` already
   returns `has_children`.
3. **The account's `type` matches the role's declared normal balance**
   (`role-account-type-mismatch`), from Task 1's table.

Each refusal names the role, the account, and what to do next, in the shape `resolveAccountRole`'s
refusal already takes.

**Done when** each guard has a unit test that a wrong configuration is refused and a right one
accepted, and a test asserts a trust-registered account cannot be renamed, reclassified, or mapped
through any path in this package.

## Task 5 — The two new roles

`accounts_payable` (liability) and `owners_equity` (equity) added to the role vocabulary in the
extracted leaf, and to the `firm_account_role` DDL CHECK.

**Do not start this task without reading
[`2026-08-26-account-role-vocabulary-widening.md`](2026-08-26-account-role-vocabulary-widening.md).**
The payments slice needs the same widening for two roles of its own and opens first; if it has already
done the rebuild for all four, this task is an edit to `ACCOUNT_ROLES` and nothing else.

**This is a CHECK widening on a table that holds data**, and it is the one place in this slice where
that is unavoidable. `firm_account_role` is a small configuration table with at most one row per role,
so the expand path is a **new table plus a data-copying migration plus a view-less cutover**, not an
in-place widen — the same care `invoice_delivery`'s note demands. Write it as a hand-written migration
with the copy, register the new CHECK, and assert in the migration test that every pre-existing row
survives with its mapping intact.

**Alternative, if the owner prefers no rebuild:** hold the two new roles in a sibling table keyed the
same way, resolved through the same function. It is uglier and it is strictly safer; note the choice in
the pull request rather than deciding it silently.

**Done when** a firm with nine mapped roles migrates to eleven with all nine mappings unchanged, and
`resolveAccountRole` refuses the two new ones by name until they are mapped.

## Task 6 — The starter chart (gated on flag G1)

If the answer is yes: a seed migration writing `system_account` rows for the accounts the platform's
own roles need plus a short list of common law-firm expense accounts, each with a code and a section,
seeded conditionally on the table being empty so a firm that already has a chart keeps it — the same
conditional seeding trust's default authorization posture uses.

**No role mapping is seeded.** The mapping is where money goes, and a platform-chosen mapping is the
platform deciding which account a firm's fee income lands in.

If the answer is no: this task is skipped and the unmapped-role refusal remains the whole of the
onboarding gate.

## Task 7 — Permissions, identifiers, routes

- `ledger:viewChart`, `ledger:manageChart` in `packages/access-control/src/registry.ts`, binding
  `resource: "firm"`, seeded per flag G14. Sync `main` first — the registry is contended.
- No new identifier prefixes yet (accounts use the existing `ledgerAccount` prefix).
- Routes through the chokepoint, each with full `RouteMeta`, problem responses RFC 9457:
  `GET /api/v1/ledger/accounts`, `POST /api/v1/ledger/accounts`,
  `PATCH /api/v1/ledger/accounts/{ledgerAccountId}`, `GET /api/v1/ledger/account-roles`,
  `PUT /api/v1/ledger/account-roles`.
- These are the ledger's first HTTP surface. Re-emit the committed OpenAPI snapshot and regenerate
  `@magna-carta/api-client`; neither is hand-edited.

## Task 8 — Fitness, docs, and the roadmap

- Fitness queries 2, 3, 4, 5 and 6 of the design's section 15, behind one
  `assertGeneralLedgerFitness`, each with a non-vacuity test.
- `docs/user/features/chart-of-accounts.md` — what the chart is, what a role mapping does, why a trust
  account cannot be edited or mapped, and what an unmapped role stops. User language only.
- `changelog.d/` fragment; `status.d/3-5-operating-general-ledger.md`; `roadmap.d/financial.md` node
  evidence, then `vp run register-build`.

---

# Sub-slice 3·5·2 — The general journal and period close

**Shippable alone:** a firm can post an opening-balance journal entry, correct it by reversal, and
close a month. The close half is cut cleanly if flag G3 says no.

## Task 1 — The periods leaf

`@magna-carta/accounting-periods` — a pure leaf, no input and no output, on the `billing-core` model.

- `assertPostingAllowed({ effectiveDate, lockedThrough, hardLockedThrough, isReversal })` and its
  error type. Pure: the lock values arrive pre-loaded, exactly as the ledger's account snapshots do,
  so nothing here can be planned "between" statements of a batch D1 will not let us interleave with.
- **A reversal is exempt** from the closed-period refusal on the original's date and subject to it on
  its own — the rule that stops a lock trapping a correction.
- The **temporal contract** moved down from `@magna-carta/reporting` (flag G11): the period type, its
  validation, and the live-mode type. `@magna-carta/reporting` imports from here; its tests pass
  unmodified beyond import paths.

**Done when** the leaf has unit tests for a date inside the window, at the boundary, before the lock,
before the hard lock, and for the reversal exemption; and reporting's suite passes against the moved
contract with no test edited beyond an import.

## Task 2 — The lock tables and the posting dimensions

Migration 2 of 4.

- `accounting_lock` — one row per firm database, `id` pinned to a constant by CHECK;
  `locked_through` and `hard_locked_through` (civil dates, nullable, **each with a DDL CHECK asserting
  it parses as a date** — that CHECK is what section 8.5's race guard aims at), `updated_at`.
- `period_close_event` — append-only with three RAISE(ABORT) triggers including the BEFORE INSERT
  guard that catches `INSERT OR REPLACE`: `action` (`close` | `reopen`, DDL CHECK), `closed_through`,
  `previous_locked_through`, `actor_user_id`, `reason` (non-empty CHECK), `created_at`.
- `general_journal_entry` — append-only, three triggers: `id`, `entry_id` (the ledger entry, UNIQUE),
  `memo`, `reason` (nullable; required when the entry reverses one, by shape CHECK), `actor_user_id`,
  `created_at`.
- `ledger_line.matter_id` and `ledger_line.location_id` — nullable, foreign-keyed, each indexed.

**Done when** the migration test asserts every CHECK and trigger enforces — including that an
`INSERT OR REPLACE` against a `general_journal_entry` row aborts — and the snapshot is refreshed.

## Task 3 — The lock check inside the posting primitive (gated on flag G12)

In `packages/ledger`:

- `postEntry` loads the `accounting_lock` row alongside the account snapshots it already reads.
- `validateEntry` gains a pre-loaded `lockedThrough` / `hardLockedThrough` input and calls
  `assertPostingAllowed`. It stays pure.
- The **race guard** rides every posting batch: a statement aimed at the singleton lock row that
  matches nothing when the lock has not moved and violates the date CHECK when it has, so a stale read
  aborts its whole batch — the entry, the lines, the balances, the idempotency record, and the outbox
  row together. This is billing's `refuseFinalizeOnFrozenWorkInProgressStatements` pattern; a guarded
  UPDATE would look safer and would be strictly worse, because a zero-row UPDATE aborts nothing.

**This changes shipped behaviour**: a trust movement or an invoice finalization backdated into a closed
period now refuses by name. Trust's and billing's suites are the regression surface, and their
existing tests must be read before this task rather than after it fails them.

**Done when** the race test passes: compose a posting against a read lock value, move the lock in a
second batch, commit the first, and assert nothing from it landed.

## Task 4 — The general journal service

`packages/general-ledger/src/journal.ts`:

- `composeGeneralJournalEntry` — validates the lines in memory, resolves every account through
  **trust's** `readTrustRegisteredAccounts`, refuses `journal-entry-touches-trust` unless every line
  is outside trust (naming the account and pointing at the trust movement path), then hands off to
  `postEntry`. Composes the `general_journal_entry` row in the same effect. Populates `matter_id` and
  `location_id` on each line where the caller gave them.
- `reverseGeneralJournalEntry` — `reverseEntry` with a caller-supplied effective date, plus a
  `general_journal_entry` row naming the reversed entry and carrying the **required** reason.
- Identifiers: `generalJournalEntry`, `periodCloseEvent` in `packages/identifiers/src/registry.ts`,
  spelled out in full.

**Done when** each of the five trust-registered account kinds is refused by name, an operating-only
entry posts, an unbalanced entry is refused by `validateEntry` and not by a local copy of the rule, and
a reversal of a closed-period entry into the open window commits.

## Task 5 — The close service

`packages/general-ledger/src/period-close.ts`:

- `closeAccountingPeriod` — monotonic; refuses a date at or before the current `locked_through` by
  name; writes the lock update and the append-only event in one effect.
- `reopenAccountingPeriod` — moves the scalar back, requires a reason, writes the event. **Refuses if
  the target date is at or before `hard_locked_through`**, and no permission overrides that.
- `readAccountingLock` and `readPeriodCloseEvents`.
- No route ever sets `hard_locked_through` (flag G6).

## Task 6 — Permissions, routes, fitness, docs

- `ledger:post`, `ledger:closePeriod`, `ledger:reopenPeriod`.
- `POST /api/v1/ledger/journal-entries`, `POST /api/v1/ledger/journal-entries/{ledgerEntryId}/reverse`,
  `GET /api/v1/ledger/period-lock`, `POST /api/v1/ledger/period-lock/close`,
  `POST /api/v1/ledger/period-lock/reopen`. OpenAPI snapshot re-emitted, client regenerated.
- Fitness queries 1 and 7 of the design's section 15.
- `docs/user/features/general-journal-and-period-close.md` — what a journal entry is for, why it cannot
  touch a trust account, that a correction is a reversal and never an edit, and what closing a period
  does and does not prevent.
- Changelog, status, roadmap fragments.

---

# Sub-slice 3·5·3 — The financial statements

**Shippable alone**, and it is the first sub-slice a firm's accountant asks for.

## Task 1 — The temporal contract, in place

Already moved in 3·5·2 Task 1. This task only confirms that the general-ledger statement functions
take the same triple, and that a live read carries `computedAt` and refuses a `knownAsOf` it cannot
honour rather than accepting and ignoring one.

## Task 2 — The ledger reads

Near `packages/ledger/src/statements.ts`, so the SQL stays inside the schema-name-sync net — **and
that file is contended, so sync `main` and check `vp run worktrees` first.**

- **Balances by account, as-of the triple** — every account's net in normal-balance terms from
  `ledger_line` joined to `ledger_entry`, filtered on both axes, aggregated **in SQL**. Never
  `account_balance`, which is a live figure with no as-of — the rule trust's proof already holds.
- **Period movement by account** — the same read bounded below by `periodStart`, for the income
  statement.
- **Section subtotals** — grouped by `statement_section`, so a statement is a handful of rows rather
  than a table streamed into the Worker.

**Done when** each read has boundary tests: an entry on `periodEnd`; an entry backdated into the
period but recorded after `knownAsOf` (absent); a reversal recorded after `knownAsOf` (absent, with
its target still present).

## Task 3 — Assembly, and the four refusals

`packages/general-ledger/src/statements/`:

- **Trial balance** — per account, with its own assertion that debits equal credits; **refuses**
  `trial-balance-does-not-foot` rather than printing.
- **Balance sheet** — sections, with computed retained earnings (`Σ(income − expense)` to the cutoff,
  never posted and never stored) beside the `owners_equity` balance, labelled separately; **refuses**
  `balance-sheet-does-not-balance`; **refuses** `trust-sections-do-not-net` when the trust asset and
  client-liability sections disagree (flag G16's include arm), naming the trust account and the
  difference.
- **Income statement** — income less expense for the period, by section.
- Every one **refuses** `account-not-classified` naming the accounts that need a section, rather than
  dropping them (the statement would not foot) or lumping them into "other" (that asserts a
  classification nobody made).
- Half-even rounding through the money package's ledger boundary only.

**Done when** an agreement test over the load-profile fixture book proves the balance sheet's trust
sections equal trust's own client-ledger and firm-funds totals — read through **trust's** functions,
not re-summed here — and each refusal has a test that reaches it.

## Task 4 — Reproducibility

Its own task, because it is the property the sub-slice exists to deliver. Assemble a trial balance at
`knownAsOf = T`; post a backdated entry with `recorded_at > T`; re-assemble at `T` and assert every
integer identical; re-assemble live and assert the figures moved and the labelling says so.

Add the negative-space regression: a test that fails if `@magna-carta/general-ledger` ever reads
`account_balance` to answer a statement question.

## Task 5 — Routes, load profile, docs

- `ledger:viewStatements`; `GET /api/v1/ledger/trial-balance`, `/balance-sheet`, `/income-statement`.
  A request whose period would exceed the measured budget refuses by name rather than degrading.
- `packages/fixtures/src/load-profile/general-ledger-measurements.ts` — trial balance and balance sheet
  at one month and at twelve, over a `GeneralLedgerVolume` sub-profile added to
  `packages/fixtures/src/load-profile/profile.ts`. Record the baseline. **If the account-and-date join
  is the cost centre, this is where the `ledger_line.effective_date` denormalization is argued** — with
  the measurement, in an ADR, implemented in the ledger package's posting batch if accepted, and not
  before.
- `docs/user/features/financial-statements.md` — what each statement says, what the two dates mean,
  and why a statement refuses instead of printing an approximate figure.
- **The cash-basis view is not built here** (flag G2). Named in the user guide as absent, with the
  reason: a derived cash figure is not a tax basis.

---

# Sub-slice 3·5·4 — Accounts payable

**Shippable alone**, and it is the sub-slice that closes billing's documented open position — Client
Costs Advanced running negative until operating disbursements land.

## Task 1 — Coordinate with the costs slice before writing anything

3·3 owns `cost_entry`. This sub-slice adds no column to it and widens no CHECK on it; the link lives on
`vendor_bill_line.disbursement_entry_id`, and provenance is derived from that link rather than from a
fourth `source` value. Confirm with whoever owns `packages/costs` that a bill-originated cost entering
at `draft` (flag G8) fits their review flow, and read `packages/costs/CLAUDE.md` immediately before
composing anything.

## Task 2 — The tables

Migration 3 of 4. Every enumerated column carries an explicit DDL CHECK.

- `vendor_bill` — `id`, `vendor_id`, `bill_reference`, `bill_date`, `due_date`, `amount_minor`,
  `currency` (`USD` CHECK), `entry_id`, `created_at`, `created_by`. Append-only except nothing: the
  header is frozen from birth by three triggers, because a bill is an evidence record and its
  correction is a reversal.
- `vendor_bill_line` — `id`, `vendor_bill_id`, `line_index` (unique per bill), `amount_minor`,
  `disbursement_class` (`hard` | `soft`, CHECK), `matter_id` (nullable), `location_id` (nullable),
  `disbursement_entry_id` (nullable, references `cost_entry.id`), `ledger_account_id`, `description`.
  The column is **not** named `cost_entry_id`: the schema conformance gate refuses a money-ish column
  name without a `_minor` or `_rate_e4` suffix, and 3·3 adopted the same vocabulary for the same
  reason.
- `vendor_bill_balance` — `vendor_bill_id` primary key, `amount_minor` frozen by shape trigger,
  `paid_minor` with a **bounds CHECK** `0 <= paid_minor <= amount_minor`, `updated_at`. The delta
  statement is deliberately **unguarded**: the CHECK is the guarantee, and a guarded UPDATE cannot
  abort a batch.
- `vendor_bill_payment` — append-only, three triggers: `id`, `vendor_bill_id`, `entry_id`,
  `amount_minor`, `paid_on`, `method`, `actor_user_id`, `created_at`.
- `vendor_bill_reversal` — append-only: `id`, `vendor_bill_id` (UNIQUE), `entry_id` (the reversing
  entry), `reason` (non-empty CHECK), `actor_user_id`, `created_at`.
- A trigger refusing a payment against a reversed bill.
- Identifiers: `vendorBill`, `vendorBillLine`, `vendorBillPayment`, `vendorBillReversal`.

**Done when** the migration test asserts the bounds CHECK aborts an overpayment, the frozen-header
triggers abort an UPDATE and an `INSERT OR REPLACE`, and a payment against a reversed bill aborts.

## Task 3 — Recording a bill

`packages/general-ledger/src/vendor-bill.ts`:

- `recordVendorBill` — validates the lines, **refuses any line naming a trust-registered account**
  through the same read the journal uses, resolves `accounts_payable` through the role map, composes
  one `postEntry` with the routed debits:
  - `hard` → `Dr Client Costs Advanced` (resolved through `client_costs_advanced`, line tagged with
    `matter_id`) `/ Cr Accounts Payable`. **No profit-and-loss impact** — an advanced client cost is a
    loan to the client, not the firm's deductible expense; misrouting it is a tax error, and the
    comment in the code states that reasoning without citing a process document.
  - `soft` → `Dr <the line's own expense account> / Cr Accounts Payable`. A line with no expense
    account **refuses** — there is deliberately no default expense account, because a plausible
    fallback makes a misposting invisible.
- Returns its statements; **does not** capture the cost.

**The route composes both writes into one batch.** `recordVendorBill` returns its statements, 3·3's
cost capture returns its own, and the route spreads both into one `runIdempotentEffect`. Neither
package imports the other. A single service owning both would buy atomicity a shared batch already
provides at the price of a wrong dependency edge; an outbox message would introduce eventual
consistency to solve a problem one batch solves, and would misuse the outbox, which exists for
external consequences.

**Done when** an end-to-end test walks a hard-cost bill from entry through the cost entry it created,
through invoice finalize, asserting the profit-and-loss is untouched and Client Costs Advanced clears;
and a soft-cost bill asserts the expense lands and reimbursement is income.

## Task 4 — Paying a bill, and reversing one

- `recordVendorBillPayment` — resolves `operating_bank` through the role map and takes **no
  caller-supplied cash account** (flag G7). Composes `Dr Accounts Payable / Cr Operating Bank`, the
  payment row, and the bounds-checked `paid_minor` delta in one effect. **Executing** the payment at a
  bank is out of scope; this records that the firm paid.
- `reverseVendorBill` — `reverseEntry` on the bill's entry plus the append-only reversal row with its
  required reason. Vendor credits are named later, not half-built.

**Done when** two payments racing for one remainder abort rather than overpay, and a payment against
a reversed bill is refused.

## Task 5 — Aging, permissions, routes, fitness, docs

- `readAccountsPayableAging` — buckets **in SQL**, per vendor and per office, on both temporal axes,
  the same shape the receivables aging read already has and for the reason its comment gives.
- `accountsPayable:viewBills`, `accountsPayable:manageBills`.
- `POST /api/v1/accounts-payable/bills`, `GET /api/v1/accounts-payable/bills`,
  `GET /api/v1/accounts-payable/bills/{vendorBillId}`,
  `POST /api/v1/accounts-payable/bills/{vendorBillId}/payments`,
  `POST /api/v1/accounts-payable/bills/{vendorBillId}/reverse`,
  `GET /api/v1/accounts-payable/aging`.
- Fitness queries 8 and 9 of the design's section 15.
- `docs/user/features/accounts-payable.md` — entering a bill, what hard versus soft does to the books
  and to what the client can be charged, recording a payment, and correcting a bill entered in error.
- Load-profile measurements for the aging read; changelog, status, roadmap fragments.

---

# Sub-slice 3·5·5 — The accounting integration seam

**Small, last, and explicitly not the adapter.** Its whole job is to fix the direction so a future
adapter cannot become a system of record.

## Task 1 — The category and its export-only descriptor

- Register the `accounting` category with a `CapabilityDescriptor` declaring **export operations
  only**. There is no `pullJournal`, no `applyRemoteEntry`, no `fetchBalance`, and no
  `reconcileAgainstRemote` — a capability that does not exist cannot be called by a future route.
- Credential requirement: OAuth at firm scope, so the framework's refresh lock applies unchanged and
  credentials live in the envelope-encrypted per-firm secret store with an integration connection
  grant. No adapter receives key material.

## Task 2 — The dispatch record

Migration 4 of 4. `accounting_export_dispatch` — append-only, three triggers: `id`, `entry_id`,
`connection_id`, `dispatched_at`, `outcome`, `remote_reference` (nullable), `detail` (nullable).

**It records that a fact left. It has no column that could hold a fact that came back.** No
`quickbooks_id` on `ledger_entry`, no `external_balance` anywhere, no table reconciling the two books
— the load-bearing schema decision in this sub-slice, because the day a remote balance column is
rendered beside the platform's own figure, a reader has two answers and no rule about which is right.

## Task 3 — The change-feed consumer

A per-firm queue consumer on `LEDGER_ENTRY_POSTED_TOPIC`, which `postEntry` already emits: dedup on
the outbox row id, resolve the connection, dispatch through the port, write the dispatch row.
Idempotent and overlap-safe like every other consumer. With no adapter registered the consumer
resolves nothing and records nothing — the dispatch outcome shape a missing adapter already has, not a
throw.

**On conflict, the platform does nothing and says which nothing.** An export refusal is a dispatch
outcome: recorded, retried through the outbox, surfaced through the standard error pipeline with a
correlated identifier. A divergence caused by somebody editing the remote is **not detectable and must
not be simulated** — detecting it needs a read of remote balances, which is exactly the read that would
make the remote authoritative. The user guide says so in those words.

## Task 4 — The two scans, and the documentation that carries the posture

- A fitness assertion rejecting any operation name in the accounting category matching an import
  shape, so the absence in Task 1 is enforced rather than observed.
- A source scan asserting no domain package imports the accounting adapter port and that the port
  surface returns no monetary figure into one.
- `docs/user/features/accounting-export.md` — the platform's books are the firm's books; the export is
  a convenience for the firm's accountant; an edit made on the far side does not come back. Plain
  language, no architecture.
- **The bank feed is reserved and nothing else.** Named in the guide as a later capability whose shape
  will mirror the trust bank statement and its matching, because a bank statement is evidence rather
  than a competing book. No table, no port method, no column now — reserving a shape for an importer
  whose reconciliation surface does not exist would be designing the retrofit in.

---

# Named later, deliberately not half-built

- **Cash receipts** — the payments subsystem's first slice. Until it lands, the operating bank balance
  moves only through a typed journal entry, and the user documentation says so.
- **Operating bank reconciliation** — needs an operating statement importer and the payments clearing
  account. Trust's reconciliation is the template; follow it rather than invent a second shape.
- **Vendor credits, recurring bills, purchase orders, 1099 tracking** — each its own design.
- **Payroll** — firms use a provider; the books receive a journal entry.
- **Per-office and per-matter income statements** — the dimension columns land in 3·5·2 and the paths
  that produce income do not write them yet. A partial figure presented as a whole one is the worst
  outcome available.
- **Profitability** — no timekeeper cost rate exists anywhere in the schema, and approximating it from
  billing rates produces a number that looks like margin and is not.
- **A cash-basis presentation** — flag G2; its own small design.
- **Multi-currency** — a schema change, not a silent extension.
- **The `ledger_line.effective_date` denormalization** — argued from 3·5·3's measurement or not at all.
- **The QuickBooks adapter Worker and the bank feed** — Phase 7·2.
- **Every screen** — the deferred surfaces are named in the design with what each must show.

---

# What blocks what

| Sub-slice | Blocked by                                                        | Blocks                                        |
| --------- | ----------------------------------------------------------------- | --------------------------------------------- |
| 3·5·1     | Flags G1, G10, G14. Nothing on `main`                             | 3·5·2, 3·5·3, 3·5·4                           |
| 3·5·2     | 3·5·1; flags G3, G4, G5, G6, G11, G12                             | Nothing — 3·5·3/4/5 do not read the lock      |
| 3·5·3     | 3·5·1; the temporal move in 3·5·2 Task 1; flag G2, G16            | Reporting's rendering of the three statements |
| 3·5·4     | 3·5·1; flags G7, G8, G9; a coordination read with the costs slice | Nothing                                       |
| 3·5·5     | 3·5·1; flag G13                                                   | Phase 7·2's adapter                           |

None of the five needs a screen, a payment rail, or an adapter to be worth shipping.
