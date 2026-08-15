# Slice 3·6 — Financial and trust-compliance reporting — implementation plan

Companion to [`2026-08-13-financial-reporting-design.md`](2026-08-13-financial-reporting-design.md).
Ordered, reviewable steps. **Slice 1 is the bar-audit pack and is useful alone** — a firm can hand
its output to an examiner with nothing else in this slice built. Slices 2–4 are the remaining three
report families; slice 5 is delivery, which none of the four needs in order to be useful.

---

## Global constraints

These bind every task below; they are stated once rather than repeated.

- **Read-only by construction.** `@magna-carta/reporting` composes nothing and imports no composer.
  The purity fitness function lands in the first sub-slice, before the first read, so no code is ever
  written into a package the scan does not yet police.
- **No second answer.** A quantity another package owns is read through that package's own function
  or statement. A decomposition ships with the agreement test that proves it sums to its aggregate.
  A pull request adding a report figure with neither is not complete.
- **No materialisation.** No rollup table, no cached total, no period snapshot. If the load profile
  demands relief, the first thing to reach for is the `ledger_line.effective_date` denormalization
  argued in the design — written by the ledger package in the posting batch, never backfilled by a
  report.
- **Bitemporal or live, never ambiguous.** A ledger-backed read takes
  `(periodStart, periodEnd, knownAsOf)`. A read that cannot honor `knownAsOf` does not accept the
  parameter at all, and its response carries `computedAt`.
- **Domain SQL lives in the domain package.** A new select over trust or billing tables is added
  there, under the schema-name-sync net; reads over the ledger's own tables go near
  `packages/ledger/src/statements.ts`. **`packages/ledger/src/statements.ts` is also touched by the
  dormant `slice-3-5-operating-general-ledger` branch** — sync `main` and check `vp run worktrees`
  before editing it.
- **Migration slots.** Two migrations across the whole slice (sub-slice 1·1 and 5·1). Register each
  in `apps/worker/src/per-firm-migrations.ts` as well as the drizzle journal.
- **Docs are part of the task, not after it.** Golden rule 5: a fragment in `changelog.d/`, the
  `status.d/3-6-financial-reporting.md` update, the `roadmap.d/reports.md` node evidence, and the
  user guide for any surface a person can operate.

## Commands

```
vp run bootstrap                    # once in the worktree
pnpm check:scoped                   # inner loop
pnpm test packages/reporting        # filter by PATH, never by test name
pnpm run lint:process-refs          # golden rule 13 — no ADR/slice citations in source
node packages/fixtures/src/load-profile/measure-cli.ts   # the measurement harness entry point
```

---

# Build sub-slice 3·6·1 — The bar-audit pack

The whole of slice 1. At its end a firm with a reconciled trust account can produce a document for a
regulator, and nothing else in this design needs to exist.

## Task 1 — Package scaffold, permissions, and the purity fitness function

- New pure package `@magna-carta/reporting`: `package.json`, `tsconfig` (registered through
  `tooling/tsconfig-refs`), no runtime dependency on anything holding a binding.
- `src/temporal.ts` — the `ReportingPeriod` type (`periodStart`, `periodEnd`, `knownAsOf | null`), its
  validation (civil dates, `periodStart <= periodEnd`, `knownAsOf` not in the future), and the
  `LiveOnlyPeriod` type used by the reads that cannot honor a knowledge instant.
- `src/completeness.ts` — the completeness declaration every response carries, shaped now to hold an
  excluded-matter count later without a response-shape change.
- `test/purity.test.ts` — the read-only fitness function (design, section 5, mechanism 1). Modelled on
  `packages/custodian/test/purity.test.ts`, including its non-vacuity assertion.
- `reports:trustCompliance`, `reports:financial`, `reports:productivity`, `reports:operational`,
  `reports:produce` in `packages/access-control/src/registry.ts`, plus the fitness assertion that no
  `reports:` key appears in a write path's guard. Seed migration to Owner/Admin.

**Done when** the purity scan runs green over a package that contains only the temporal and
completeness modules, and the permission registry test passes.

## Task 2 — The trust reads the pack needs

New `select…Statement` builders in `packages/trust/src/statements.ts` (that package owns SQL over its
own tables), each on both axes:

- **Client-ledger entries as-of** — per matter leaf under a trust account: entries with
  `effective_date` in the period and `recorded_at <= knownAsOf`, with direction, amount, description,
  and the movement or transfer that produced them.
- **Opening balance as-of** — the same shape as `selectTrustClientLedgerTotalAsOfStatement` but per
  leaf and at `periodStart − 1`.
