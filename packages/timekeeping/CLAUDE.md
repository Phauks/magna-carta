# @magna-carta/timekeeping — CLAUDE.md

**Purpose.** The time-capture domain module: the work-in-progress (WIP) time-entry store + its
Draft→Billed lifecycle, the effective-dated rate engine (rate cards + `resolveRate`), the UTBMS code
catalog, non-billable categories, and narrative templates. Validates in memory and composes statements
into @magna-carta/data-access's `composeEffectBatch`; never runs logic mid-transaction and never calls
external services. Pure services returning `EffectWrite` with an injected `ClockPort` + `actorUserId` +
`randomSource` — no ambient clock/identity/RNG (the shipment-service / matter-service shape).

**White paper:** _Financial Core — Time tracking_ (§17.1).
**Spec:**
[`docs/specs/2026-06-22-slice-3-1-time-tracking-design.md`](../../docs/specs/2026-06-22-slice-3-1-time-tracking-design.md).

## Key files / entry points

- `src/time-entry-service.ts` — `captureTimeEntry`, the lifecycle transitions
  (submit/approve/kickBack/void), and `refileTimeEntry` (a misfiled draft onto another matter)
- `src/lifecycle.ts` — the pure Draft→Billed state machine (`assertTransition`, `isFrozen`), gate-aware
- `src/rate-service.ts` — `createRateCard` / `appendRate` (effective-dated, non-overlap) / `reRateUnbilledDrafts`
- `src/rate-resolution.ts` — pure `resolveRate` (override → matter → client → timekeeper → role → card default)
- `src/rounding.ts` — `roundDuration` (quantity) + `computeAmountMinor` (integer-minor money via @magna-carta/money)
- `src/utbms-catalog.ts` / `src/utbms-service.ts` — the seeded ABA UTBMS codes + enable/disable
- `src/queries.ts` / `src/my-day.ts` — the WIP / weekly-grid / per-matter-unbilled / My Day reads, the
  one shared RECORD read every listing and the single-entry detail go through (`readTimeEntryRecord`),
  and the entry's own cursor-paged event history
- `src/entry-numbering.ts` — the matter-scoped entry number (`2026-0147.0042` by default): the
  per-matter counter block planned through `@magna-carta/sequence-numbering`'s `planSchemeDraw`.
  Nothing here renders a number; the shape is the firm's, written on the numbering settings screen
- `src/time-entry-attachments.ts` — the many-file relation to the entry's matter's documents; attach
  refuses a file on another matter, detach removes the link and never the file
- `src/task-time.ts` — how long a task took: the grouped read over `time_entry.task_id`, batched by
  construction so a page of tasks costs one statement rather than one per task

## Invariants that apply here

- **Time is WIP, not a ledger posting.** No write here ever composes a `ledger_*` statement; billable
  time converts to A/R only at billing (3·4). Enforced by the worker `timekeeping-wip-ledger-fitness` scan.
- **The freeze contract (column-level, not append-only).** `status` is a normal mutable column; legal
  transitions are UPDATEs. On reaching `billed`/`void` the row's business columns freeze — the service
  refuses any UPDATE except the billing `invoice_id`/lock set. Distinct from, and weaker than, the
  ledger's never-mutate rule. Enforced by the `timekeeping-freeze-fitness` scan.
- **Rates are effective-dated and append-only.** A `rate` version is never edited except to close a prior
  open row's `valid_to` when appending. An entry snapshots its resolved `rate_e4` on its `work_date` and
  keeps it forever — changing a card later never silently re-rates an existing entry. `reRateUnbilledDrafts`
  is opt-in, audited, and never touches billed/void.
- **Integer-minor money, no floats.** `amount_minor = round(rate_e4 × duration_minutes / 60)` via
  @magna-carta/money. `amount_minor` is null ⟺ `rate_e4` is null (non-billable). A `Rate`/`Money` must
  reconstruct from the stored columns, so `currency` is carried NOT NULL.
- **Every mutation audited.** A `time_audit` row rides in the same batch as the write.
- **The internal memo never reaches audit metadata, a bill, or a client.** `time_entry.memo` is the
  firm's own note: an audit row records WHICH fields an edit touched (names only), never their text,
  and no client-facing projection selects the column.
- **A time entry names at most ONE task, and that task is on the entry's own matter.** The column is
  nullable and null on nearly every row: time is captured against a MATTER, and naming a task is an
  extra the timekeeper chooses. One task rather than a set, because an entry split across two tasks
  needs an allocation of its minutes between them and an allocation is a second ledger with its own
  rounding; the honest encoding is two entries. `assertTaskOnMatter` in `time-entry-service.ts` is
  the whole enforcement — SQLite cannot express the cross-table condition without a trigger — and it
  refuses three shapes under one code: a task that does not exist, a task on another matter, and a
  task on NO matter, which is the firm's own work and has nothing for a client matter to bill it to.
  A null `matter_id` on the task is a refusal, never a wildcard.