- **Bank-leaf journal as-of** — entries touching the account's bank leaf, keyed on the **ledger
  entry** (never on `trust_movement`), left-joined to `trust_movement` and `trust_transfer` for the
  kind, reference, counterparty, and `authorized_by`.
- **Firm-funds movements as-of** — bounded to the account's single firm-funds node.
- **Reconciliations in period** — the frozen rows, whole, including `frozen_firm_funds_minor` with its
  `COALESCE(…, 0)` for rows predating the column.

Every one of these adds `recorded_at <= ?` to a filter the existing as-of statements do not carry.
The existing statements are **not** changed — the proof's contract is settled and this slice does not
move it.

**Done when** each builder has a unit test over the node-sqlite substrate covering the boundary
cases: an entry on `periodEnd`, an entry backdated into the period but recorded after `knownAsOf`
(absent), and a reversal recorded after `knownAsOf` (absent, and its target still present).

## Task 3 — Pack assembly

`src/trust-compliance/` in the reporting package: the seven sections of the design, assembled from
Task 2's reads plus `computeTrustThreeWayProof` and the frozen reconciliation rows, **called, not
reimplemented**.

- The reconciliation section pairs each frozen attestation with the live proof at `knownAsOf` and
  computes the difference between them, labelled — never a third figure.
- The cushion section is absent, not zero, on an account without the carve-out.
- Refusals propagate: `reconciliation-outstanding-items-truncated` and the four jurisdiction
  refusals surface as named pack-level refusals, and no partial pack is returned.

**Done when** `test/agreement.test.ts` passes over the load-profile fixture book: per-matter closing
balances sum to `selectTrustClientLedgerTotalAsOfStatement`; the journal's closing bank balance equals
`selectTrustBookBalanceAsOfStatement`; the cushion equals `selectTrustFirmFundsTotalAsOfStatement`.

## Task 4 — The reproducibility test

Its own task because it is the property the slice exists to deliver.

Produce a pack at `knownAsOf = T`. Post a backdated reversal with an effective date inside the period
and `recorded_at > T`. Re-run at `knownAsOf = T` and assert every integer is identical. Re-run live
and assert the figures moved, the frozen attestation did not, and the live/frozen labelling states
the difference.

Add the negative-space regression too: a test that fails if the reporting package ever grows its own
`SUM` over `ledger_line` restricted to trust node accounts.

## Task 5 — The read route

`GET /api/v1/reports/trust-compliance/{trustAccountId}` through the slice 0·5 chokepoint on
`reports:trustCompliance`, taking the temporal triple as query parameters, returning the pack as
JSON with its completeness declaration. Conformance test: every reports route is a GET on a
`reports:` read key.

Bounded scope only — one account, one period. A request whose period would exceed the measured budget
refuses by name and points at production (Task 6), rather than degrading.

## Task 6 — Production: the artifact and its record

The one write in the surface, and it is the caller's, not the package's.

- Migration: `report_production` (append-only; requester, temporal triple, scope, requested_at) and
  `report_production_completion` (append-only; the artifact's file version, content hash, completed_at,
  or the refusal). **No status column** — completion is derived from the presence of a completion row,
  the house pattern that keeps one off `trust_hold` and off `invoice_application`. RAISE(ABORT)
  triggers on both.
- `POST /api/v1/reports/productions` on `reports:produce`: validate, write the production row and one
  outbox message in a single batch, return the production id. Idempotency required.
- Queue consumer: assemble the pack, render it through the existing assembly-to-PDF conversion edge,
  file it as a File Manager version (which computes and stores the SHA-256 content hash at write),
  write the completion row. Idempotent on the outbox row id.
- `GET /api/v1/reports/productions/{id}` for status and the artifact reference.
- The cover snapshots the mutable captions of the design's section 2.4 — office identity, jurisdiction
  citation and corpus review state — onto the artifact, and carries the reproducibility statement in
  plain words.

## Task 7 — Load profile and documentation

- `packages/fixtures/src/load-profile/reports-measurements.ts`: the client-ledger read, the journal
  read, and whole-pack assembly, each at one month and at twelve, over the existing trust volume.
  Record the baseline. **If the journal read is the cost centre, this is where the
  `ledger_line.effective_date` denormalization is argued** — with the measurement, in an ADR, and
  implemented in the ledger package's posting batch if accepted.
- `docs/user/features/trust-compliance-reporting.md` — how a firm produces a pack, what each section
  is, and what the reproducibility statement means. User-facing language only; no architecture.
- Changelog fragment, `status.d/3-6-financial-reporting.md`, `roadmap.d/reports.md` evidence.

---

# Build sub-slice 3·6·2 — Financial reports

## Task 1 — Accounts-receivable aging, as-of

- New select in `packages/billing/src/statements.ts`: unpaid balance derived as the finalized-invoice
  totals on or before the effective date, less the signed sum of `invoice_application` rows on both
  axes (a `reversal` adds back). Bucketed **in SQL**, as the existing live read already is and for the
  reason its comment gives.
- `readAccountsReceivableAging` is untouched and remains the owner of the live answer.
- **The agreement test is the deliverable**: at `(asOf = today, knownAsOf = now)` the as-of derivation
  equals the live read bucket for bucket over the fixture book.
- Breakdowns by client, matter, and office, each proved to sum to the firm-wide buckets.

## Task 2 — Work in progress (live only)

Unbilled, unvoided time and cost by matter, client, timekeeper, office, from the mirror columns the
existing hot read already uses — no join to the claim table, for the reason
`readUnbilledWorkInProgress` documents.

The endpoint **does not accept `knownAsOf`**. The response carries `computedAt` and an explicit
`reproducible: false`. The user documentation says why in one sentence.

## Task 3 — Realization

Standard value recorded, value billed, value credited or written off, value applied, for a period.
Billed/credited/applied legs from invoice line snapshots and `invoice_application` — as-of
reproducible. The standard-value leg is live and labelled as such beside them. No blended figure that
mixes an as-of leg with a live one without saying so.

Vocabulary: **applied**, never **collected**, until a payment rail exists.

## Task 4 — Routes, per-office roll-ups, load profile, docs

GET routes on `reports:financial`; office subtotals through `matter.location_id`; measurements added
to `reports-measurements.ts`; user guide.

---

# Build sub-slice 3·6·3 — Productivity

Hours recorded by timekeeper, matter, client, UTBMS code, office; billable versus non-billable and
by non-billable category; the billable ratio; distribution across matters. Work date is the period
axis. **Live only**, on the same reasoning as work in progress, and stamped.

No attainment figure and no target — the platform stores none, and rendering one against a number the
firm never set would be the platform grading a lawyer's month. Named as a later addition to time
tracking.

Its own permission key (`reports:productivity`) is already registered in 3·6·1: a report about people
is a different grant from a report about money.

Routes, load profile, user guide.

---

# Build sub-slice 3·6·4 — Operational

Matters opened and closed by type and office; invoices drafted, finalized, voided; credit notes and
write-offs with their reasons; trust movements by kind; disbursement requests raised, approved,
rejected, withdrawn; cost entries by class; reconciliations opened and closed.

Counts over append-only tables carry the temporal pair; counts over mutable tables are live and
labelled. Where a count wants a value beside it, the value comes from the financial report that owns
it — this sub-slice sums no money.

Routes, load profile, user guide.

---

# Build sub-slice 3·6·5 — Delivery

Deliberately last: none of the four families needs it to be useful, and building it early would mean
building it before the reports it delivers have settled shapes.

- **Export formats.** CSV and Excel beside the existing PDF path. Rendering stays on the existing
  conversion edge; no new engine.
- **Scheduling.** A `report_schedule` (append-only, superseded rather than edited) riding the existing
  daily per-firm cron fan-out, enqueuing productions. Every consequence is an outbox message in the
  same batch; the handler never calls email directly.
- **Archival and delivery.** Produced artifacts listed per firm; optional delivery through the
  notifications seam.
- **Migration slot 2** of the slice.

---

# Named later, deliberately not half-built

- **Profitability** — waits on a timekeeper cost rate, which does not exist. Not approximated from
  billing rates.
- **Trial balance, income statement, balance sheet** — wait on slice 3·5's chart of accounts. This
  slice renders them when 3·5 assembles them; it does not invent a partial book.
- **As-of work in progress** — waits on `billed_at`/`voided_at` stamps and append-only re-rate in the
  work-in-progress stores. That is a change in the owning slice, not here.
- **Utilization against target** — waits on targets in time tracking.
- **Custom report builder and live dashboards** — deferred at the white-paper level.
- **Ethical-wall screening of a total** — waits on the owner's answer (design, Q1) and on walls
  existing at all. The completeness declaration is the seam, and it ships in 3·6·1.

---

# Open owner questions blocking nothing but shaping the output

The nine questions in the design's section 8. None blocks starting 3·6·1: each of them changes what a
pack **prints**, not how it is **computed**, and the recommended default is stated for each. Q1 (walls
and firm-wide totals) is the only one that touches a mechanism, and that mechanism does not exist yet.