- **The task summary is minutes and never money.** `readTaskTimeSummaries` answers "how long did this
  take", which is the question the column exists for. What a task COST is a billing question with a
  different audience and a different permission, and a summary carrying both would have to be gated
  by the stricter of the two everywhere it is read. Void is excluded and every other status counts:
  a discarded capture is not an hour, a billed hour still is one.
- **An entry number is immutable and never reused.** It is drawn once at capture and kept through
  every transition — a void keeps its number, and so does a REFILE onto another matter — and an entry
  captured before the sequence existed stays null rather than being backfilled with a guess. Because
  the number's shape names the matter it was drawn on, a refiled entry's prefix is provenance rather
  than an assertion about where it lives now.
- **The count runs within the MATTER'S HANDLE, and the matter number is a rendered part.** The
  `time_entry` purpose is `scopeSource: "owner"` on the register: the draw passes the matter id, so
  a matter renumbered after the fact does not restart its entries' count and issue a second 0001.
  The purpose's `scopeDistinguishedBy` is `matter_number`, so a scheme that drops that part is
  refused at the save — without it two matters would both render `0001`.
- **The run takes no date part, by register.** A capture block draws several entries on one matter
  from one counter read and renders them from ONE context, so a date part would stamp every entry
  in the batch with the day the batch was taken rather than the day each was worked. The purpose's
  allowed parts exclude dates for that reason; do not widen them.
- **The matter moves only through `refileTimeEntry`, and takes the rate with it.** `matterId` is not
  a `DraftPatch` field: moving it is a cross-matter write, and the rate and rounding an entry carries
  were resolved against the matter it is leaving. The caller re-resolves against the destination on
  the entry's own work date and hands the result in. This does NOT weaken the snapshot rule above —
  that forbids a later rate-card edit re-rating a standing entry, which is still true.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `@magna-carta/money`, `zod`. Does NOT import the live-timer Durable Object: the DO lives in
  `apps/api-worker` and is a pure coordinator; the route composes the `time_entry` write through this package.
- Pure and synchronous: produces statements for the caller to run; holds no D1 binding, does no I/O.

## Gotchas

- The route resolves the rate + rounds the duration, then hands the resolved values into
  `captureTimeEntry` — the service composes the insert + audit, it does not re-resolve.
- A null `rate_e4` means "non-billable," never "flat-fee matter": a flat-fee/contingency matter still
  resolves and captures the standard rate (for the realization report), it just is not billed hourly.
- D1 has no interactive transactions — read before composing, or assert inside the batch (the
  rate-interval non-overlap check reads existing rows for the scope, then composes the append).
- **Phantom-audit pre-read requirement.** Lifecycle transitions compose an audit row in the same batch as
  the status UPDATE. The service must pre-read the current row (status + business columns) to detect
  illegal transitions and to populate the audit's `from_status`/`to_status`; a blind UPDATE without the
  pre-read produces an incomplete or incorrect audit row.
- **`live_run_id`-idempotent stop-commit.** The live-timer route derives the `time_entry` identifier and
  the chokepoint `Idempotency-Key` header from the DO-minted `live_run_id`. Two devices racing a stop
  collapse to one entry because the second commit hits the idempotency guard before reaching the service.
  Do not change the derivation without also updating the DO's commit path.
- **Scoped-setting precedence chain.** Increment and rounding settings resolve most-specific-first
  (matter → client → user → location → firm) via `resolveScopedSetting` in @magna-carta/data-access.
  Reading the firm-level key/value `setting` table directly bypasses per-matter/client overrides — always
  use the scoped resolver for time-related settings.
- **The task summary is BATCHED by construction, and that is not an optimization to undo.** It takes
  a set of task identifiers and returns a map, because its caller is a paged list: a per-task read
  would put a round-trip on every row of every page, and the failure would be invisible to an EXPLAIN
  (a per-task lookup has the same plan as the grouped one). The load profile records its STATEMENT
  COUNT beside the timings for exactly that reason — one statement for a page of fifty tasks, and
  `packages/fixtures/test/load-profile-smoke.test.ts` asserts it. The map answers for every task
  asked about, including the ones with no time at all, so a caller rendering a list never has to
  remember to default a missing key.
- **Whose time the summary counts is the CALLER's answer, arriving as data.** `onlyTimekeeperUserId`
  null reads the firm's; a user id reads that member's own. It is the same line My Day draws, and the
  reason it is a parameter rather than a permission read inside the module is that this package holds
  no session — the route resolves `time:viewFirm` and passes the consequence.
- **Consent-gated AI seam.** The `buildNarrativeSuggestion` / UTBMS-suggestion path is compiled in but
  dark: the route returns null unless the firm's client-consent flag is set. No model is reached at any
  point in the default path. Do not change the gate without a consent decision recorded as an ADR
  (the existing fragment addresses client consent).
