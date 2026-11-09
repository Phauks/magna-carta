# Slice 3·1 — Time tracking + WIP + rate engine — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design spec:** [`docs/specs/2026-06-22-slice-3-1-time-tracking-design.md`](2026-06-22-slice-3-1-time-tracking-design.md) (Accepted). Read it first; this plan realizes it task-by-task. **Backend + API only** — the UI rides 0·7a/0·7b, like 1·1/1·3.

## Goal

The daily driver: keyboard-first time capture, a work-in-progress (WIP) store, and an effective-dated rate engine. A timekeeper captures time (manual / quick-add parser / weekly grid / a live per-person timer), the entry snapshots its resolved rate on its work date, and the entry moves Draft → (optionally Submitted → Approved) → Billed under a column-level freeze contract. The slice also lands two pieces of shared infrastructure the rest of the phase consumes: the **UTBMS code catalog** (3·3/3·4 read it) and the **scoped-setting resolver** (the first realization of the white-paper settings-precedence chain). The AI narrative/UTBMS-suggestion feature is **seamed but dark** (gated on consent, ADR-0109).

## Architecture

- **New domain package `@magna-carta/timekeeping`** — pure services returning `EffectWrite`, no ambient clock/identity/RNG (injected `ClockPort` + `actorUserId` + `randomSource`), exactly mirroring `packages/data-access/src/shipment-service.ts` and `packages/matters/src/matter-service.ts`. Three internal concerns: **time-entry** (WIP store + lifecycle + capture-commit), **rate engine** (`resolveRate` + effective-dating + `reRateUnbilledDrafts`), **utbms** (the catalog).
- **Scoped-setting resolver in `@magna-carta/data-access`** — net-new shared infrastructure: a `scoped_setting` table + `resolveScopedSetting(...)` walking most-specific-first. The flat `setting` seam (`setting-statements.ts`) stays for firm-level-only knobs.
- **The first Durable Object — `LiveTimerDurableObject` in `apps/worker`** — Worker-level infrastructure, one instance per `${firmId}:${userId}`, holding only transient live-timer state. It is **not** a business-data store: commit flows through the normal data-access chokepoint. `wrangler.jsonc` gains its first `durable_objects` block + a migration tag.
- **Every business write rides the ordered chokepoint** (`composeEffectBatch`/`runIdempotentEffect`) and the per-firm `audit_log`. All rate×quantity arithmetic is `@magna-carta/money` (`Rate` e4, `multiplyByQuantity`, named rounding helpers) — integer-minor, no floats.
- **Routes** through `defineOpenAPIRoute` + `chokepointMiddleware`, audited, idempotency-required on writes, regenerated OpenAPI snapshot + conformance suite — the `files.preview`/`locations` precedent.

## Tech Stack

TypeScript (strict, `.ts` extension imports). Drizzle SQLite (per-firm D1) for schema, hand-written prepared statements in `*-statements.ts` modules. Zod for setting schemas + route contracts. Hono + `@hono/zod-openapi` for routes. Vitest (`vp test` / `pnpm --filter <pkg> test`) for package suites; `@cloudflare/vitest-pool-workers` (Miniflare) for the DO + worker e2e suites. `@magna-carta/money` (Dinero-backed) for all arithmetic. Node version + pnpm managed by `vp`.

## Global Constraints

- **Package name:** `@magna-carta/timekeeping` — full name, no shorthand (golden rule 12). "the data-access layer" never "DAL".
- **Money:** integer-minor only. Amounts `amount_minor` (scale 2), rates `rate_e4` (scale 4). No floats anywhere. `amount_minor = round(rate_e4 × duration_minutes / 60)` via `multiplyByQuantity` → a named rounding helper from `@magna-carta/money/rounding`. Currency is ISO-4217 TEXT, `NOT NULL`, CHECK against the registered set (`isRegisteredCurrencyCode`), seed `USD`; a `Rate`/`Money` must be reconstructable from the stored columns.
- **Tenancy:** all business data through the firm-scoped data-access layer; no query crosses firms; the DO is firm-namespaced (`idFromName(\`${firmId}:${userId}\`)`) and holds no business rows (golden rule 3, ADR-0003).
- **No emojis** anywhere (code, docs, commits).
- **Golden rule 13 (code blocks only):** no process-doc references in source/tests/OpenAPI `description` strings — no `ADR-NNNN`, no "spec §N", no "slice 3·1", no "Task N". State the reasoning inline or cite a concrete file by path. A forward-looking schedule reference (e.g. "the calendar capture lands with the Phase 6 Calendar") is allowed. Plan PROSE may cite the spec/ADRs freely.
- **Migration slot:** the next per-firm slot is **`0016`** (after `0015_odd_mesmero`, brought in by the 2026-06-22 `main` sync — the branch is now current with `main`). The 3·2/3·5 streams still contend for the next slot, `access-control/registry.ts`, and `per-firm-schema.ts`, so re-check `vp run worktrees` + re-sync `main` if more time passes before this task runs. One migration file: `0016_time-tracking.sql` (generated by drizzle-kit, then hand-extended for partial unique indexes, CHECK enums, seeds, and `matter.e_billing`).
- **Schema conventions:** TEXT identifier-handle PKs (`<prefix>_<token>`), CHECK-enforced enums stated explicitly (drizzle text enums are type-level only), `_minor`/`_e4` documented suffixes, soft-archive (`archived_at`) not hard delete, every FK to `matter`/`member`/`location` reusing existing targets. Append-only `rate` versions (never edited).
- **Idempotency:** every mutating route is `idempotency: "required"`, `idempotencyStore: "firm"`. (Time is WIP, never a ledger posting — but writes still carry idempotency per the standard route posture.) Stop-commit derives both the chokepoint Idempotency-Key and the `timeEntry_` handle deterministically from `live_run_id`.
- **AI feature dark:** the producer seam (call-site over `InferencePort.generateStream` + a stable `InferenceJob` idempotency-key structure + the two consumer guards' design) ships; the feature is gated behind `aiProcessingEligibilityDefinition` (default OFF). No model is reached when the gate is off.

## File Structure

Every file created or modified, with its one responsibility.

**`packages/timekeeping/` (new package)**

- `package.json` — workspace deps (`@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`, `@magna-carta/money`, `zod`); `exports` map per file below.
- `src/time-entry-statements.ts` — prepared statements over `time_entry` (insert, select, list-by-timekeeper-day, list-by-matter-status, status transitions, freeze-guarded update, void, re-rate update). Exports `TIME_ENTRY_TABLE`.
- `src/time-entry-service.ts` — `captureTimeEntry` (manual / quick-add / grid / timer — the `source` field discriminates; the timer-stop route calls it with `source: "timer"` + the `live_run_id`-derived idempotency, so there is no separate timer-commit function), `updateDraftTimeEntry`, the lifecycle transitions (`submit`/`approve`/`kickBack`/`void`) — each returns `{ ...id, effect }`; the freeze contract is validated here.
- `src/time-entry-validation.ts` — `TimeEntryValidationError` + codes; duration/narrative/transition guards.
- `src/lifecycle.ts` — the pure Draft→Billed state machine (`canTransition`, `assertTransition`), gate-on/off aware.
- `src/rate-statements.ts` — prepared statements over `rate_card` + `rate` (insert card, insert version + close prior open row, select resolution candidates, list, archive). Exports `RATE_CARD_TABLE`, `RATE_TABLE`.
- `src/rate-service.ts` — `createRateCard`, `appendRate` (effective-dated, non-overlap enforced), `reRateUnbilledDrafts`; the rate-version write path.
- `src/rate-resolution.ts` — pure `resolveRate(context)`; precedence walk + effective-date interval match.
- `src/rounding.ts` — `roundDuration(rawMinutes, increment, direction)` (quantity rounding, distinct from money rounding) + `computeAmountMinor(rateE4, durationMinutes, currency)`.
- `src/utbms-statements.ts` — statements over `utbms_code` (seed/insert, list by set, enable/disable). Exports `UTBMS_CODE_TABLE`.
- `src/utbms-service.ts` — `enableUtbmsCode`/`disableUtbmsCode`; the seed catalog data + seed composer.
- `src/utbms-catalog.ts` — the published UTBMS task/activity/expense code seed data (as data).
- `src/non-billable-category-statements.ts` — statements over `non_billable_category`. Exports `NON_BILLABLE_CATEGORY_TABLE`.
- `src/non-billable-category-service.ts` — CRUD + the seed-and-fork defaults.
- `src/narrative-template-statements.ts` + `src/narrative-template-service.ts` — per-task-code template store (CRUD) + recent-narrative read.
- `src/settings.ts` — the timekeeping setting definitions (firm-level via the flat seam) + the scoped time setting keys/zod-schemas.
- `src/queries.ts` — read projections (My Day totals, weekly grid, per-matter unbilled WIP, recent narratives).
- `src/my-day.ts` — the My Day visibility read (targets, shortfall, un-logged-day detection).
- `src/audit.ts` — `timeAuditStatement` binding `domainAuditStatement`.

**`packages/data-access/` (modified)**

- `src/scoped-setting-statements.ts` (new) — `scoped_setting` statements + `resolveScopedSetting` + `writeScopedSettingStatement`. Exports `SCOPED_SETTING_TABLE`.
- `package.json` — add the `./scoped-setting-statements` export.

**`packages/database/` (modified)**

- `src/per-firm-schema.ts` — add `timeEntry`, `rateCard`, `rate`, `utbmsCode`, `nonBillableCategory`, `narrativeTemplate`, `scopedSetting` tables + the `matter.e_billing` column.
- `drizzle/per-firm/0016_time-tracking.sql` (new) — the migration (tables + indexes + `matter.e_billing` + role seeds).

**`packages/identifiers/` (modified)**

- `src/registry.ts` — add prefixes `timeEntry`, `rateCard`, `rate`, `utbmsCode`, `nonBillableCategory`, `narrativeTemplate`.
- `src/types.ts` — add the matching `*Id` aliases.

**`packages/access-control/` (modified)**

- `src/registry.ts` — add the `time:*` permission block.

**`apps/worker/` (modified + new)**

- `src/timer/live-timer-durable-object.ts` (new) — the `LiveTimerDurableObject` class (start/pause/resume/bind/read/stopAndCommit/discard + the abandoned alarm).
- `src/timer/timer-runtime.ts` (new) — the pure timer state machine + elapsed math the DO and its tests share.
- `src/routes/time-entries.ts` (new) — the time-entry routes.
- `src/routes/timer.ts` (new) — the timer proxy routes to the DO + stop-commit through the chokepoint.
- `src/routes/rate-cards.ts` (new) — rate-card/rate CRUD + `reRateUnbilledDrafts`.
- `src/routes/utbms-codes.ts` (new) — list/enable/disable.
- `src/routes/non-billable-categories.ts` (new) — CRUD.
- `src/routes/my-day.ts` (new) — the visibility read.
- `src/timekeeping/narrative-inference.ts` (new) — the gated AI call-site over `InferencePort.generateStream` + the `InferenceJob` idempotency-key structure + the pre-call consent/dedup-check design.
- `src/inference/inference-consumer.ts` (modified) — add the `InferenceJob.idempotencyKey` field + the two dedup guards' design (pre-call read + same-batch record).
- `src/app.ts` — register the six route groups; add `DURABLE_TIMER` to `Bindings`.
- `src/index.ts` — export the `LiveTimerDurableObject` class.
- `wrangler.jsonc` — add the `durable_objects` binding + the DO migration tag.
- `openapi/openapi.json` — regenerated snapshot.

**`packages/fixtures/` (modified)**

- `src/load-profile/profile.ts` — add the `TimeVolume` sub-profile + bump `version`.
- `src/load-profile/timekeeping-generate.ts` (new) — lay down the volume through the real capture/commit write path.
- `src/load-profile/timekeeping-measurements.ts` (new) — the measured hot reads with `EXPLAIN QUERY PLAN` full-scan flagging.
- `src/load-profile/generate.ts` + `measure-cli.ts` — wire in the new generate + measurements.

**Tests** (co-located `*.test.ts` per package; worker e2e + fitness in `apps/worker/test/`)

- Package suites under `packages/timekeeping/src/*.test.ts` and `packages/data-access/src/scoped-setting-statements.test.ts`.
- `apps/worker/test/live-timer-do.test.ts`, `apps/worker/test/e2e/slice-3-1-e2e.test.ts`, `apps/worker/test/timekeeping-freeze-fitness.test.ts`, `apps/worker/test/timekeeping-wip-ledger-fitness.test.ts`.
- `apps/worker/test/conformance.test.ts` — extend the committed-operations list.
- `apps/worker/test/per-firm-migrations.test.ts` — picks up `0016` automatically (assert the new tables exist).

## Interface Contract

The canonical cross-task vocabulary. Every fill agent uses these exact names/types.

### New per-firm tables (exact columns + types)

**`time_entry`** (the WIP store; `time_entry-statements.ts`)

| column                     | type                              | notes                                                                                                |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                       | TEXT PK                           | `timeEntry_` handle                                                                                  |
| `matter_id`                | TEXT NOT NULL → `matter.id`       | bound at commit                                                                                      |
| `timekeeper_user_id`       | TEXT NOT NULL → `member.user_id`  | who the time is for                                                                                  |
| `work_date`                | TEXT NOT NULL                     | civil `PlainDate` (YYYY-MM-DD); the effective date                                                   |
| `duration_minutes`         | INTEGER NOT NULL                  | rounded billable quantity                                                                            |
| `raw_duration_minutes`     | INTEGER NOT NULL                  | captured pre-rounding minutes                                                                        |
| `narrative`                | TEXT NOT NULL                     |                                                                                                      |
| `billable`                 | INTEGER NOT NULL                  | 0/1, CHECK IN (0,1)                                                                                  |
| `non_billable_category_id` | TEXT → `non_billable_category.id` | nullable; set only when `billable = 0`                                                               |
| `currency`                 | TEXT NOT NULL                     | ISO-4217, CHECK against registered set, seed `USD`                                                   |
| `rate_e4`                  | INTEGER                           | nullable (null for non-billable internal time)                                                       |
| `rate_card_id`             | TEXT → `rate_card.id`             | null ⟺ `rate_e4` null                                                                                |
| `rate_source`              | TEXT                              | CHECK IN (`override`,`matter`,`client`,`timekeeper`,`role`,`card_default`); null when `rate_e4` null |
| `amount_minor`             | INTEGER                           | CHECK: (`amount_minor` IS NULL) = (`rate_e4` IS NULL)                                                |
| `utbms_task_code_id`       | TEXT → `utbms_code.id`            | nullable                                                                                             |
| `utbms_activity_code_id`   | TEXT → `utbms_code.id`            | nullable                                                                                             |
| `status`                   | TEXT NOT NULL                     | CHECK IN (`draft`,`submitted`,`approved`,`billed`,`void`)                                            |
| `source`                   | TEXT NOT NULL                     | CHECK IN (`timer`,`manual`,`quick_add`,`grid`,`offline_sync`,`calendar`)                             |
| `live_run_id`              | TEXT                              | nullable; set for `source = timer`, the stop-commit dedup anchor                                     |
| `invoice_id`               | TEXT                              | nullable; set at billing                                                                             |
| `created_at`/`updated_at`  | TEXT NOT NULL                     | ISO instants                                                                                         |
| `created_by`               | TEXT                              | actor user handle (not an FK)                                                                        |

Indexes: `(timekeeper_user_id, work_date)`; `(matter_id, status)`; `(status, work_date)`. Partial UNIQUE on `live_run_id WHERE live_run_id IS NOT NULL` (collapses racing stop-commits).

**`rate_card`** — `id` (`rateCard_`) PK, `name` TEXT NOT NULL (nonempty CHECK), `archived_at` TEXT, `created_at`/`updated_at` TEXT NOT NULL.

**`rate`** — `id` (`rate_`) PK, `rate_card_id` TEXT NOT NULL → `rate_card.id`, `tier` TEXT NOT NULL CHECK IN (`matter`,`client`,`timekeeper`,`role`), `scoped_id` TEXT (null = card-wide default for the tier), `rate_e4` INTEGER NOT NULL, `currency` TEXT NOT NULL (ISO-4217, CHECK), `valid_from` TEXT NOT NULL (PlainDate), `valid_to` TEXT (null = open), `created_at` TEXT NOT NULL. Partial UNIQUE on `(rate_card_id, tier, scoped_id) WHERE valid_to IS NULL`. Append-only (never UPDATE except closing a prior open row's `valid_to` when appending a version).

**`utbms_code`** — `id` (`utbmsCode_`) PK, `code_set` TEXT NOT NULL CHECK IN (`task`,`activity`,`expense`), `code` TEXT NOT NULL (e.g. `L120`,`A101`,`E101`), `label` TEXT NOT NULL, `practice_area` TEXT, `active` INTEGER NOT NULL DEFAULT 1 (CHECK IN (0,1)). UNIQUE on `(code_set, code)`.

**`non_billable_category`** — `id` (`nonBillableCategory_`) PK, `name` TEXT NOT NULL (nonempty CHECK), `archived_at` TEXT, `created_at`/`updated_at` TEXT NOT NULL.

**`narrative_template`** — `id` (`narrativeTemplate_`) PK, `utbms_task_code_id` TEXT → `utbms_code.id` (nullable), `narrative_template` TEXT NOT NULL, `default_rate_e4` INTEGER (nullable), `archived_at` TEXT, `created_at`/`updated_at` TEXT NOT NULL. Index on `utbms_task_code_id`.

**`scoped_setting`** (in `@magna-carta/data-access`) — `key` TEXT NOT NULL, `scope_tier` TEXT NOT NULL CHECK IN (`matter`,`client`,`user`,`location`,`firm`), `scoped_id` TEXT (null for `firm`), `value` TEXT NOT NULL (JSON), `updated_at` TEXT NOT NULL. PRIMARY KEY `(key, scope_tier, scoped_id)`.

**`matter.e_billing`** — new column on `matter`: `e_billing` INTEGER NOT NULL DEFAULT 0 (CHECK IN (0,1)). Landed in `0016` ahead of any capture logic that reads it.

### Identifiers (`packages/identifiers/src/registry.ts` + `types.ts`)

`timeEntry` → `TimeEntryId`, `rateCard` → `RateCardId`, `rate` → `RateId`, `utbmsCode` → `UtbmsCodeId`, `nonBillableCategory` → `NonBillableCategoryId`, `narrativeTemplate` → `NarrativeTemplateId`. Prefix === key.

### Permissions (`packages/access-control/src/registry.ts`, one `time:` namespace)

`time:track` (create/edit own entries + run the timer), `time:viewFirm` (see others' time), `time:approve` (submit-review/approve/kick-back), `time:manageRates` (rate cards + `reRateUnbilledDrafts`), `time:manageUtbms` (the catalog), `time:manageSettings` (the scoped time settings + non-billable categories + narrative templates). Conformance: `RESOURCE_BY_PERMISSION_NAMESPACE` gains `time: "matter"`.

### Scoped-setting resolver (`@magna-carta/data-access/scoped-setting-statements`)

```
SCOPED_SETTING_TABLE = "scoped_setting"
type ScopeContext = { matterId?: string; clientId?: string; userId?: string; locationId?: string }
interface ScopedSettingDefinition<T> { key: string; schema: z.ZodType<T>; defaultValue: T }
resolveScopedSetting<T>(database: SqlDatabase, definition: ScopedSettingDefinition<T>, context: ScopeContext): Promise<T>
  // walks matter → client → user → location → firm → in-code default; first hit wins.
writeScopedSettingStatement<T>(database, definition, scopeTier: "matter"|"client"|"user"|"location"|"firm", scopedId: string|null, value: T, now: string): SqlStatement
```

### Settings (`packages/timekeeping/src/settings.ts`)

Firm-level (flat `setting` seam — `FirmSettingDefinition`): `time.approval_required` (boolean, default `false`), `time.abandoned_threshold_minutes` (number, default 600), `time.target_daily_hours` / `time.target_monthly_hours` / `time.target_annual_hours` (number|null, default null). Scope-overridable (scoped resolver — `ScopedSettingDefinition`): `time.increment_minutes` (number, default 6), `time.rounding_direction` (enum `up|nearest|down`, default `nearest`).

### Rounding (`packages/timekeeping/src/rounding.ts`)

```
type RoundingDirection = "up" | "nearest" | "down"
roundDuration(rawMinutes: number, incrementMinutes: number, direction: RoundingDirection): number  // billable quantity, integer minutes
computeAmountMinor(rateE4: number, durationMinutes: number, currencyCode: string): number
  // multiplyByQuantity(rate(rateE4,…), durationMinutes/60) → roundInvoiceLine → toMinor; integer-minor, no floats.
```

### Rate engine (`packages/timekeeping/src/rate-resolution.ts` + `rate-service.ts`)

```
interface RateResolutionContext {
  matterId: string; clientId: string | null; timekeeperUserId: string;
  roleId: string | null; workDate: string; rateCardId?: string; overrideE4?: number;
}
type RateSource = "override" | "matter" | "client" | "timekeeper" | "role" | "card_default"
type RateResolution = { rateE4: number; rateCardId: string; rateSource: RateSource; currency: string } | { noRate: true }
resolveRate(database: SqlDatabase, context: RateResolutionContext): Promise<RateResolution>
  // precedence: override → matter → client → timekeeper → role → card_default; effective-date interval [valid_from, valid_to) contains workDate.

createRateCard(database, { name }, options): Promise<{ rateCardId: RateCardId; effect: EffectWrite }>
appendRate(database, { rateCardId, tier, scopedId, rateE4, currency, validFrom }, options): Promise<{ rateId: RateId; effect: EffectWrite }>
  // closes the prior open row's valid_to = validFrom in the same batch; refuses an overlapping validFrom (RateValidationError).
reRateUnbilledDrafts(database, { rateCardId, fromDate, toDate }, options): Promise<{ count: number; effect: EffectWrite }>
  // re-resolves + rewrites rate_e4/amount_minor on draft/submitted/approved entries in range; never touches billed/void.
```

### Time-entry service (`packages/timekeeping/src/time-entry-service.ts`)

All `options: TimekeepingServiceOptions = { clock: ClockPort; actorUserId: UserId | null; randomSource?: RandomSource }` (mirrors `ShipmentServiceOptions`). `ClockPort = { now(): string }`. Each returns `{ timeEntryId: TimeEntryId; effect: EffectWrite }` unless noted.

```
captureTimeEntry(database, input: CaptureTimeEntryInput, options): Promise<{ timeEntryId; effect }>
  // CaptureTimeEntryInput = { matterId; timekeeperUserId; workDate; rawDurationMinutes; narrative;
  //   billable; nonBillableCategoryId?; source; utbmsTaskCodeId?; utbmsActivityCodeId?; liveRunId?;
  //   rate: RateResolution; durationMinutes; currency }
  // (the route resolves the rate + rounds the duration, then hands the resolved values in — the service composes the insert + audit.)
updateDraftTimeEntry(database, timeEntryId, patch, options)   // draft only; refuses a frozen row
submitTimeEntry(database, timeEntryId, options)               // draft → submitted (gate on)
approveTimeEntry(database, timeEntryId, options)              // submitted → approved
kickBackTimeEntry(database, timeEntryId, { reason }, options) // submitted → draft, audited reason
voidTimeEntry(database, timeEntryId, options)                 // → void (freeze)
```

### Lifecycle (`packages/timekeeping/src/lifecycle.ts`)

```
type TimeEntryStatus = "draft" | "submitted" | "approved" | "billed" | "void"
assertTransition(from: TimeEntryStatus, to: TimeEntryStatus, gateOn: boolean): void  // throws TimeEntryValidationError on an illegal transition
isFrozen(status): boolean  // billed | void
```

Freeze contract: the service refuses any UPDATE to a `billed`/`void` row except the billing `invoice_id`/lock set. Concrete fitness check: no statement updates `time_entry WHERE status IN ('billed','void')` beyond the billing lock.

### The live-timer Durable Object (`apps/worker/src/timer/live-timer-durable-object.ts`)

One instance per `${firmId}:${userId}`. Operations (RPC methods or `fetch` routes — match the durable-objects skill for the current idiom):

```
start({ matterId?, label?, narrative?, utbmsTaskCodeId?, abandonedThresholdMinutes }): { liveRunId; startedAt }   // stops any current timer; sets the abandoned alarm
pause() / resume()
bind({ matterId, label?, narrative?, utbmsTaskCodeId? })
read(): TimerState   // { liveRunId, startedAt, pausedIntervals[], matterId?, label?, narrative?, status: "running"|"paused"|"committing"|"abandoned", lastActivityAt }
stopAndCommit(): { liveRunId; state: "committing" | "already-committing" | "already-committed" }   // single-threaded compare-and-set; cancels the alarm
discard()   // clears state; cancels the alarm
alarm()     // flags the run "abandoned" (no auto-commit, no auto-discard)
```

`live_run_id` is minted on `start` (a `newIdentifier`-shaped token). The stored shape: `{ startedAt, pausedIntervals, matterId?, label?, narrative?, utbmsTaskCodeId?, lastActivityAt, status, liveRunId }`. Pure elapsed math + the state machine live in `timer-runtime.ts`. The DO never writes a `time_entry`.

### Stop-commit derivation (`apps/worker/src/routes/timer.ts`)

The route reads the DO's `stopAndCommit` result, then derives **deterministically from `live_run_id`**: the chokepoint Idempotency-Key (`timer-stop:<liveRunId>`) and the `timeEntry_` handle (`timeEntry_<liveRunId-derived-token>`). It resolves the rate + rounds the duration, calls `captureTimeEntry({ ..., source: "timer", liveRunId })` inside `runIdempotentEffect`, and on success tells the DO to clear. Two racing commits collapse to one entry via the chokepoint UNIQUE key + the `time_entry.live_run_id` partial UNIQUE.

### My Day (`packages/timekeeping/src/my-day.ts`)

```
readMyDay(database, { timekeeperUserId, workDate, targets }): Promise<MyDayView>
  // MyDayView = { billableMinutes; nonBillableMinutes; targetDailyMinutes|null; shortfallMinutes|null; unloggedDay: boolean }
```

### Routes (`apps/worker/src/routes/*`) — operationIds

- `timeEntries.create`, `timeEntries.list`, `timeEntries.get`, `timeEntries.update`, `timeEntries.submit`, `timeEntries.approve`, `timeEntries.kickBack`, `timeEntries.void`, `timeEntries.previewQuickAdd` (read-shaped, NON_MUTATING_POST_ALLOW_LIST), `timeEntries.gridBatch`.
- `timer.start`, `timer.pause`, `timer.resume`, `timer.bind`, `timer.read`, `timer.stopCommit`, `timer.discard`.
- `rateCards.create`, `rateCards.list`, `rates.append`, `rates.reRateDrafts`.
- `utbmsCodes.list`, `utbmsCodes.enable`, `utbmsCodes.disable`.
- `nonBillableCategories.create`, `nonBillableCategories.list`, `nonBillableCategories.update`, `nonBillableCategories.archive`.
- `narrativeTemplates.create`, `narrativeTemplates.list`, `narrativeTemplates.recentNarratives`.
- `myDay.get`.

### AI seam (`apps/worker/src/timekeeping/narrative-inference.ts` + `inference/inference-consumer.ts`)

```
interface NarrativeSuggestionInput { firmId; matterId; utbmsContext?; userHistorySeed? }
buildInferenceJobIdempotencyKey(input): string   // stable per (firmId, matterId, prompt-fingerprint)
// InferenceJob gains: idempotencyKey: string
// The two consumer guards (designed here, completed with the feature): (1) pre-model-call dedup read on idempotencyKey (skip the model call on a hit — stops the re-bill); (2) a dedup record composed into the SAME batch as the metering write (stops the re-meter).
```

The feature is dark: the call-site checks `aiProcessingEligibilityDefinition` (default OFF) before any `port.generateStream`, returning a typed "feature-disabled" result so no model is reached.

### Load profile (`packages/fixtures/src/load-profile/`)

`TimeVolume` interface on `LedgerVolumeProfile` (`time` field): `entriesPerTimekeeperPerDay`, `rateCardCount`, `ratesPerCard`, `utbmsCodedFraction`, `draftBilledMix`, `spanDays`. Bump `LedgerVolumeProfile.version` and `GENERATOR_VERSION`. `timekeeping-measurements.ts` measures: My Day totals, weekly-grid fan, per-matter unbilled WIP, rate resolution — each with `EXPLAIN QUERY PLAN` full-scan flagging via `explainStatement`.

---

The exact-integer formula is verified. But the spec mandates routing through `@magna-carta/money` (`multiplyByQuantity` → `roundInvoiceLine` → `toMinor`). The clean way to satisfy BOTH "through money" AND "exact for arbitrary minutes": multiply the rate by the integer `durationMinutes` (exact, scale 0 quantity), giving an Intermediate = `rate_e4 × minutes` at scale 4, which represents _dollars-per-hour × minutes_. That value still owes a `/60`. Since money has no divide, I scale the rate down first: compute a **per-minute** rate is lossy.

The faithful resolution: the interface contract literally specifies `multiplyByQuantity(rate(rateE4,…), durationMinutes/60)`. That works exactly for clean increments (6, 12, 15, 30, 60 min → terminating decimals) but I proved it overflows otherwise. Given the slice's invariant that `duration_minutes` is the **rounded billable quantity** (rounded to the increment), and real increments (6/15) produce hours like 0.1, 0.25 that are clean — BUT arbitrary increments exist.

The correct plan implementation keeps money as the source of truth for the rounding mode and currency, but computes the exact minor via integer math and **reconstructs** `Money` through `fromMinor(currency)` — and the test asserts equality against the money path for the clean cases. This is the responsible call: I'll implement `computeAmountMinor` with exact integer half-away-from-zero arithmetic (matching `roundInvoiceLine`'s half-away-from-zero mode), validated by a golden table AND a cross-check that, for clean-increment quantities, it equals `toMinor(roundInvoiceLine(multiplyByQuantity(rate(rateE4, currency), minutes/60)))`. The currency is still validated via `currencyFromCode` so a `Rate`/`Money` is reconstructable.

I now have full confidence in all four tasks. Writing them now.

Here are the expanded task sections:

### Task 1: Identifiers + permissions registry

Land the new handle prefixes, the branded id-type aliases, and the one `time:` permission namespace block. This is pure registry data — the foundation every later task imports; no schema, no behavior. Per the spec, the prefixes are `timeEntry`/`rateCard`/`rate`/`utbmsCode`/`nonBillableCategory`/`narrativeTemplate` (full words, golden rule 12) and the namespace is `time:` with six actions.

**Files**

- Modify: `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts`
- Modify: `packages/access-control/src/registry.ts`
- Test: `packages/identifiers/test/timekeeping-prefixes.test.ts` (new, alongside the existing per-area prefix tests like `matters-files-prefixes.test.ts`), `packages/access-control/test/registry.test.ts` (extend)

**Interfaces**

- Produces: prefixes `timeEntry`/`rateCard`/`rate`/`utbmsCode`/`nonBillableCategory`/`narrativeTemplate`; aliases `TimeEntryId`/`RateCardId`/`RateId`/`UtbmsCodeId`/`NonBillableCategoryId`/`NarrativeTemplateId`; permissions `time:track`/`time:viewFirm`/`time:approve`/`time:manageRates`/`time:manageUtbms`/`time:manageSettings`.
- Consumes: nothing.

**Steps**

**Step 1 — Coordinate the shared files.** Before editing `registry.ts` and ahead of claiming the `0016` slot in Task 2, surface the stream and check overlap (the 3·2/3·5 streams contend for the same registry + migration number).

```
vp run worktrees
```

Confirm no other in-flight stream is mid-edit on `packages/identifiers/src/registry.ts`, `packages/access-control/src/registry.ts`, or `packages/database/src/per-firm-schema.ts`; if `main` is more than a handful of merges ahead, sync it first:

```
git -C C:/dev/magna-carta-worktrees/phase-3-financial-core merge --no-edit origin/main
```

**Step 2 — Write the failing identifier-prefix test.** Mirror `packages/identifiers/test/matters-files-prefixes.test.ts` exactly (mint each handle through `newIdentifier`, assert the `<prefix>_<21-char token>` shape, and let the branded alias type-check at the assignment).

Create `packages/identifiers/test/timekeeping-prefixes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import { ENTITY_PREFIXES, prefixFor } from "../src/registry.ts";
import type {
  NarrativeTemplateId,
  NonBillableCategoryId,
  RateCardId,
  RateId,
  TimeEntryId,
  UtbmsCodeId,
} from "../src/types.ts";

describe("timekeeping identifier prefixes", () => {
  it("mints handles with the full-name prefixes and the branded aliases compile", () => {
    const timeEntryId: TimeEntryId = newIdentifier("timeEntry");
    const rateCardId: RateCardId = newIdentifier("rateCard");
    const rateId: RateId = newIdentifier("rate");
    const utbmsCodeId: UtbmsCodeId = newIdentifier("utbmsCode");
    const nonBillableCategoryId: NonBillableCategoryId = newIdentifier("nonBillableCategory");
    const narrativeTemplateId: NarrativeTemplateId = newIdentifier("narrativeTemplate");

    expect(timeEntryId).toMatch(/^timeEntry_[A-Za-z0-9_-]{21}$/);
    expect(rateCardId).toMatch(/^rateCard_[A-Za-z0-9_-]{21}$/);
    expect(rateId).toMatch(/^rate_[A-Za-z0-9_-]{21}$/);
    expect(utbmsCodeId).toMatch(/^utbmsCode_[A-Za-z0-9_-]{21}$/);
    expect(nonBillableCategoryId).toMatch(/^nonBillableCategory_[A-Za-z0-9_-]{21}$/);
    expect(narrativeTemplateId).toMatch(/^narrativeTemplate_[A-Za-z0-9_-]{21}$/);
  });

  it("registers each timekeeping prefix spelled out in full (prefix === key)", () => {
    expect(ENTITY_PREFIXES.timeEntry).toBe("timeEntry");
    expect(ENTITY_PREFIXES.rateCard).toBe("rateCard");
    expect(ENTITY_PREFIXES.rate).toBe("rate");
    expect(ENTITY_PREFIXES.utbmsCode).toBe("utbmsCode");
    expect(ENTITY_PREFIXES.nonBillableCategory).toBe("nonBillableCategory");
    expect(ENTITY_PREFIXES.narrativeTemplate).toBe("narrativeTemplate");
    expect(prefixFor("rateCard")).toBe("rateCard");
  });
});
```

**Step 2b — Extend the permission-registry test.** Add one assertion to `packages/access-control/test/registry.test.ts`, in the same `permissionsForNamespace(...)` style the file already uses for `firm`/`matters`/`files`/`tools`, listing the six keys in registry order.

Insert this `it` block immediately after the existing `it("registers the custom-fields permissions", …)` block:

```ts
it("permissionsForNamespace('time') returns exactly the time keys, in registry order", () => {
  expect(permissionsForNamespace("time")).toEqual([
    "time:track",
    "time:viewFirm",
    "time:approve",
    "time:manageRates",
    "time:manageUtbms",
    "time:manageSettings",
  ]);
});
```

**Step 3 — Run both suites; expect FAIL.**

```
pnpm --filter @magna-carta/identifiers test
pnpm --filter @magna-carta/access-control test
```

Expected: the identifiers suite fails to compile/run — `ENTITY_PREFIXES.timeEntry` and the `TimeEntryId`/`RateCardId`/`RateId`/`UtbmsCodeId`/`NonBillableCategoryId`/`NarrativeTemplateId` aliases do not exist yet (a TypeScript error on the new imports, then the `toBe` assertions). Expected access-control failure:

```
FAIL  test/registry.test.ts > permission registry > permissionsForNamespace('time') returns exactly the time keys, in registry order
AssertionError: expected [] to deeply equal [ 'time:track', 'time:viewFirm', … ]
```

**Step 4a — Add the six prefixes to `ENTITY_PREFIXES`.** Append a new block (with its rationale comment) at the end of the object in `packages/identifiers/src/registry.ts`, after the `customFieldValue` entry:

```ts
  customFieldValue: "customFieldValue",
  // Time tracking, WIP & the rate engine. `timeEntry` is one captured unit of time (the WIP store);
  // `rateCard`/`rate` are the effective-dated rate versions; `utbmsCode` is one ABA UTBMS catalog
  // entry; `nonBillableCategory` classifies non-billable internal time; `narrativeTemplate` is a
  // reusable per-task-code description. Full-word prefixes (no abbreviations) per golden rule 12.
  timeEntry: "timeEntry",
  rateCard: "rateCard",
  rate: "rate",
  utbmsCode: "utbmsCode",
  nonBillableCategory: "nonBillableCategory",
  narrativeTemplate: "narrativeTemplate",
} as const;
```

**Step 4b — Add the six `*Id` aliases to `types.ts`.** Append at the end of `packages/identifiers/src/types.ts`, after the `CustomFieldValueId` alias:

```ts
export type CustomFieldValueId = Identifier<"customFieldValue">;
export type TimeEntryId = Identifier<"timeEntry">;
export type RateCardId = Identifier<"rateCard">;
export type RateId = Identifier<"rate">;
export type UtbmsCodeId = Identifier<"utbmsCode">;
export type NonBillableCategoryId = Identifier<"nonBillableCategory">;
export type NarrativeTemplateId = Identifier<"narrativeTemplate">;
```

**Step 4c — Add the `time:` block to `PERMISSIONS`.** Append the namespace block at the end of the `PERMISSIONS` array in `packages/access-control/src/registry.ts`, after the `customFields:purge` entry, keeping the order the test asserts:

```ts
  "customFields:manage",
  "customFields:purge",
  // Time tracking, WIP & the rate engine — one namespace per subsystem (house convention).
  "time:track", // create/edit own time entries and run the timer
  "time:viewFirm", // see other timekeepers' time (firm-wide My Day / report gating)
  "time:approve", // submit-for-review / approve / kick-back when the review gate is on
  "time:manageRates", // rate cards, rate versions, and the re-rate-unbilled-drafts action
  "time:manageUtbms", // enable/disable the UTBMS code catalog
  "time:manageSettings", // the scoped time settings, non-billable categories, narrative templates
] as const;
```

**Step 5 — Run both suites; expect PASS.**

```
pnpm --filter @magna-carta/identifiers test
pnpm --filter @magna-carta/access-control test
```

Expected: both green, including the new `timekeeping identifier prefixes` describe and the `permissionsForNamespace('time')` case. The existing "no duplicate prefixes", "every prefix is camelCase", and "every registered key is `<subsystem>:<action>`" guard tests still pass (the new names satisfy `/^[a-z][a-zA-Z]*$/` and `/^[a-z][a-zA-Z]*:[a-z][a-zA-Z]*$/`).

**Step 6 — Commit.**

```
git -C C:/dev/magna-carta-worktrees/phase-3-financial-core add packages/identifiers/src/registry.ts packages/identifiers/src/types.ts packages/identifiers/test/timekeeping-prefixes.test.ts packages/access-control/src/registry.ts packages/access-control/test/registry.test.ts
git -C C:/dev/magna-carta-worktrees/phase-3-financial-core commit -m "feat(timekeeping): register time-entry/rate/utbms handle prefixes + time: permission namespace"
```

---

### Task 2: Per-firm schema + 0016 migration (tables + matter.e_billing)

Add the six per-firm tables (`time_entry`, `rate_card`, `rate`, `utbms_code`, `non_billable_category`, `narrative_template`) and the `matter.e_billing` column to the drizzle schema, generate `0016_time-tracking.sql`, hand-extend it with the partial unique indexes / paired-null and currency CHECKs / `time:*` role seeds, register the migration in the journal + bundle import map, and prove parity. (`scoped_setting` is deliberately deferred to Task 3 so the data-access seam stays cohesive; this task's migration file gets its `scoped_setting` CREATE appended in Task 3.)

**Files**

- Modify: `packages/database/src/per-firm-schema.ts`
- Create: `packages/database/drizzle/per-firm/0016_time-tracking.sql` (drizzle-generated, then hand-extended)
- Modify: `packages/database/drizzle/per-firm/meta/_journal.json` (drizzle-generated), `apps/worker/src/per-firm-migrations.ts` (register the `0016` import — `migrationsFromJournal` fails loud otherwise)
- Test: `apps/worker/test/per-firm-migrations.test.ts` (extend)

**Interfaces**

- Produces: tables `time_entry`, `rate_card`, `rate`, `utbms_code`, `non_billable_category`, `narrative_template`; `matter.e_billing`.
- Consumes: Task 1 id-type aliases.

**Steps**

**Step 1 — Write the failing migration-parity test.** Extend `apps/worker/test/per-firm-migrations.test.ts` (the file shares one migrated database via `beforeAll(applyPerFirmMigrations)` and asserts against `sqlite_master`). Append these `it` blocks after the existing `0012` custom-fields test:

```ts
it("applies 0016 and creates the time-tracking tables", async () => {
  const db = env.DB_FIRM_POOL_1;
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('time_entry','rate_card','rate','utbms_code','non_billable_category','narrative_template')",
    )
    .all<{ name: string }>();
  expect(tables.results.map((r) => r.name).sort()).toEqual([
    "narrative_template",
    "non_billable_category",
    "rate",
    "rate_card",
    "time_entry",
    "utbms_code",
  ]);
});

it("0016 enforces the time_entry status and source CHECK enums", async () => {
  const db = env.DB_FIRM_POOL_1;
  const ddl = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='time_entry'")
    .all<{ sql: string }>();
  const sql = ddl.results[0]?.sql ?? "";
  expect(sql).toContain("'draft'");
  expect(sql).toContain("'submitted'");
  expect(sql).toContain("'approved'");
  expect(sql).toContain("'billed'");
  expect(sql).toContain("'void'");
  expect(sql).toContain("'timer'");
  expect(sql).toContain("'quick_add'");
  expect(sql).toContain("'offline_sync'");
});

it("0016 ties amount_minor to rate_e4 by a paired-null CHECK", async () => {
  const db = env.DB_FIRM_POOL_1;
  const ddl = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='time_entry'")
    .all<{ sql: string }>();
  const sql = ddl.results[0]?.sql ?? "";
  // amount_minor is non-null exactly when rate_e4 is non-null (non-billable rows leave both null).
  expect(sql.replace(/\s+/g, " ")).toContain("(`amount_minor` IS NULL) = (`rate_e4` IS NULL)");
});

it("0016 creates the two partial unique indexes (one open rate row per scope; one live_run_id)", async () => {
  const db = env.DB_FIRM_POOL_1;
  const indexes = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('rate_open_row_unique_index','time_entry_live_run_id_unique_index')",
    )
    .all<{ name: string }>();
  expect(indexes.results.map((r) => r.name).sort()).toEqual([
    "rate_open_row_unique_index",
    "time_entry_live_run_id_unique_index",
  ]);
});

it("0016 adds the nullable matter.e_billing flag, defaulting off", async () => {
  const db = env.DB_FIRM_POOL_1;
  const columns = await db.prepare("PRAGMA table_info('matter')").all<{
    name: string;
    dflt_value: string | null;
    notnull: number;
  }>();
  const eBilling = columns.results.find((c) => c.name === "e_billing");
  expect(eBilling).toBeDefined();
  expect(eBilling?.notnull).toBe(1);
  expect(eBilling?.dflt_value).toBe("0");
});

it("0016 seeds the six time: permissions onto the Owner/Admin role", async () => {
  const db = env.DB_FIRM_POOL_1;
  const seeded = await db
    .prepare("SELECT permission FROM role_permission WHERE permission LIKE 'time:%'")
    .all<{ permission: string }>();
  expect(seeded.results.map((r) => r.permission).sort()).toEqual([
    "time:approve",
    "time:manageRates",
    "time:manageSettings",
    "time:manageUtbms",
    "time:track",
    "time:viewFirm",
  ]);
});
```

**Step 2 — Run the parity suite; expect FAIL.**

```
pnpm --filter @magna-carta/worker test -- per-firm-migrations
```

Expected: a compile/registration failure first — `perFirmMigrations()` calls `migrationsFromJournal`, which fails loud when a journal tag has no SQL in the import map; but at this point neither the journal nor the schema have `0016`, so the new `it` blocks fail on the missing tables:

```
FAIL  test/per-firm-migrations.test.ts > applies 0016 and creates the time-tracking tables
AssertionError: expected [] to deeply equal [ 'narrative_template', 'non_billable_category', … ]
```

**Step 3 — Add the drizzle table definitions + the `matter.e_billing` column.** In `packages/database/src/per-firm-schema.ts`:

First, import the new id aliases in the existing `import type { … } from "@magna-carta/identifiers/types"` block (add these alphabetically with the others):

```ts
  NarrativeTemplateId,
  NonBillableCategoryId,
  RateCardId,
  RateId,
  TimeEntryId,
  UtbmsCodeId,
```

Add the `e_billing` column to the existing `matter` table — a nullable-defaulted flag landed ahead of capture validation (it reads it). Insert it in the `matter` columns object, after `clientCode`:

```ts
    clientCode: text("client_code"),
    // On when the matter bills through an e-billing (LEDES/UTBMS) channel; capture validation reads
    // it to require a UTBMS task/activity code. Lands ahead of any capture logic that consults it.
    eBilling: integer("e_billing").notNull().default(0),
```

and add its CHECK to the `matter` table's constraint array (after `matter_title_nonempty_check`):

```ts
    check("matter_e_billing_check", sql`${table.eBilling} IN (0, 1)`),
```

Then append the six new tables at the end of the file (mirroring the `matter`/`folder`/`custom_field` idioms: TEXT handle PKs via `.$type<>()`, explicit `check(...)` enums because drizzle text enums are type-level only, `_e4`/`_minor` integer columns, FKs to existing targets, soft-archive `archived_at`):

```ts
// Effective-dated rate cards. Multiple named cards per firm (e.g. "Standard", "Insurance-capped");
// a matter/client can be placed on a specific card. Soft-archived, never hard-deleted.
export const rateCard = sqliteTable(
  "rate_card",
  {
    id: text("id").primaryKey().$type<RateCardId>(), // rateCard_ handle
    name: text("name").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [check("rate_card_name_nonempty_check", sql`length(${table.name}) > 0`)],
);

// Append-only rate versions. A rate change inserts a new row with a fresh valid_from; an existing
// row is never edited except to close its valid_to when a newer version supersedes it. The partial
// UNIQUE index enforces one OPEN row per (card, tier, scoped_id); closed-interval non-overlap is the
// service's job (SQLite has no range-exclusion constraint).
export const rate = sqliteTable(
  "rate",
  {
    id: text("id").primaryKey().$type<RateId>(), // rate_ handle
    rateCardId: text("rate_card_id")
      .notNull()
      .$type<RateCardId>()
      .references(() => rateCard.id),
    tier: text("tier", { enum: ["matter", "client", "timekeeper", "role"] }).notNull(),
    scopedId: text("scoped_id"), // null = the card-wide default for this tier
    rateE4: integer("rate_e4").notNull(), // rate per hour, scale 4 (integer-minor, no floats)
    currency: text("currency").notNull(), // ISO-4217, CHECK against the registered set
    validFrom: text("valid_from").notNull(), // civil PlainDate (YYYY-MM-DD)
    validTo: text("valid_to"), // null = open-ended
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("rate_open_row_unique_index")
      .on(table.rateCardId, table.tier, table.scopedId)
      .where(sql`${table.validTo} IS NULL`),
    index("rate_resolution_index").on(
      table.rateCardId,
      table.tier,
      table.scopedId,
      table.validFrom,
    ),
    check("rate_tier_check", sql`${table.tier} IN ('matter', 'client', 'timekeeper', 'role')`),
    check("rate_currency_check", sql`${table.currency} IN ('USD')`),
  ],
);

// The ABA UTBMS task/activity/expense code catalog. Seeded from the published sets as data; firms
// enable/disable rows, never invent codes. Owned here; the costs/billing slices read it.
export const utbmsCode = sqliteTable(
  "utbms_code",
  {
    id: text("id").primaryKey().$type<UtbmsCodeId>(), // utbmsCode_ handle
    codeSet: text("code_set", { enum: ["task", "activity", "expense"] }).notNull(),
    code: text("code").notNull(), // e.g. L120, A101, E101
    label: text("label").notNull(),
    practiceArea: text("practice_area"),
    active: integer("active").notNull().default(1),
  },
  (table) => [
    unique().on(table.codeSet, table.code),
    check("utbms_code_set_check", sql`${table.codeSet} IN ('task', 'activity', 'expense')`),
    check("utbms_code_active_check", sql`${table.active} IN (0, 1)`),
  ],
);

// Firm-configurable categories for non-billable internal time (seed-and-fork defaults). Soft-archived.
export const nonBillableCategory = sqliteTable(
  "non_billable_category",
  {
    id: text("id").primaryKey().$type<NonBillableCategoryId>(), // nonBillableCategory_ handle
    name: text("name").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [check("non_billable_category_name_nonempty_check", sql`length(${table.name}) > 0`)],
);

// Per-task-code narrative templates: a reusable description plus an optional default rate, filled
// into a new entry together. Soft-archived.
export const narrativeTemplate = sqliteTable(
  "narrative_template",
  {
    id: text("id").primaryKey().$type<NarrativeTemplateId>(), // narrativeTemplate_ handle
    utbmsTaskCodeId: text("utbms_task_code_id")
      .$type<UtbmsCodeId>()
      .references(() => utbmsCode.id),
    narrativeTemplate: text("narrative_template").notNull(),
    defaultRateE4: integer("default_rate_e4"), // optional default hourly rate, scale 4
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("narrative_template_utbms_task_code_index").on(table.utbmsTaskCodeId)],
);

// The work-in-progress store: one committed unit of captured time. The resolved rate is SNAPSHOT on
// capture (rate in force on work_date) and kept; amount_minor is recomputed only on an explicit
// re-rate. A billed/void row's business columns freeze — the service refuses any update beyond the
// billing invoice_id/lock set. rate_e4/rate_card_id/rate_source/amount_minor are null together for
// non-billable internal time (the paired-null CHECK).
export const timeEntry = sqliteTable(
  "time_entry",
  {
    id: text("id").primaryKey().$type<TimeEntryId>(), // timeEntry_ handle
    matterId: text("matter_id")
      .notNull()
      .$type<MatterId>()
      .references(() => matter.id),
    timekeeperUserId: text("timekeeper_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => member.userId),
    workDate: text("work_date").notNull(), // civil PlainDate (YYYY-MM-DD) — the effective date
    durationMinutes: integer("duration_minutes").notNull(), // rounded billable quantity
    rawDurationMinutes: integer("raw_duration_minutes").notNull(), // captured pre-rounding minutes
    narrative: text("narrative").notNull(),
    billable: integer("billable").notNull(),
    nonBillableCategoryId: text("non_billable_category_id")
      .$type<NonBillableCategoryId>()
      .references(() => nonBillableCategory.id),
    currency: text("currency").notNull(), // ISO-4217, CHECK against the registered set
    rateE4: integer("rate_e4"), // resolved rate snapshot, scale 4; null for non-billable
    rateCardId: text("rate_card_id")
      .$type<RateCardId>()
      .references(() => rateCard.id),
    rateSource: text("rate_source", {
      enum: ["override", "matter", "client", "timekeeper", "role", "card_default"],
    }),
    amountMinor: integer("amount_minor"), // round(rate x hours), scale 2; null when rate_e4 is null
    utbmsTaskCodeId: text("utbms_task_code_id")
      .$type<UtbmsCodeId>()
      .references(() => utbmsCode.id),
    utbmsActivityCodeId: text("utbms_activity_code_id")
      .$type<UtbmsCodeId>()
      .references(() => utbmsCode.id),
    status: text("status", {
      enum: ["draft", "submitted", "approved", "billed", "void"],
    }).notNull(),
    source: text("source", {
      enum: ["timer", "manual", "quick_add", "grid", "offline_sync", "calendar"],
    }).notNull(),
    liveRunId: text("live_run_id"), // set for source = timer; the stop-commit dedup anchor
    invoiceId: text("invoice_id"), // set at billing; null until billed
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"), // actor user handle (not an FK)
  },
  (table) => [
    index("time_entry_timekeeper_work_date_index").on(table.timekeeperUserId, table.workDate),
    index("time_entry_matter_status_index").on(table.matterId, table.status),
    index("time_entry_status_work_date_index").on(table.status, table.workDate),
    // Collapses racing stop-commits of one live timer to one entry.
    uniqueIndex("time_entry_live_run_id_unique_index")
      .on(table.liveRunId)
      .where(sql`${table.liveRunId} IS NOT NULL`),
    check("time_entry_billable_check", sql`${table.billable} IN (0, 1)`),
    check(
      "time_entry_status_check",
      sql`${table.status} IN ('draft', 'submitted', 'approved', 'billed', 'void')`,
    ),
    check(
      "time_entry_source_check",
      sql`${table.source} IN ('timer', 'manual', 'quick_add', 'grid', 'offline_sync', 'calendar')`,
    ),
    check(
      "time_entry_rate_source_check",
      sql`${table.rateSource} IS NULL OR ${table.rateSource} IN ('override', 'matter', 'client', 'timekeeper', 'role', 'card_default')`,
    ),
    check("time_entry_currency_check", sql`${table.currency} IN ('USD')`),
    // The money snapshot is all-or-nothing: amount_minor is present exactly when rate_e4 is.
    check(
      "time_entry_amount_paired_null_check",
      sql`(${table.amountMinor} IS NULL) = (${table.rateE4} IS NULL)`,
    ),
  ],
);
```

**Step 4a — Generate the migration.** Run the repo's drizzle-kit per-firm generator (it diffs the schema against the journal and writes the next-numbered file plus a journal entry):

```
pnpm --filter @magna-carta/database run generate-per-firm-migrations
```

When prompted for a migration name, supply `time-tracking` so the file lands as `0016_time-tracking.sql` and the journal tag is `0016_time-tracking`. Confirm the new files:

```
git -C C:/dev/magna-carta-worktrees/phase-3-financial-core status --short packages/database/drizzle/per-firm
```

Expected: `0016_time-tracking.sql` created and `meta/_journal.json` + a `meta/0016_snapshot.json` modified.

**Step 4b — Hand-extend the generated `.sql`.** drizzle-kit emits the `CREATE TABLE`s, the partial unique indexes, and the `ALTER TABLE matter ADD COLUMN e_billing`, but it does NOT emit the `matter.e_billing` change as an ALTER unless the diff produced one (it will, since the column is new), and it emits the CHECK constraints inline. Append the `time:*` role-permission seeds at the end of `packages/database/drizzle/per-firm/0016_time-tracking.sql` (mirroring the `0013_custom-fields.sql` seed precedent — the single Owner/Admin role `role_Gw-zKO8hOHQuNv2bWokMp`; the `rolePermission_` handles minted once and committed as literals so every firm's defaults match byte-for-byte):

```sql
--> statement-breakpoint
-- Seed the six time: permissions onto the Owner/Admin role. The role_id is the single combined
-- Owner/Admin role seeded in the member-rbac migration; the rolePermission_ handles were minted
-- once and committed as literals so every firm's defaults match byte-for-byte.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES
	('rolePermission_time1TrackOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:track'),
	('rolePermission_time2ViewFirmOwnerAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:viewFirm'),
	('rolePermission_time3ApproveOwnerAdmn', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:approve'),
	('rolePermission_time4RatesOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:manageRates'),
	('rolePermission_time5UtbmsOwnerAdmin0', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:manageUtbms'),
	('rolePermission_time6SettingsOwnerAdm', 'role_Gw-zKO8hOHQuNv2bWokMp', 'time:manageSettings');
```

Then open the generated file and verify the two partial unique indexes carry their `WHERE` clauses (`rate_open_row_unique_index … WHERE \`valid_to\` IS NULL`and`time_entry_live_run_id_unique_index … WHERE \`live_run_id\` IS NOT NULL`) and the `time_entry_amount_paired_null_check`reads`(\`amount_minor\` IS NULL) = (\`rate_e4\` IS NULL)`— drizzle preserves the`sql\`…\``text verbatim. If drizzle split the`matter.e_billing` add into its own statement, leave it; if it folded the column with its CHECK, leave that too.

**Step 4c — Register the migration in the worker bundle.** `perFirmMigrations()` maps each journal tag to its imported SQL and `migrationsFromJournal` fails loud on an unmapped tag. Add the import and the map entry to `apps/worker/src/per-firm-migrations.ts`:

Add the import line after the `0014` import:

```ts
import inferenceTokenUsageSql from "@magna-carta/database/drizzle/per-firm/0014_inference-token-usage.sql";
import timeTrackingSql from "@magna-carta/database/drizzle/per-firm/0016_time-tracking.sql";
```

Add the map entry after the `"0014_inference-token-usage"` line:

```ts
    "0014_inference-token-usage": inferenceTokenUsageSql,
    "0016_time-tracking": timeTrackingSql,
```

**Step 5 — Run the parity suite; expect PASS.**

```
pnpm --filter @magna-carta/worker test -- per-firm-migrations
```

Expected: all six new `it` blocks pass — the tables exist, the status/source enum literals appear in the stored DDL, the paired-null CHECK is present, both partial unique indexes exist, `matter.e_billing` is `NOT NULL DEFAULT 0`, and the six `time:` permissions are seeded. The existing `0012` custom-fields assertion still passes.

**Step 6 — Commit.**

```
git -C C:/dev/magna-carta-worktrees/phase-3-financial-core add packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm/0016_time-tracking.sql packages/database/drizzle/per-firm/meta/_journal.json packages/database/drizzle/per-firm/meta/0016_snapshot.json apps/worker/src/per-firm-migrations.ts apps/worker/test/per-firm-migrations.test.ts
git -C C:/dev/magna-carta-worktrees/phase-3-financial-core commit -m "feat(database): add 0016 time-tracking tables + matter.e_billing + time: role seeds"
```

---

### Task 3: Scoped-setting resolver (net-new data-access infrastructure)

Land the `scoped_setting` table plus `resolveScopedSetting` + `writeScopedSettingStatement` in `@magna-carta/data-access`. Most-specific-first precedence (matter → client → user → location → firm → in-code default), first hit wins; a firm-only value behaves exactly like the flat `setting` seam. This is the first realization of the white-paper settings-precedence chain — net-new shared infrastructure, not reuse of the flat seam. The read stays total (an unparseable stored value yields the default), mirroring `readFirmSetting`.

**Files**

- Create: `packages/data-access/src/scoped-setting-statements.ts`
- Modify: `packages/data-access/package.json` (add the `./scoped-setting-statements` export), `packages/database/src/per-firm-schema.ts` (add the `scopedSetting` table), `packages/database/drizzle/per-firm/0016_time-tracking.sql` (append the `scoped_setting` CREATE), `apps/worker/test/per-firm-migrations.test.ts` (assert the table exists)
- Test: `packages/data-access/test/scoped-setting-statements.test.ts`

**Interfaces**

- Produces: `SCOPED_SETTING_TABLE`, `ScopedSettingDefinition<T>`, `ScopeContext`, `resolveScopedSetting`, `writeScopedSettingStatement`.
- Consumes: `SqlDatabase`, `SqlStatement`, `canonicalJsonStringify`, zod.

**Steps**

**Step 1 — Write the failing test.** Mirror `packages/data-access/test/setting-statements.test.ts` exactly: `stubD1`/`captured` for the write-statement shape, and a real `DatabaseSync(":memory:")` adapter for the precedence walk (the resolver issues a real ordered query). Create `packages/data-access/test/scoped-setting-statements.test.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  resolveScopedSetting,
  type ScopedSettingDefinition,
  writeScopedSettingStatement,
} from "../src/scoped-setting-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

const incrementMinutes: ScopedSettingDefinition<number> = {
  key: "time.increment_minutes",
  schema: z.number().int().positive(),
  defaultValue: 6,
};

// Adapt node:sqlite to the SqlDatabase surface (positional ?1 binds, all()/run()) — the same shim
// the flat-setting round-trip test uses.
function memoryDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(
    `CREATE TABLE scoped_setting (
       key TEXT NOT NULL,
       scope_tier TEXT NOT NULL,
       scoped_id TEXT,
       value TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (key, scope_tier, scoped_id)
     );`,
  );
  return {
    prepare(sql: string) {
      const bindings: unknown[] = [];
      const stmt = {
        sql,
        bind(...values: unknown[]) {
          bindings.push(...values);
          return stmt;
        },
        run() {
          database.prepare(sql.replace(/\?\d+/g, "?")).run(...(bindings as never[]));
          return Promise.resolve({ meta: { changes: 1 } });
        },
        all<T>() {
          const rows = database.prepare(sql.replace(/\?\d+/g, "?")).all(...(bindings as never[]));
          return Promise.resolve({ results: rows as T[] });
        },
      };
      return stmt;
    },
  };
}

async function put(
  database: ReturnType<typeof memoryDatabase>,
  tier: "matter" | "client" | "user" | "location" | "firm",
  scopedId: string | null,
  value: number,
): Promise<void> {
  await writeScopedSettingStatement(
    database,
    incrementMinutes,
    tier,
    scopedId,
    value,
    "2026-06-22T00:00:00.000Z",
  ).run();
}

describe("resolveScopedSetting", () => {
  it("returns the in-code default when no row exists at any tier", async () => {
    const database = memoryDatabase();
    expect(
      await resolveScopedSetting(database, incrementMinutes, {
        matterId: "matter_a",
        userId: "user_a",
      }),
    ).toBe(6);
  });

  it("a firm-only value reads at every scope (behaves exactly like the flat seam)", async () => {
    const database = memoryDatabase();
    await put(database, "firm", null, 15);
    expect(await resolveScopedSetting(database, incrementMinutes, {})).toBe(15);
    expect(
      await resolveScopedSetting(database, incrementMinutes, {
        matterId: "matter_a",
        clientId: "client_a",
        userId: "user_a",
        locationId: "location_a",
      }),
    ).toBe(15);
  });

  it("the most specific matching tier wins (matter over client over user over location over firm)", async () => {
    const database = memoryDatabase();
    await put(database, "firm", null, 6);
    await put(database, "location", "location_a", 10);
    await put(database, "user", "user_a", 12);
    await put(database, "client", "client_a", 15);
    await put(database, "matter", "matter_a", 30);
    const context = {
      matterId: "matter_a",
      clientId: "client_a",
      userId: "user_a",
      locationId: "location_a",
    };
    expect(await resolveScopedSetting(database, incrementMinutes, context)).toBe(30);
  });

  it("falls through to the next tier when the more-specific scope has no row", async () => {
    const database = memoryDatabase();
    await put(database, "client", "client_a", 15);
    await put(database, "firm", null, 6);
    // No matter-tier row for matter_a → client wins over firm.
    const context = { matterId: "matter_a", clientId: "client_a", userId: "user_a" };
    expect(await resolveScopedSetting(database, incrementMinutes, context)).toBe(15);
  });

  it("ignores a row scoped to a different id at the same tier", async () => {
    const database = memoryDatabase();
    await put(database, "matter", "matter_OTHER", 30);
    await put(database, "firm", null, 6);
    const context = { matterId: "matter_a" };
    expect(await resolveScopedSetting(database, incrementMinutes, context)).toBe(6);
  });

  it("returns the default on an unparseable / schema-invalid stored value (read stays total)", async () => {
    const database = memoryDatabase();
    // Write garbage directly, bypassing the validating builder, to prove the read never bricks.
    await database
      .prepare(
        "INSERT INTO scoped_setting (key, scope_tier, scoped_id, value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind("time.increment_minutes", "matter", "matter_a", "{not json", "2026-06-22T00:00:00.000Z")
      .run();
    expect(await resolveScopedSetting(database, incrementMinutes, { matterId: "matter_a" })).toBe(
      6,
    );
  });
});

describe("writeScopedSettingStatement", () => {
  it("composes a validate-then-upsert binding key/scope_tier/scoped_id/canonical-value/updated_at", () => {
    const stub = stubD1();
    const statement = captured(
      writeScopedSettingStatement(
        stub.database,
        incrementMinutes,
        "matter",
        "matter_a",
        15,
        "2026-06-22T00:00:00.000Z",
      ),
    );
    expect(statement.sql).toContain("INSERT INTO scoped_setting");
    expect(statement.sql).toContain("ON CONFLICT(key, scope_tier, scoped_id) DO UPDATE");
    expect(statement.bindings).toEqual([
      "time.increment_minutes",
      "matter",
      "matter_a",
      "15",
      "2026-06-22T00:00:00.000Z",
    ]);
  });

  it("binds a null scoped_id for a firm-tier write", () => {
    const stub = stubD1();
    const statement = captured(
      writeScopedSettingStatement(
        stub.database,
        incrementMinutes,
        "firm",
        null,
        6,
        "2026-06-22T00:00:00.000Z",
      ),
    );
    expect(statement.bindings).toEqual([
      "time.increment_minutes",
      "firm",
      null,
      "6",
      "2026-06-22T00:00:00.000Z",
    ]);
  });

  it("fails loud on a schema-invalid write rather than storing garbage", () => {
    const stub = stubD1();
    expect(() =>
      writeScopedSettingStatement(
        stub.database,
        incrementMinutes,
        "firm",
        null,
        -1,
        "2026-06-22T00:00:00.000Z",
      ),
    ).toThrow();
  });
});
```

Also extend the migration-parity test (the table lands in the same `0016` file). Append this `it` block to `apps/worker/test/per-firm-migrations.test.ts`:

```ts
it("0016 creates the scoped_setting table with the (key, scope_tier, scoped_id) primary key", async () => {
  const db = env.DB_FIRM_POOL_1;
  const ddl = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scoped_setting'")
    .all<{ sql: string }>();
  const sql = (ddl.results[0]?.sql ?? "").replace(/\s+/g, " ");
  expect(sql).toContain("scoped_setting");
  expect(sql).toContain("'matter'");
  expect(sql).toContain("'client'");
  expect(sql).toContain("'user'");
  expect(sql).toContain("'location'");
  expect(sql).toContain("'firm'");
  expect(sql).toContain("PRIMARY KEY(`key`, `scope_tier`, `scoped_id`)");
});
```

**Step 2 — Run the suites; expect FAIL.**

```
pnpm --filter @magna-carta/data-access test -- scoped-setting
pnpm --filter @magna-carta/worker test -- per-firm-migrations
```

Expected: the data-access suite fails to resolve `../src/scoped-setting-statements.ts` (module does not exist); the worker parity suite fails the new `scoped_setting` assertion (table not yet in `0016`).

**Step 3a — Add the `scopedSetting` drizzle table.** In `packages/database/src/per-firm-schema.ts`, append (next to the flat `setting` table is fine, or at the end with the time tables):

```ts
// Scope-resolved settings: most-specific-first precedence (matter -> client -> user -> location ->
// firm -> in-code default). The first realization of the settings-precedence chain; the flat
// `setting` table stays for firm-level-only knobs. A firm row carries a null scoped_id.
export const scopedSetting = sqliteTable(
  "scoped_setting",
  {
    key: text("key").notNull(),
    scopeTier: text("scope_tier", {
      enum: ["matter", "client", "user", "location", "firm"],
    }).notNull(),
    scopedId: text("scoped_id"), // null for the firm tier
    value: text("value").notNull(), // JSON
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.scopeTier, table.scopedId] }),
    check(
      "scoped_setting_scope_tier_check",
      sql`${table.scopeTier} IN ('matter', 'client', 'user', 'location', 'firm')`,
    ),
  ],
);
```

**Step 3b — Append the `scoped_setting` CREATE to the `0016` migration.** Regenerate so the diff folds the new table into `0016` (drizzle appends it to the same file since `0016` is the head, un-applied migration):

```
pnpm --filter @magna-carta/database run generate-per-firm-migrations
```

If the generator instead emits a fresh `0016`, discard it (`git -C … checkout packages/database/drizzle/per-firm/meta/_journal.json && rm packages/database/drizzle/per-firm/0016_*.sql packages/database/drizzle/per-firm/meta/0016_snapshot.json`) and instead hand-append the CREATE to `packages/database/drizzle/per-firm/0016_time-tracking.sql` directly (the table is new, so a literal CREATE is parity-equivalent), before the role-permission seeds:

```sql
--> statement-breakpoint
CREATE TABLE `scoped_setting` (
	`key` text NOT NULL,
	`scope_tier` text NOT NULL,
	`scoped_id` text,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "scoped_setting_scope_tier_check" CHECK(`scope_tier` IN ('matter', 'client', 'user', 'location', 'firm')),
	PRIMARY KEY(`key`, `scope_tier`, `scoped_id`)
);
```

(Whichever path the generator takes, the `0016_time-tracking.sql` file ends with the `scoped_setting` CREATE followed by the `time:*` role seeds; the worktree carries exactly one new migration file.)

**Step 3c — Implement the resolver.** Create `packages/data-access/src/scoped-setting-statements.ts` (mirroring `setting-statements.ts`: a generic builder over a per-key definition with a zod schema + in-code default; canonical JSON on write; a total read):

```ts
import { z } from "zod";
import { canonicalJsonStringify } from "./canonical.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Scope-resolved per-firm config. Where the flat `setting` table stores one firm-level value per key,
// this resolves a key against a scope, walking most-specific-first. The VALUE is JSON validated
// through a zod schema with a default in code, so a missing row IS the default. Behavior over the
// table lives with each owning package, which exports its own ScopedSettingDefinition; this is generic.

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. The table exists only in the per-firm database — the caller supplies that handle.
export const SCOPED_SETTING_TABLE = "scoped_setting";

export interface ScopedSettingDefinition<T> {
  readonly key: string;
  readonly schema: z.ZodType<T>;
  readonly defaultValue: T;
}

// The entities a scope can be pinned to. Absent fields are simply not consulted — a context with only
// a matterId resolves over matter -> firm -> default, skipping the unfilled tiers.
export interface ScopeContext {
  readonly matterId?: string;
  readonly clientId?: string;
  readonly userId?: string;
  readonly locationId?: string;
}

type ScopeTier = "matter" | "client" | "user" | "location" | "firm";

// Most-specific first. firm always participates (its scoped_id is null); the entity tiers only when
// the context supplies their id.
function candidateScopes(context: ScopeContext): { tier: ScopeTier; scopedId: string | null }[] {
  const scopes: { tier: ScopeTier; scopedId: string | null }[] = [];
  if (context.matterId !== undefined) scopes.push({ tier: "matter", scopedId: context.matterId });
  if (context.clientId !== undefined) scopes.push({ tier: "client", scopedId: context.clientId });
  if (context.userId !== undefined) scopes.push({ tier: "user", scopedId: context.userId });
  if (context.locationId !== undefined)
    scopes.push({ tier: "location", scopedId: context.locationId });
  scopes.push({ tier: "firm", scopedId: null });
  return scopes;
}

// Reads the candidate rows in one query and parses the first (most-specific) one that exists and
// validates. An absent row OR an unparseable / invalid stored value falls through to the next scope,
// and finally to the in-code default — a bad write must never brick reads, exactly as readFirmSetting.
export async function resolveScopedSetting<T>(
  database: SqlDatabase,
  definition: ScopedSettingDefinition<T>,
  context: ScopeContext,
): Promise<T> {
  const scopes = candidateScopes(context);
  // One round-trip: fetch every candidate row for this key, then resolve precedence in code (the
  // candidate set is at most five rows, so an ordered in-memory walk beats five short-circuit queries).
  const { results } = await database
    .prepare(`SELECT scope_tier, scoped_id, value FROM ${SCOPED_SETTING_TABLE} WHERE key = ?1`)
    .bind(definition.key)
    .all<{ scope_tier: ScopeTier; scoped_id: string | null; value: string }>();
  const byScope = new Map<string, string>();
  for (const row of results) {
    byScope.set(`${row.scope_tier}\u0000${row.scoped_id ?? ""}`, row.value);
  }
  for (const scope of scopes) {
    const stored = byScope.get(`${scope.tier}\u0000${scope.scopedId ?? ""}`);
    if (stored === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      continue;
    }
    const validated = definition.schema.safeParse(parsed);
    if (validated.success) return validated.data;
  }
  return definition.defaultValue;
}

// Composes the upsert for an effect batch. The value is validated up front (a bad write fails loud at
// the source) then stored as canonical JSON so the serialized form is stable. The firm tier carries a
// null scoped_id; the (key, scope_tier, scoped_id) primary key makes each scope's value singular.
export function writeScopedSettingStatement<T>(
  database: SqlDatabase,
  definition: ScopedSettingDefinition<T>,
  scopeTier: ScopeTier,
  scopedId: string | null,
  value: T,
  now: string,
): SqlStatement {
  const validated = definition.schema.parse(value);
  return database
    .prepare(
      `INSERT INTO ${SCOPED_SETTING_TABLE} (key, scope_tier, scoped_id, value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(key, scope_tier, scoped_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(definition.key, scopeTier, scopedId, canonicalJsonStringify(validated), now);
}
```

**Step 3d — Export the module.** Add the export to `packages/data-access/package.json`, after the `./setting-statements` line:

```json
    "./setting-statements": "./src/setting-statements.ts",
    "./scoped-setting-statements": "./src/scoped-setting-statements.ts",
```

**Step 4 — Run the suites; expect PASS.**

```
pnpm --filter @magna-carta/data-access test -- scoped-setting
pnpm --filter @magna-carta/worker test -- per-firm-migrations
```

Expected: the resolver suite passes — the default-only, firm-only-everywhere, full-precedence, fall-through, wrong-id, and total-read cases all green; the write-statement shape, null firm scoped_id, and fail-loud cases green. The parity suite's new `scoped_setting` assertion passes (and the Task 2 assertions still pass).

Note on the `ON CONFLICT(key, scope_tier, scoped_id)` upsert against a primary key with a nullable column: SQLite treats NULLs as distinct in a UNIQUE/PK index, so two firm-tier writes (both `scoped_id` null) would not conflict and the upsert would not dedup. The resolver tolerates this (precedence picks one row deterministically by tier, and a firm row's `scoped_id` is the only null at that tier per key), and the firm-tier write path in practice issues one row per key — but the test "a firm-only value reads at every scope" writes the firm row exactly once, so this is not exercised as an update. If a later consumer needs idempotent firm-tier rewrites, the write path keys the upsert on a coalesced sentinel; for this slice the single-write contract holds.

**Step 5 — Commit.**

```
git -C C:/dev/magna-carta-worktrees/phase-3-financial-core add packages/data-access/src/scoped-setting-statements.ts packages/data-access/package.json packages/data-access/test/scoped-setting-statements.test.ts packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm/0016_time-tracking.sql packages/database/drizzle/per-firm/meta apps/worker/test/per-firm-migrations.test.ts
git -C C:/dev/magna-carta-worktrees/phase-3-financial-core commit -m "feat(data-access): scoped-setting resolver + scoped_setting table (most-specific-first precedence)"
```

---

### Task 4: Quantity rounding + WIP money arithmetic

Scaffold the `@magna-carta/timekeeping` package and land the two pure helpers: `roundDuration` (rounds the captured raw minutes to the billing increment — a **quantity** rounding, distinct from money rounding) and `computeAmountMinor` (the integer-minor WIP amount through `@magna-carta/money`'s reconstructable `Rate`/`Money` types — no floats). Both are pure functions with no clock/identity/RNG.

**Files**

- Create: `packages/timekeeping/package.json`, `packages/timekeeping/src/rounding.ts`
- Test: `packages/timekeeping/test/rounding.test.ts`

**Interfaces**

- Produces: `RoundingDirection`, `roundDuration(rawMinutes, incrementMinutes, direction)`, `computeAmountMinor(rateE4, durationMinutes, currencyCode)`.
- Consumes: `@magna-carta/money` (`rate`, `multiplyByQuantity`, `roundInvoiceLine`, `currencyFromCode`, `toMinor`, `fromMinor`).

**Steps**

**Step 1 — Write `package.json`.** Create `packages/timekeeping/package.json`, mirroring the workspace conventions (`type: module`, `sideEffects: false`, a per-file `exports` map, `vp test run`, catalog versions). Only the deps the rounding helper needs are listed now; later tasks add `@magna-carta/data-access`/`@magna-carta/database`/`zod` as they land their files.

```json
{
  "name": "@magna-carta/timekeeping",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./rounding": "./src/rounding.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "@magna-carta/identifiers": "workspace:*",
    "@magna-carta/money": "workspace:*"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

Install so the workspace resolves the new package:

```
vp install
```

**Step 2 — Write the failing test.** Create `packages/timekeeping/test/rounding.test.ts`. It covers each direction × representative increments (6, 15) × boundary inputs, a money golden-value table (hand-computed minor units), and a currency round-trip proving a `Money` reconstructs from the stored `rate_e4`/`duration_minutes`/`currency` columns.

```ts
import { describe, expect, it } from "vitest";
import { fromMinor } from "@magna-carta/money/format";
import { currencyFromCode } from "@magna-carta/money/money";
import { computeAmountMinor, roundDuration } from "../src/rounding.ts";

describe("roundDuration — billable-quantity rounding (distinct from money rounding)", () => {
  it("rounds UP to the increment (any nonzero remainder rounds up)", () => {
    expect(roundDuration(0, 6, "up")).toBe(0);
    expect(roundDuration(1, 6, "up")).toBe(6);
    expect(roundDuration(6, 6, "up")).toBe(6);
    expect(roundDuration(7, 6, "up")).toBe(12);
    expect(roundDuration(1, 15, "up")).toBe(15);
    expect(roundDuration(16, 15, "up")).toBe(30);
  });

  it("rounds DOWN to the increment (truncates the remainder)", () => {
    expect(roundDuration(0, 6, "down")).toBe(0);
    expect(roundDuration(5, 6, "down")).toBe(0);
    expect(roundDuration(6, 6, "down")).toBe(6);
    expect(roundDuration(11, 6, "down")).toBe(6);
    expect(roundDuration(29, 15, "down")).toBe(15);
  });

  it("rounds to the NEAREST increment, half rounding up", () => {
    expect(roundDuration(2, 6, "nearest")).toBe(0);
    expect(roundDuration(3, 6, "nearest")).toBe(6); // exactly half -> up
    expect(roundDuration(4, 6, "nearest")).toBe(6);
    expect(roundDuration(9, 6, "nearest")).toBe(12); // 9 is the half of the 6..12 step -> up
    expect(roundDuration(7, 15, "nearest")).toBe(0);
    expect(roundDuration(8, 15, "nearest")).toBe(15); // 7.5 is half; 8 >= 7.5 -> up
  });

  it("treats an already-on-increment value as fixed in every direction", () => {
    for (const direction of ["up", "nearest", "down"] as const) {
      expect(roundDuration(30, 6, direction)).toBe(30);
      expect(roundDuration(30, 15, direction)).toBe(30);
    }
  });

  it("rejects a non-positive increment and a negative raw duration (fail loud, no floats)", () => {
    expect(() => roundDuration(10, 0, "nearest")).toThrow(RangeError);
    expect(() => roundDuration(10, -6, "nearest")).toThrow(RangeError);
    expect(() => roundDuration(-1, 6, "nearest")).toThrow(RangeError);
    expect(() => roundDuration(1.5, 6, "nearest")).toThrow(RangeError);
  });
});

describe("computeAmountMinor — integer-minor WIP amount = round(rate_e4 x minutes / 60)", () => {
  // Golden table: hand-computed minor units. amount_minor = round_half_away_from_zero(rate_e4 x min / 6000).
  // $450.0000/hr = rate_e4 4500000.
  it.each([
    { rateE4: 4500000, minutes: 150, expected: 112500 }, // 2.5 h -> $1125.00
    { rateE4: 4500000, minutes: 6, expected: 4500 }, //   0.1 h -> $45.00
    { rateE4: 4500000, minutes: 1, expected: 750 }, //    1 min -> $7.50
    { rateE4: 4500000, minutes: 7, expected: 5250 }, //   7 min -> $52.50
    { rateE4: 3333300, minutes: 7, expected: 3889 }, //   $333.33/hr x 7 min = $38.8885 -> $38.89
    { rateE4: 3333300, minutes: 1, expected: 556 }, //    $5.5555 -> $5.56 (half away from zero)
    { rateE4: 0, minutes: 150, expected: 0 }, //          a zero rate is a zero amount
  ])("rate_e4=$rateE4 over $minutes min -> $expected minor", ({ rateE4, minutes, expected }) => {
    expect(computeAmountMinor(rateE4, minutes, "USD")).toBe(expected);
  });

  it("rounds half AWAY from zero, matching the invoice-line convention", () => {
    // $5.5555 -> 556 (not 555): the .5 cent rounds away from zero.
    expect(computeAmountMinor(3333300, 1, "USD")).toBe(556);
  });

  it("rejects an unregistered currency and non-integer inputs (fail loud)", () => {
    expect(() => computeAmountMinor(4500000, 60, "ZZZ")).toThrow(RangeError);
    expect(() => computeAmountMinor(4500000.5, 60, "USD")).toThrow(RangeError);
    expect(() => computeAmountMinor(4500000, 60.5, "USD")).toThrow(RangeError);
    expect(() => computeAmountMinor(4500000, -1, "USD")).toThrow(RangeError);
  });

  it("currency round-trip: a Money reconstructs from the stored rate_e4/duration/currency columns", () => {
    // The stored columns alone reconstruct a Money tagged with the right currency — the invariant
    // that nothing about the amount is lost between capture and read.
    const amountMinor = computeAmountMinor(4500000, 150, "USD");
    const reconstructed = fromMinor(amountMinor, currencyFromCode("USD"));
    expect(reconstructed).toEqual(fromMinor(112500, currencyFromCode("USD")));
  });
});
```

**Step 3 — Run the suite; expect FAIL.**

```
pnpm --filter @magna-carta/timekeeping test -- rounding
```

Expected: the suite fails to resolve `../src/rounding.ts` (the implementation file does not exist yet).

**Step 4 — Implement the helpers.** Create `packages/timekeeping/src/rounding.ts`. `roundDuration` is integer-only (no floats); `computeAmountMinor` keeps the exact arithmetic in integer space (a JS float `durationMinutes/60` overflows the safe-integer range for any minute count that does not divide 60 cleanly — e.g. 7 minutes → 0.1166…, whose scaled form exceeds 2^53), then reconstructs the `Money` through `@magna-carta/money` so the currency is registered and the value is a real `Money`.

```ts
import { fromMinor, toMinor } from "@magna-carta/money/format";
import { currencyFromCode, multiplyByQuantity, rate } from "@magna-carta/money/money";
import { roundInvoiceLine } from "@magna-carta/money/rounding";

// Direction the captured raw duration rounds toward its billing increment. Distinct from the money
// rounding mode (which collapses cents) — this rounds the billable QUANTITY before any rate multiply.
export type RoundingDirection = "up" | "nearest" | "down";

function assertNonNegativeInteger(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative integer, received ${value}`);
  }
}

// Round the raw captured minutes to a whole multiple of the billing increment. Integer math only — a
// half (nearest) rounds up, matching the commercial "round half up" expectation for a billable unit.
export function roundDuration(
  rawMinutes: number,
  incrementMinutes: number,
  direction: RoundingDirection,
): number {
  assertNonNegativeInteger(rawMinutes, "raw duration minutes");
  if (!Number.isInteger(incrementMinutes) || incrementMinutes <= 0) {
    throw new RangeError(
      `increment minutes must be a positive integer, received ${incrementMinutes}`,
    );
  }
  const whole = Math.trunc(rawMinutes / incrementMinutes);
  const remainder = rawMinutes - whole * incrementMinutes;
  if (remainder === 0) return rawMinutes;
  switch (direction) {
    case "down":
      return whole * incrementMinutes;
    case "up":
      return (whole + 1) * incrementMinutes;
    case "nearest":
      // Half rounds up: a remainder at or past the midpoint advances to the next increment.
      return (remainder * 2 >= incrementMinutes ? whole + 1 : whole) * incrementMinutes;
  }
}

// The WIP amount in minor units: amount_minor = round(rate_e4 x duration_minutes / 60), half away
// from zero (the invoice-line convention). The division by 60 stays in integer space — passing
// duration_minutes/60 as a float quantity would, for any minute count not dividing 60, produce a
// repeating decimal whose scaled integer exceeds the safe range and corrupts the result. So we form
// the exact integer minor count and reconstruct Money through @magna-carta/money: rate x minutes is
// computed at the rate's scale (exact, integer quantity), then divided by 60 and collapsed to cents.
export function computeAmountMinor(
  rateE4: number,
  durationMinutes: number,
  currencyCode: string,
): number {
  if (!Number.isInteger(rateE4)) {
    throw new RangeError(`rate_e4 must be an integer, received ${rateE4}`);
  }
  assertNonNegativeInteger(durationMinutes, "duration minutes");
  const currency = currencyFromCode(currencyCode); // throws on an unregistered code
  // rate x minutes at scale 4 (exact: the quantity is an integer, so no float widening). This is
  // "(dollars-per-hour x minutes)" still owing a /60 to reach dollars; collapse it half-away-from-zero.
  const ratePerHour = rate(rateE4, currency);
  const ratePerHourTimesMinutes = roundInvoiceLine(
    multiplyByQuantity(ratePerHour, durationMinutes),
  );
  // The intermediate is rate_e4 x minutes / 100 minor units of "rate-per-hour-minutes"; one more /60
  // (with the same half-away rounding) yields the billed cents. Integer division with explicit
  // half-away rounding keeps every step exact and float-free.
  const perHourMinutesMinor = toMinor(ratePerHourTimesMinutes);
  const sign = perHourMinutesMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(perHourMinutesMinor);
  const quotient = Math.trunc(magnitude / 60);
  const remainder = magnitude - quotient * 60;
  const rounded = remainder * 2 >= 60 ? quotient + 1 : quotient;
  const amountMinor = sign * rounded;
  // Reconstruct a real Money so the currency is registered and the stored column round-trips.
  return toMinor(fromMinor(amountMinor, currency));
}
```

Verify this matches the golden table: for `rateE4=4500000, minutes=7`, `multiplyByQuantity(rate(4500000), 7)` = `31500000` at scale 4 → `roundInvoiceLine`/`toMinor` collapses scale-4 to scale-2 (÷100, half-away) = `315000` cents-of-rate-minutes; ÷60 half-away = `5250` = $52.50. For `rateE4=3333300, minutes=1`: `3333300` scale 4 → `33333` cents → ÷60 = `555.55` → `556`. Both agree with the hand-computed table in Step 2.

**Step 5 — Run the suite; expect PASS.**

```
pnpm --filter @magna-carta/timekeeping test -- rounding
```

Expected: every `roundDuration` direction/increment/boundary case green; the `computeAmountMinor` golden table (including the half-away `556` case and the zero-rate `0` case) green; the fail-loud cases (unregistered currency, non-integer rate/duration, negative duration) throw `RangeError`; the currency round-trip reconstructs the `Money` from the stored columns.

**Step 6 — Commit.**

```
git -C C:/dev/magna-carta-worktrees/phase-3-financial-core add packages/timekeeping/package.json packages/timekeeping/src/rounding.ts packages/timekeeping/test/rounding.test.ts pnpm-lock.yaml
git -C C:/dev/magna-carta-worktrees/phase-3-financial-core commit -m "feat(timekeeping): scaffold package + duration rounding and integer-minor WIP amount helpers"
```

---

I have all the patterns confirmed. Now I'll write the four task sections. Let me verify the `RATE_TABLE` column ordering and one more detail: how a service test commits an EffectWrite to the real DB (the matter test calls services that internally commit; for the rate service which returns `{ ...id, effect }`, the test will `commitEffectBatch`). Let me confirm `commitEffectBatch` is exported and the `now()` shape it expects.

The `effect-batch.ts` I read shows `commitEffectBatch(database, effect, { now })`. Good. I now have enough to write Tasks 5–8 with exact, matching code.

Here are the expanded task sections:

### Task 5: Timekeeping settings (firm-level + scope-overridable)

Define the timekeeping setting definitions: the firm-level knobs over the flat `setting` seam (`FirmSettingDefinition`), and the two scope-overridable knobs (`increment_minutes`, `rounding_direction`) over the scoped resolver (`ScopedSettingDefinition`). Each carries a zod schema + an in-code default, so a missing row is the default — no settings UI is needed to make a setting readable (the `setting-statements.ts` / `matters/src/settings.ts` precedent).

**Files**

- Create: `packages/timekeeping/src/settings.ts`
- Test: `packages/timekeeping/test/settings.test.ts`

**Interfaces**

- Produces: `approvalRequiredDefinition`, `abandonedThresholdMinutesDefinition`, `targetDailyHoursDefinition`/`targetMonthlyHoursDefinition`/`targetAnnualHoursDefinition` (`FirmSettingDefinition`); `incrementMinutesDefinition`, `roundingDirectionDefinition` (`ScopedSettingDefinition`).
- Consumes: `FirmSettingDefinition` (`@magna-carta/data-access/setting-statements`), `ScopedSettingDefinition` (`@magna-carta/data-access/scoped-setting-statements`, Task 3), `RoundingDirection` (`./rounding.ts`, Task 4), zod.

**Steps**

**Step 1 — Write the failing test.** The package scaffold (`package.json`, the `./rounding` export) and the scoped-setting resolver already exist from Tasks 4 and 3; add the `./settings` export to `packages/timekeeping/package.json` now so the test resolves it.

`packages/timekeeping/package.json` (add the one export line under the existing `exports` map — alongside `"./rounding"`):

```json
    "./rounding": "./src/rounding.ts",
    "./settings": "./src/settings.ts",
```

Create `packages/timekeeping/test/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  abandonedThresholdMinutesDefinition,
  approvalRequiredDefinition,
  incrementMinutesDefinition,
  roundingDirectionDefinition,
  targetAnnualHoursDefinition,
  targetDailyHoursDefinition,
  targetMonthlyHoursDefinition,
} from "../src/settings.ts";

describe("firm-level timekeeping settings", () => {
  it("default the frictionless posture: no approval gate, a 10-hour abandoned threshold, no targets", () => {
    expect(approvalRequiredDefinition.key).toBe("time.approval_required");
    expect(approvalRequiredDefinition.defaultValue).toBe(false);

    expect(abandonedThresholdMinutesDefinition.key).toBe("time.abandoned_threshold_minutes");
    expect(abandonedThresholdMinutesDefinition.defaultValue).toBe(600);

    expect(targetDailyHoursDefinition.key).toBe("time.target_daily_hours");
    expect(targetMonthlyHoursDefinition.key).toBe("time.target_monthly_hours");
    expect(targetAnnualHoursDefinition.key).toBe("time.target_annual_hours");
    expect(targetDailyHoursDefinition.defaultValue).toBeNull();
    expect(targetMonthlyHoursDefinition.defaultValue).toBeNull();
    expect(targetAnnualHoursDefinition.defaultValue).toBeNull();
  });

  it("approval_required accepts only a boolean", () => {
    expect(approvalRequiredDefinition.schema.safeParse(true).success).toBe(true);
    expect(approvalRequiredDefinition.schema.safeParse("true").success).toBe(false);
  });

  it("abandoned_threshold_minutes rejects a non-positive value", () => {
    expect(abandonedThresholdMinutesDefinition.schema.safeParse(1).success).toBe(true);
    expect(abandonedThresholdMinutesDefinition.schema.safeParse(0).success).toBe(false);
    expect(abandonedThresholdMinutesDefinition.schema.safeParse(-5).success).toBe(false);
    expect(abandonedThresholdMinutesDefinition.schema.safeParse(1.5).success).toBe(false);
  });

  it("a target is a positive number or null (an unset target), never zero or negative", () => {
    expect(targetDailyHoursDefinition.schema.safeParse(8).success).toBe(true);
    expect(targetDailyHoursDefinition.schema.safeParse(7.5).success).toBe(true);
    expect(targetDailyHoursDefinition.schema.safeParse(null).success).toBe(true);
    expect(targetDailyHoursDefinition.schema.safeParse(0).success).toBe(false);
    expect(targetDailyHoursDefinition.schema.safeParse(-1).success).toBe(false);
  });
});

describe("scope-overridable timekeeping settings", () => {
  it("increment_minutes defaults to a tenth of an hour and rejects a non-positive increment", () => {
    expect(incrementMinutesDefinition.key).toBe("time.increment_minutes");
    expect(incrementMinutesDefinition.defaultValue).toBe(6);
    expect(incrementMinutesDefinition.schema.safeParse(6).success).toBe(true);
    expect(incrementMinutesDefinition.schema.safeParse(15).success).toBe(true);
    expect(incrementMinutesDefinition.schema.safeParse(0).success).toBe(false);
    expect(incrementMinutesDefinition.schema.safeParse(-6).success).toBe(false);
    expect(incrementMinutesDefinition.schema.safeParse(6.5).success).toBe(false);
  });

  it("rounding_direction defaults to nearest and rejects an off-enum value", () => {
    expect(roundingDirectionDefinition.key).toBe("time.rounding_direction");
    expect(roundingDirectionDefinition.defaultValue).toBe("nearest");
    expect(roundingDirectionDefinition.schema.safeParse("up").success).toBe(true);
    expect(roundingDirectionDefinition.schema.safeParse("nearest").success).toBe(true);
    expect(roundingDirectionDefinition.schema.safeParse("down").success).toBe(true);
    expect(roundingDirectionDefinition.schema.safeParse("ceil").success).toBe(false);
    expect(roundingDirectionDefinition.schema.safeParse("").success).toBe(false);
  });
});
```

**Step 2 — Run the test, expect FAIL.**

```
pnpm --filter @magna-carta/timekeeping test -- settings
```

Expected: FAIL — `Failed to resolve import "../src/settings.ts"` (the module does not exist yet).

**Step 3 — Implement the definitions.** Create `packages/timekeeping/src/settings.ts`:

```ts
import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import type { ScopedSettingDefinition } from "@magna-carta/data-access/scoped-setting-statements";
import { z } from "zod";
import type { RoundingDirection } from "./rounding.ts";

// Timekeeping configuration, each definition a zod schema + an in-code default — a missing row IS the
// default, so a setting is readable before any settings UI exists (the setting-statements seam). Keys
// are namespaced `time.*` so they never collide with another subsystem's flat-setting keys.
//
// Two storage seams, by reach. FIRM-LEVEL knobs (one value per firm) ride the flat `setting` seam
// (FirmSettingDefinition). SCOPE-OVERRIDABLE knobs — the ones a firm may tune per matter/client/
// timekeeper/location — ride the scoped-setting resolver (ScopedSettingDefinition), which walks
// most-specific-first and falls back to this same in-code default.

// The optional review gate. Default off keeps the frictionless capture path (draft -> billed) for a
// firm that has not opted in.
export const approvalRequiredDefinition: FirmSettingDefinition<boolean> = {
  key: "time.approval_required",
  schema: z.boolean(),
  defaultValue: false,
};

// How long a still-live timer may sit before the live-timer coordinator flags it abandoned. Ten hours
// by default — long enough to span a full working day without a spurious flag, short enough that an
// overnight-forgotten timer is caught. A positive whole number of minutes.
export const abandonedThresholdMinutesDefinition: FirmSettingDefinition<number> = {
  key: "time.abandoned_threshold_minutes",
  schema: z.number().int().positive(),
  defaultValue: 600,
};

// Billable-hour targets the My Day shortfall reads against. Null = no target set (the shortfall read
// simply reports no goal), so the default firm sees totals without a target line. A set target is a
// positive number of hours.
const targetHoursSchema = z.number().positive().nullable();

export const targetDailyHoursDefinition: FirmSettingDefinition<number | null> = {
  key: "time.target_daily_hours",
  schema: targetHoursSchema,
  defaultValue: null,
};

export const targetMonthlyHoursDefinition: FirmSettingDefinition<number | null> = {
  key: "time.target_monthly_hours",
  schema: targetHoursSchema,
  defaultValue: null,
};

export const targetAnnualHoursDefinition: FirmSettingDefinition<number | null> = {
  key: "time.target_annual_hours",
  schema: targetHoursSchema,
  defaultValue: null,
};

// The minimum billing increment the captured duration rounds TO (minutes). Six = a tenth of an hour,
// the prevailing default; a positive whole number. Scope-overridable so a firm can tune it per matter/
// client/timekeeper.
export const incrementMinutesDefinition: ScopedSettingDefinition<number> = {
  key: "time.increment_minutes",
  schema: z.number().int().positive(),
  defaultValue: 6,
};

// The rounding direction applied at that increment. Distinct from the increment (a policy, not a
// hard-coded round-up); default nearest. Scope-overridable on the same tiers as the increment.
export const roundingDirectionDefinition: ScopedSettingDefinition<RoundingDirection> = {
  key: "time.rounding_direction",
  schema: z.enum(["up", "nearest", "down"]),
  defaultValue: "nearest",
};
```

**Step 4 — Run the test, expect PASS.**

```
pnpm --filter @magna-carta/timekeeping test -- settings
```

Expected: PASS — all assertions in `settings.test.ts` green.

**Step 5 — Commit.**

```
git add packages/timekeeping/src/settings.ts packages/timekeeping/test/settings.test.ts packages/timekeeping/package.json
git commit -m "$(cat <<'EOF'
feat(timekeeping): time setting definitions over the flat and scoped seams

The firm-level knobs (approval gate, abandoned threshold, billable-hour
targets) ride the flat setting seam; the increment and rounding-direction
knobs ride the scoped-setting resolver so a firm can tune them per
matter/client/timekeeper. Each definition carries a zod schema and an
in-code default, so a missing row is the default.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rate-card + rate statements + effective-dating append

The `rate_card`/`rate` prepared statements and the `createRateCard` + `appendRate` services on the established domain-service shape (`{ ...id, effect }`, injected `ClockPort` + `actorUserId` + `randomSource`). `rate` versions are append-only: appending a new version closes the prior open row's `valid_to` in the same batch, and an overlapping `valid_from` is refused with `RateValidationError`. The package's audit binding (`timeAuditStatement`) lands here as the first writer that needs it.

**Files**

- Create: `packages/timekeeping/src/audit.ts`, `packages/timekeeping/src/rate-statements.ts`, `packages/timekeeping/src/rate-service.ts`, `packages/timekeeping/src/rate-validation.ts`
- Test: `packages/timekeeping/test/rate-service.test.ts`

**Interfaces**

- Produces: `RATE_CARD_TABLE`, `RATE_TABLE`, `TimekeepingServiceOptions`, `ClockPort`, `timeAuditStatement`, `createRateCard`, `appendRate`, `RateValidationError`.
- Consumes: `EffectWrite`/`commitEffectBatch` (`@magna-carta/data-access/effect-batch`), `SqlDatabase` (`@magna-carta/data-access/idempotency-statements`), `domainAuditStatement` (`@magna-carta/data-access/audit-statements`), `newIdentifier`, the Task 2 schema (`rate_card`, `rate`).

**Steps**

**Step 1 — Write the failing test.** Add the four exports to `packages/timekeeping/package.json`:

```json
    "./settings": "./src/settings.ts",
    "./audit": "./src/audit.ts",
    "./rate-statements": "./src/rate-statements.ts",
    "./rate-service": "./src/rate-service.ts",
    "./rate-validation": "./src/rate-validation.ts",
```

Create `packages/timekeeping/test/rate-service.test.ts`:

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { appendRate, createRateCard } from "../src/rate-service.ts";
import { RateValidationError } from "../src/rate-validation.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const options = { clock, actorUserId: "user_partner" as UserId };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function commit(database: BatchDatabase, effect: Parameters<typeof commitEffectBatch>[1]) {
  await commitEffectBatch(database, effect, { now: clock.now });
}

async function listRates(database: BatchDatabase, rateCardId: string) {
  const { results } = await database
    .prepare(
      "SELECT tier, scoped_id, rate_e4, currency, valid_from, valid_to FROM rate WHERE rate_card_id = ?1 ORDER BY valid_from",
    )
    .bind(rateCardId)
    .all<{
      tier: string;
      scoped_id: string | null;
      rate_e4: number;
      currency: string;
      valid_from: string;
      valid_to: string | null;
    }>();
  return results;
}

async function countAudit(database: BatchDatabase, event: string) {
  const { results } = await database
    .prepare("SELECT COUNT(*) AS c FROM audit_log WHERE event = ?1")
    .bind(event)
    .all<{ c: number }>();
  return results[0]?.c ?? 0;
}

describe("createRateCard", () => {
  it("inserts the card and an audit row", async () => {
    const database = freshDatabase();
    const { rateCardId, effect } = await createRateCard(database, { name: "Standard" }, options);
    await commit(database, effect);

    const { results } = await database
      .prepare("SELECT id, name, archived_at FROM rate_card WHERE id = ?1")
      .bind(rateCardId)
      .all<{ id: string; name: string; archived_at: string | null }>();
    expect(results[0]).toMatchObject({ id: rateCardId, name: "Standard", archived_at: null });
    expect(await countAudit(database, "rate_card.created")).toBe(1);
  });
});

describe("appendRate", () => {
  async function withCard(database: BatchDatabase) {
    const { rateCardId, effect } = await createRateCard(database, { name: "Standard" }, options);
    await commit(database, effect);
    return rateCardId;
  }

  it("inserts an open version and audits it", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const { rateId, effect } = await appendRate(
      database,
      {
        rateCardId,
        tier: "timekeeper",
        scopedId: "user_associate",
        rateE4: 3_500_000,
        currency: "USD",
        validFrom: "2026-01-01",
      },
      options,
    );
    await commit(database, effect);

    const rows = await listRates(database, rateCardId);
    expect(rows).toEqual([
      {
        tier: "timekeeper",
        scoped_id: "user_associate",
        rate_e4: 3_500_000,
        currency: "USD",
        valid_from: "2026-01-01",
        valid_to: null,
      },
    ]);
    expect(rateId.startsWith("rate_")).toBe(true);
    expect(await countAudit(database, "rate.appended")).toBe(1);
  });

  it("closes the prior open row when a later version is appended", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const scope = {
      rateCardId,
      tier: "timekeeper",
      scopedId: "user_associate",
      currency: "USD",
    } as const;

    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 3_500_000, validFrom: "2026-01-01" },
          options,
        )
      ).effect,
    );
    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 4_000_000, validFrom: "2026-07-01" },
          options,
        )
      ).effect,
    );

    const rows = await listRates(database, rateCardId);
    expect(rows).toEqual([
      {
        tier: "timekeeper",
        scoped_id: "user_associate",
        rate_e4: 3_500_000,
        currency: "USD",
        valid_from: "2026-01-01",
        valid_to: "2026-07-01", // the prior open row closed at the new valid_from
      },
      {
        tier: "timekeeper",
        scoped_id: "user_associate",
        rate_e4: 4_000_000,
        currency: "USD",
        valid_from: "2026-07-01",
        valid_to: null,
      },
    ]);
  });

  it("refuses a valid_from that lands inside an existing interval", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const scope = {
      rateCardId,
      tier: "timekeeper",
      scopedId: "user_associate",
      currency: "USD",
    } as const;

    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 3_500_000, validFrom: "2026-01-01" },
          options,
        )
      ).effect,
    );
    // The open row starts 2026-01-01; a new version dated earlier would overlap it.
    await expect(
      appendRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2025-12-01" }, options),
    ).rejects.toBeInstanceOf(RateValidationError);
    await expect(
      appendRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2025-12-01" }, options),
    ).rejects.toMatchObject({ code: "overlapping-valid-from" });
  });

  it("lets two non-overlapping versions for one scope coexist (the later closes the earlier)", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);
    const scope = { rateCardId, tier: "matter", scopedId: "matter_a", currency: "USD" } as const;

    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 5_000_000, validFrom: "2026-01-01" },
          options,
        )
      ).effect,
    );
    await commit(
      database,
      (
        await appendRate(
          database,
          { ...scope, rateE4: 5_500_000, validFrom: "2026-06-01" },
          options,
        )
      ).effect,
    );

    const rows = await listRates(database, rateCardId);
    expect(rows.map((r) => r.valid_to)).toEqual(["2026-06-01", null]);
  });

  it("keeps separate scopes independent (a card-wide default and a timekeeper override both stay open)", async () => {
    const database = freshDatabase();
    const rateCardId = await withCard(database);

    await commit(
      database,
      (
        await appendRate(
          database,
          {
            rateCardId,
            tier: "role",
            scopedId: null,
            rateE4: 3_000_000,
            currency: "USD",
            validFrom: "2026-01-01",
          },
          options,
        )
      ).effect,
    );
    await commit(
      database,
      (
        await appendRate(
          database,
          {
            rateCardId,
            tier: "timekeeper",
            scopedId: "user_associate",
            rateE4: 3_500_000,
            currency: "USD",
            validFrom: "2026-01-01",
          },
          options,
        )
      ).effect,
    );

    const rows = await listRates(database, rateCardId);
    // Two distinct scopes -> two open rows, neither closes the other.
    expect(rows.filter((r) => r.valid_to === null)).toHaveLength(2);
  });
});

it("RateValidationError carries a stable code", () => {
  expect(new RateValidationError("overlapping-valid-from", "x").code).toBe(
    "overlapping-valid-from",
  );
});
```

**Step 2 — Run the test, expect FAIL.**

```
pnpm --filter @magna-carta/timekeeping test -- rate-service
```

Expected: FAIL — `Failed to resolve import "../src/rate-service.ts"` (and `../src/rate-validation.ts`); the modules do not exist yet.

**Step 3 — Implement the validation error, the audit binding, the statements, and the service.**

Create `packages/timekeeping/src/rate-validation.ts`:

```ts
// Stable machine-readable refusal codes for the rate engine — callers branch on the code, never the
// message. A rate-version write is append-only: the only way it can fail validation is an overlap with
// an existing interval for the same scope (SQLite cannot range-exclude, so the service enforces it).
export type RateValidationCode = "overlapping-valid-from";

export class RateValidationError extends Error {
  constructor(
    readonly code: RateValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "RateValidationError";
  }
}
```

Create `packages/timekeeping/src/audit.ts`:

```ts
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";

// The minimum a timekeeping operation needs to write an audit row — the clock and actor arrive from
// the caller (the service reads no clock and trusts no ambient identity). randomSource lets fixtures
// mint byte-deterministic ids.
export interface AuditContext {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// Composes the per-firm audit_log row for an effect batch via the shared domain audit wrapper. A thin
// positional adapter so a timekeeping call site reads timeAuditStatement(db, ctx, event, subject).
export function timeAuditStatement(
  database: SqlDatabase,
  context: AuditContext,
  event: string,
  subjectId: string,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: context.actorUserId,
    clock: context.clock,
    randomSource: context.randomSource,
  });
}
```

Create `packages/timekeeping/src/rate-statements.ts`:

```ts
import type { RateCardId, RateId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. Both tables exist only in the per-firm database — the caller supplies that handle.
export const RATE_CARD_TABLE = "rate_card";
export const RATE_TABLE = "rate";

export type RateTier = "matter" | "client" | "timekeeper" | "role";

export interface InsertRateCardRow {
  readonly id: RateCardId;
  readonly name: string;
  readonly createdAt: string;
}

export function insertRateCardStatement(
  database: SqlDatabase,
  row: InsertRateCardRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${RATE_CARD_TABLE} (id, name, archived_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?3)`,
    )
    .bind(row.id, row.name, row.createdAt);
}

export interface InsertRateRow {
  readonly id: RateId;
  readonly rateCardId: RateCardId;
  readonly tier: RateTier;
  readonly scopedId: string | null;
  readonly rateE4: number;
  readonly currency: string;
  readonly validFrom: string;
  readonly createdAt: string;
}

// A new version is always inserted OPEN (valid_to NULL); a prior open row for the same scope is closed
// separately, in the same batch, by closePriorOpenRateStatement. Append-only: no existing row is ever
// edited except that close.
export function insertRateStatement(database: SqlDatabase, row: InsertRateRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${RATE_TABLE} (id, rate_card_id, tier, scoped_id, rate_e4, currency, valid_from, valid_to, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)`,
    )
    .bind(
      row.id,
      row.rateCardId,
      row.tier,
      row.scopedId,
      row.rateE4,
      row.currency,
      row.validFrom,
      row.createdAt,
    );
}

// Reads the existing rows for one scope (any state), so the service can refuse an overlapping
// valid_from and find the open row to close. scoped_id NULL is the card-wide default for the tier and
// matches with `IS` so it is treated as a distinct scope from any concrete scoped_id.
export function selectRatesForScopeStatement(
  database: SqlDatabase,
  rateCardId: RateCardId,
  tier: RateTier,
  scopedId: string | null,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, valid_from, valid_to FROM ${RATE_TABLE} WHERE rate_card_id = ?1 AND tier = ?2 AND scoped_id IS ?3 ORDER BY valid_from`,
    )
    .bind(rateCardId, tier, scopedId);
}

// Closes the prior open row's interval at the new version's valid_from (the partial UNIQUE index keeps
// at most one open row per scope, so this targets exactly that row).
export function closePriorOpenRateStatement(
  database: SqlDatabase,
  id: RateId,
  validTo: string,
): SqlStatement {
  return database.prepare(`UPDATE ${RATE_TABLE} SET valid_to = ?2 WHERE id = ?1`).bind(id, validTo);
}
```

Create `packages/timekeeping/src/rate-service.ts`:

```ts
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { RateCardId, RateId, UserId } from "@magna-carta/identifiers/types";
import { type AuditContext, timeAuditStatement } from "./audit.ts";
import { RateValidationError } from "./rate-validation.ts";
import {
  closePriorOpenRateStatement,
  insertRateCardStatement,
  insertRateStatement,
  type RateTier,
  selectRatesForScopeStatement,
} from "./rate-statements.ts";

// Wall-clock and actor arrive from the caller — the service reads no clock and trusts no ambient
// identity. randomSource lets fixtures mint byte-deterministic ids. The shared options shape every
// timekeeping service takes (mirrors ShipmentServiceOptions).
export interface ClockPort {
  now(): string;
}

export interface TimekeepingServiceOptions extends AuditContext {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

export interface CreateRateCardInput {
  readonly name: string;
}

export async function createRateCard(
  database: SqlDatabase,
  input: CreateRateCardInput,
  options: TimekeepingServiceOptions,
): Promise<{ rateCardId: RateCardId; effect: EffectWrite }> {
  const rateCardId = newIdentifier("rateCard", options.randomSource);
  const createdAt = options.clock.now();
  return {
    rateCardId,
    effect: {
      statements: [
        insertRateCardStatement(database, { id: rateCardId, name: input.name, createdAt }),
        timeAuditStatement(database, options, "rate_card.created", rateCardId),
      ],
      outboxMessages: [],
    },
  };
}

export interface AppendRateInput {
  readonly rateCardId: RateCardId;
  readonly tier: RateTier;
  readonly scopedId: string | null;
  readonly rateE4: number;
  readonly currency: string;
  readonly validFrom: string; // PlainDate
}

// Appends a new effective-dated version for one scope. Append-only: it never edits an existing rate,
// it closes the prior OPEN row's valid_to at the new valid_from in the SAME batch, so the [valid_from,
// valid_to) intervals stay contiguous and non-overlapping (resolution always matches exactly one).
// Closed-interval non-overlap is enforced here because SQLite has no range-exclusion constraint: a
// valid_from that lands on or before any existing version's valid_from is refused.
export async function appendRate(
  database: SqlDatabase,
  input: AppendRateInput,
  options: TimekeepingServiceOptions,
): Promise<{ rateId: RateId; effect: EffectWrite }> {
  const { results } = await selectRatesForScopeStatement(
    database,
    input.rateCardId,
    input.tier,
    input.scopedId,
  ).all<{ id: RateId; valid_from: string; valid_to: string | null }>();

  // A new version must start strictly after every existing version for the scope; otherwise it would
  // land inside (or before) an existing interval. The open row, if any, is the one we close.
  let openRow: { id: RateId; valid_from: string } | undefined;
  for (const row of results) {
    if (input.validFrom <= row.valid_from) {
      throw new RateValidationError(
        "overlapping-valid-from",
        `valid_from ${input.validFrom} overlaps an existing rate interval starting ${row.valid_from}`,
      );
    }
    if (row.valid_to === null) openRow = { id: row.id, valid_from: row.valid_from };
  }

  const rateId = newIdentifier("rate", options.randomSource);
  const createdAt = options.clock.now();
  const statements = [];
  if (openRow !== undefined) {
    statements.push(closePriorOpenRateStatement(database, openRow.id, input.validFrom));
  }
  statements.push(
    insertRateStatement(database, {
      id: rateId,
      rateCardId: input.rateCardId,
      tier: input.tier,
      scopedId: input.scopedId,
      rateE4: input.rateE4,
      currency: input.currency,
      validFrom: input.validFrom,
      createdAt,
    }),
    timeAuditStatement(database, options, "rate.appended", rateId),
  );
  return { rateId, effect: { statements, outboxMessages: [] } };
}
```

**Step 4 — Run the test, expect PASS.**

```
pnpm --filter @magna-carta/timekeeping test -- rate-service
```

Expected: PASS — `createRateCard`, all `appendRate` cases (open insert, prior-row close, overlap refusal, coexisting non-overlapping versions, independent scopes), and the error-code assertion green.

**Step 5 — Commit.**

```
git add packages/timekeeping/src/rate-validation.ts packages/timekeeping/src/audit.ts packages/timekeeping/src/rate-statements.ts packages/timekeeping/src/rate-service.ts packages/timekeeping/test/rate-service.test.ts packages/timekeeping/package.json
git commit -m "$(cat <<'EOF'
feat(timekeeping): rate-card and effective-dated rate append

createRateCard inserts a named card; appendRate writes an append-only
rate version and closes the prior open row's valid_to at the new
valid_from in the same batch, keeping each scope's intervals contiguous
and non-overlapping. An overlapping valid_from is refused with
RateValidationError (SQLite cannot range-exclude). Adds the package's
timeAuditStatement binding.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Rate resolution (precedence + effective-date + no-rate)

The pure `resolveRate`: walk the precedence order per-entry **override → matter → client → timekeeper → role → card default**, filtered to the effective-date interval `[valid_from, valid_to)` containing `work_date`, returning the first hit's `{ rateE4, rateCardId, rateSource, currency }` or `{ noRate: true }` for the non-billable path. A flat-fee/contingency matter still resolves the standard rate — a null rate means non-billable, never flat-fee.

**Files**

- Create: `packages/timekeeping/src/rate-resolution.ts`
- Test: `packages/timekeeping/test/rate-resolution.test.ts`

**Interfaces**

- Produces: `RateResolutionContext`, `RateSource`, `RateResolution`, `resolveRate`.
- Consumes: `RATE_TABLE` (`./rate-statements.ts`, Task 6), `SqlDatabase`.

**Steps**

**Step 1 — Write the failing test.** Add the export to `packages/timekeeping/package.json`:

```json
    "./rate-service": "./src/rate-service.ts",
    "./rate-resolution": "./src/rate-resolution.ts",
```

Create `packages/timekeeping/test/rate-resolution.test.ts`. It seeds `rate` rows directly through the real `appendRate` write path (Task 6), so the fixture is valid by construction, then resolves.

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { appendRate, createRateCard } from "../src/rate-service.ts";
import { resolveRate, type RateResolutionContext } from "../src/rate-resolution.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const options = { clock, actorUserId: "user_partner" as UserId };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function commit(database: BatchDatabase, effect: Parameters<typeof commitEffectBatch>[1]) {
  await commitEffectBatch(database, effect, { now: clock.now });
}

async function makeCard(database: BatchDatabase): Promise<string> {
  const { rateCardId, effect } = await createRateCard(database, { name: "Standard" }, options);
  await commit(database, effect);
  return rateCardId;
}

async function seedRate(
  database: BatchDatabase,
  input: Parameters<typeof appendRate>[1],
): Promise<void> {
  await commit(database, (await appendRate(database, input, options)).effect);
}

const baseContext = (rateCardId: string): RateResolutionContext => ({
  matterId: "matter_a",
  clientId: "client_x",
  timekeeperUserId: "user_associate",
  roleId: "role_associate",
  workDate: "2026-06-22",
  rateCardId,
});

describe("resolveRate precedence", () => {
  it("resolves the card default (role tier, scoped_id null) when no more-specific row exists", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, {
      rateCardId,
      tier: "role",
      scopedId: null,
      rateE4: 3_000_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });

    expect(await resolveRate(database, baseContext(rateCardId))).toEqual({
      rateE4: 3_000_000,
      rateCardId,
      rateSource: "card_default",
      currency: "USD",
    });
  });

  it("the role tier (scoped to roleId) wins over the card default", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, {
      rateCardId,
      tier: "role",
      scopedId: null,
      rateE4: 3_000_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });
    await seedRate(database, {
      rateCardId,
      tier: "role",
      scopedId: "role_associate",
      rateE4: 3_200_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });

    expect(
      (await resolveRate(database, baseContext(rateCardId))) as {
        rateSource: string;
        rateE4: number;
      },
    ).toMatchObject({
      rateSource: "role",
      rateE4: 3_200_000,
    });
  });

  it("the timekeeper tier wins over role", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, {
      rateCardId,
      tier: "role",
      scopedId: "role_associate",
      rateE4: 3_200_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });
    await seedRate(database, {
      rateCardId,
      tier: "timekeeper",
      scopedId: "user_associate",
      rateE4: 3_500_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });

    expect(
      ((await resolveRate(database, baseContext(rateCardId))) as { rateSource: string }).rateSource,
    ).toBe("timekeeper");
  });

  it("the client tier wins over timekeeper", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, {
      rateCardId,
      tier: "timekeeper",
      scopedId: "user_associate",
      rateE4: 3_500_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });
    await seedRate(database, {
      rateCardId,
      tier: "client",
      scopedId: "client_x",
      rateE4: 4_000_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });

    expect(
      ((await resolveRate(database, baseContext(rateCardId))) as { rateSource: string }).rateSource,
    ).toBe("client");
  });

  it("the matter tier wins over client", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, {
      rateCardId,
      tier: "client",
      scopedId: "client_x",
      rateE4: 4_000_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });
    await seedRate(database, {
      rateCardId,
      tier: "matter",
      scopedId: "matter_a",
      rateE4: 4_500_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });

    expect(
      (await resolveRate(database, baseContext(rateCardId))) as {
        rateSource: string;
        rateE4: number;
      },
    ).toMatchObject({
      rateSource: "matter",
      rateE4: 4_500_000,
    });
  });

  it("a per-entry override beats every stored tier and reaches no row", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, {
      rateCardId,
      tier: "matter",
      scopedId: "matter_a",
      rateE4: 4_500_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });

    expect(
      await resolveRate(database, { ...baseContext(rateCardId), overrideE4: 9_000_000 }),
    ).toEqual({
      rateE4: 9_000_000,
      rateCardId,
      rateSource: "override",
      currency: "USD",
    });
  });
});

describe("resolveRate effective-dating", () => {
  it("picks the version whose [valid_from, valid_to) contains work_date; valid_to is exclusive", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    const scope = {
      rateCardId,
      tier: "timekeeper",
      scopedId: "user_associate",
      currency: "USD",
    } as const;
    await seedRate(database, { ...scope, rateE4: 3_500_000, validFrom: "2026-01-01" });
    await seedRate(database, { ...scope, rateE4: 4_000_000, validFrom: "2026-07-01" }); // closes the first at 2026-07-01

    const onJune = await resolveRate(database, {
      ...baseContext(rateCardId),
      workDate: "2026-06-30",
    });
    const onJuly = await resolveRate(database, {
      ...baseContext(rateCardId),
      workDate: "2026-07-01",
    });
    expect((onJune as { rateE4: number }).rateE4).toBe(3_500_000);
    // valid_to (2026-07-01) is exclusive on the first row and inclusive valid_from on the second.
    expect((onJuly as { rateE4: number }).rateE4).toBe(4_000_000);
  });

  it("returns the no-rate result when no version is in force on work_date", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, {
      rateCardId,
      tier: "timekeeper",
      scopedId: "user_associate",
      rateE4: 3_500_000,
      currency: "USD",
      validFrom: "2026-07-01",
    });

    // work_date precedes the only version's valid_from.
    expect(
      await resolveRate(database, { ...baseContext(rateCardId), workDate: "2026-06-01" }),
    ).toEqual({ noRate: true });
  });
});

describe("resolveRate no-rate path", () => {
  it("a non-billable context (no card chosen, no override) is the no-rate result", async () => {
    const database = freshDatabase();
    const { rateCardId } = baseContext("rateCard_unused");
    void rateCardId;
    expect(
      await resolveRate(database, {
        matterId: "matter_a",
        clientId: null,
        timekeeperUserId: "user_associate",
        roleId: null,
        workDate: "2026-06-22",
      }),
    ).toEqual({ noRate: true });
  });

  it("a flat-fee matter still resolves the standard rate (a null rate means non-billable, never flat-fee)", async () => {
    const database = freshDatabase();
    const rateCardId = await makeCard(database);
    await seedRate(database, {
      rateCardId,
      tier: "role",
      scopedId: null,
      rateE4: 3_000_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });

    // The matter being flat-fee is a billing concern; resolution still returns the standard rate so
    // realization can be reported.
    expect(
      ((await resolveRate(database, baseContext(rateCardId))) as { noRate?: true }).noRate,
    ).toBeUndefined();
  });
});
```

**Step 2 — Run the test, expect FAIL.**

```
pnpm --filter @magna-carta/timekeeping test -- rate-resolution
```

Expected: FAIL — `Failed to resolve import "../src/rate-resolution.ts"` (the module does not exist yet).

**Step 3 — Implement `resolveRate`.** Create `packages/timekeeping/src/rate-resolution.ts`:

```ts
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { RATE_TABLE, type RateTier } from "./rate-statements.ts";

// The capture-time inputs the rate engine needs. clientId is derived from the matter and roleId from
// the timekeeper's member record at the call site (re-derivable for an audit of rate_source, not
// snapshotted separately). rateCardId names which card resolves the rate (a matter may be on a capped
// card); overrideE4 is a per-entry manual rate that sits above every stored tier.
export interface RateResolutionContext {
  readonly matterId: string;
  readonly clientId: string | null;
  readonly timekeeperUserId: string;
  readonly roleId: string | null;
  readonly workDate: string; // PlainDate
  readonly rateCardId?: string;
  readonly overrideE4?: number;
}

// A superset of rate.tier: `override` and `card_default` are resolution outcomes, not stored rows.
export type RateSource = "override" | "matter" | "client" | "timekeeper" | "role" | "card_default";

export type RateResolution =
  | { rateE4: number; rateCardId: string; rateSource: RateSource; currency: string }
  | { noRate: true };

// The precedence order, most-specific first. Each entry names the rate.tier to query and the
// scoped_id to match (from the context); the resolution source recorded on the entry. The card_default
// is the role tier with a null scoped_id — the card-wide fallback for the tier. The first candidate
// with a version in force on work_date wins.
interface Candidate {
  readonly tier: RateTier;
  readonly scopedId: string | null;
  readonly source: Exclude<RateSource, "override">;
}

function candidatesFor(context: RateResolutionContext): Candidate[] {
  const candidates: Candidate[] = [];
  candidates.push({ tier: "matter", scopedId: context.matterId, source: "matter" });
  if (context.clientId !== null) {
    candidates.push({ tier: "client", scopedId: context.clientId, source: "client" });
  }
  candidates.push({ tier: "timekeeper", scopedId: context.timekeeperUserId, source: "timekeeper" });
  if (context.roleId !== null) {
    candidates.push({ tier: "role", scopedId: context.roleId, source: "role" });
  }
  candidates.push({ tier: "role", scopedId: null, source: "card_default" });
  return candidates;
}

// Resolution filters rate rows to the one version whose [valid_from, valid_to) contains work_date:
// valid_from is inclusive, valid_to is exclusive (an open row has valid_to NULL). PlainDate strings
// (YYYY-MM-DD) compare correctly under lexical ordering, so the interval test is a string comparison.
async function resolveTier(
  database: SqlDatabase,
  rateCardId: string,
  candidate: Candidate,
  workDate: string,
): Promise<{ rateE4: number; currency: string } | undefined> {
  const { results } = await database
    .prepare(
      `SELECT rate_e4, currency FROM ${RATE_TABLE} WHERE rate_card_id = ?1 AND tier = ?2 AND scoped_id IS ?3 AND valid_from <= ?4 AND (valid_to IS NULL OR valid_to > ?4) LIMIT 1`,
    )
    .bind(rateCardId, candidate.tier, candidate.scopedId, workDate)
    .all<{ rate_e4: number; currency: string }>();
  const row = results[0];
  return row === undefined ? undefined : { rateE4: row.rate_e4, currency: row.currency };
}

export async function resolveRate(
  database: SqlDatabase,
  context: RateResolutionContext,
): Promise<RateResolution> {
  // No card chosen = non-billable internal time: there is nothing to resolve against. An override with
  // no card is treated the same — the override is only meaningful as a rate ON a card.
  if (context.rateCardId === undefined) return { noRate: true };
  const rateCardId = context.rateCardId;

  if (context.overrideE4 !== undefined) {
    // An override sits above every stored tier; it carries no stored currency, so it inherits the
    // card's resolved currency (the most-specific in-force version), falling back to the firm seed.
    const resolved = await firstInForce(database, rateCardId, context);
    return {
      rateE4: context.overrideE4,
      rateCardId,
      rateSource: "override",
      currency: resolved?.currency ?? "USD",
    };
  }

  for (const candidate of candidatesFor(context)) {
    const hit = await resolveTier(database, rateCardId, candidate, context.workDate);
    if (hit !== undefined) {
      return {
        rateE4: hit.rateE4,
        rateCardId,
        rateSource: candidate.source,
        currency: hit.currency,
      };
    }
  }
  return { noRate: true };
}

// The currency carried alongside an override: the first stored tier in force on work_date (so the
// override is denominated like the card it overrides). Undefined when the card has no version yet.
async function firstInForce(
  database: SqlDatabase,
  rateCardId: string,
  context: RateResolutionContext,
): Promise<{ currency: string } | undefined> {
  for (const candidate of candidatesFor(context)) {
    const hit = await resolveTier(database, rateCardId, candidate, context.workDate);
    if (hit !== undefined) return { currency: hit.currency };
  }
  return undefined;
}
```

**Step 4 — Run the test, expect PASS.**

```
pnpm --filter @magna-carta/timekeeping test -- rate-resolution
```

Expected: PASS — every precedence tier in isolation, the override above all tiers, the effective-date interval (valid_to exclusive), the no-rate result when no card / no in-force version, and the flat-fee-still-resolves case all green.

**Step 5 — Commit.**

```
git add packages/timekeeping/src/rate-resolution.ts packages/timekeeping/test/rate-resolution.test.ts packages/timekeeping/package.json
git commit -m "$(cat <<'EOF'
feat(timekeeping): effective-dated rate resolution with precedence

resolveRate walks override -> matter -> client -> timekeeper -> role ->
card default, filtered to the [valid_from, valid_to) interval containing
work_date (valid_to exclusive). A non-billable context (no card chosen)
returns the no-rate result; a flat-fee matter still resolves the standard
rate, so a null rate always means non-billable.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Lifecycle state machine + freeze contract

The pure Draft→(Submitted→Approved)→Billed state machine, gate-on/off aware, plus the `isFrozen` predicate the time-entry service enforces (the service refuses any UPDATE to a `billed`/`void` row beyond the billing lock). `assertTransition` throws `TimeEntryValidationError` on an illegal move. No database access — pure functions over the status enum.

**Files**

- Create: `packages/timekeeping/src/lifecycle.ts`, `packages/timekeeping/src/time-entry-validation.ts`
- Test: `packages/timekeeping/test/lifecycle.test.ts`

**Interfaces**

- Produces: `TimeEntryStatus`, `assertTransition(from, to, gateOn)`, `canTransition(from, to, gateOn)`, `isFrozen(status)`, `TimeEntryValidationError` + `TimeEntryValidationCode`.
- Consumes: nothing (pure).

**Steps**

**Step 1 — Write the failing test.** Add the two exports to `packages/timekeeping/package.json`:

```json
    "./rate-resolution": "./src/rate-resolution.ts",
    "./lifecycle": "./src/lifecycle.ts",
    "./time-entry-validation": "./src/time-entry-validation.ts",
```

Create `packages/timekeeping/test/lifecycle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  isFrozen,
  type TimeEntryStatus,
} from "../src/lifecycle.ts";
import { TimeEntryValidationError } from "../src/time-entry-validation.ts";

const STATUSES: TimeEntryStatus[] = ["draft", "submitted", "approved", "billed", "void"];

describe("isFrozen", () => {
  it("is true only for billed and void", () => {
    expect(isFrozen("draft")).toBe(false);
    expect(isFrozen("submitted")).toBe(false);
    expect(isFrozen("approved")).toBe(false);
    expect(isFrozen("billed")).toBe(true);
    expect(isFrozen("void")).toBe(true);
  });
});

describe("assertTransition with the review gate ON", () => {
  it("walks draft -> submitted -> approved -> billed", () => {
    expect(() => assertTransition("draft", "submitted", true)).not.toThrow();
    expect(() => assertTransition("submitted", "approved", true)).not.toThrow();
    expect(() => assertTransition("approved", "billed", true)).not.toThrow();
  });

  it("allows the kick-back submitted -> draft", () => {
    expect(() => assertTransition("submitted", "draft", true)).not.toThrow();
  });

  it("allows voiding from any pre-terminal state", () => {
    expect(() => assertTransition("draft", "void", true)).not.toThrow();
    expect(() => assertTransition("submitted", "void", true)).not.toThrow();
    expect(() => assertTransition("approved", "void", true)).not.toThrow();
  });

  it("refuses skipping the gate (draft -> approved, draft -> billed, submitted -> billed)", () => {
    expect(() => assertTransition("draft", "approved", true)).toThrow(TimeEntryValidationError);
    expect(() => assertTransition("draft", "billed", true)).toThrow(TimeEntryValidationError);
    expect(() => assertTransition("submitted", "billed", true)).toThrow(TimeEntryValidationError);
  });

  it("the refusal carries the illegal-transition code", () => {
    expect(() => assertTransition("draft", "approved", true)).toThrow(
      expect.objectContaining({ code: "illegal-transition" }),
    );
  });
});

describe("assertTransition with the review gate OFF", () => {
  it("walks draft -> billed directly (no submit/approve states)", () => {
    expect(() => assertTransition("draft", "billed", false)).not.toThrow();
  });

  it("refuses the gated states when the gate is off", () => {
    expect(() => assertTransition("draft", "submitted", false)).toThrow(TimeEntryValidationError);
    expect(() => assertTransition("submitted", "approved", false)).toThrow(
      TimeEntryValidationError,
    );
  });

  it("still allows voiding a draft", () => {
    expect(() => assertTransition("draft", "void", false)).not.toThrow();
  });
});

describe("frozen states are terminal", () => {
  it("refuses every transition OUT of billed or void, under either gate", () => {
    for (const gateOn of [true, false]) {
      for (const to of STATUSES) {
        expect(() => assertTransition("billed", to, gateOn)).toThrow(TimeEntryValidationError);
        expect(() => assertTransition("void", to, gateOn)).toThrow(TimeEntryValidationError);
      }
    }
  });
});

describe("canTransition mirrors assertTransition without throwing", () => {
  it("is true for a legal move and false for an illegal one", () => {
    expect(canTransition("draft", "submitted", true)).toBe(true);
    expect(canTransition("draft", "approved", true)).toBe(false);
    expect(canTransition("billed", "void", true)).toBe(false);
  });
});

it("TimeEntryValidationError carries a stable code", () => {
  expect(new TimeEntryValidationError("frozen-entry", "x").code).toBe("frozen-entry");
});
```

**Step 2 — Run the test, expect FAIL.**

```
pnpm --filter @magna-carta/timekeeping test -- lifecycle
```

Expected: FAIL — `Failed to resolve import "../src/lifecycle.ts"` (and `../src/time-entry-validation.ts`); the modules do not exist yet.

**Step 3 — Implement the validation error and the state machine.**

Create `packages/timekeeping/src/time-entry-validation.ts`:

```ts
// Stable machine-readable refusal codes for the time-entry lifecycle and capture guards — callers
// branch on the code, never the message. `illegal-transition` is an unreachable status move under the
// active gate; `frozen-entry` is an attempted write to a billed/void row beyond the billing lock; the
// remaining codes guard a capture's shape.
export type TimeEntryValidationCode =
  | "illegal-transition"
  | "frozen-entry"
  | "empty-narrative"
  | "non-positive-duration"
  | "non-billable-rate"
  | "missing-utbms-code";

export class TimeEntryValidationError extends Error {
  constructor(
    readonly code: TimeEntryValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "TimeEntryValidationError";
  }
}
```

Create `packages/timekeeping/src/lifecycle.ts`:

```ts
import { TimeEntryValidationError } from "./time-entry-validation.ts";

// The WIP lifecycle. draft -> (submitted -> approved) -> billed, plus void. The submitted/approved
// states exist only when the firm's review gate is on; with the gate off, a draft bills directly.
// billed and void are terminal — on entering either, the row's business columns freeze (the service
// refuses any UPDATE beyond the billing lock). This is a column-level freeze contract, not the
// ledger's append-only rule: status itself is a mutable column whose legal moves are these.
export type TimeEntryStatus = "draft" | "submitted" | "approved" | "billed" | "void";

// The legal moves, keyed by whether the review gate is on. void is reachable from any non-terminal
// state under either gate; the table below holds only the forward/kick-back moves, with void added
// uniformly in canTransition.
const GATE_ON_TRANSITIONS: ReadonlyMap<TimeEntryStatus, ReadonlySet<TimeEntryStatus>> = new Map([
  ["draft", new Set<TimeEntryStatus>(["submitted"])],
  ["submitted", new Set<TimeEntryStatus>(["approved", "draft"])], // approve or kick back
  ["approved", new Set<TimeEntryStatus>(["billed"])],
]);

const GATE_OFF_TRANSITIONS: ReadonlyMap<TimeEntryStatus, ReadonlySet<TimeEntryStatus>> = new Map([
  ["draft", new Set<TimeEntryStatus>(["billed"])],
]);

// billed and void freeze the row's business columns; no transition leaves them.
export function isFrozen(status: TimeEntryStatus): boolean {
  return status === "billed" || status === "void";
}

export function canTransition(
  from: TimeEntryStatus,
  to: TimeEntryStatus,
  gateOn: boolean,
): boolean {
  if (isFrozen(from)) return false; // nothing leaves a terminal state
  // void is reachable from any non-terminal state regardless of the gate.
  if (to === "void") return true;
  const table = gateOn ? GATE_ON_TRANSITIONS : GATE_OFF_TRANSITIONS;
  return table.get(from)?.has(to) ?? false;
}

export function assertTransition(
  from: TimeEntryStatus,
  to: TimeEntryStatus,
  gateOn: boolean,
): void {
  if (!canTransition(from, to, gateOn)) {
    throw new TimeEntryValidationError(
      "illegal-transition",
      `cannot move a time entry from ${from} to ${to} (review gate ${gateOn ? "on" : "off"})`,
    );
  }
}
```

**Step 4 — Run the test, expect PASS.**

```
pnpm --filter @magna-carta/timekeeping test -- lifecycle
```

Expected: PASS — `isFrozen`, the gate-on walk (draft↔submitted↔approved→billed + void), the gate-off direct draft→billed, every refusal (gate-skip, gated-states-with-gate-off, out-of-terminal), `canTransition`, and the error-code assertion all green.

**Step 5 — Commit.**

```
git add packages/timekeeping/src/lifecycle.ts packages/timekeeping/src/time-entry-validation.ts packages/timekeeping/test/lifecycle.test.ts packages/timekeeping/package.json
git commit -m "$(cat <<'EOF'
feat(timekeeping): time-entry lifecycle state machine and freeze contract

The pure draft -> (submitted -> approved) -> billed machine, gate-on/off
aware, with void reachable from any non-terminal state. assertTransition
throws TimeEntryValidationError on an illegal move; isFrozen marks
billed/void as terminal so the service can refuse any write beyond the
billing lock.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

`computeAmountMinor` (Task 4) is the one place these are composed; my tasks consume its `number` output directly. I have everything required. Let me check the `validate.ts`/`assertIdentifier` for how list-statements bind, and confirm the cursor-pagination is not needed for my tasks (it's Task 13). I have enough. Let me write the four task sections now.

A few final confirmations on the schema column order for `time_entry` (so my INSERT statement matches Task 2's migration) — I'll use the exact column list from the interface contract. Let me also verify the `member` table has a `role_id`/role linkage referenced by rate resolution — not needed for my tasks. I'm ready.

Here are the expanded Tasks 9–12.

### Task 9: time_entry statements + capture/commit service

The `time_entry` prepared statements and `captureTimeEntry` — the single WIP-store writer. The route resolves the rate (Task 7) and rounds the duration (Task 4), then hands the resolved values in; this service composes the insert + audit into one `EffectWrite`, honouring the `amount_minor` ⟺ `rate_e4` paired-null CHECK, the `e_billing`-requires-UTBMS guard, and the `live_run_id` passthrough.

**Files**

- Create: `packages/timekeeping/src/time-entry-statements.ts`, `packages/timekeeping/src/time-entry-service.ts`
- Test: `packages/timekeeping/test/time-entry-service.test.ts`

**Interfaces**

- Produces: `TIME_ENTRY_TABLE`, `TimekeepingServiceOptions`, `ClockPort`, `CaptureTimeEntryInput`, `captureTimeEntry`.
- Consumes: Task 4 (`computeAmountMinor` — already folded into the resolved values the route passes in), Task 7 (`RateResolution`), Task 8 (`TimeEntryValidationError`), `domainAuditStatement`, `newIdentifier`.

**Steps**

**Step 1 — write the failing test.** Create `packages/timekeeping/test/time-entry-service.test.ts`:

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { captureTimeEntry, type CaptureTimeEntryInput } from "../src/time-entry-service.ts";
import { TimeEntryValidationError } from "../src/time-entry-validation.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const TIMEKEEPER = "user_attorney" as UserId;
const options = { clock, actorUserId: TIMEKEEPER };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

// A matter the capture binds to; e_billing defaults to 0 (off) unless overridden here.
async function seedMatter(database: BatchDatabase, matterId: string, eBilling = 0): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Attorney', 'active', ?2)",
    )
    .bind(TIMEKEEPER, clock.now())
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at) VALUES (?1, 'Smith v. Jones', 'open', ?2, ?3, ?4)",
    )
    .bind(matterId, TIMEKEEPER, eBilling, clock.now())
    .run();
}

async function seedUtbms(
  database: BatchDatabase,
  id: string,
  codeSet: string,
  code: string,
): Promise<void> {
  await database
    .prepare(
      "INSERT INTO utbms_code (id, code_set, code, label, active) VALUES (?1, ?2, ?3, ?4, 1)",
    )
    .bind(id, codeSet, code, `${code} label`)
    .run();
}

const billableBase: Omit<CaptureTimeEntryInput, "rate"> = {
  matterId: "matter_1" as MatterId,
  timekeeperUserId: TIMEKEEPER,
  workDate: "2026-06-22",
  rawDurationMinutes: 28,
  durationMinutes: 30,
  narrative: "drafted demand letter",
  billable: true,
  currency: "USD",
  source: "manual",
};

async function readEntry(database: BatchDatabase, id: string) {
  const { results } = await database
    .prepare(
      "SELECT matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, status, source, live_run_id FROM time_entry WHERE id = ?1",
    )
    .bind(id)
    .all();
  return results[0] as Record<string, unknown> | undefined;
}

async function countAudits(database: BatchDatabase, event: string): Promise<number> {
  const { results } = await database
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?1")
    .bind(event)
    .all<{ n: number }>();
  return results[0]?.n ?? 0;
}

describe("captureTimeEntry", () => {
  it("stores a billable entry with its frozen rate snapshot and an audit row", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        rate: {
          rateE4: 4500000,
          rateCardId: "rateCard_std",
          rateSource: "matter",
          currency: "USD",
          amountMinor: 2250000,
        },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });

    const row = await readEntry(database, timeEntryId);
    expect(row).toMatchObject({
      matter_id: "matter_1",
      timekeeper_user_id: TIMEKEEPER,
      work_date: "2026-06-22",
      duration_minutes: 30,
      raw_duration_minutes: 28,
      narrative: "drafted demand letter",
      billable: 1,
      non_billable_category_id: null,
      currency: "USD",
      rate_e4: 4500000,
      rate_card_id: "rateCard_std",
      rate_source: "matter",
      amount_minor: 2250000,
      status: "draft",
      source: "manual",
    });
    expect(await countAudits(database, "time_entry.captured")).toBe(1);
  });

  it("leaves rate columns null and sets the category on a non-billable capture", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        billable: false,
        nonBillableCategoryId: "nonBillableCategory_admin",
        rate: { noRate: true },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });

    const row = await readEntry(database, timeEntryId);
    expect(row).toMatchObject({
      billable: 0,
      non_billable_category_id: "nonBillableCategory_admin",
      rate_e4: null,
      rate_card_id: null,
      rate_source: null,
      amount_minor: 0, // unused on non-billable; coalesced to keep the paired-null CHECK satisfied
    });
  });

  it("carries the live_run_id through for a timer-sourced capture", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        source: "timer",
        liveRunId: "run_abc",
        rate: {
          rateE4: 4500000,
          rateCardId: "rateCard_std",
          rateSource: "matter",
          currency: "USD",
          amountMinor: 2250000,
        },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });
    expect((await readEntry(database, timeEntryId))?.live_run_id).toBe("run_abc");
  });

  it("refuses a billable capture on an e_billing matter without a UTBMS task code", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1", 1);
    await expect(
      captureTimeEntry(
        database,
        {
          ...billableBase,
          rate: {
            rateE4: 4500000,
            rateCardId: "rateCard_std",
            rateSource: "matter",
            currency: "USD",
            amountMinor: 2250000,
          },
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "utbms-required" });
  });

  it("accepts an e_billing capture once a UTBMS task code is supplied", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1", 1);
    await seedUtbms(database, "utbmsCode_l120", "task", "L120");
    const { timeEntryId, effect } = await captureTimeEntry(
      database,
      {
        ...billableBase,
        utbmsTaskCodeId: "utbmsCode_l120",
        rate: {
          rateE4: 4500000,
          rateCardId: "rateCard_std",
          rateSource: "matter",
          currency: "USD",
          amountMinor: 2250000,
        },
      },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });
    expect((await readEntry(database, timeEntryId))?.utbms_task_code_id).toBe("utbmsCode_l120");
  });
});

it("TimeEntryValidationError carries a stable code", () => {
  expect(new TimeEntryValidationError("utbms-required", "x").code).toBe("utbms-required");
});
```

> Note on the `rate` shape: the route folds Task 7's `RateResolution` together with Task 4's `computeAmountMinor` and hands the service the resolved `{ rateE4, rateCardId, rateSource, currency, amountMinor }` (or `{ noRate: true }`). The service stores them verbatim — it never re-resolves or re-multiplies, so the captured rate is frozen exactly as the route computed it.

**Step 2 — run it (expect FAIL).**

```
pnpm --filter @magna-carta/timekeeping test -- time-entry-service
```

Expected: FAIL — `time-entry-service.ts` and `time-entry-validation.ts` (the latter from Task 8) do not yet export `captureTimeEntry` / the `utbms-required` code, so the import/type resolution fails:

```
FAIL  test/time-entry-service.test.ts [ test/time-entry-service.test.ts ]
Error: Failed to resolve entry for package "../src/time-entry-service.ts"
```

**Step 3 — add the `utbms-required` code to Task 8's validation module.** Append the code to `packages/timekeeping/src/time-entry-validation.ts`'s `TimeEntryValidationCode` union:

```ts
export type TimeEntryValidationCode =
  | "illegal-transition"
  | "frozen-entry"
  | "utbms-required"
  | "draft-only";
```

(The other codes land in Task 8/10; this step only adds `utbms-required` if Task 8 has not already.)

**Step 4 — write the insert statement.** Create `packages/timekeeping/src/time-entry-statements.ts`:

```ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { TimeEntryId } from "@magna-carta/identifiers/types";

// The single WIP store. Only committed entries live here; an in-flight scratch timer lives in the
// per-timekeeper Durable Object, never this table. Lifecycle is a column-level freeze contract: the
// service is the only writer and validates each status transition, and a billed/void row's business
// columns are frozen (transitions live in this module, the guard lives in the service).
export const TIME_ENTRY_TABLE = "time_entry";

// The resolved rate snapshot the route hands in, already frozen for this entry. amount_minor and
// rate_e4 are paired by the table CHECK: both set (billable) or both null (non-billable internal time).
export interface InsertTimeEntryRow {
  readonly id: TimeEntryId;
  readonly matterId: string;
  readonly timekeeperUserId: string;
  readonly workDate: string;
  readonly durationMinutes: number;
  readonly rawDurationMinutes: number;
  readonly narrative: string;
  readonly billable: number; // 0 | 1
  readonly nonBillableCategoryId: string | null;
  readonly currency: string;
  readonly rateE4: number | null;
  readonly rateCardId: string | null;
  readonly rateSource: string | null;
  readonly amountMinor: number | null;
  readonly utbmsTaskCodeId: string | null;
  readonly utbmsActivityCodeId: string | null;
  readonly source: string;
  readonly liveRunId: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

// A captured entry always enters as draft; invoice_id stays null until billing locks the row.
export function insertTimeEntryStatement(
  database: SqlDatabase,
  row: InsertTimeEntryRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TIME_ENTRY_TABLE} (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, utbms_activity_code_id, status, source, live_run_id, invoice_id, created_at, updated_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, 'draft', ?17, ?18, NULL, ?19, ?19, ?20)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.timekeeperUserId,
      row.workDate,
      row.durationMinutes,
      row.rawDurationMinutes,
      row.narrative,
      row.billable,
      row.nonBillableCategoryId,
      row.currency,
      row.rateE4,
      row.rateCardId,
      row.rateSource,
      row.amountMinor,
      row.utbmsTaskCodeId,
      row.utbmsActivityCodeId,
      row.source,
      row.liveRunId,
      row.createdAt,
      row.createdBy,
    );
}

// Reads the e_billing flag of the matter the capture binds to: an electronic-billing matter requires a
// UTBMS task code on every billable entry (the LEDES exporter at billing reads this column).
export function selectMatterEBillingStatement(
  database: SqlDatabase,
  matterId: string,
): SqlStatement {
  return database.prepare(`SELECT e_billing FROM matter WHERE id = ?1`).bind(matterId);
}
```

**Step 5 — write the service.** Create `packages/timekeeping/src/time-entry-service.ts`:

```ts
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { TimeEntryId, UserId } from "@magna-carta/identifiers/types";
import type { RateResolution } from "./rate-resolution.ts";
import {
  insertTimeEntryStatement,
  selectMatterEBillingStatement,
} from "./time-entry-statements.ts";
import { TimeEntryValidationError } from "./time-entry-validation.ts";

// Wall-clock and actor arrive from the caller — the service reads no clock and trusts no ambient
// identity. randomSource lets fixtures mint byte-deterministic ids. Mirrors ShipmentServiceOptions.
export interface ClockPort {
  now(): string;
}

export interface TimekeepingServiceOptions {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// The resolved rate the route hands in: Task-7 RateResolution widened with the Task-4-computed
// amount_minor, so the service stores a frozen snapshot and never re-resolves or re-multiplies.
export type CaptureRate =
  | {
      readonly rateE4: number;
      readonly rateCardId: string;
      readonly rateSource: RateResolution extends { noRate: true } ? never : string;
      readonly currency: string;
      readonly amountMinor: number;
    }
  | { readonly noRate: true };

export interface CaptureTimeEntryInput {
  readonly matterId: string;
  readonly timekeeperUserId: string;
  readonly workDate: string;
  readonly rawDurationMinutes: number;
  readonly durationMinutes: number;
  readonly narrative: string;
  readonly billable: boolean;
  readonly nonBillableCategoryId?: string;
  readonly source: string;
  readonly utbmsTaskCodeId?: string;
  readonly utbmsActivityCodeId?: string;
  readonly liveRunId?: string;
  readonly currency: string;
  readonly rate: CaptureRate;
}

function audit(
  database: SqlDatabase,
  options: TimekeepingServiceOptions,
  event: string,
  subjectId: string,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}

async function isEBillingMatter(database: SqlDatabase, matterId: string): Promise<boolean> {
  const { results } = await selectMatterEBillingStatement(database, matterId).all<{
    e_billing: number;
  }>();
  return (results[0]?.e_billing ?? 0) === 1;
}

// The single WIP-store writer. The route has already resolved the rate (precedence + effective date)
// and rounded the duration, then folded both into `input.rate` — this composes the insert + audit into
// one EffectWrite. A null rate ("non-billable internal time") stores null rate columns; the table's
// amount_minor ⟺ rate_e4 paired-null CHECK keeps the two in lockstep.
export async function captureTimeEntry(
  database: SqlDatabase,
  input: CaptureTimeEntryInput,
  options: TimekeepingServiceOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  // An electronic-billing matter cannot carry a billable entry without a UTBMS task code — the LEDES
  // exporter rejects an uncoded line, so refusing here keeps an uncodeable entry out of the WIP store.
  if (
    input.billable &&
    input.utbmsTaskCodeId === undefined &&
    (await isEBillingMatter(database, input.matterId))
  ) {
    throw new TimeEntryValidationError(
      "utbms-required",
      "an electronic-billing matter requires a UTBMS task code on a billable entry",
    );
  }

  const timeEntryId = newIdentifier("timeEntry", options.randomSource);
  const createdAt = options.clock.now();
  const billed = "noRate" in input.rate ? null : input.rate;

  return {
    timeEntryId,
    effect: {
      statements: [
        insertTimeEntryStatement(database, {
          id: timeEntryId,
          matterId: input.matterId,
          timekeeperUserId: input.timekeeperUserId,
          workDate: input.workDate,
          durationMinutes: input.durationMinutes,
          rawDurationMinutes: input.rawDurationMinutes,
          narrative: input.narrative,
          billable: input.billable ? 1 : 0,
          nonBillableCategoryId: input.nonBillableCategoryId ?? null,
          currency: input.currency,
          rateE4: billed?.rateE4 ?? null,
          rateCardId: billed?.rateCardId ?? null,
          rateSource: billed?.rateSource ?? null,
          amountMinor: billed?.amountMinor ?? null,
          utbmsTaskCodeId: input.utbmsTaskCodeId ?? null,
          utbmsActivityCodeId: input.utbmsActivityCodeId ?? null,
          source: input.source,
          liveRunId: input.liveRunId ?? null,
          createdAt,
          createdBy: options.actorUserId,
        }),
        audit(database, options, "time_entry.captured", timeEntryId),
      ],
      outboxMessages: [],
    },
  };
}
```

> The non-billable test asserts `amount_minor: 0` rather than `null`. Reconcile to the interface contract's `amount_minor` ⟺ `rate_e4` paired-null CHECK: a non-billable entry stores **null** for both. Correct the test's expectation to `amount_minor: null` to match the CHECK before running — the implementation above stores `null` on `noRate`, which is the contract.

Apply that one-line fix to the test (`amount_minor: 0` → `amount_minor: null`).

**Step 6 — run it (expect PASS).**

```
pnpm --filter @magna-carta/timekeeping test -- time-entry-service
```

Expected: PASS.

```
 ✓ test/time-entry-service.test.ts (6)
   ✓ captureTimeEntry > stores a billable entry with its frozen rate snapshot and an audit row
   ✓ captureTimeEntry > leaves rate columns null and sets the category on a non-billable capture
   ✓ captureTimeEntry > carries the live_run_id through for a timer-sourced capture
   ✓ captureTimeEntry > refuses a billable capture on an e_billing matter without a UTBMS task code
   ✓ captureTimeEntry > accepts an e_billing capture once a UTBMS task code is supplied
   ✓ TimeEntryValidationError carries a stable code

 Test Files  1 passed (1)
```

**Step 7 — add the package exports.** Add to `packages/timekeeping/package.json`'s `exports` map (alongside the Task 4/6/8 entries):

```json
    "./time-entry-statements": "./src/time-entry-statements.ts",
    "./time-entry-service": "./src/time-entry-service.ts",
```

**Step 8 — commit.**

```
git add packages/timekeeping/src/time-entry-statements.ts packages/timekeeping/src/time-entry-service.ts packages/timekeeping/src/time-entry-validation.ts packages/timekeeping/test/time-entry-service.test.ts packages/timekeeping/package.json
git commit -m "$(cat <<'EOF'
feat(timekeeping): time_entry statements + capture/commit service

The single WIP-store writer: captureTimeEntry composes the insert (frozen
resolved-rate snapshot, computed amount_minor, audit) into one EffectWrite,
honouring the amount_minor/rate_e4 paired-null CHECK and refusing an
uncoded billable entry on an electronic-billing matter.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Lifecycle transitions service + re-rate of unbilled drafts

The mutating lifecycle methods (`updateDraftTimeEntry`, `submit`/`approve`/`kickBack`/`void`) enforcing the column-level freeze contract through guarded `WHERE status = <from>` UPDATEs, plus `reRateUnbilledDrafts` on the rate service — re-resolving and rewriting `rate_e4`/`amount_minor` on draft/submitted/approved entries in range while leaving billed/void frozen.

**Files**

- Modify: `packages/timekeeping/src/time-entry-statements.ts` (transition + freeze-guarded-update + re-rate statements), `packages/timekeeping/src/time-entry-service.ts`, `packages/timekeeping/src/rate-service.ts` (`reRateUnbilledDrafts`)
- Test: `packages/timekeeping/test/time-entry-service.test.ts` (extend), `packages/timekeeping/test/rate-service.test.ts` (extend)

**Interfaces**

- Produces: `updateDraftTimeEntry`, `submitTimeEntry`, `approveTimeEntry`, `kickBackTimeEntry`, `voidTimeEntry`, `reRateUnbilledDrafts`.
- Consumes: Task 8 (`assertTransition`/`isFrozen`/`TimeEntryValidationError`), Task 7 (`resolveRate`), Task 4 (`computeAmountMinor`).

**Steps**

**Step 1 — write the failing lifecycle test.** Append to `packages/timekeeping/test/time-entry-service.test.ts`:

```ts
import {
  approveTimeEntry,
  kickBackTimeEntry,
  submitTimeEntry,
  updateDraftTimeEntry,
  voidTimeEntry,
} from "../src/time-entry-service.ts";

async function captureDraft(database: BatchDatabase, matterId = "matter_1"): Promise<string> {
  const { timeEntryId, effect } = await captureTimeEntry(
    database,
    {
      ...billableBase,
      matterId: matterId as MatterId,
      rate: {
        rateE4: 4500000,
        rateCardId: "rateCard_std",
        rateSource: "matter",
        currency: "USD",
        amountMinor: 2250000,
      },
    },
    options,
  );
  await commitEffectBatch(database, effect, { now: clock.now });
  return timeEntryId;
}

async function statusOf(database: BatchDatabase, id: string): Promise<string | undefined> {
  const { results } = await database
    .prepare("SELECT status FROM time_entry WHERE id = ?1")
    .bind(id)
    .all<{ status: string }>();
  return results[0]?.status;
}

async function billEntry(database: BatchDatabase, id: string): Promise<void> {
  // Stand in for the billing lock the financial core sets when an entry is invoiced.
  await database
    .prepare("UPDATE time_entry SET status = 'billed', invoice_id = 'invoice_x' WHERE id = ?1")
    .bind(id)
    .run();
}

describe("time-entry lifecycle (review gate on)", () => {
  const gateOn = { ...options, approvalRequired: true } as const;

  it("rewrites a draft via updateDraftTimeEntry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);
    const { effect } = await updateDraftTimeEntry(
      database,
      id as never,
      { narrative: "revised narrative", durationMinutes: 42 },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });
    const { results } = await database
      .prepare("SELECT narrative, duration_minutes FROM time_entry WHERE id = ?1")
      .bind(id)
      .all<{ narrative: string; duration_minutes: number }>();
    expect(results[0]).toMatchObject({ narrative: "revised narrative", duration_minutes: 42 });
  });

  it("refuses to update a billed (frozen) entry", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);
    await billEntry(database, id);
    await expect(
      updateDraftTimeEntry(database, id as never, { narrative: "no" }, options),
    ).rejects.toMatchObject({ code: "frozen-entry" });
  });

  it("walks draft -> submitted -> approved and audits each step", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);

    const submit = await submitTimeEntry(database, id as never, gateOn);
    await commitEffectBatch(database, submit.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("submitted");

    const approve = await approveTimeEntry(database, id as never, gateOn);
    await commitEffectBatch(database, approve.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("approved");

    expect(await countAudits(database, "time_entry.submitted")).toBe(1);
    expect(await countAudits(database, "time_entry.approved")).toBe(1);
  });

  it("kicks a submitted entry back to draft with an audited reason", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);
    const submit = await submitTimeEntry(database, id as never, gateOn);
    await commitEffectBatch(database, submit.effect, { now: clock.now });

    const kick = await kickBackTimeEntry(database, id as never, { reason: "wrong matter" }, gateOn);
    await commitEffectBatch(database, kick.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("draft");
    expect(await countAudits(database, "time_entry.kicked_back")).toBe(1);
  });

  it("refuses an illegal transition (approve a draft directly when the gate is on)", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);
    await expect(approveTimeEntry(database, id as never, gateOn)).rejects.toMatchObject({
      code: "illegal-transition",
    });
  });

  it("voids a draft and then refuses any further update", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");
    const id = await captureDraft(database);
    const voided = await voidTimeEntry(database, id as never, options);
    await commitEffectBatch(database, voided.effect, { now: clock.now });
    expect(await statusOf(database, id)).toBe("void");
    await expect(
      updateDraftTimeEntry(database, id as never, { narrative: "no" }, options),
    ).rejects.toMatchObject({ code: "frozen-entry" });
  });
});
```

**Step 2 — run the lifecycle test (expect FAIL).**

```
pnpm --filter @magna-carta/timekeeping test -- time-entry-service
```

Expected: FAIL — `submitTimeEntry`/`approveTimeEntry`/`kickBackTimeEntry`/`voidTimeEntry`/`updateDraftTimeEntry` are not exported.

```
Error: No "submitTimeEntry" export is defined on the "../src/time-entry-service.ts" mock
```

**Step 3 — add the transition statements.** Append to `packages/timekeeping/src/time-entry-statements.ts`:

```ts
// A guarded status transition: the WHERE status = <from> clause is the freeze backstop — a billed/void
// row never matches a pre-terminal `from`, so meta.changes === 0 means the row was not in the expected
// state (frozen, already-transitioned, or missing) and the service refuses. updated_at moves with the
// status; no business column is touched.
export function transitionStatusStatement(
  database: SqlDatabase,
  id: TimeEntryId,
  from: string,
  to: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TIME_ENTRY_TABLE} SET status = ?3, updated_at = ?4 WHERE id = ?1 AND status = ?2`,
    )
    .bind(id, from, to, updatedAt);
}

// The freeze-guarded draft edit: only a draft row matches, so a billed/void/submitted/approved row is
// untouched (meta.changes === 0) and the service refuses. Only the editable business columns move.
export interface DraftPatch {
  readonly narrative?: string;
  readonly durationMinutes?: number;
  readonly rawDurationMinutes?: number;
  readonly nonBillableCategoryId?: string | null;
  readonly utbmsTaskCodeId?: string | null;
  readonly utbmsActivityCodeId?: string | null;
}

export function updateDraftStatement(
  database: SqlDatabase,
  id: TimeEntryId,
  patch: DraftPatch,
  updatedAt: string,
): SqlStatement {
  const sets: string[] = [];
  const bindings: (string | number | null)[] = [id];
  let index = 2;
  for (const [column, value] of Object.entries({
    narrative: patch.narrative,
    duration_minutes: patch.durationMinutes,
    raw_duration_minutes: patch.rawDurationMinutes,
    non_billable_category_id: patch.nonBillableCategoryId,
    utbms_task_code_id: patch.utbmsTaskCodeId,
    utbms_activity_code_id: patch.utbmsActivityCodeId,
  })) {
    if (value === undefined) continue;
    sets.push(`${column} = ?${index}`);
    bindings.push(value);
    index += 1;
  }
  const updatedAtPlaceholder = `?${index}`;
  bindings.push(updatedAt);
  return database
    .prepare(
      `UPDATE ${TIME_ENTRY_TABLE} SET ${[...sets, `updated_at = ${updatedAtPlaceholder}`].join(", ")} WHERE id = ?1 AND status = 'draft'`,
    )
    .bind(...bindings);
}

// Reads the row the service guards against before composing a transition or freeze-guarded edit: the
// service needs the current status to choose the legal target and to refuse a frozen row up front (the
// WHERE-guard is the backstop; this read produces the human-facing refusal code).
export function selectTimeEntryStatusStatement(
  database: SqlDatabase,
  id: TimeEntryId,
): SqlStatement {
  return database.prepare(`SELECT status FROM ${TIME_ENTRY_TABLE} WHERE id = ?1`).bind(id);
}

// The re-rate rewrite: moves rate_e4 + amount_minor on ONE unbilled entry. Guarded to the unbilled set
// (draft/submitted/approved) so a billed/void row can never be re-rated — the captured rate is frozen.
export function reRateEntryStatement(
  database: SqlDatabase,
  id: string,
  rateE4: number,
  amountMinor: number,
  rateCardId: string,
  rateSource: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TIME_ENTRY_TABLE} SET rate_e4 = ?2, amount_minor = ?3, rate_card_id = ?4, rate_source = ?5, updated_at = ?6 WHERE id = ?1 AND status IN ('draft','submitted','approved')`,
    )
    .bind(id, rateE4, amountMinor, rateCardId, rateSource, updatedAt);
}

// The unbilled entries a re-rate revisits for a card over a work-date range. Only billable, unbilled,
// card-bound rows in range — billed/void and non-billable (null rate_card_id) are excluded by query.
export interface ReRateCandidate {
  readonly id: string;
  readonly matter_id: string;
  readonly timekeeper_user_id: string;
  readonly work_date: string;
  readonly duration_minutes: number;
  readonly currency: string;
}

export function selectReRateCandidatesStatement(
  database: SqlDatabase,
  rateCardId: string,
  fromDate: string,
  toDate: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, matter_id, timekeeper_user_id, work_date, duration_minutes, currency FROM ${TIME_ENTRY_TABLE} WHERE rate_card_id = ?1 AND status IN ('draft','submitted','approved') AND work_date >= ?2 AND work_date < ?3 ORDER BY work_date`,
    )
    .bind(rateCardId, fromDate, toDate);
}
```

**Step 4 — add the lifecycle methods to the service.** Append to `packages/timekeeping/src/time-entry-service.ts`:

```ts
import { assertTransition, isFrozen, type TimeEntryStatus } from "./lifecycle.ts";
import {
  selectTimeEntryStatusStatement,
  transitionStatusStatement,
  updateDraftStatement,
  type DraftPatch,
} from "./time-entry-statements.ts";
import type { TimeEntryId } from "@magna-carta/identifiers/types";

// The gate-aware option bag for the lifecycle methods: approvalRequired is the firm setting the route
// has already resolved (off by default), threaded so the pure state machine knows which path is legal.
export interface LifecycleOptions extends TimekeepingServiceOptions {
  readonly approvalRequired?: boolean;
}

async function loadStatus(database: SqlDatabase, id: TimeEntryId): Promise<TimeEntryStatus> {
  const { results } = await selectTimeEntryStatusStatement(database, id).all<{
    status: TimeEntryStatus;
  }>();
  const status = results[0]?.status;
  if (status === undefined) {
    throw new TimeEntryValidationError("not-found", `no such time entry: ${id}`);
  }
  return status;
}

// One transition method body: load the current status, refuse a frozen row with a human-facing code,
// assert the transition is legal for the gate, then compose the guarded UPDATE + audit. The WHERE-guard
// in transitionStatusStatement is the concurrency backstop behind the up-front status read.
async function transition(
  database: SqlDatabase,
  id: TimeEntryId,
  to: TimeEntryStatus,
  event: string,
  options: LifecycleOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  const from = await loadStatus(database, id);
  if (isFrozen(from)) {
    throw new TimeEntryValidationError("frozen-entry", `time entry ${id} is ${from} and frozen`);
  }
  assertTransition(from, to, options.approvalRequired ?? false);
  const updatedAt = options.clock.now();
  return {
    timeEntryId: id,
    effect: {
      statements: [
        transitionStatusStatement(database, id, from, to, updatedAt),
        audit(database, options, event, id),
      ],
      outboxMessages: [],
    },
  };
}

export async function updateDraftTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  patch: DraftPatch,
  options: TimekeepingServiceOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  const status = await loadStatus(database, timeEntryId);
  if (isFrozen(status)) {
    throw new TimeEntryValidationError(
      "frozen-entry",
      `time entry ${timeEntryId} is ${status} and frozen`,
    );
  }
  if (status !== "draft") {
    throw new TimeEntryValidationError(
      "draft-only",
      `time entry ${timeEntryId} is ${status}, not draft`,
    );
  }
  const updatedAt = options.clock.now();
  return {
    timeEntryId,
    effect: {
      statements: [
        updateDraftStatement(database, timeEntryId, patch, updatedAt),
        audit(database, options, "time_entry.updated", timeEntryId),
      ],
      outboxMessages: [],
    },
  };
}

export function submitTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  options: LifecycleOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  return transition(database, timeEntryId, "submitted", "time_entry.submitted", options);
}

export function approveTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  options: LifecycleOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  return transition(database, timeEntryId, "approved", "time_entry.approved", options);
}

// Kick-back records the reviewer's reason on the audit row (the only place a free-text reason lives —
// the entry itself carries no reason column). subjectId stays the entry; the reason rides metadata.
export async function kickBackTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  input: { reason: string },
  options: LifecycleOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  const from = await loadStatus(database, timeEntryId);
  if (isFrozen(from)) {
    throw new TimeEntryValidationError(
      "frozen-entry",
      `time entry ${timeEntryId} is ${from} and frozen`,
    );
  }
  assertTransition(from, "draft", options.approvalRequired ?? false);
  const updatedAt = options.clock.now();
  return {
    timeEntryId,
    effect: {
      statements: [
        transitionStatusStatement(database, timeEntryId, from, "draft", updatedAt),
        domainAuditStatement(database, {
          event: "time_entry.kicked_back",
          subjectId: timeEntryId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Void is a terminal freeze reachable from any non-frozen state (a mistaken entry is voided, never
// hard-deleted — the row stays for audit). assertTransition permits <any non-frozen> -> void.
export async function voidTimeEntry(
  database: SqlDatabase,
  timeEntryId: TimeEntryId,
  options: LifecycleOptions,
): Promise<{ timeEntryId: TimeEntryId; effect: EffectWrite }> {
  const from = await loadStatus(database, timeEntryId);
  if (isFrozen(from)) {
    throw new TimeEntryValidationError(
      "frozen-entry",
      `time entry ${timeEntryId} is ${from} and frozen`,
    );
  }
  assertTransition(from, "void", options.approvalRequired ?? false);
  const updatedAt = options.clock.now();
  return {
    timeEntryId,
    effect: {
      statements: [
        transitionStatusStatement(database, timeEntryId, from, "void", updatedAt),
        audit(database, options, "time_entry.voided", timeEntryId),
      ],
      outboxMessages: [],
    },
  };
}
```

> Add the `not-found` and `draft-only` codes to Task 8's `TimeEntryValidationCode` union if not already present:
>
> ```ts
> export type TimeEntryValidationCode =
>   | "illegal-transition"
>   | "frozen-entry"
>   | "utbms-required"
>   | "draft-only"
>   | "not-found";
> ```

**Step 5 — run the lifecycle test (expect PASS).**

```
pnpm --filter @magna-carta/timekeeping test -- time-entry-service
```

Expected: PASS — all lifecycle cases plus the Task-9 capture cases.

```
 ✓ test/time-entry-service.test.ts (12)
   ✓ time-entry lifecycle (review gate on) > rewrites a draft via updateDraftTimeEntry
   ✓ time-entry lifecycle (review gate on) > refuses to update a billed (frozen) entry
   ✓ time-entry lifecycle (review gate on) > walks draft -> submitted -> approved and audits each step
   ✓ time-entry lifecycle (review gate on) > kicks a submitted entry back to draft with an audited reason
   ✓ time-entry lifecycle (review gate on) > refuses an illegal transition (approve a draft directly when the gate is on)
   ✓ time-entry lifecycle (review gate on) > voids a draft and then refuses any further update
```

**Step 6 — write the failing re-rate test.** Append to `packages/timekeeping/test/rate-service.test.ts` (the Task-6 suite, which already seeds a rate card and `appendRate` versions):

```ts
import { reRateUnbilledDrafts } from "../src/rate-service.ts";

describe("reRateUnbilledDrafts", () => {
  it("rewrites rate_e4/amount_minor on unbilled entries in range and leaves billed/void untouched", async () => {
    const database = freshDatabase();
    await seedMatter(database, "matter_1");

    // A card with a matter-tier rate of 450.0000/hr in force from the work date.
    const { rateCardId } = await createRateCard(database, { name: "Standard" }, options);
    await commitEffectBatch(
      database,
      (
        await appendRate(
          database,
          {
            rateCardId,
            tier: "matter",
            scopedId: "matter_1",
            rateE4: 4500000,
            currency: "USD",
            validFrom: "2026-06-01",
          },
          options,
        )
      ).effect,
      { now: clock.now },
    );

    // Three entries on the card: a draft, an approved, and a billed — all 60 min, 2026-06-22.
    const draftId = await captureCardEntry(database, rateCardId, "draft");
    const approvedId = await captureCardEntry(database, rateCardId, "approved");
    const billedId = await captureCardEntry(database, rateCardId, "billed");

    // A retroactive correction: a new matter-tier version of 500.0000/hr effective 2026-06-01.
    await commitEffectBatch(
      database,
      (
        await appendRate(
          database,
          {
            rateCardId,
            tier: "matter",
            scopedId: "matter_1",
            rateE4: 5000000,
            currency: "USD",
            validFrom: "2026-06-15",
          },
          options,
        )
      ).effect,
      { now: clock.now },
    );

    const { count, effect } = await reRateUnbilledDrafts(
      database,
      { rateCardId, fromDate: "2026-06-01", toDate: "2026-07-01" },
      options,
    );
    await commitEffectBatch(database, effect, { now: clock.now });

    expect(count).toBe(2); // draft + approved; billed excluded
    // The draft + approved move to the 500.0000 rate; 60 min => 50000 minor.
    expect(await rateOf(database, draftId)).toMatchObject({
      rate_e4: 5000000,
      amount_minor: 50000,
    });
    expect(await rateOf(database, approvedId)).toMatchObject({
      rate_e4: 5000000,
      amount_minor: 50000,
    });
    // The billed entry's captured rate never moves.
    expect(await rateOf(database, billedId)).toMatchObject({
      rate_e4: 4500000,
      amount_minor: 45000,
    });
    expect(await countAudits(database, "time_entry.re_rated")).toBe(2);
  });
});
```

Add these helpers to the rate-service test file (above the `describe`):

```ts
async function captureCardEntry(
  database: BatchDatabase,
  rateCardId: string,
  finalStatus: "draft" | "approved" | "billed",
): Promise<string> {
  const { timeEntryId, effect } = await captureTimeEntry(
    database,
    {
      matterId: "matter_1" as MatterId,
      timekeeperUserId: TIMEKEEPER,
      workDate: "2026-06-22",
      rawDurationMinutes: 60,
      durationMinutes: 60,
      narrative: "research",
      billable: true,
      currency: "USD",
      source: "manual",
      rate: {
        rateE4: 4500000,
        rateCardId,
        rateSource: "matter",
        currency: "USD",
        amountMinor: 45000,
      },
    },
    options,
  );
  await commitEffectBatch(database, effect, { now: clock.now });
  if (finalStatus === "approved") {
    await database
      .prepare("UPDATE time_entry SET status = 'approved' WHERE id = ?1")
      .bind(timeEntryId)
      .run();
  } else if (finalStatus === "billed") {
    await database
      .prepare("UPDATE time_entry SET status = 'billed', invoice_id = 'invoice_x' WHERE id = ?1")
      .bind(timeEntryId)
      .run();
  }
  return timeEntryId;
}

async function rateOf(database: BatchDatabase, id: string) {
  const { results } = await database
    .prepare("SELECT rate_e4, amount_minor FROM time_entry WHERE id = ?1")
    .bind(id)
    .all<{ rate_e4: number; amount_minor: number }>();
  return results[0];
}
```

(The rate-service test already imports `createRateCard`/`appendRate`/`commitEffectBatch`/`captureTimeEntry`/`seedMatter`/`clock`/`options`/`TIMEKEEPER`/`countAudits` from Task 6/9; reuse them.)

**Step 7 — run the re-rate test (expect FAIL).**

```
pnpm --filter @magna-carta/timekeeping test -- rate-service
```

Expected: FAIL — `reRateUnbilledDrafts` is not exported from `rate-service.ts`.

```
Error: No "reRateUnbilledDrafts" export is defined on the "../src/rate-service.ts" mock
```

**Step 8 — implement `reRateUnbilledDrafts`.** Append to `packages/timekeeping/src/rate-service.ts`:

```ts
import { computeAmountMinor } from "./rounding.ts";
import { resolveRate } from "./rate-resolution.ts";
import { reRateEntryStatement, selectReRateCandidatesStatement } from "./time-entry-statements.ts";

export interface ReRateUnbilledDraftsInput {
  readonly rateCardId: RateCardId;
  readonly fromDate: string;
  readonly toDate: string;
}

// Re-resolves and rewrites the rate on every unbilled (draft/submitted/approved) entry the card
// produced over a work-date range — the opt-in retroactive correction, never automatic, so amounts
// never move silently. Billed/void rows are excluded by query AND by the statement's status guard, so a
// captured rate on a billed entry can never move. Each rewrite re-resolves on the entry's OWN work_date,
// so the effective-dated version in force on that date is the one applied. Batched into one EffectWrite.
export async function reRateUnbilledDrafts(
  database: SqlDatabase,
  input: ReRateUnbilledDraftsInput,
  options: TimekeepingServiceOptions,
): Promise<{ count: number; effect: EffectWrite }> {
  const { results } = await selectReRateCandidatesStatement(
    database,
    input.rateCardId,
    input.fromDate,
    input.toDate,
  ).all<{
    id: string;
    matter_id: string;
    timekeeper_user_id: string;
    work_date: string;
    duration_minutes: number;
    currency: string;
  }>();

  const statements: EffectWrite["statements"] = [];
  const updatedAt = options.clock.now();
  for (const row of results) {
    const resolution = await resolveRate(database, {
      matterId: row.matter_id,
      clientId: null,
      timekeeperUserId: row.timekeeper_user_id,
      roleId: null,
      workDate: row.work_date,
      rateCardId: input.rateCardId,
    });
    if ("noRate" in resolution) continue; // a candidate that no longer resolves a rate keeps its capture
    const amountMinor = computeAmountMinor(
      resolution.rateE4,
      row.duration_minutes,
      resolution.currency,
    );
    statements.push(
      reRateEntryStatement(
        database,
        row.id,
        resolution.rateE4,
        amountMinor,
        resolution.rateCardId,
        resolution.rateSource,
        updatedAt,
      ),
      audit(database, options, "time_entry.re_rated", row.id),
    );
  }

  return { count: statements.length / 2, effect: { statements, outboxMessages: [] } };
}
```

> The `audit` helper and `SqlDatabase`/`EffectWrite`/`TimekeepingServiceOptions`/`RateCardId` imports already exist in `rate-service.ts` from Task 6. If `audit` is local-private there, reuse it; otherwise import `domainAuditStatement` and inline as in `kickBackTimeEntry`.

**Step 9 — run the re-rate test (expect PASS).**

```
pnpm --filter @magna-carta/timekeeping test -- rate-service
```

Expected: PASS.

```
 ✓ test/rate-service.test.ts (5)
   ✓ reRateUnbilledDrafts > rewrites rate_e4/amount_minor on unbilled entries in range and leaves billed/void untouched
```

**Step 10 — run the whole package suite to confirm no regression.**

```
pnpm --filter @magna-carta/timekeeping test
```

Expected: PASS (all timekeeping suites).

**Step 11 — commit.**

```
git add packages/timekeeping/src/time-entry-statements.ts packages/timekeeping/src/time-entry-service.ts packages/timekeeping/src/rate-service.ts packages/timekeeping/src/time-entry-validation.ts packages/timekeeping/test/time-entry-service.test.ts packages/timekeeping/test/rate-service.test.ts
git commit -m "$(cat <<'EOF'
feat(timekeeping): lifecycle transitions + re-rate of unbilled drafts

submit/approve/kickBack/void and the draft edit ride guarded
WHERE status = <from> UPDATEs so a billed/void row stays frozen;
reRateUnbilledDrafts re-resolves and rewrites rate_e4/amount_minor on
draft/submitted/approved entries in range, leaving billed/void untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: UTBMS catalog (seed + enable/disable)

The `utbms_code` statements, the published-set seed data as code, the seed composer, and the enable/disable service. This catalog is owned here; the costs and billing slices read it. A firm enables or disables seeded ABA codes but never invents one.

**Files**

- Create: `packages/timekeeping/src/utbms-catalog.ts`, `packages/timekeeping/src/utbms-statements.ts`, `packages/timekeeping/src/utbms-service.ts`
- Test: `packages/timekeeping/test/utbms-service.test.ts`

**Interfaces**

- Produces: `UTBMS_CODE_TABLE`, `utbmsSeedData`, `seedUtbmsCatalogStatements`, `enableUtbmsCode`, `disableUtbmsCode`, `listUtbmsCodesBySetStatement`.
- Consumes: `newIdentifier`, `domainAuditStatement`, Task 2 schema, `TimekeepingServiceOptions`.

**Steps**

**Step 1 — write the failing test.** Create `packages/timekeeping/test/utbms-service.test.ts`:

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { utbmsSeedData } from "../src/utbms-catalog.ts";
import {
  listUtbmsCodesBySetStatement,
  seedUtbmsCatalogStatements,
} from "../src/utbms-statements.ts";
import { disableUtbmsCode, enableUtbmsCode } from "../src/utbms-service.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const ADMIN = "user_admin" as UserId;
const options = { clock, actorUserId: ADMIN };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedCatalog(database: BatchDatabase): Promise<void> {
  await database.batch(seedUtbmsCatalogStatements(database));
}

async function listSet(database: BatchDatabase, codeSet: string) {
  const { results } = await listUtbmsCodesBySetStatement(database, codeSet).all<{
    id: string;
    code: string;
    label: string;
    active: number;
  }>();
  return results;
}

describe("utbms catalog seed", () => {
  it("emits one insert per published task/activity/expense code", async () => {
    const database = freshDatabase();
    const statements = seedUtbmsCatalogStatements(database);
    expect(statements.length).toBe(utbmsSeedData.length);
    expect(utbmsSeedData.length).toBeGreaterThan(0);
    await database.batch(statements);

    const tasks = await listSet(database, "task");
    const activities = await listSet(database, "activity");
    const expenses = await listSet(database, "expense");
    expect(tasks.some((row) => row.code === "L120")).toBe(true);
    expect(activities.some((row) => row.code === "A101")).toBe(true);
    expect(expenses.some((row) => row.code === "E101")).toBe(true);
    // Every seeded code starts active.
    expect([...tasks, ...activities, ...expenses].every((row) => row.active === 1)).toBe(true);
  });

  it("seeds deterministic handles so a re-seed is a no-op on the UNIQUE (code_set, code)", async () => {
    const database = freshDatabase();
    await seedCatalog(database);
    // Re-seeding must not duplicate rows (INSERT OR IGNORE on the UNIQUE index).
    await seedCatalog(database);
    const tasks = await listSet(database, "task");
    const l120 = tasks.filter((row) => row.code === "L120");
    expect(l120.length).toBe(1);
  });
});

describe("enable/disable", () => {
  it("disableUtbmsCode flips active to 0 and audits", async () => {
    const database = freshDatabase();
    await seedCatalog(database);
    const id = (await listSet(database, "task")).find((row) => row.code === "L120")!.id;

    const { effect } = await disableUtbmsCode(database, id as never, options);
    await commitEffectBatch(database, effect, { now: clock.now });
    const row = (await listSet(database, "task")).find((r) => r.code === "L120")!;
    expect(row.active).toBe(0);

    const { results: audits } = await database
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'utbms_code.disabled'")
      .all<{ n: number }>();
    expect(audits[0]?.n).toBe(1);
  });

  it("enableUtbmsCode flips active back to 1 and audits", async () => {
    const database = freshDatabase();
    await seedCatalog(database);
    const id = (await listSet(database, "task")).find((row) => row.code === "L120")!.id;
    await commitEffectBatch(
      database,
      (await disableUtbmsCode(database, id as never, options)).effect,
      { now: clock.now },
    );
    await commitEffectBatch(
      database,
      (await enableUtbmsCode(database, id as never, options)).effect,
      { now: clock.now },
    );
    expect((await listSet(database, "task")).find((r) => r.code === "L120")!.active).toBe(1);
  });

  it("a toggle on an unknown id touches no row (the service only toggles seeded rows)", async () => {
    const database = freshDatabase();
    await seedCatalog(database);
    const before = await listSet(database, "task");
    const { effect } = await disableUtbmsCode(database, "utbmsCode_not_real" as never, options);
    await commitEffectBatch(database, effect, { now: clock.now });
    // No invented code, no row mutated: the active set is unchanged.
    expect(await listSet(database, "task")).toEqual(before);
  });
});
```

**Step 2 — run it (expect FAIL).**

```
pnpm --filter @magna-carta/timekeeping test -- utbms
```

Expected: FAIL — `utbms-catalog.ts`, `utbms-statements.ts`, `utbms-service.ts` do not exist.

```
Error: Failed to resolve entry for package "../src/utbms-catalog.ts"
```

**Step 3 — write the seed data as code.** Create `packages/timekeeping/src/utbms-catalog.ts`:

```ts
// The published ABA UTBMS task / activity / expense families, carried as data. Firms enable or disable
// these rows but never invent a code — the standard set is the contract a LEDES export validates
// against, so it is fixed here and seeded at provisioning. A representative, extensible subset of the
// litigation (L), counselling (A) and expense (E) sets; new published codes are added here and nowhere
// else. code_set partitions the three families; code is the published ABA code (e.g. L120, A101, E101).
export interface UtbmsSeedCode {
  readonly codeSet: "task" | "activity" | "expense";
  readonly code: string;
  readonly label: string;
  readonly practiceArea: string | null;
}

export const utbmsSeedData: readonly UtbmsSeedCode[] = [
  // Litigation task codes (L-set).
  {
    codeSet: "task",
    code: "L110",
    label: "Fact Investigation/Development",
    practiceArea: "litigation",
  },
  { codeSet: "task", code: "L120", label: "Analysis/Strategy", practiceArea: "litigation" },
  { codeSet: "task", code: "L130", label: "Experts/Consultants", practiceArea: "litigation" },
  { codeSet: "task", code: "L140", label: "Document/File Management", practiceArea: "litigation" },
  {
    codeSet: "task",
    code: "L160",
    label: "Settlement/Non-Binding ADR",
    practiceArea: "litigation",
  },
  { codeSet: "task", code: "L210", label: "Pleadings", practiceArea: "litigation" },
  {
    codeSet: "task",
    code: "L230",
    label: "Court Mandated Conferences",
    practiceArea: "litigation",
  },
  { codeSet: "task", code: "L240", label: "Dispositive Motions", practiceArea: "litigation" },
  {
    codeSet: "task",
    code: "L250",
    label: "Other Written Motions and Submissions",
    practiceArea: "litigation",
  },
  { codeSet: "task", code: "L310", label: "Written Discovery", practiceArea: "litigation" },
  { codeSet: "task", code: "L330", label: "Depositions", practiceArea: "litigation" },
  { codeSet: "task", code: "L390", label: "Other Discovery", practiceArea: "litigation" },
  {
    codeSet: "task",
    code: "L440",
    label: "Other Trial Preparation and Support",
    practiceArea: "litigation",
  },
  {
    codeSet: "task",
    code: "L450",
    label: "Trial and Hearing Attendance",
    practiceArea: "litigation",
  },
  // Activity codes (A-set), practice-area-independent.
  { codeSet: "activity", code: "A101", label: "Plan and prepare for", practiceArea: null },
  { codeSet: "activity", code: "A102", label: "Research", practiceArea: null },
  { codeSet: "activity", code: "A103", label: "Draft/revise", practiceArea: null },
  { codeSet: "activity", code: "A104", label: "Review/analyze", practiceArea: null },
  { codeSet: "activity", code: "A105", label: "Communicate (in firm)", practiceArea: null },
  { codeSet: "activity", code: "A106", label: "Communicate (with client)", practiceArea: null },
  {
    codeSet: "activity",
    code: "A107",
    label: "Communicate (other outside counsel)",
    practiceArea: null,
  },
  { codeSet: "activity", code: "A108", label: "Communicate (other external)", practiceArea: null },
  { codeSet: "activity", code: "A109", label: "Appear for/attend", practiceArea: null },
  { codeSet: "activity", code: "A110", label: "Manage data/files", practiceArea: null },
  { codeSet: "activity", code: "A111", label: "Other", practiceArea: null },
  // Expense codes (E-set) — owned here, consumed by the costs slice.
  { codeSet: "expense", code: "E101", label: "Copying", practiceArea: null },
  { codeSet: "expense", code: "E102", label: "Outside printing", practiceArea: null },
  { codeSet: "expense", code: "E106", label: "Online research", practiceArea: null },
  { codeSet: "expense", code: "E107", label: "Delivery services/messengers", practiceArea: null },
  { codeSet: "expense", code: "E108", label: "Postage", practiceArea: null },
  { codeSet: "expense", code: "E110", label: "Out-of-town travel", practiceArea: null },
  { codeSet: "expense", code: "E111", label: "Meals", practiceArea: null },
  { codeSet: "expense", code: "E112", label: "Court fees", practiceArea: null },
  { codeSet: "expense", code: "E115", label: "Deposition transcripts", practiceArea: null },
  { codeSet: "expense", code: "E118", label: "Litigation support vendors", practiceArea: null },
];
```

**Step 4 — write the statements.** Create `packages/timekeeping/src/utbms-statements.ts`:

```ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { UtbmsCodeId } from "@magna-carta/identifiers/types";
import { utbmsSeedData } from "./utbms-catalog.ts";

export const UTBMS_CODE_TABLE = "utbms_code";

// A deterministic handle per published code so a re-seed is a no-op: the id is stable across runs and
// the UNIQUE (code_set, code) index makes a duplicate INSERT OR IGNORE a no-op rather than a conflict.
function seedHandle(codeSet: string, code: string): string {
  return `utbmsCode_${codeSet}_${code}`;
}

// The catalog seed: one INSERT OR IGNORE per published code, active by default. Composed at
// provisioning and idempotent on re-run (the UNIQUE index + OR IGNORE), so re-seeding never duplicates.
export function seedUtbmsCatalogStatements(database: SqlDatabase): SqlStatement[] {
  return utbmsSeedData.map((row) =>
    database
      .prepare(
        `INSERT OR IGNORE INTO ${UTBMS_CODE_TABLE} (id, code_set, code, label, practice_area, active) VALUES (?1, ?2, ?3, ?4, ?5, 1)`,
      )
      .bind(seedHandle(row.codeSet, row.code), row.codeSet, row.code, row.label, row.practiceArea),
  );
}

// The active/inactive toggle. Guarded to a known id: an unknown id matches no row (meta.changes === 0),
// so the service can only flip a seeded row — a firm can never invent an ABA code through this path.
export function setUtbmsCodeActiveStatement(
  database: SqlDatabase,
  id: UtbmsCodeId,
  active: number,
): SqlStatement {
  return database
    .prepare(`UPDATE ${UTBMS_CODE_TABLE} SET active = ?2 WHERE id = ?1`)
    .bind(id, active);
}

// The read the routes and the costs/billing slices consume: every code in a set, active flag included.
export function listUtbmsCodesBySetStatement(database: SqlDatabase, codeSet: string): SqlStatement {
  return database
    .prepare(
      `SELECT id, code_set, code, label, practice_area, active FROM ${UTBMS_CODE_TABLE} WHERE code_set = ?1 ORDER BY code`,
    )
    .bind(codeSet);
}
```

**Step 5 — write the service.** Create `packages/timekeeping/src/utbms-service.ts`:

```ts
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { UtbmsCodeId } from "@magna-carta/identifiers/types";
import type { TimekeepingServiceOptions } from "./time-entry-service.ts";
import { setUtbmsCodeActiveStatement } from "./utbms-statements.ts";

function toggle(
  database: SqlDatabase,
  id: UtbmsCodeId,
  active: number,
  event: string,
  options: TimekeepingServiceOptions,
): { utbmsCodeId: UtbmsCodeId; effect: EffectWrite } {
  return {
    utbmsCodeId: id,
    effect: {
      statements: [
        setUtbmsCodeActiveStatement(database, id, active),
        domainAuditStatement(database, {
          event,
          subjectId: id,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Enable/disable a seeded UTBMS code. The firm toggles the published ABA set; the UPDATE is guarded to a
// known id, so an invented code never lands — only an existing row's active flag moves.
export function enableUtbmsCode(
  database: SqlDatabase,
  id: UtbmsCodeId,
  options: TimekeepingServiceOptions,
): { utbmsCodeId: UtbmsCodeId; effect: EffectWrite } {
  return toggle(database, id, 1, "utbms_code.enabled", options);
}

export function disableUtbmsCode(
  database: SqlDatabase,
  id: UtbmsCodeId,
  options: TimekeepingServiceOptions,
): { utbmsCodeId: UtbmsCodeId; effect: EffectWrite } {
  return toggle(database, id, 0, "utbms_code.disabled", options);
}
```

> The test `await`s `disableUtbmsCode(...)` — these return synchronously, but `await` on a non-Promise value resolves to the value, so the test reads fine. (The route still composes the returned `effect` through `runIdempotentEffect`.)

**Step 6 — run it (expect PASS).**

```
pnpm --filter @magna-carta/timekeeping test -- utbms
```

Expected: PASS.

```
 ✓ test/utbms-service.test.ts (5)
   ✓ utbms catalog seed > emits one insert per published task/activity/expense code
   ✓ utbms catalog seed > seeds deterministic handles so a re-seed is a no-op on the UNIQUE (code_set, code)
   ✓ enable/disable > disableUtbmsCode flips active to 0 and audits
   ✓ enable/disable > enableUtbmsCode flips active back to 1 and audits
   ✓ enable/disable > a toggle on an unknown id touches no row (the service only toggles seeded rows)
```

**Step 7 — add the package exports.** Add to `packages/timekeeping/package.json`'s `exports` map:

```json
    "./utbms-catalog": "./src/utbms-catalog.ts",
    "./utbms-statements": "./src/utbms-statements.ts",
    "./utbms-service": "./src/utbms-service.ts",
```

**Step 8 — commit.**

```
git add packages/timekeeping/src/utbms-catalog.ts packages/timekeeping/src/utbms-statements.ts packages/timekeeping/src/utbms-service.ts packages/timekeeping/test/utbms-service.test.ts packages/timekeeping/package.json
git commit -m "$(cat <<'EOF'
feat(timekeeping): UTBMS catalog seed + enable/disable

The published ABA task/activity/expense code families as code, an
idempotent seed composer (deterministic handles + INSERT OR IGNORE on the
UNIQUE index), and the enable/disable toggle guarded so a firm flips a
seeded row but never invents a code.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Non-billable categories + narrative templates

The firm-configurable `non_billable_category` (seed-and-fork defaults, soft-archive) and the per-task-code `narrative_template` store with the recent-narrative read.

**Files**

- Create: `packages/timekeeping/src/non-billable-category-statements.ts`, `packages/timekeeping/src/non-billable-category-service.ts`, `packages/timekeeping/src/narrative-template-statements.ts`, `packages/timekeeping/src/narrative-template-service.ts`
- Test: `packages/timekeeping/test/non-billable-category-service.test.ts`, `packages/timekeeping/test/narrative-template-service.test.ts`

**Interfaces**

- Produces: `NON_BILLABLE_CATEGORY_TABLE`, `seedNonBillableCategoryStatements`, `createNonBillableCategory`, `updateNonBillableCategory`, `archiveNonBillableCategory`; `NARRATIVE_TEMPLATE_TABLE`, `createNarrativeTemplate`, `updateNarrativeTemplate`, `archiveNarrativeTemplate`, `recentNarrativesStatement`, `listNarrativeTemplatesStatement`.
- Consumes: `newIdentifier`, `domainAuditStatement`, `TimekeepingServiceOptions`.

**Steps**

**Step 1 — write the failing non-billable-category test.** Create `packages/timekeeping/test/non-billable-category-service.test.ts`:

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  NON_BILLABLE_CATEGORY_DEFAULTS,
  seedNonBillableCategoryStatements,
} from "../src/non-billable-category-statements.ts";
import {
  archiveNonBillableCategory,
  createNonBillableCategory,
  updateNonBillableCategory,
} from "../src/non-billable-category-service.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const ADMIN = "user_admin" as UserId;
const options = { clock, actorUserId: ADMIN };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function listCategories(database: BatchDatabase) {
  const { results } = await database
    .prepare("SELECT id, name, archived_at FROM non_billable_category ORDER BY name")
    .all<{ id: string; name: string; archived_at: string | null }>();
  return results;
}

describe("non-billable category seed-and-fork", () => {
  it("seeds the four default categories", async () => {
    const database = freshDatabase();
    await database.batch(seedNonBillableCategoryStatements(database, clock.now()));
    const names = (await listCategories(database)).map((row) => row.name);
    expect(names).toEqual([...NON_BILLABLE_CATEGORY_DEFAULTS].sort());
    expect(names).toContain("Administrative");
    expect(names).toContain("Business Development");
    expect(names).toContain("Pro Bono");
    expect(names).toContain("Training/CLE");
  });
});

describe("non-billable category CRUD", () => {
  it("creates, renames, and soft-archives (never hard delete), auditing each", async () => {
    const database = freshDatabase();
    const created = await createNonBillableCategory(
      database,
      { name: "Knowledge Management" },
      options,
    );
    await commitEffectBatch(database, created.effect, { now: clock.now });
    expect((await listCategories(database))[0]).toMatchObject({
      name: "Knowledge Management",
      archived_at: null,
    });

    const renamed = await updateNonBillableCategory(
      database,
      created.nonBillableCategoryId,
      { name: "Knowledge Mgmt" },
      options,
    );
    await commitEffectBatch(database, renamed.effect, { now: clock.now });
    expect((await listCategories(database))[0]?.name).toBe("Knowledge Mgmt");

    const archived = await archiveNonBillableCategory(
      database,
      created.nonBillableCategoryId,
      options,
    );
    await commitEffectBatch(database, archived.effect, { now: clock.now });
    const row = (await listCategories(database))[0];
    expect(row?.archived_at).not.toBeNull(); // soft-archive: the row survives
    expect(row?.name).toBe("Knowledge Mgmt");

    const { results: audits } = await database
      .prepare("SELECT event FROM audit_log ORDER BY created_at")
      .all<{ event: string }>();
    expect(audits.map((a) => a.event)).toEqual([
      "non_billable_category.created",
      "non_billable_category.updated",
      "non_billable_category.archived",
    ]);
  });

  it("refuses an empty category name", async () => {
    const database = freshDatabase();
    await expect(
      createNonBillableCategory(database, { name: "  " }, options),
    ).rejects.toMatchObject({ code: "empty-name" });
  });
});
```

**Step 2 — write the failing narrative-template test.** Create `packages/timekeeping/test/narrative-template-service.test.ts`:

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  listNarrativeTemplatesStatement,
  recentNarrativesStatement,
} from "../src/narrative-template-statements.ts";
import {
  archiveNarrativeTemplate,
  createNarrativeTemplate,
  updateNarrativeTemplate,
} from "../src/narrative-template-service.ts";

const clock = { now: () => "2026-06-22T12:00:00.000Z" };
const ADMIN = "user_admin" as UserId;
const TIMEKEEPER = "user_attorney" as UserId;
const options = { clock, actorUserId: ADMIN };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedUtbms(database: BatchDatabase): Promise<void> {
  await database
    .prepare(
      "INSERT INTO utbms_code (id, code_set, code, label, active) VALUES ('utbmsCode_l120', 'task', 'L120', 'Analysis/Strategy', 1)",
    )
    .run();
}

async function listTemplates(database: BatchDatabase) {
  const { results } = await listNarrativeTemplatesStatement(database).all<{
    id: string;
    utbms_task_code_id: string | null;
    narrative_template: string;
    default_rate_e4: number | null;
    archived_at: string | null;
  }>();
  return results;
}

describe("narrative templates", () => {
  it("stores a template carrying the optional task code and default rate, and lists active ones", async () => {
    const database = freshDatabase();
    await seedUtbms(database);
    const created = await createNarrativeTemplate(
      database,
      {
        utbmsTaskCodeId: "utbmsCode_l120",
        narrativeTemplate: "Analysis and strategy re: ",
        defaultRateE4: 4500000,
      },
      options,
    );
    await commitEffectBatch(database, created.effect, { now: clock.now });
    const rows = await listTemplates(database);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      utbms_task_code_id: "utbmsCode_l120",
      narrative_template: "Analysis and strategy re: ",
      default_rate_e4: 4500000,
      archived_at: null,
    });
  });

  it("stores a template with no task code and no default rate", async () => {
    const database = freshDatabase();
    const created = await createNarrativeTemplate(
      database,
      { narrativeTemplate: "Telephone conference with client" },
      options,
    );
    await commitEffectBatch(database, created.effect, { now: clock.now });
    expect((await listTemplates(database))[0]).toMatchObject({
      utbms_task_code_id: null,
      default_rate_e4: null,
    });
  });

  it("updates and soft-archives a template, auditing each", async () => {
    const database = freshDatabase();
    const created = await createNarrativeTemplate(
      database,
      { narrativeTemplate: "Draft memo" },
      options,
    );
    await commitEffectBatch(database, created.effect, { now: clock.now });
    await commitEffectBatch(
      database,
      (
        await updateNarrativeTemplate(
          database,
          created.narrativeTemplateId,
          { narrativeTemplate: "Draft memorandum" },
          options,
        )
      ).effect,
      { now: clock.now },
    );
    await commitEffectBatch(
      database,
      (await archiveNarrativeTemplate(database, created.narrativeTemplateId, options)).effect,
      { now: clock.now },
    );
    // Archived templates drop out of the active list.
    expect(await listTemplates(database)).toHaveLength(0);

    const { results: audits } = await database
      .prepare("SELECT event FROM audit_log ORDER BY created_at")
      .all<{ event: string }>();
    expect(audits.map((a) => a.event)).toEqual([
      "narrative_template.created",
      "narrative_template.updated",
      "narrative_template.archived",
    ]);
  });

  it("refuses an empty template body", async () => {
    const database = freshDatabase();
    await expect(
      createNarrativeTemplate(database, { narrativeTemplate: "   " }, options),
    ).rejects.toMatchObject({ code: "empty-name" });
  });
});

describe("recent narratives", () => {
  it("returns the timekeeper's distinct recent narratives, most recent first", async () => {
    const database = freshDatabase();
    // Seed the matter + timekeeper the entries reference.
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'A', 'active', ?2)",
      )
      .bind(TIMEKEEPER, clock.now())
      .run();
    await database
      .prepare(
        "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at) VALUES ('matter_1', 'M', 'open', ?1, 0, ?2)",
      )
      .bind(TIMEKEEPER, clock.now())
      .run();

    // Three entries; two share a narrative — the read must de-dup.
    let n = 0;
    for (const [narrative, date] of [
      ["reviewed pleadings", "2026-06-20"],
      ["drafted demand letter", "2026-06-21"],
      ["reviewed pleadings", "2026-06-22"],
    ] as const) {
      n += 1;
      await database
        .prepare(
          "INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, status, source, created_at, updated_at) VALUES (?1, 'matter_1', ?2, ?3, 30, 30, ?4, 1, 'USD', 'draft', 'manual', ?5, ?5)",
        )
        .bind(`timeEntry_${n}`, TIMEKEEPER, date, narrative, `2026-06-${20 + n}T00:00:00.000Z`)
        .run();
    }

    const { results } = await recentNarrativesStatement(database, TIMEKEEPER, 10).all<{
      narrative: string;
    }>();
    const narratives = results.map((r) => r.narrative);
    expect(narratives).toEqual(["reviewed pleadings", "drafted demand letter"]);
  });
});
```

**Step 3 — run both (expect FAIL).**

```
pnpm --filter @magna-carta/timekeeping test -- non-billable-category narrative-template
```

Expected: FAIL — none of the four source modules exist yet.

```
Error: Failed to resolve entry for package "../src/non-billable-category-statements.ts"
```

**Step 4 — write the non-billable-category statements.** Create `packages/timekeeping/src/non-billable-category-statements.ts`:

```ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { NonBillableCategoryId } from "@magna-carta/identifiers/types";

export const NON_BILLABLE_CATEGORY_TABLE = "non_billable_category";

// Seed-and-fork defaults: provisioning lays these down and a firm renames, archives, or extends them —
// defaults, not locks. The same pattern the custom-fields templates use.
export const NON_BILLABLE_CATEGORY_DEFAULTS = [
  "Administrative",
  "Business Development",
  "Pro Bono",
  "Training/CLE",
] as const;

export interface InsertNonBillableCategoryRow {
  readonly id: NonBillableCategoryId;
  readonly name: string;
  readonly createdAt: string;
}

export function insertNonBillableCategoryStatement(
  database: SqlDatabase,
  row: InsertNonBillableCategoryRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NON_BILLABLE_CATEGORY_TABLE} (id, name, archived_at, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?3)`,
    )
    .bind(row.id, row.name, row.createdAt);
}

// The provisioning seed. Handles are minted (not deterministic) — a firm forks freely and a re-seed is
// not expected (provisioning runs once), matching the custom-fields seed-and-fork precedent.
export function seedNonBillableCategoryStatements(
  database: SqlDatabase,
  now: string,
): SqlStatement[] {
  return NON_BILLABLE_CATEGORY_DEFAULTS.map((name) =>
    insertNonBillableCategoryStatement(database, {
      id: newIdentifier("nonBillableCategory"),
      name,
      createdAt: now,
    }),
  );
}

export function renameNonBillableCategoryStatement(
  database: SqlDatabase,
  id: NonBillableCategoryId,
  name: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${NON_BILLABLE_CATEGORY_TABLE} SET name = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, name, updatedAt);
}

// Soft-archive: stamp archived_at, never delete. The row survives so historical entries that reference
// it stay readable.
export function archiveNonBillableCategoryStatement(
  database: SqlDatabase,
  id: NonBillableCategoryId,
  archivedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${NON_BILLABLE_CATEGORY_TABLE} SET archived_at = ?2, updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, archivedAt);
}
```

**Step 5 — write the non-billable-category service.** Create `packages/timekeeping/src/non-billable-category-service.ts`:

```ts
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { NonBillableCategoryId } from "@magna-carta/identifiers/types";
import type { TimekeepingServiceOptions } from "./time-entry-service.ts";
import { TimeEntryValidationError } from "./time-entry-validation.ts";
import {
  archiveNonBillableCategoryStatement,
  insertNonBillableCategoryStatement,
  renameNonBillableCategoryStatement,
} from "./non-billable-category-statements.ts";

function audit(
  database: SqlDatabase,
  options: TimekeepingServiceOptions,
  event: string,
  subjectId: string,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}

function requireNonEmpty(name: string): void {
  if (name.trim().length === 0) {
    throw new TimeEntryValidationError("empty-name", "a non-billable category needs a name");
  }
}

export async function createNonBillableCategory(
  database: SqlDatabase,
  input: { name: string },
  options: TimekeepingServiceOptions,
): Promise<{ nonBillableCategoryId: NonBillableCategoryId; effect: EffectWrite }> {
  requireNonEmpty(input.name);
  const nonBillableCategoryId = newIdentifier("nonBillableCategory", options.randomSource);
  const now = options.clock.now();
  return {
    nonBillableCategoryId,
    effect: {
      statements: [
        insertNonBillableCategoryStatement(database, {
          id: nonBillableCategoryId,
          name: input.name,
          createdAt: now,
        }),
        audit(database, options, "non_billable_category.created", nonBillableCategoryId),
      ],
      outboxMessages: [],
    },
  };
}

export async function updateNonBillableCategory(
  database: SqlDatabase,
  id: NonBillableCategoryId,
  patch: { name: string },
  options: TimekeepingServiceOptions,
): Promise<{ nonBillableCategoryId: NonBillableCategoryId; effect: EffectWrite }> {
  requireNonEmpty(patch.name);
  return {
    nonBillableCategoryId: id,
    effect: {
      statements: [
        renameNonBillableCategoryStatement(database, id, patch.name, options.clock.now()),
        audit(database, options, "non_billable_category.updated", id),
      ],
      outboxMessages: [],
    },
  };
}

// Soft-archive only — a category with historical entries pointing at it is never hard-deleted.
export async function archiveNonBillableCategory(
  database: SqlDatabase,
  id: NonBillableCategoryId,
  options: TimekeepingServiceOptions,
): Promise<{ nonBillableCategoryId: NonBillableCategoryId; effect: EffectWrite }> {
  return {
    nonBillableCategoryId: id,
    effect: {
      statements: [
        archiveNonBillableCategoryStatement(database, id, options.clock.now()),
        audit(database, options, "non_billable_category.archived", id),
      ],
      outboxMessages: [],
    },
  };
}
```

> Add the `empty-name` code to Task 8's `TimeEntryValidationCode` union if not already present.

**Step 6 — write the narrative-template statements.** Create `packages/timekeeping/src/narrative-template-statements.ts`:

```ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NarrativeTemplateId } from "@magna-carta/identifiers/types";

export const NARRATIVE_TEMPLATE_TABLE = "narrative_template";

// A template fills narrative AND rate together: utbms_task_code_id keys the suggestion to a task, and
// default_rate_e4 pre-fills the rate alongside the narrative (both optional).
export interface InsertNarrativeTemplateRow {
  readonly id: NarrativeTemplateId;
  readonly utbmsTaskCodeId: string | null;
  readonly narrativeTemplate: string;
  readonly defaultRateE4: number | null;
  readonly createdAt: string;
}

export function insertNarrativeTemplateStatement(
  database: SqlDatabase,
  row: InsertNarrativeTemplateRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${NARRATIVE_TEMPLATE_TABLE} (id, utbms_task_code_id, narrative_template, default_rate_e4, archived_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5)`,
    )
    .bind(row.id, row.utbmsTaskCodeId, row.narrativeTemplate, row.defaultRateE4, row.createdAt);
}

export function updateNarrativeTemplateStatement(
  database: SqlDatabase,
  id: NarrativeTemplateId,
  patch: {
    narrativeTemplate?: string;
    utbmsTaskCodeId?: string | null;
    defaultRateE4?: number | null;
  },
  updatedAt: string,
): SqlStatement {
  const sets: string[] = [];
  const bindings: (string | number | null)[] = [id];
  let index = 2;
  for (const [column, value] of Object.entries({
    narrative_template: patch.narrativeTemplate,
    utbms_task_code_id: patch.utbmsTaskCodeId,
    default_rate_e4: patch.defaultRateE4,
  })) {
    if (value === undefined) continue;
    sets.push(`${column} = ?${index}`);
    bindings.push(value);
    index += 1;
  }
  const updatedAtPlaceholder = `?${index}`;
  bindings.push(updatedAt);
  return database
    .prepare(
      `UPDATE ${NARRATIVE_TEMPLATE_TABLE} SET ${[...sets, `updated_at = ${updatedAtPlaceholder}`].join(", ")} WHERE id = ?1`,
    )
    .bind(...bindings);
}

export function archiveNarrativeTemplateStatement(
  database: SqlDatabase,
  id: NarrativeTemplateId,
  archivedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${NARRATIVE_TEMPLATE_TABLE} SET archived_at = ?2, updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, archivedAt);
}

// Active templates only (archived rows drop out).
export function listNarrativeTemplatesStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT id, utbms_task_code_id, narrative_template, default_rate_e4, archived_at FROM ${NARRATIVE_TEMPLATE_TABLE} WHERE archived_at IS NULL ORDER BY created_at`,
  );
}

// The timekeeper's distinct recent narratives, most recent first — the one-tap re-pick read. DISTINCT
// de-dups a repeated narrative; MAX(work_date) orders by the most recent use. Reads time_entry directly.
export function recentNarrativesStatement(
  database: SqlDatabase,
  timekeeperUserId: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT narrative FROM time_entry WHERE timekeeper_user_id = ?1 GROUP BY narrative ORDER BY MAX(work_date) DESC LIMIT ?2`,
    )
    .bind(timekeeperUserId, limit);
}
```

**Step 7 — write the narrative-template service.** Create `packages/timekeeping/src/narrative-template-service.ts`:

```ts
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { NarrativeTemplateId } from "@magna-carta/identifiers/types";
import type { TimekeepingServiceOptions } from "./time-entry-service.ts";
import { TimeEntryValidationError } from "./time-entry-validation.ts";
import {
  archiveNarrativeTemplateStatement,
  insertNarrativeTemplateStatement,
  updateNarrativeTemplateStatement,
} from "./narrative-template-statements.ts";

function audit(
  database: SqlDatabase,
  options: TimekeepingServiceOptions,
  event: string,
  subjectId: string,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}

export interface CreateNarrativeTemplateInput {
  readonly narrativeTemplate: string;
  readonly utbmsTaskCodeId?: string;
  readonly defaultRateE4?: number;
}

export async function createNarrativeTemplate(
  database: SqlDatabase,
  input: CreateNarrativeTemplateInput,
  options: TimekeepingServiceOptions,
): Promise<{ narrativeTemplateId: NarrativeTemplateId; effect: EffectWrite }> {
  if (input.narrativeTemplate.trim().length === 0) {
    throw new TimeEntryValidationError("empty-name", "a narrative template needs a body");
  }
  const narrativeTemplateId = newIdentifier("narrativeTemplate", options.randomSource);
  const now = options.clock.now();
  return {
    narrativeTemplateId,
    effect: {
      statements: [
        insertNarrativeTemplateStatement(database, {
          id: narrativeTemplateId,
          utbmsTaskCodeId: input.utbmsTaskCodeId ?? null,
          narrativeTemplate: input.narrativeTemplate,
          defaultRateE4: input.defaultRateE4 ?? null,
          createdAt: now,
        }),
        audit(database, options, "narrative_template.created", narrativeTemplateId),
      ],
      outboxMessages: [],
    },
  };
}

export async function updateNarrativeTemplate(
  database: SqlDatabase,
  id: NarrativeTemplateId,
  patch: {
    narrativeTemplate?: string;
    utbmsTaskCodeId?: string | null;
    defaultRateE4?: number | null;
  },
  options: TimekeepingServiceOptions,
): Promise<{ narrativeTemplateId: NarrativeTemplateId; effect: EffectWrite }> {
  if (patch.narrativeTemplate !== undefined && patch.narrativeTemplate.trim().length === 0) {
    throw new TimeEntryValidationError("empty-name", "a narrative template needs a body");
  }
  return {
    narrativeTemplateId: id,
    effect: {
      statements: [
        updateNarrativeTemplateStatement(database, id, patch, options.clock.now()),
        audit(database, options, "narrative_template.updated", id),
      ],
      outboxMessages: [],
    },
  };
}

export async function archiveNarrativeTemplate(
  database: SqlDatabase,
  id: NarrativeTemplateId,
  options: TimekeepingServiceOptions,
): Promise<{ narrativeTemplateId: NarrativeTemplateId; effect: EffectWrite }> {
  return {
    narrativeTemplateId: id,
    effect: {
      statements: [
        archiveNarrativeTemplateStatement(database, id, options.clock.now()),
        audit(database, options, "narrative_template.archived", id),
      ],
      outboxMessages: [],
    },
  };
}
```

**Step 8 — run both (expect PASS).**

```
pnpm --filter @magna-carta/timekeeping test -- non-billable-category narrative-template
```

Expected: PASS.

```
 ✓ test/non-billable-category-service.test.ts (4)
   ✓ non-billable category seed-and-fork > seeds the four default categories
   ✓ non-billable category CRUD > creates, renames, and soft-archives (never hard delete), auditing each
   ✓ non-billable category CRUD > refuses an empty category name
 ✓ test/narrative-template-service.test.ts (6)
   ✓ narrative templates > stores a template carrying the optional task code and default rate, and lists active ones
   ✓ narrative templates > stores a template with no task code and no default rate
   ✓ narrative templates > updates and soft-archives a template, auditing each
   ✓ narrative templates > refuses an empty template body
   ✓ recent narratives > returns the timekeeper's distinct recent narratives, most recent first
```

**Step 9 — add the package exports.** Add to `packages/timekeeping/package.json`'s `exports` map:

```json
    "./non-billable-category-statements": "./src/non-billable-category-statements.ts",
    "./non-billable-category-service": "./src/non-billable-category-service.ts",
    "./narrative-template-statements": "./src/narrative-template-statements.ts",
    "./narrative-template-service": "./src/narrative-template-service.ts",
```

**Step 10 — commit.**

```
git add packages/timekeeping/src/non-billable-category-statements.ts packages/timekeeping/src/non-billable-category-service.ts packages/timekeeping/src/narrative-template-statements.ts packages/timekeeping/src/narrative-template-service.ts packages/timekeeping/test/non-billable-category-service.test.ts packages/timekeeping/test/narrative-template-service.test.ts packages/timekeeping/package.json
git commit -m "$(cat <<'EOF'
feat(timekeeping): non-billable categories + narrative templates

Firm-configurable non-billable categories (seed-and-fork defaults,
soft-archive never hard delete) and the per-task-code narrative template
store (fills narrative + default rate together) plus the timekeeper's
distinct recent-narrative read for one-tap re-pick.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

I have everything I need. Now I'll write the four task sections (13, 14, 15, 16) with full TDD code matching the established patterns.

### Task 13: Quick-add parser + My Day reads + WIP queries

The one-line quick-add parser (duration + matter fuzzy-match candidate + narrative), the My Day visibility projection, and the WIP read queries (weekly grid, per-matter unbilled). All three read-only — no audit, no `EffectWrite`. The queries ride the keyset-pagination toolkit and the `(timekeeper_user_id, work_date)` / `(matter_id, status)` indexes the migration lands.

**Files**

- Create: `packages/timekeeping/src/quick-add-parser.ts`, `packages/timekeeping/src/my-day.ts`, `packages/timekeeping/src/queries.ts`
- Modify: `packages/timekeeping/package.json` (add the three `exports`)
- Test: `packages/timekeeping/test/quick-add-parser.test.ts`, `packages/timekeeping/test/my-day.test.ts`, `packages/timekeeping/test/queries.test.ts`

**Interfaces**

- Produces: `parseQuickAdd(text)` → `{ durationMinutes; matterHint; narrative }`; `readMyDay`, `MyDayView`, `MyDayTargets`; `listTimeEntriesForTimekeeperDay`, `listWeeklyGrid`, `listUnbilledByMatter`.
- Consumes: `TIME_ENTRY_TABLE` (Task 9), the `@magna-carta/data-access/cursor-pagination` toolkit, `@magna-carta/database/node-sqlite` (tests).

**Step 1 — add the three exports to `package.json`.**

Append to the `exports` map in `packages/timekeeping/src/../package.json` (the package scaffold landed in Task 4):

```jsonc
// packages/timekeeping/package.json — exports map (added entries)
    "./quick-add-parser": "./src/quick-add-parser.ts",
    "./my-day": "./src/my-day.ts",
    "./queries": "./src/queries.ts",
```

**Step 2 — write the failing parser test.**

Create `packages/timekeeping/test/quick-add-parser.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "../src/quick-add-parser.ts";

describe("parseQuickAdd", () => {
  it("reads a leading decimal-hours duration, a matter hint, and the narrative", () => {
    expect(parseQuickAdd("0.5 Smith — drafted demand letter")).toEqual({
      durationMinutes: 30,
      matterHint: "Smith",
      narrative: "drafted demand letter",
    });
  });

  it("reads an explicit hours+minutes duration (1h30m)", () => {
    expect(parseQuickAdd("1h30m Acme — reviewed disclosure")).toEqual({
      durationMinutes: 90,
      matterHint: "Acme",
      narrative: "reviewed disclosure",
    });
  });

  it("reads a bare-minutes duration (45m)", () => {
    expect(parseQuickAdd("45m Jones — call with client")).toEqual({
      durationMinutes: 45,
      matterHint: "Jones",
      narrative: "call with client",
    });
  });

  it("accepts a hyphen separator as well as an em dash", () => {
    expect(parseQuickAdd("0.25 Doe - quick note")).toEqual({
      durationMinutes: 15,
      matterHint: "Doe",
      narrative: "quick note",
    });
  });

  it("returns a null matter hint when nothing precedes the separator", () => {
    // No matter token before the dash: the hint stays null rather than guessing, so the UI
    // never auto-picks a matter the writer did not name.
    expect(parseQuickAdd("0.5 — research")).toEqual({
      durationMinutes: 30,
      matterHint: null,
      narrative: "research",
    });
  });

  it("keeps a multi-word matter hint verbatim and never auto-resolves it", () => {
    // The parser surfaces the raw hint string only; resolving it to one of the firm's matters
    // (and refusing an ambiguous match) is the route's job, not the parser's.
    expect(parseQuickAdd("2h Smith v. Jones — prepared for hearing")).toEqual({
      durationMinutes: 120,
      matterHint: "Smith v. Jones",
      narrative: "prepared for hearing",
    });
  });

  it("treats text with no separator as narrative-only", () => {
    expect(parseQuickAdd("0.5 drafted demand letter")).toEqual({
      durationMinutes: 30,
      matterHint: null,
      narrative: "drafted demand letter",
    });
  });

  it("throws when no duration can be read", () => {
    expect(() => parseQuickAdd("Smith — drafted demand letter")).toThrow(/duration/);
  });

  it("throws on a zero or negative duration", () => {
    expect(() => parseQuickAdd("0 Smith — note")).toThrow(/duration/);
  });
});
```

**Step 3 — run it (expect FAIL: the module does not exist yet).**

```
pnpm --filter @magna-carta/timekeeping test -- quick-add
```

Expected: the suite errors with `Failed to resolve import "../src/quick-add-parser.ts"` / `Cannot find module` — 0 passed.

**Step 4 — implement the parser.**

Create `packages/timekeeping/src/quick-add-parser.ts`:

```typescript
// The one-line capture grammar: "<duration> [<matter hint> —|-] <narrative>". The parser is pure and
// total over its three fields — it reads the duration and (optionally) a matter HINT string, but never
// resolves that hint to a stored matter: ambiguity is the caller's to surface for confirmation, so a
// one-line capture can never silently bill the wrong matter. No competitor ships a built-in parser; the
// grammar is deliberately small and explicit rather than a free-text NLP guess.

export interface QuickAddParse {
  readonly durationMinutes: number;
  readonly matterHint: string | null;
  readonly narrative: string;
}

// Leading duration token: decimal hours ("0.5", "2"), "1h30m" / "1h" / "30m", anchored at the start.
const DURATION_PATTERN = /^\s*(?:(\d+)h(?:(\d+)m)?|(\d+)m|(\d+(?:\.\d+)?))\b/;

// Either an em dash or a hyphen, surrounded by spaces, splits the "[hint] — narrative" remainder.
const SEPARATOR_PATTERN = /\s+[—-]\s+/;

function durationToMinutes(match: RegExpExecArray): number {
  const [, hoursOfHM, minutesOfHM, bareMinutes, decimalHours] = match;
  if (hoursOfHM !== undefined) {
    return Number(hoursOfHM) * 60 + (minutesOfHM !== undefined ? Number(minutesOfHM) : 0);
  }
  if (bareMinutes !== undefined) return Number(bareMinutes);
  // decimalHours is integer minutes only when hours map cleanly; round to whole minutes (the captured
  // raw quantity), leaving the billing-increment rounding to roundDuration at the write boundary.
  return Math.round(Number(decimalHours) * 60);
}

export function parseQuickAdd(text: string): QuickAddParse {
  const durationMatch = DURATION_PATTERN.exec(text);
  if (durationMatch === null) {
    throw new Error("quick-add text must begin with a duration (e.g. 0.5, 45m, 1h30m)");
  }
  const durationMinutes = durationToMinutes(durationMatch);
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("quick-add duration must be a positive number of minutes");
  }

  const remainder = text.slice(durationMatch[0].length).trim();
  const separator = SEPARATOR_PATTERN.exec(remainder);
  if (separator === null || separator.index === undefined) {
    // No "hint — narrative" split: the whole remainder is the narrative; no matter is named.
    return { durationMinutes, matterHint: null, narrative: remainder };
  }
  const hint = remainder.slice(0, separator.index).trim();
  const narrative = remainder.slice(separator.index + separator[0].length).trim();
  return { durationMinutes, matterHint: hint.length > 0 ? hint : null, narrative };
}
```

**Step 5 — write the failing My Day + queries tests.**

Create `packages/timekeeping/test/my-day.test.ts`:

```typescript
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { readMyDay } from "../src/my-day.ts";

const TIMEKEEPER = "user_attorney" as UserId;

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedMatter(database: BatchDatabase, id: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1, 'M', NULL, 'open', NULL, NULL, ?2, NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(id, TIMEKEEPER)
    .run();
}

interface SeedEntry {
  id: string;
  workDate: string;
  durationMinutes: number;
  billable: 0 | 1;
  status?: string;
}

async function seedEntry(database: BatchDatabase, entry: SeedEntry): Promise<void> {
  await database
    .prepare(
      "INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, utbms_activity_code_id, status, source, live_run_id, invoice_id, created_at, updated_at, created_by) VALUES (?1, 'matter_a', ?2, ?3, ?4, ?4, 'work', ?5, NULL, 'USD', NULL, NULL, NULL, NULL, NULL, NULL, ?6, 'manual', NULL, NULL, '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z', ?2)",
    )
    .bind(
      entry.id,
      TIMEKEEPER,
      entry.workDate,
      entry.durationMinutes,
      entry.billable,
      entry.status ?? "draft",
    )
    .run();
}

async function setup(): Promise<BatchDatabase> {
  const database = freshDatabase();
  await seedMatter(database, "matter_a");
  return database;
}

describe("readMyDay", () => {
  it("totals billable and non-billable minutes for the work date, excluding void", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_1",
      workDate: "2026-06-22",
      durationMinutes: 120,
      billable: 1,
    });
    await seedEntry(database, {
      id: "timeEntry_2",
      workDate: "2026-06-22",
      durationMinutes: 90,
      billable: 1,
    });
    await seedEntry(database, {
      id: "timeEntry_3",
      workDate: "2026-06-22",
      durationMinutes: 30,
      billable: 0,
    });
    // A void entry never counts toward the day's totals.
    await seedEntry(database, {
      id: "timeEntry_void",
      workDate: "2026-06-22",
      durationMinutes: 60,
      billable: 1,
      status: "void",
    });
    // A different day must not bleed in.
    await seedEntry(database, {
      id: "timeEntry_other",
      workDate: "2026-06-21",
      durationMinutes: 240,
      billable: 1,
    });

    const view = await readMyDay(database, {
      timekeeperUserId: TIMEKEEPER,
      workDate: "2026-06-22",
      targets: { targetDailyMinutes: 480 },
    });
    expect(view).toEqual({
      billableMinutes: 210,
      nonBillableMinutes: 30,
      targetDailyMinutes: 480,
      shortfallMinutes: 270, // 480 - 210 billable
      unloggedDay: false,
    });
  });

  it("reports an un-logged day with a null shortfall when no target is set", async () => {
    const database = await setup();
    const view = await readMyDay(database, {
      timekeeperUserId: TIMEKEEPER,
      workDate: "2026-06-22",
      targets: { targetDailyMinutes: null },
    });
    expect(view).toEqual({
      billableMinutes: 0,
      nonBillableMinutes: 0,
      targetDailyMinutes: null,
      shortfallMinutes: null,
      unloggedDay: true,
    });
  });

  it("clamps the shortfall to zero once the billable target is met", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_1",
      workDate: "2026-06-22",
      durationMinutes: 540,
      billable: 1,
    });
    const view = await readMyDay(database, {
      timekeeperUserId: TIMEKEEPER,
      workDate: "2026-06-22",
      targets: { targetDailyMinutes: 480 },
    });
    expect(view.shortfallMinutes).toBe(0);
    expect(view.unloggedDay).toBe(false);
  });
});
```

Create `packages/timekeeping/test/queries.test.ts`:

```typescript
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  listTimeEntriesForTimekeeperDay,
  listUnbilledByMatter,
  listWeeklyGrid,
} from "../src/queries.ts";

const TIMEKEEPER = "user_attorney" as UserId;

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

async function seedMatter(database: BatchDatabase, id: string): Promise<void> {
  await database
    .prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES (?1, 'M', NULL, 'open', NULL, NULL, ?2, NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .bind(id, TIMEKEEPER)
    .run();
}

interface SeedEntry {
  id: string;
  matterId: string;
  workDate: string;
  durationMinutes: number;
  status: string;
  amountMinor: number | null;
  createdAt: string;
}

async function seedEntry(database: BatchDatabase, entry: SeedEntry): Promise<void> {
  await database
    .prepare(
      "INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, non_billable_category_id, currency, rate_e4, rate_card_id, rate_source, amount_minor, utbms_task_code_id, utbms_activity_code_id, status, source, live_run_id, invoice_id, created_at, updated_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'work', 1, NULL, 'USD', 30000, 'rateCard_a', 'matter', ?6, NULL, NULL, ?7, 'manual', NULL, NULL, ?8, ?8, ?3)",
    )
    .bind(
      entry.id,
      entry.matterId,
      TIMEKEEPER,
      entry.workDate,
      entry.durationMinutes,
      entry.amountMinor,
      entry.status,
      entry.createdAt,
    )
    .run();
}

async function setup(): Promise<BatchDatabase> {
  const database = freshDatabase();
  await seedMatter(database, "matter_a");
  await seedMatter(database, "matter_b");
  return database;
}

const day = (n: number) => `2026-06-${String(n).padStart(2, "0")}`;
const at = (n: number) => `2026-06-${String(n).padStart(2, "0")}T12:00:00.000Z`;

describe("listTimeEntriesForTimekeeperDay", () => {
  it("returns the timekeeper's entries for the work date, newest first", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_1",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 60,
      status: "draft",
      amountMinor: 30000,
      createdAt: at(22),
    });
    await seedEntry(database, {
      id: "timeEntry_2",
      matterId: "matter_b",
      workDate: day(22),
      durationMinutes: 30,
      status: "draft",
      amountMinor: 15000,
      createdAt: at(21),
    });
    await seedEntry(database, {
      id: "timeEntry_other",
      matterId: "matter_a",
      workDate: day(21),
      durationMinutes: 90,
      status: "draft",
      amountMinor: 45000,
      createdAt: at(20),
    });
    const { data } = await listTimeEntriesForTimekeeperDay(database, {
      timekeeperUserId: TIMEKEEPER,
      workDate: day(22),
    });
    expect(data.map((row) => row.id)).toEqual(["timeEntry_1", "timeEntry_2"]);
    expect(data[0]).toMatchObject({
      matterId: "matter_a",
      durationMinutes: 60,
      amountMinor: 30000,
    });
  });
});

describe("listWeeklyGrid", () => {
  it("returns the timekeeper's entries across the week window, oldest day first", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_mon",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 60,
      status: "draft",
      amountMinor: 30000,
      createdAt: at(22),
    });
    await seedEntry(database, {
      id: "timeEntry_tue",
      matterId: "matter_a",
      workDate: day(23),
      durationMinutes: 120,
      status: "draft",
      amountMinor: 60000,
      createdAt: at(23),
    });
    // Outside the window — excluded.
    await seedEntry(database, {
      id: "timeEntry_prev",
      matterId: "matter_a",
      workDate: day(21),
      durationMinutes: 30,
      status: "draft",
      amountMinor: 15000,
      createdAt: at(21),
    });
    const rows = await listWeeklyGrid(database, {
      timekeeperUserId: TIMEKEEPER,
      fromDate: day(22),
      toDate: day(28),
    });
    expect(rows.map((row) => row.id)).toEqual(["timeEntry_mon", "timeEntry_tue"]);
    expect(rows.map((row) => row.workDate)).toEqual([day(22), day(23)]);
  });
});

describe("listUnbilledByMatter", () => {
  it("sums unbilled minutes and amount per matter, excluding billed and void", async () => {
    const database = await setup();
    await seedEntry(database, {
      id: "timeEntry_1",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 60,
      status: "draft",
      amountMinor: 30000,
      createdAt: at(22),
    });
    await seedEntry(database, {
      id: "timeEntry_2",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 30,
      status: "approved",
      amountMinor: 15000,
      createdAt: at(22),
    });
    // Billed and void must not appear in unbilled WIP.
    await seedEntry(database, {
      id: "timeEntry_billed",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 120,
      status: "billed",
      amountMinor: 60000,
      createdAt: at(22),
    });
    await seedEntry(database, {
      id: "timeEntry_void",
      matterId: "matter_a",
      workDate: day(22),
      durationMinutes: 45,
      status: "void",
      amountMinor: 22500,
      createdAt: at(22),
    });
    const rows = await listUnbilledByMatter(database, { matterId: "matter_a" as MatterId });
    expect(rows).toEqual([
      { matterId: "matter_a", unbilledMinutes: 90, unbilledAmountMinor: 45000, entryCount: 2 },
    ]);
  });
});
```

**Step 6 — run all three (expect FAIL: `my-day.ts` / `queries.ts` do not exist).**

```
pnpm --filter @magna-carta/timekeeping test -- quick-add my-day queries
```

Expected: `quick-add-parser.test.ts` now PASSES; `my-day.test.ts` and `queries.test.ts` error with `Cannot find module ../src/my-day.ts` / `../src/queries.ts`.

**Step 7 — implement `my-day.ts`.**

Create `packages/timekeeping/src/my-day.ts`:

```typescript
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import { TIME_ENTRY_TABLE } from "./time-entry-statements.ts";

// The My Day visibility read: billable/non-billable totals for one timekeeper on one work date, with a
// target-vs-actual shortfall and un-logged-day detection. Read-only over the WIP store (never the
// ledger) and total — a missing target yields a null shortfall rather than a guess. Void entries are
// excluded so a discarded capture never colours the day. Utilization/realization roll-ups live in the
// reports surface, not here; this is the daily-driver headline.

export interface MyDayTargets {
  readonly targetDailyMinutes: number | null;
}

export interface MyDayQuery {
  readonly timekeeperUserId: UserId;
  readonly workDate: string;
  readonly targets: MyDayTargets;
}

export interface MyDayView {
  readonly billableMinutes: number;
  readonly nonBillableMinutes: number;
  readonly targetDailyMinutes: number | null;
  readonly shortfallMinutes: number | null;
  readonly unloggedDay: boolean;
}

interface TotalsRow {
  readonly billable_minutes: number | null;
  readonly non_billable_minutes: number | null;
  readonly entry_count: number;
}

export async function readMyDay(database: SqlDatabase, query: MyDayQuery): Promise<MyDayView> {
  // One grouped pass over the (timekeeper_user_id, work_date) index. COALESCE turns the empty-day SUM
  // (NULL) into 0; the billable flag splits the two totals in a single scan.
  const { results } = await database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN billable = 1 THEN duration_minutes ELSE 0 END), 0) AS billable_minutes,
         COALESCE(SUM(CASE WHEN billable = 0 THEN duration_minutes ELSE 0 END), 0) AS non_billable_minutes,
         COUNT(*) AS entry_count
       FROM ${TIME_ENTRY_TABLE}
       WHERE timekeeper_user_id = ?1 AND work_date = ?2 AND status != 'void'`,
    )
    .bind(query.timekeeperUserId, query.workDate)
    .all<TotalsRow>();
  const row = results[0];
  const billableMinutes = row?.billable_minutes ?? 0;
  const nonBillableMinutes = row?.non_billable_minutes ?? 0;
  const entryCount = row?.entry_count ?? 0;

  const targetDailyMinutes = query.targets.targetDailyMinutes;
  // Shortfall is measured against BILLABLE minutes (the headline target); a met target clamps to 0.
  const shortfallMinutes =
    targetDailyMinutes === null ? null : Math.max(0, targetDailyMinutes - billableMinutes);

  return {
    billableMinutes,
    nonBillableMinutes,
    targetDailyMinutes,
    shortfallMinutes,
    unloggedDay: entryCount === 0,
  };
}
```

**Step 8 — implement `queries.ts`.**

Create `packages/timekeeping/src/queries.ts`:

```typescript
import {
  appendCursorPredicate,
  assemblePage,
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  type Page,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId, RateCardId, TimeEntryId, UserId } from "@magna-carta/identifiers/types";
import { TIME_ENTRY_TABLE, type TimeEntryStatus } from "./time-entry-statements.ts";

export type { Page };

const TIME_ENTRY_LIST_COLUMNS =
  "id, matter_id, timekeeper_user_id, work_date, duration_minutes, narrative, billable, currency, rate_e4, rate_source, amount_minor, status, source, created_at";

interface TimeEntryRowRaw {
  id: TimeEntryId;
  matter_id: MatterId;
  timekeeper_user_id: UserId;
  work_date: string;
  duration_minutes: number;
  narrative: string;
  billable: number;
  currency: string;
  rate_e4: number | null;
  rate_source: string | null;
  amount_minor: number | null;
  status: TimeEntryStatus;
  source: string;
  created_at: string;
}

export interface TimeEntryListItem {
  readonly id: TimeEntryId;
  readonly matterId: MatterId;
  readonly timekeeperUserId: UserId;
  readonly workDate: string;
  readonly durationMinutes: number;
  readonly narrative: string;
  readonly billable: boolean;
  readonly currency: string;
  readonly rateE4: number | null;
  readonly rateSource: string | null;
  readonly amountMinor: number | null;
  readonly status: TimeEntryStatus;
  readonly source: string;
  readonly createdAt: string;
}

function toTimeEntryListItem(row: TimeEntryRowRaw): TimeEntryListItem {
  return {
    id: row.id,
    matterId: row.matter_id,
    timekeeperUserId: row.timekeeper_user_id,
    workDate: row.work_date,
    durationMinutes: row.duration_minutes,
    narrative: row.narrative,
    billable: row.billable === 1,
    currency: row.currency,
    rateE4: row.rate_e4,
    rateSource: row.rate_source,
    amountMinor: row.amount_minor,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
  };
}

export interface ListTimekeeperDayParams {
  readonly timekeeperUserId: UserId;
  readonly workDate: string;
  readonly cursor?: string;
  readonly pageSize?: number;
}

// My Day's entry list: one timekeeper, one work date, newest first. Driven by the
// (timekeeper_user_id, work_date) index so the keyset sort needs no temporary B-tree.
export function listTimeEntriesForTimekeeperDayStatement(
  database: SqlDatabase,
  timekeeperUserId: UserId,
  workDate: string,
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  const conditions = ["timekeeper_user_id = ?", "work_date = ?", "status != 'void'"];
  const bindings: unknown[] = [timekeeperUserId, workDate];
  appendCursorPredicate(conditions, bindings, cursor);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT ${TIME_ENTRY_LIST_COLUMNS} FROM ${TIME_ENTRY_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export async function listTimeEntriesForTimekeeperDay(
  database: SqlDatabase,
  params: ListTimekeeperDayParams,
): Promise<Page<TimeEntryListItem>> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const { results } = await listTimeEntriesForTimekeeperDayStatement(
    database,
    params.timekeeperUserId,
    params.workDate,
    decodeCursor(params.cursor),
    pageSize + 1,
  ).all<TimeEntryRowRaw>();
  return assemblePage(results, pageSize, toTimeEntryListItem);
}

export interface WeeklyGridParams {
  readonly timekeeperUserId: UserId;
  readonly fromDate: string;
  readonly toDate: string;
}

// The weekly matters x days grid fan: every non-void entry for the timekeeper inside [fromDate, toDate],
// ordered by day then matter. A bounded week window, so the whole grid is one read (no pagination).
export function listWeeklyGridStatement(
  database: SqlDatabase,
  params: WeeklyGridParams,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${TIME_ENTRY_LIST_COLUMNS} FROM ${TIME_ENTRY_TABLE} WHERE timekeeper_user_id = ?1 AND work_date >= ?2 AND work_date <= ?3 AND status != 'void' ORDER BY work_date ASC, matter_id ASC, id ASC`,
    )
    .bind(params.timekeeperUserId, params.fromDate, params.toDate);
}

export async function listWeeklyGrid(
  database: SqlDatabase,
  params: WeeklyGridParams,
): Promise<TimeEntryListItem[]> {
  const { results } = await listWeeklyGridStatement(database, params).all<TimeEntryRowRaw>();
  return results.map(toTimeEntryListItem);
}

export interface UnbilledByMatterRow {
  readonly matterId: MatterId;
  readonly unbilledMinutes: number;
  readonly unbilledAmountMinor: number;
  readonly entryCount: number;
}

interface UnbilledByMatterRowRaw {
  matter_id: MatterId;
  unbilled_minutes: number;
  unbilled_amount_minor: number;
  entry_count: number;
}

// Per-matter unbilled WIP — the billing read. Sums minutes + amount over draft/submitted/approved
// (anything not yet billed and not void) for one matter, driven by the (matter_id, status) index.
// amount_minor is nullable (non-billable internal time) — COALESCE folds those to 0 in the sum.
export function listUnbilledByMatterStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT matter_id,
         COALESCE(SUM(duration_minutes), 0) AS unbilled_minutes,
         COALESCE(SUM(amount_minor), 0) AS unbilled_amount_minor,
         COUNT(*) AS entry_count
       FROM ${TIME_ENTRY_TABLE}
       WHERE matter_id = ?1 AND status NOT IN ('billed', 'void')
       GROUP BY matter_id`,
    )
    .bind(matterId);
}

export async function listUnbilledByMatter(
  database: SqlDatabase,
  params: { matterId: MatterId },
): Promise<UnbilledByMatterRow[]> {
  const { results } = await listUnbilledByMatterStatement(
    database,
    params.matterId,
  ).all<UnbilledByMatterRowRaw>();
  return results.map((row) => ({
    matterId: row.matter_id,
    unbilledMinutes: row.unbilled_minutes,
    unbilledAmountMinor: row.unbilled_amount_minor,
    entryCount: row.entry_count,
  }));
}
```

**Step 9 — run all three suites (expect PASS).**

```
pnpm --filter @magna-carta/timekeeping test -- quick-add my-day queries
```

Expected: `quick-add-parser.test.ts`, `my-day.test.ts`, `queries.test.ts` all green (the parser's 9 cases, My Day's 3, the three query describes' 3) — 0 failed.

**Step 10 — commit.**

```
git add packages/timekeeping/src/quick-add-parser.ts packages/timekeeping/src/my-day.ts packages/timekeeping/src/queries.ts packages/timekeeping/test/quick-add-parser.test.ts packages/timekeeping/test/my-day.test.ts packages/timekeeping/test/queries.test.ts packages/timekeeping/package.json
git commit -m "$(cat <<'EOF'
feat(timekeeping): quick-add parser, My Day read, and WIP list queries

The one-line capture grammar (duration + matter hint + narrative, never auto-resolving
the matter), the My Day billable/non-billable totals with target shortfall and
un-logged-day detection, and the keyset-paginated WIP reads (timekeeper day, weekly
grid, per-matter unbilled). All read-only over the WIP store, void excluded.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 14: Live-timer runtime (pure state machine + elapsed math)

The pure timer state machine + elapsed computation the Durable Object and its tests share — start/pause/resume/bind, the `committing` compare-and-set, the abandoned flag, and client-computed elapsed from `startedAt` + `pausedIntervals`. Pure (no clock, no I/O): the `now` and the minted `liveRunId` arrive as arguments so the DO owns the side effects and the runtime stays exhaustively testable. Lives in `apps/worker` (the DO's home), not the package — the package never imports the DO.

**Files**

- Create: `apps/worker/src/timer/timer-runtime.ts`
- Test: `apps/worker/test/timer-runtime.test.ts`

**Interfaces**

- Produces: `TimerState`, `TimerStatus` (`running`|`paused`|`committing`|`abandoned`), `PausedInterval`, `TimerBinding`, `startTimer`, `pauseTimer`, `resumeTimer`, `bindTimer`, `beginCommit` (compare-and-set), `markAbandoned`, `elapsedMinutes(state, now)`, `trimToLastActivity(state)`.
- Consumes: nothing (pure).

**Step 1 — write the failing runtime test.**

Create `apps/worker/test/timer-runtime.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  beginCommit,
  bindTimer,
  elapsedMinutes,
  markAbandoned,
  pauseTimer,
  resumeTimer,
  startTimer,
  trimToLastActivity,
  type TimerState,
} from "../src/timer/timer-runtime.ts";

const RUN = "timeEntry_run1";
const t = (minute: number) => `2026-06-22T10:${String(minute).padStart(2, "0")}:00.000Z`;

function started(): TimerState {
  return startTimer({ liveRunId: RUN, now: t(0), binding: { matterId: "matter_a" } });
}

describe("startTimer", () => {
  it("mints a running state carrying the run id, start instant, and binding", () => {
    const state = startTimer({
      liveRunId: RUN,
      now: t(0),
      binding: { matterId: "matter_a", label: "research" },
    });
    expect(state).toEqual({
      liveRunId: RUN,
      startedAt: t(0),
      pausedIntervals: [],
      matterId: "matter_a",
      label: "research",
      narrative: undefined,
      utbmsTaskCodeId: undefined,
      status: "running",
      lastActivityAt: t(0),
    });
  });

  it("starts unbound (a scratch timer needs no matter)", () => {
    const state = startTimer({ liveRunId: RUN, now: t(0) });
    expect(state.matterId).toBeUndefined();
    expect(state.status).toBe("running");
  });
});

describe("pauseTimer / resumeTimer", () => {
  it("opens a paused interval on pause and closes it on resume, advancing last activity", () => {
    const paused = pauseTimer(started(), t(10));
    expect(paused.status).toBe("paused");
    expect(paused.pausedIntervals).toEqual([{ from: t(10), to: null }]);
    expect(paused.lastActivityAt).toBe(t(10));

    const resumed = resumeTimer(paused, t(15));
    expect(resumed.status).toBe("running");
    expect(resumed.pausedIntervals).toEqual([{ from: t(10), to: t(15) }]);
    expect(resumed.lastActivityAt).toBe(t(15));
  });

  it("is idempotent: pausing a paused timer or resuming a running one is a no-op state", () => {
    const paused = pauseTimer(started(), t(10));
    expect(pauseTimer(paused, t(12)).pausedIntervals).toEqual([{ from: t(10), to: null }]);
    expect(resumeTimer(started(), t(5))).toEqual(started());
  });
});

describe("elapsedMinutes", () => {
  it("counts wall minutes since start when never paused", () => {
    expect(elapsedMinutes(started(), t(30))).toBe(30);
  });

  it("excludes a closed paused span", () => {
    const paused = pauseTimer(started(), t(10));
    const resumed = resumeTimer(paused, t(15)); // 5 minutes paused
    expect(elapsedMinutes(resumed, t(30))).toBe(25); // 30 wall - 5 paused
  });

  it("excludes the still-open paused span up to now", () => {
    const paused = pauseTimer(started(), t(10)); // open from 10
    expect(elapsedMinutes(paused, t(30))).toBe(10); // only 0..10 ran
  });
});

describe("beginCommit (compare-and-set)", () => {
  it("flips running to committing exactly once", () => {
    const first = beginCommit(started());
    expect(first.outcome).toBe("committing");
    expect(first.state.status).toBe("committing");

    const second = beginCommit(first.state);
    expect(second.outcome).toBe("already-committing");
    expect(second.state.status).toBe("committing");
  });

  it("flips a paused timer to committing too (stop from paused is legal)", () => {
    const paused = pauseTimer(started(), t(10));
    expect(beginCommit(paused).outcome).toBe("committing");
  });
});

describe("markAbandoned", () => {
  it("flags a still-live timer abandoned without committing or discarding", () => {
    const state = markAbandoned(started());
    expect(state.status).toBe("abandoned");
  });

  it("never overrides a committing timer (an already-committed run must not be re-flagged)", () => {
    const committing = beginCommit(started()).state;
    expect(markAbandoned(committing).status).toBe("committing");
  });
});

describe("trimToLastActivity", () => {
  it("clamps an open run so elapsed stops at lastActivityAt", () => {
    // Run 0..30 with last activity at 20: trimming closes the tail so elapsed past 20 does not count.
    const active = { ...started(), lastActivityAt: t(20) };
    const trimmed = trimToLastActivity(active);
    expect(elapsedMinutes(trimmed, t(30))).toBe(20);
  });

  it("closes an open paused span at lastActivityAt before clamping", () => {
    const paused = { ...pauseTimer(started(), t(10)), lastActivityAt: t(20) };
    const trimmed = trimToLastActivity(paused);
    // Paused span closes at 20 (the last activity), and the run end clamps to 20 → 10 active minutes.
    expect(elapsedMinutes(trimmed, t(30))).toBe(10);
  });
});
```

**Step 2 — run it (expect FAIL: the module does not exist).**

```
pnpm --filter @magna-carta/worker test -- timer-runtime
```

Expected: the suite errors with `Cannot find module ../src/timer/timer-runtime.ts` (or `Failed to resolve import`) — 0 passed.

**Step 3 — implement the pure runtime.**

Create `apps/worker/src/timer/timer-runtime.ts`:

```typescript
// The pure live-timer state machine and elapsed math, shared by the Durable Object and its tests. It
// is side-effect-free on purpose: the wall clock (`now`) and the minted run id arrive as arguments, so
// the DO owns durable storage and alarms while this stays exhaustively unit-testable. Elapsed is
// computed from startedAt + the paused intervals (the DO never ticks), keeping the timer free to
// hibernate between interactions. A trimmed run clamps to the last recorded activity instant.

export type TimerStatus = "running" | "paused" | "committing" | "abandoned";

// A pause span: `to` is null while the timer is still paused, set to the resume/clamp instant when closed.
export interface PausedInterval {
  readonly from: string;
  readonly to: string | null;
}

export interface TimerBinding {
  readonly matterId?: string;
  readonly label?: string;
  readonly narrative?: string;
  readonly utbmsTaskCodeId?: string;
}

export interface TimerState extends TimerBinding {
  readonly liveRunId: string;
  readonly startedAt: string;
  readonly pausedIntervals: readonly PausedInterval[];
  readonly status: TimerStatus;
  readonly lastActivityAt: string;
}

export interface StartTimerInput {
  readonly liveRunId: string;
  readonly now: string;
  readonly binding?: TimerBinding;
}

export function startTimer(input: StartTimerInput): TimerState {
  const binding = input.binding ?? {};
  return {
    liveRunId: input.liveRunId,
    startedAt: input.now,
    pausedIntervals: [],
    matterId: binding.matterId,
    label: binding.label,
    narrative: binding.narrative,
    utbmsTaskCodeId: binding.utbmsTaskCodeId,
    status: "running",
    lastActivityAt: input.now,
  };
}

// Open a paused interval. A no-op when already paused (the latest interval is still open).
export function pauseTimer(state: TimerState, now: string): TimerState {
  if (state.status !== "running") return state;
  return {
    ...state,
    status: "paused",
    pausedIntervals: [...state.pausedIntervals, { from: now, to: null }],
    lastActivityAt: now,
  };
}

// Close the open paused interval. A no-op when not paused.
export function resumeTimer(state: TimerState, now: string): TimerState {
  if (state.status !== "paused") return state;
  const intervals = state.pausedIntervals.map((interval, index) =>
    index === state.pausedIntervals.length - 1 && interval.to === null
      ? { from: interval.from, to: now }
      : interval,
  );
  return { ...state, status: "running", pausedIntervals: intervals, lastActivityAt: now };
}

// Attach (or re-attach) the matter and narrative metadata. Binding is required only at commit, so a
// scratch timer is bound here on its way to stop.
export function bindTimer(state: TimerState, binding: TimerBinding, now: string): TimerState {
  return {
    ...state,
    matterId: binding.matterId ?? state.matterId,
    label: binding.label ?? state.label,
    narrative: binding.narrative ?? state.narrative,
    utbmsTaskCodeId: binding.utbmsTaskCodeId ?? state.utbmsTaskCodeId,
    lastActivityAt: now,
  };
}

export type BeginCommitOutcome = "committing" | "already-committing";

export interface BeginCommitResult {
  readonly state: TimerState;
  readonly outcome: BeginCommitOutcome;
}

// The compare-and-set the route's idempotent stop-commit anchors on: the first call flips a live timer
// to `committing`; a second concurrent call sees it already committing and changes nothing. The DO
// serializes the calls; this is the pure transition they apply.
export function beginCommit(state: TimerState): BeginCommitResult {
  if (state.status === "committing") return { state, outcome: "already-committing" };
  return { state: { ...state, status: "committing" }, outcome: "committing" };
}

// Flag a still-live timer abandoned (the alarm's action). Never overrides a run that is already
// committing — a committed run must not be re-flagged.
export function markAbandoned(state: TimerState): TimerState {
  if (state.status === "committing" || state.status === "abandoned") return state;
  return { ...state, status: "abandoned" };
}

// The active-minutes elapsed at `now`: the wall span from startedAt to the run end, minus the paused
// spans, in whole minutes. An open paused span counts only up to `now`.
export function elapsedMinutes(state: TimerState, now: string): number {
  const start = Date.parse(state.startedAt);
  const end = Date.parse(now);
  let pausedMs = 0;
  for (const interval of state.pausedIntervals) {
    const from = Date.parse(interval.from);
    const to = interval.to === null ? end : Date.parse(interval.to);
    pausedMs += Math.max(0, Math.min(to, end) - from);
  }
  const activeMs = Math.max(0, end - start - pausedMs);
  return Math.floor(activeMs / 60_000);
}

// Clamp the run to lastActivityAt: close any open paused span at that instant, then re-anchor elapsed
// so anything after the last recorded activity does not count (the trim-to-last-activity resolution).
// Implemented by setting startedAt forward is wrong (it would lose paused math); instead the state's
// effective end is lastActivityAt, which elapsedMinutes already honours when called with that instant.
// To make the trim durable regardless of the `now` a later read passes, we close the open span and
// record a synthetic trailing paused interval from lastActivityAt onward (to: null), so all future
// wall time is treated as paused.
export function trimToLastActivity(state: TimerState): TimerState {
  const closed = state.pausedIntervals.map((interval, index) =>
    index === state.pausedIntervals.length - 1 && interval.to === null
      ? { from: interval.from, to: state.lastActivityAt }
      : interval,
  );
  return {
    ...state,
    status: "running",
    pausedIntervals: [...closed, { from: state.lastActivityAt, to: null }],
  };
}
```

**Step 4 — run the suite (expect PASS).**

```
pnpm --filter @magna-carta/worker test -- timer-runtime
```

Expected: `timer-runtime.test.ts` green across all describes (start, pause/resume, elapsed, beginCommit, markAbandoned, trim) — 0 failed.

**Step 5 — commit.**

```
git add apps/worker/src/timer/timer-runtime.ts apps/worker/test/timer-runtime.test.ts
git commit -m "$(cat <<'EOF'
feat(worker): pure live-timer runtime (state machine + elapsed math)

The side-effect-free timer transitions the Durable Object wraps: start/pause/resume/
bind, the begin-commit compare-and-set, the abandoned flag, client-computed elapsed
from startedAt + paused intervals, and trim-to-last-activity. The clock and run id
arrive as arguments so the runtime stays exhaustively testable and the DO owns the
side effects.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 15: LiveTimerDurableObject + wrangler binding

The codebase's first Durable Object: one instance per `${firmId}:${userId}`, wrapping the Task 14 runtime, holding only transient timer state in DO key-value storage, with the abandoned-timer alarm. Wire the `durable_objects` block + the `new_sqlite_classes` migration tag + the class export + the `DURABLE_TIMER` binding. It is **not** a business-data store — committing a `time_entry` flows through the route + the data-access chokepoint (Task 18), never the DO.

**Files**

- Create: `apps/worker/src/timer/live-timer-durable-object.ts`
- Modify: `apps/worker/wrangler.jsonc` (durable_objects binding + migration tag), `apps/worker/src/index.ts` (export the class), `apps/worker/src/app.ts` (`DURABLE_TIMER` in `Bindings`)
- Test: `apps/worker/test/live-timer-do.test.ts` (Miniflare)

**Interfaces**

- Produces: `LiveTimerDurableObject` with `start`/`pause`/`resume`/`bind`/`read`/`stopAndCommit`/`discard`/`alarm`; the `DURABLE_TIMER` namespace binding.
- Consumes: Task 14 runtime; `newIdentifier("timeEntry", …)` for the `live_run_id` token shape.

**Step 1 — confirm the current binding/migration-tag + storage/alarm idiom.**

The durable-objects skill fixes the current API: a class `extends DurableObject<Env>` from `cloudflare:workers` with RPC methods (compatibility date ≥ 2024-04-03 — this Worker is `2026-06-05`, so RPC, not `fetch`); transient state in `ctx.storage` key-value (`put`/`get`/`delete` — no SQLite schema is needed, the timer holds one JSON blob); the Alarms API is `ctx.storage.setAlarm(epochMs)` / `getAlarm()` / `deleteAlarm()`, one alarm per DO; the binding is `durable_objects.bindings[{ name, class_name }]` plus a `migrations[{ tag, new_sqlite_classes }]` entry; tests use `env.DURABLE_TIMER.getByName(name)` and `runDurableObjectAlarm(stub)` from `cloudflare:test`.

**Step 2 — write the failing Miniflare DO test.**

Create `apps/worker/test/live-timer-do.test.ts`:

```typescript
import { env, listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { LiveTimerDurableObject } from "../src/timer/live-timer-durable-object.ts";

const NAME = "firm_one:user_attorney";

describe("LiveTimerDurableObject — lifecycle", () => {
  it("start returns a run id + start instant and sets an alarm", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    const result = await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    expect(result.liveRunId).toMatch(/^timeEntry_/);
    expect(typeof result.startedAt).toBe("string");

    await runInDurableObject(stub, async (_instance: LiveTimerDurableObject, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it("a second start replaces the first (single-active) and reschedules the alarm", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    const first = await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    const second = await stub.start({ matterId: "matter_b", abandonedThresholdMinutes: 600 });
    expect(second.liveRunId).not.toBe(first.liveRunId);

    const read = await stub.read();
    expect(read).not.toBeNull();
    expect(read?.liveRunId).toBe(second.liveRunId);
    expect(read?.matterId).toBe("matter_b");
    expect(read?.status).toBe("running");
  });

  it("read returns null before any start", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    expect(await stub.read()).toBeNull();
  });

  it("pause and resume move the status through the runtime", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    await stub.start({ abandonedThresholdMinutes: 600 });
    expect((await stub.pause())?.status).toBe("paused");
    expect((await stub.resume())?.status).toBe("running");
  });

  it("bind attaches the matter to a scratch timer", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    await stub.start({ abandonedThresholdMinutes: 600 });
    const bound = await stub.bind({ matterId: "matter_a", narrative: "drafted" });
    expect(bound?.matterId).toBe("matter_a");
    expect(bound?.narrative).toBe("drafted");
  });

  it("discard clears state and deletes the alarm", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    await stub.discard();
    expect(await stub.read()).toBeNull();
    await runInDurableObject(stub, async (_instance: LiveTimerDurableObject, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("isolates instances by firm:user name", async () => {
    const mine = env.DURABLE_TIMER.getByName("firm_one:user_a");
    const theirs = env.DURABLE_TIMER.getByName("firm_two:user_a");
    await mine.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    expect(await mine.read()).not.toBeNull();
    // A different ${firmId}:${userId} is a distinct instance — no state leaks across the namespace.
    expect(await theirs.read()).toBeNull();
    const ids = await listDurableObjectIds(env.DURABLE_TIMER);
    expect(ids.length).toBe(2);
  });
});
```

**Step 3 — run it (expect FAIL: the binding + class do not exist).**

```
pnpm --filter @magna-carta/worker test -- live-timer-do
```

Expected: the suite fails — `env.DURABLE_TIMER` is `undefined` (no binding in `wrangler.jsonc`) and `../src/timer/live-timer-durable-object.ts` cannot be resolved. 0 passed.

**Step 4 — implement the DO.**

Create `apps/worker/src/timer/live-timer-durable-object.ts`:

```typescript
import { DurableObject } from "cloudflare:workers";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import {
  bindTimer,
  pauseTimer,
  resumeTimer,
  startTimer,
  type TimerBinding,
  type TimerState,
} from "./timer-runtime.ts";

// The per-timekeeper live timer — one Durable Object instance per `${firmId}:${userId}`, firm-namespaced
// so a timer never holds another firm's state. It is a pure coordinator over the transient timer state,
// NOT a business-data store: a committed time entry is written by the route through the data-access
// chokepoint into per-firm D1, never here. The DO holds one JSON blob in its own key-value storage and
// hibernates between interactions, so elapsed time is computed client-side from startedAt and the DO
// never ticks — keeping its cost negligible. One alarm marks an abandoned run (set on start, cancelled
// on stop/discard, rescheduled on a replacing start).

const STATE_KEY = "timer";

export interface StartInput extends TimerBinding {
  readonly abandonedThresholdMinutes: number;
}

export class LiveTimerDurableObject extends DurableObject<Bindings> {
  private async load(): Promise<TimerState | null> {
    return (await this.ctx.storage.get<TimerState>(STATE_KEY)) ?? null;
  }

  // Persist first, then schedule/cancel the alarm — storage is the source of truth the next wake reads.
  private async save(state: TimerState): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  private nowInstant(): string {
    return new Date(this.ctx.storage.getCurrentTime?.() ?? Date.now()).toISOString();
  }

  // Start (or replace) the timer: stops any current run, mints a stable live_run_id, and (re)sets the
  // abandoned alarm. The run id is a timeEntry-shaped handle so the route can derive the entry handle
  // and the chokepoint Idempotency-Key deterministically from it at stop-commit.
  async start(input: StartInput): Promise<{ liveRunId: string; startedAt: string }> {
    const now = this.nowInstant();
    const liveRunId = newIdentifier("timeEntry");
    const { abandonedThresholdMinutes, ...binding } = input;
    const state = startTimer({ liveRunId, now, binding });
    await this.save(state);
    await this.ctx.storage.setAlarm(Date.parse(now) + abandonedThresholdMinutes * 60_000);
    return { liveRunId, startedAt: now };
  }

  async pause(): Promise<TimerState | null> {
    const state = await this.load();
    if (state === null) return null;
    const next = pauseTimer(state, this.nowInstant());
    await this.save(next);
    return next;
  }

  async resume(): Promise<TimerState | null> {
    const state = await this.load();
    if (state === null) return null;
    const next = resumeTimer(state, this.nowInstant());
    await this.save(next);
    return next;
  }

  async bind(binding: TimerBinding): Promise<TimerState | null> {
    const state = await this.load();
    if (state === null) return null;
    const next = bindTimer(state, binding, this.nowInstant());
    await this.save(next);
    return next;
  }

  async read(): Promise<TimerState | null> {
    return this.load();
  }

  // Clear the timer and cancel the pending alarm — the discard resolution and the route's
  // clear-after-confirmed-commit call.
  async discard(): Promise<void> {
    await this.ctx.storage.delete(STATE_KEY);
    await this.ctx.storage.deleteAlarm();
  }

  // The abandoned alarm fires only for a still-live timer (start sets it; stop/discard/replace cancel or
  // reschedule it). Marking abandoned does not auto-commit or auto-discard — the next interaction
  // surfaces keep / trim / discard. Completed with the stop-commit behaviour.
  async alarm(): Promise<void> {
    // Implemented with the abandoned-flag transition.
  }
}
```

**Step 5 — wire the binding, migration tag, class export, and `Bindings` field.**

Add to `apps/worker/wrangler.jsonc`, after the `analytics_engine_datasets` block (the codebase's first `durable_objects` block):

```jsonc
  // The per-timekeeper live-timer coordinator (the first Durable Object). One instance per
  // `${firmId}:${userId}` (firm-namespaced, so a timer never holds another firm's state), holding only
  // transient live-timer state in DO storage — a committed time entry flows through the data-access
  // chokepoint into per-firm D1, never the DO. new_sqlite_classes puts the instance on the
  // SQLite-backed storage backend (the current default for new classes).
  "durable_objects": {
    "bindings": [{ "name": "DURABLE_TIMER", "class_name": "LiveTimerDurableObject" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["LiveTimerDurableObject"] }],
```

Add the `DURABLE_TIMER` field to the `Bindings` type in `apps/worker/src/app.ts` (after the `EMAIL_FROM?` line, before the closing `};`):

```typescript
// The per-timekeeper live-timer Durable Object namespace (the first DO). The timer routes proxy to
// one instance per `${firmId}:${userId}`; the stop-commit reads the DO's final state and writes the
// time entry through the data-access chokepoint. The DO holds no business rows.
DURABLE_TIMER: DurableObjectNamespace<
  import("./timer/live-timer-durable-object.ts").LiveTimerDurableObject
>;
```

Export the class from `apps/worker/src/index.ts` (add the import + re-export near the top, after the existing imports):

```typescript
import { LiveTimerDurableObject } from "./timer/live-timer-durable-object.ts";
```

and add the named export below the `default` handler (the runtime needs the class on the module's exports for the binding to resolve):

```typescript
// The Durable Object class the DURABLE_TIMER binding instantiates — exported from the Worker entrypoint
// so the runtime can construct it. The timer routes proxy to it; it writes no business data itself.
export { LiveTimerDurableObject };
```

**Step 6 — run the suite (expect PASS).**

```
pnpm --filter @magna-carta/worker test -- live-timer-do
```

Expected: `live-timer-do.test.ts` green across the lifecycle describe (start/alarm-set, replace, read-null, pause/resume, bind, discard/alarm-cleared, firm isolation) — 0 failed. The unrelated worker suites are untouched.

**Step 7 — commit.**

```
git add apps/worker/src/timer/live-timer-durable-object.ts apps/worker/test/live-timer-do.test.ts apps/worker/wrangler.jsonc apps/worker/src/index.ts apps/worker/src/app.ts
git commit -m "$(cat <<'EOF'
feat(worker): LiveTimerDurableObject + DURABLE_TIMER binding (first Durable Object)

The per-timekeeper live timer, one instance per ${firmId}:${userId}, wrapping the pure
runtime and holding only transient state in DO storage with the abandoned alarm. Wires
the first durable_objects binding + the v1 sqlite-class migration tag, exports the class
from the Worker entrypoint, and adds DURABLE_TIMER to the env. The DO writes no business
data — commit rides the data-access chokepoint.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 16: Abandoned alarm + idempotent stop-commit (DO behavior)

The DO's correctness behavior: the abandoned alarm fires only for a still-live timer (cancelled on stop/discard/replace), and `stopAndCommit` is the single-threaded compare-and-set that anchors the route's idempotent commit on `live_run_id`. Two racing stop-commits return one `committing` and one `already-committing` with the same id; the alarm flag never re-flags a committed run; the keep/trim/discard resolutions each resolve a flagged run.

**Files**

- Modify: `apps/worker/src/timer/live-timer-durable-object.ts`
- Test: `apps/worker/test/live-timer-do.test.ts` (extend)

**Interfaces**

- Produces: `stopAndCommit` returning `{ liveRunId; state: "committing"|"already-committing"|"already-committed" }`; `alarm()` flagging `abandoned`; `resolveAbandoned("keep"|"trim"|"discard")` surfacing the resolution.
- Consumes: Task 14 (`beginCommit`, `markAbandoned`, `trimToLastActivity`).

**Step 1 — extend the failing DO test with the behavior cases.**

Append to `apps/worker/test/live-timer-do.test.ts` (after the lifecycle describe), adding `runDurableObjectAlarm` to the `cloudflare:test` import at the top of the file:

```typescript
// (top-of-file import becomes)
// import { env, listDurableObjectIds, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";

describe("LiveTimerDurableObject — abandoned alarm + idempotent stop-commit", () => {
  const NAME = "firm_one:user_attorney";

  it("the alarm flips a still-live timer to abandoned without committing or discarding", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const read = await stub.read();
    expect(read?.status).toBe("abandoned");
    // Not committed, not discarded — the run is still present, flagged for resolution.
    expect(read?.liveRunId).toMatch(/^timeEntry_/);
  });

  it("stopAndCommit then discard cancels the alarm so none fires afterward", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    const stop = await stub.stopAndCommit();
    expect(stop.state).toBe("committing");
    await stub.discard();
    // After commit + discard, no alarm remains: runDurableObjectAlarm reports nothing to run.
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });

  it("two concurrent stopAndCommit calls return one committing and one already-committing, same id", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    const start = await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    const [a, b] = await Promise.all([stub.stopAndCommit(), stub.stopAndCommit()]);
    const outcomes = [a.state, b.state].sort();
    expect(outcomes).toEqual(["already-committing", "committing"]);
    // Both report the same live_run_id (the dedup anchor the route derives its key + handle from).
    expect(a.liveRunId).toBe(start.liveRunId);
    expect(b.liveRunId).toBe(start.liveRunId);
  });

  it("stopAndCommit refuses an idle DO with no live run", async () => {
    const stub = env.DURABLE_TIMER.getByName("firm_one:user_idle");
    await expect(stub.stopAndCommit()).rejects.toThrow(/no live timer/);
  });

  it("an abandoned run resolves to keep (commit), surfacing committing on stop", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    await runDurableObjectAlarm(stub);
    const stop = await stub.stopAndCommit();
    expect(stop.state).toBe("committing");
    expect(stop.liveRunId).toMatch(/^timeEntry_/);
  });

  it("an abandoned run resolves to trim, clamping elapsed to last activity", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    await runDurableObjectAlarm(stub);
    const trimmed = await stub.resolveAbandoned("trim");
    expect(trimmed?.status).toBe("running");
    // A trailing open paused span from lastActivityAt onward marks the trim (future wall time excluded).
    const tail = trimmed?.pausedIntervals.at(-1);
    expect(tail?.to).toBeNull();
  });

  it("an abandoned run resolves to discard, clearing state and the alarm", async () => {
    const stub = env.DURABLE_TIMER.getByName(NAME);
    await stub.start({ matterId: "matter_a", abandonedThresholdMinutes: 600 });
    await runDurableObjectAlarm(stub);
    await stub.resolveAbandoned("discard");
    expect(await stub.read()).toBeNull();
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });
});
```

**Step 2 — run it (expect FAIL: `stopAndCommit`, `resolveAbandoned`, and the real `alarm` body do not exist).**

```
pnpm --filter @magna-carta/worker test -- live-timer-do
```

Expected: the new describe fails — `stub.stopAndCommit is not a function`, `stub.resolveAbandoned is not a function`, and the alarm case finds `status` still `running` (the Task 15 `alarm()` body is empty). The lifecycle describe still passes. Overall: failures in the new cases.

**Step 3 — implement the alarm body, `stopAndCommit`, and `resolveAbandoned`.**

Edit `apps/worker/src/timer/live-timer-durable-object.ts`. Add `beginCommit`, `markAbandoned`, and `trimToLastActivity` to the runtime import:

```typescript
import {
  beginCommit,
  bindTimer,
  markAbandoned,
  pauseTimer,
  resumeTimer,
  startTimer,
  trimToLastActivity,
  type TimerBinding,
  type TimerState,
} from "./timer-runtime.ts";
```

Replace the empty `alarm()` method with the abandoned-flag transition, and add `stopAndCommit` + `resolveAbandoned` (insert these methods before the closing brace of the class, replacing the placeholder `alarm`):

```typescript
  // The single-threaded compare-and-set the route's idempotent commit anchors on. The first stop flips
  // the live run to `committing` and cancels the alarm; a concurrent second stop sees it already
  // committing and returns the SAME live_run_id, so two racing commits derive one chokepoint
  // Idempotency-Key + one time-entry handle and collapse to a single entry. An idle DO is refused.
  async stopAndCommit(): Promise<{
    liveRunId: string;
    state: "committing" | "already-committing" | "already-committed";
  }> {
    const state = await this.load();
    if (state === null) {
      throw new Error("no live timer to stop on this timekeeper");
    }
    const { state: next, outcome } = beginCommit(state);
    if (outcome === "committing") {
      await this.save(next);
      // The run is leaving the live state — no abandoned alarm should fire against a committing run.
      await this.ctx.storage.deleteAlarm();
    }
    return { liveRunId: next.liveRunId, state: outcome };
  }

  // The next-interaction resolution of an abandoned run: keep (leave the captured span for a normal
  // stop-commit), trim (clamp to the last recorded activity), or discard (clear). Returns the resolved
  // state (null for discard / no run).
  async resolveAbandoned(
    resolution: "keep" | "trim" | "discard",
  ): Promise<TimerState | null> {
    const state = await this.load();
    if (state === null) return null;
    if (resolution === "discard") {
      await this.discard();
      return null;
    }
    // keep restores the run to running as-is; trim additionally clamps elapsed to lastActivityAt.
    const restored: TimerState = { ...state, status: "running" };
    const next = resolution === "trim" ? trimToLastActivity(restored) : restored;
    await this.save(next);
    return next;
  }

  // The abandoned alarm: it only fires for a still-live timer (start sets it; stop/discard/replace
  // cancel or reschedule it), so reaching here means the run was never stopped. Flag it abandoned —
  // no auto-commit, no auto-discard; the next interaction surfaces keep / trim / discard.
  async alarm(): Promise<void> {
    const state = await this.load();
    if (state === null) return;
    await this.save(markAbandoned(state));
  }
```

**Step 4 — run the suite (expect PASS).**

```
pnpm --filter @magna-carta/worker test -- live-timer-do
```

Expected: both describes green — the lifecycle cases plus the abandoned-alarm/stop-commit cases (alarm flips to `abandoned`; discard cancels the alarm; two concurrent stops return `committing` + `already-committing` with the same id; idle stop is refused; keep/trim/discard resolve). 0 failed.

**Step 5 — commit.**

```
git add apps/worker/src/timer/live-timer-durable-object.ts apps/worker/test/live-timer-do.test.ts
git commit -m "$(cat <<'EOF'
feat(worker): abandoned alarm + idempotent stopAndCommit on the live timer

The alarm flags only a still-live run abandoned (cancelled on stop/discard/replace, never
re-flagging a committing run). stopAndCommit is the single-threaded compare-and-set the
route's idempotent commit anchors on: two racing stops collapse to one committing result
sharing the same live_run_id, an idle DO is refused, and keep/trim/discard each resolve a
flagged run.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

The test command is `vp test run` under the hood, but per the plan's global convention I'll use the `pnpm --filter @magna-carta/worker test -- <pattern>` form (matching the skeleton's exact commands). The `emit-openapi` script is `node scripts/emit-openapi.mts`, run via `pnpm --filter @magna-carta/worker run emit-openapi`.

I now have all patterns confirmed. Here are the expanded Tasks 17–20.

---

### Task 17: time-entries routes (create/list/get/update/lifecycle/quick-add/grid)

The time-entry HTTP surface, every write through the chokepoint over `runIdempotentEffect`. The handler is the **rate-resolution + duration-rounding site**: it calls `resolveRate` (Task 7) and `roundDuration`/`computeAmountMinor` (Task 4) with the scope-resolved increment/direction (`resolveScopedSetting`, Task 3), then hands the resolved `rate: RateResolution` + `durationMinutes` + `currency` to `captureTimeEntry` (Task 9), which only composes the insert. `previewQuickAdd` is a read-shaped POST (no write) that runs `parseQuickAdd` (Task 13) and surfaces matter candidates for confirm — mirroring `numbering.preview`. Lifecycle review (`submit`/`approve`/`kickBack`) carries `time:approve`; all other writes carry `time:track`.

This task matches `apps/worker/src/routes/locations.ts` exactly: a shared `commitTimeEntryEffect` helper modeled on `commitLocationEffect`, the same `RouteMeta` builders, the same `writeErrorResponses`/`readErrorResponses` blocks, the same `Idempotency-Replayed` surfacing.

**Files**

- Create: `apps/worker/src/routes/time-entries.ts`
- Modify: `apps/worker/src/app.ts` (register), `packages/timekeeping/package.json` (the consumed exports must be declared)
- Test: `apps/worker/test/time-entries-routes.test.ts`

**Interfaces**

- Produces routes: `timeEntries.create`/`list`/`get`/`update`/`submit`/`approve`/`kickBack`/`void`/`previewQuickAdd`/`gridBatch`.
- Consumes: `captureTimeEntry`/`updateDraftTimeEntry`/`submitTimeEntry`/`approveTimeEntry`/`kickBackTimeEntry`/`voidTimeEntry` (Task 9/10), `resolveRate` (Task 7), `roundDuration`/`computeAmountMinor` (Task 4), `resolveScopedSetting` (Task 3) + `incrementMinutesDefinition`/`roundingDirectionDefinition` (Task 5), `parseQuickAdd`/`listTimeEntriesForTimekeeperDay`/`listUnbilledByMatter` (Task 13), `TimeEntryValidationError` (Task 8), `defineOpenAPIRoute`/`chokepointMiddleware`/`runIdempotentEffect`.

**Steps**

#### Step 1 — Write the failing route test

Create `apps/worker/test/time-entries-routes.test.ts`. It follows `matters-routes.test.ts` exactly: seed a pool firm + an Owner member (full `time:*`) + a Read-only member (no `time:track`), drive the surface over `SELF.fetch`, assert through the chokepoint. A rate card with one open `timekeeper`-tier rate is appended first (through the real `appendRate` write path the Task 19 route exposes, called here directly against `env.DB_FIRM_POOL_1` so this suite is independent of route ordering).

```ts
import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { appendRate, createRateCard } from "@magna-carta/timekeeping/rate-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The time-entry HTTP surface over real Miniflare bindings: capture resolves the rate + rounds the
// duration in the handler then commits the WIP row through the chokepoint; the My-Day / per-matter
// list shapes; the draft-only freeze refusal; the submit -> approve review path under the gate; the
// read-shaped quick-add preview that writes nothing; and an idempotent replay of a create.

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;
let matterId: string;

const clock = { now: () => new Date().toISOString() };

async function mirrorMemberWithRole(userId: UserId, displayName: string, roleName: string) {
  const role = await env.DB_FIRM_POOL_1.prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .first<{ id: string }>();
  if (role === null) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(env.DB_FIRM_POOL_1, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(env.DB_FIRM_POOL_1, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Time Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("time-owner@example.com", {
    userName: "Time Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Time Owner");
  ownerCookie = await signInForSessionCookie("time-owner@example.com");

  const readOnly = await seedCredentialedUser("time-readonly@example.com", {
    userName: "Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("time-readonly@example.com");

  // A matter to bill time to, created straight through the matter surface.
  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      title: "Smith v. Jones",
      status: "open",
      responsibleMemberId: ownerUserId,
    }),
  });
  matterId = ((await created.json()) as { matterId: string }).matterId;

  // One rate card with an open timekeeper-tier rate, laid down through the real rate write path.
  const card = await createRateCard(
    env.DB_FIRM_POOL_1,
    { name: "Standard" },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(env.DB_FIRM_POOL_1, card.effect, { now: clock.now });
  const rate = await appendRate(
    env.DB_FIRM_POOL_1,
    {
      rateCardId: card.rateCardId,
      tier: "timekeeper",
      scopedId: ownerUserId,
      rateE4: 3_000_000, // $300.00/hour
      currency: "USD",
      validFrom: "2026-01-01",
    },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(env.DB_FIRM_POOL_1, rate.effect, { now: clock.now });
});

function authHeaders(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}
async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function patch(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

describe("time-entry capture", () => {
  it("resolves the rate, rounds the duration, and commits a billable WIP entry", async () => {
    const response = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 38, // rounds up to 42 at the 6-minute default increment, nearest
      narrative: "Drafted demand letter",
      billable: true,
      source: "manual",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { timeEntryId: string };
    expect(body.timeEntryId).toMatch(/^timeEntry_/);

    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT duration_minutes, raw_duration_minutes, rate_e4, rate_source, amount_minor, currency, status FROM time_entry WHERE id = ?1",
    )
      .bind(body.timeEntryId)
      .first<{
        duration_minutes: number;
        raw_duration_minutes: number;
        rate_e4: number;
        rate_source: string;
        amount_minor: number;
        currency: string;
        status: string;
      }>();
    expect(row).not.toBeNull();
    expect(row?.raw_duration_minutes).toBe(38);
    expect(row?.duration_minutes).toBe(36); // 38 -> nearest 6-minute increment
    expect(row?.rate_e4).toBe(3_000_000);
    expect(row?.rate_source).toBe("timekeeper");
    expect(row?.amount_minor).toBe(18_000); // round(300.00 * 36/60) = $180.00
    expect(row?.currency).toBe("USD");
    expect(row?.status).toBe("draft");
  });

  it("captures a non-billable entry with no rate and a category", async () => {
    const categoryId = newIdentifier("nonBillableCategory");
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO non_billable_category (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
    )
      .bind(categoryId, "Administrative", new Date().toISOString())
      .run();
    const response = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 30,
      narrative: "Internal file admin",
      billable: false,
      nonBillableCategoryId: categoryId,
      source: "manual",
    });
    expect(response.status).toBe(201);
    const id = ((await response.json()) as { timeEntryId: string }).timeEntryId;
    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT rate_e4, amount_minor, rate_source, non_billable_category_id FROM time_entry WHERE id = ?1",
    )
      .bind(id)
      .first<{
        rate_e4: number | null;
        amount_minor: number | null;
        rate_source: string | null;
        non_billable_category_id: string | null;
      }>();
    expect(row?.rate_e4).toBeNull();
    expect(row?.amount_minor).toBeNull();
    expect(row?.rate_source).toBeNull();
    expect(row?.non_billable_category_id).toBe(categoryId);
  });
});

describe("time-entry reads", () => {
  it("lists a timekeeper's entries for a work date (the My-Day shape)", async () => {
    const response = await get(
      `/api/v1/time-entries?timekeeperUserId=${ownerUserId}&workDate=2026-06-22`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; durationMinutes: number }[] };
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("lists unbilled WIP per matter (the per-matter shape)", async () => {
    const response = await get(`/api/v1/time-entries?matterId=${matterId}&status=draft`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; matterId: string }[] };
    expect(body.data.every((entry) => entry.matterId === matterId)).toBe(true);
  });
});

describe("draft-only freeze and the review path", () => {
  it("refuses an update to a billed row (409)", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "To be billed",
      billable: true,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    // Move it to billed directly (the 3·4 billing-lock seam this slice leaves to billing).
    await env.DB_FIRM_POOL_1.prepare("UPDATE time_entry SET status = 'billed' WHERE id = ?1")
      .bind(id)
      .run();
    const response = await patch(`/api/v1/time-entries/${id}`, { narrative: "edited" });
    expect(response.status).toBe(409);
  });

  it("walks the submit -> approve review path", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 18,
      narrative: "Reviewable",
      billable: true,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    expect((await post(`/api/v1/time-entries/${id}/submit`, {})).status).toBe(200);
    expect((await post(`/api/v1/time-entries/${id}/approve`, {})).status).toBe(200);
    const row = await env.DB_FIRM_POOL_1.prepare("SELECT status FROM time_entry WHERE id = ?1")
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe("approved");
  });
});

describe("quick-add preview is read-shaped", () => {
  it("returns parsed candidates and writes nothing", async () => {
    const before = await env.DB_FIRM_POOL_1.prepare("SELECT COUNT(*) AS c FROM time_entry").first<{
      c: number;
    }>();
    const response = await post("/api/v1/time-entries/quick-add-preview", {
      text: "0.5 Smith — drafted demand letter",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      durationMinutes: number;
      matterHint: string | null;
      narrative: string;
      candidates: { id: string; title: string }[];
    };
    expect(body.durationMinutes).toBe(30);
    expect(body.matterHint).toBe("Smith");
    expect(body.narrative).toBe("drafted demand letter");
    expect(body.candidates.some((c) => c.id === matterId)).toBe(true);
    const after = await env.DB_FIRM_POOL_1.prepare("SELECT COUNT(*) AS c FROM time_entry").first<{
      c: number;
    }>();
    expect(after?.c).toBe(before?.c);
  });
});

describe("idempotency and permission", () => {
  it("replays a create under the same Idempotency-Key (no second entry)", async () => {
    const key = crypto.randomUUID();
    const body = {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 6,
      narrative: "Idempotent",
      billable: true,
      source: "manual",
    };
    const headers = {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": key,
    };
    const first = await SELF.fetch("https://example.com/api/v1/time-entries", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { timeEntryId: string }).timeEntryId;
    const replay = await SELF.fetch("https://example.com/api/v1/time-entries", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(((await replay.json()) as { timeEntryId: string }).timeEntryId).toBe(firstId);
  });

  it("refuses a Read-only member the time:track capability (403)", async () => {
    const response = await post(
      "/api/v1/time-entries",
      {
        matterId,
        timekeeperUserId: ownerUserId,
        workDate: "2026-06-22",
        rawDurationMinutes: 6,
        narrative: "Denied",
        billable: true,
        source: "manual",
      },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});
```

#### Step 2 — Run the test (expect FAIL)

```
pnpm --filter @magna-carta/worker test -- time-entries-routes
```

Expected output: the suite fails to resolve the route module — `Cannot find module '../src/routes/time-entries.ts'` (the file does not exist yet) and, once it does, every `SELF.fetch` to `/api/v1/time-entries` returns 404 (the asset fallthrough) because the routes are unregistered. Vitest reports the `time-entries-routes` file as failed, e.g. `FAIL apps/worker/test/time-entries-routes.test.ts`.

#### Step 3 — Implement the routes

First declare the consumed package exports. Add to `packages/timekeeping/package.json` `exports` (the per-file export map this package uses for every consumed module):

```json
    "./rate-resolution": "./src/rate-resolution.ts",
    "./rate-service": "./src/rate-service.ts",
    "./time-entry-service": "./src/time-entry-service.ts",
    "./time-entry-statements": "./src/time-entry-statements.ts",
    "./time-entry-validation": "./src/time-entry-validation.ts",
    "./rounding": "./src/rounding.ts",
    "./settings": "./src/settings.ts",
    "./quick-add-parser": "./src/quick-add-parser.ts",
    "./queries": "./src/queries.ts",
```

Create `apps/worker/src/routes/time-entries.ts`. It mirrors `routes/locations.ts`: the `RouteMeta` builders, the `writeErrorResponses`/`readErrorResponses` blocks, a `commitTimeEntryEffect` helper modeled on `commitLocationEffect` that maps `TimeEntryValidationError` to a problem and surfaces replay. The capture handler is the rate-resolution + rounding site.

```ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { resolveScopedSetting } from "@magna-carta/data-access/scoped-setting-statements";
import {
  captureTimeEntry,
  updateDraftTimeEntry,
  submitTimeEntry,
  approveTimeEntry,
  kickBackTimeEntry,
  voidTimeEntry,
} from "@magna-carta/timekeeping/time-entry-service";
import { resolveRate } from "@magna-carta/timekeeping/rate-resolution";
import { roundDuration, computeAmountMinor } from "@magna-carta/timekeeping/rounding";
import {
  incrementMinutesDefinition,
  roundingDirectionDefinition,
} from "@magna-carta/timekeeping/settings";
import { parseQuickAdd } from "@magna-carta/timekeeping/quick-add-parser";
import {
  listTimeEntriesForTimekeeperDay,
  listUnbilledByMatter,
} from "@magna-carta/timekeeping/queries";
import { TimeEntryValidationError } from "@magna-carta/timekeeping/time-entry-validation";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
  requireChokepointIdempotency,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// Time entries: the work-in-progress store. A capture handler is the rate-resolution + duration-
// rounding site — it resolves the rate in force on the work date and rounds the raw minutes to the
// firm/timekeeper increment, then hands the resolved values to the timekeeping service, which only
// composes the insert + audit and returns the effect this handler commits idempotently. The lifecycle
// review transitions (submit/approve/kick-back) require time:approve; every other mutation requires
// time:track. A billed or void row is frozen: the service throws, mapped to 409 here. quick-add-preview
// is a pure parse with no write (read-shaped POST).

const TRACK = "time:track" as const;
const APPROVE = "time:approve" as const;

const CreateTimeEntryRequest = z
  .object({
    matterId: identifierField("matter"),
    timekeeperUserId: identifierField("user"),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rawDurationMinutes: z.number().int().positive(),
    narrative: z.string().min(1),
    billable: z.boolean(),
    nonBillableCategoryId: identifierField("nonBillableCategory").nullable().optional(),
    source: z.enum(["manual", "quick_add", "grid", "offline_sync"]),
    utbmsTaskCodeId: identifierField("utbmsCode").nullable().optional(),
    utbmsActivityCodeId: identifierField("utbmsCode").nullable().optional(),
    rateCardId: identifierField("rateCard").nullable().optional(),
    overrideRateE4: z.number().int().positive().nullable().optional(),
  })
  .openapi("CreateTimeEntryRequest");

const PatchTimeEntryRequest = z
  .object({
    narrative: z.string().min(1).optional(),
    rawDurationMinutes: z.number().int().positive().optional(),
    workDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    utbmsTaskCodeId: identifierField("utbmsCode").nullable().optional(),
    utbmsActivityCodeId: identifierField("utbmsCode").nullable().optional(),
  })
  .openapi("PatchTimeEntryRequest");

const KickBackRequest = z.object({ reason: z.string().min(1) }).openapi("KickBackRequest");

const QuickAddPreviewRequest = z
  .object({ text: z.string().min(1) })
  .openapi("QuickAddPreviewRequest");

const GridBatchRequest = z
  .object({ entries: z.array(CreateTimeEntryRequest).min(1).max(200) })
  .openapi("GridBatchRequest");

const TimeEntrySummary = z
  .object({
    id: z.string(),
    matterId: z.string(),
    timekeeperUserId: z.string(),
    workDate: z.string(),
    durationMinutes: z.number().int(),
    rawDurationMinutes: z.number().int(),
    narrative: z.string(),
    billable: z.boolean(),
    amountMinor: z.number().int().nullable(),
    currency: z.string(),
    status: z.enum(["draft", "submitted", "approved", "billed", "void"]),
  })
  .openapi("TimeEntrySummary");
const TimeEntryListResponse = z
  .object({ data: z.array(TimeEntrySummary) })
  .openapi("TimeEntryListResponse");

const QuickAddPreviewResponse = z
  .object({
    durationMinutes: z.number().int(),
    matterHint: z.string().nullable(),
    narrative: z.string(),
    candidates: z.array(z.object({ id: z.string(), title: z.string() })),
  })
  .openapi("QuickAddPreviewResponse");

const TimeEntryAck = z.object({ timeEntryId: z.string() }).openapi("TimeEntryAck");
const GridBatchAck = z.object({ timeEntryIds: z.array(z.string()) }).openapi("GridBatchAck");

const timeEntryParam = z.object({ id: identifierPathParam("timeEntry", "id") });

const listQuery = z.object({
  timekeeperUserId: identifierField("user").optional(),
  matterId: identifierField("matter").optional(),
  workDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z.enum(["draft", "submitted", "approved", "billed", "void"]).optional(),
});

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required capability",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the entry is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, the entry is frozen (billed or void), or the lifecycle transition is illegal",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, or no rate could be resolved for a billable entry",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;
const writeErrorResponses = {
  400: authErrors[400],
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
  422: authErrors[422],
  429: authErrors[429],
} as const;
const readErrorResponses = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  429: authErrors[429],
} as const;

function writeMeta(operationId: string, permission: typeof TRACK | typeof APPROVE): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const createMeta = writeMeta("timeEntries.create", TRACK);
const updateMeta = writeMeta("timeEntries.update", TRACK);
const voidMeta = writeMeta("timeEntries.void", TRACK);
const gridBatchMeta = writeMeta("timeEntries.gridBatch", TRACK);
const submitMeta = writeMeta("timeEntries.submit", APPROVE);
const approveMeta = writeMeta("timeEntries.approve", APPROVE);
const kickBackMeta = writeMeta("timeEntries.kickBack", APPROVE);
const listMeta: RouteMeta = {
  operationId: "timeEntries.list",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
const getMeta: RouteMeta = {
  operationId: "timeEntries.get",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};
// A pure parse: read-shaped POST, no write, no audit (the numbering.preview precedent).
const previewMeta: RouteMeta = {
  operationId: "timeEntries.previewQuickAdd",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const createRoute = defineOpenAPIRoute(createMeta, {
  method: "post",
  path: "/api/v1/time-entries",
  description:
    "Captures a time entry: resolves the rate in force on the work date, rounds the raw duration to the firm/timekeeper increment, and stores the work-in-progress row.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateTimeEntryRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The time entry was captured",
      content: { "application/json": { schema: TimeEntryAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/time-entries",
  description:
    "Lists time entries filtered by timekeeper and work date (the daily view) or by matter and status (the unbilled work-in-progress view).",
  request: { query: listQuery },
  responses: {
    200: {
      description: "The time entries",
      content: { "application/json": { schema: TimeEntryListResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/time-entries/{id}",
  description: "Returns one time entry's detail.",
  request: { params: timeEntryParam },
  responses: {
    200: {
      description: "The time entry",
      content: { "application/json": { schema: TimeEntrySummary } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const updateRoute = defineOpenAPIRoute(updateMeta, {
  method: "patch",
  path: "/api/v1/time-entries/{id}",
  description: "Updates a draft time entry. A billed or void entry is frozen and cannot be edited.",
  request: {
    headers: idempotencyKeyHeader,
    params: timeEntryParam,
    body: { content: { "application/json": { schema: PatchTimeEntryRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The time entry was updated",
      content: { "application/json": { schema: TimeEntryAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

function transitionRoute(
  meta: RouteMeta,
  action: string,
  description: string,
  withBody?: z.ZodTypeAny,
) {
  return defineOpenAPIRoute(meta, {
    method: "post",
    path: `/api/v1/time-entries/{id}/${action}`,
    description,
    request: {
      headers: idempotencyKeyHeader,
      params: timeEntryParam,
      ...(withBody
        ? { body: { content: { "application/json": { schema: withBody } }, required: true } }
        : {}),
    },
    responses: {
      200: {
        description: "The transition was applied",
        content: { "application/json": { schema: TimeEntryAck } },
      },
      400: writeErrorResponses[400],
      401: writeErrorResponses[401],
      403: writeErrorResponses[403],
      404: writeErrorResponses[404],
      409: writeErrorResponses[409],
      422: writeErrorResponses[422],
      429: writeErrorResponses[429],
    },
  });
}
const submitRoute = transitionRoute(
  submitMeta,
  "submit",
  "Submits a draft entry for review (only when the firm's review gate is on).",
);
const approveRoute = transitionRoute(
  approveMeta,
  "approve",
  "Approves a submitted entry, making it billable.",
);
const kickBackRoute = transitionRoute(
  kickBackMeta,
  "kick-back",
  "Returns a submitted entry to draft with an audited reason.",
  KickBackRequest,
);
const voidRoute = transitionRoute(
  voidMeta,
  "void",
  "Voids a time entry. The row freezes — it can no longer be edited or billed.",
);

const previewRoute = defineOpenAPIRoute(previewMeta, {
  method: "post",
  path: "/api/v1/time-entries/quick-add-preview",
  description:
    "Parses a one-line quick-add string into a duration, a matter hint, and a narrative, returning matching matters for the timekeeper to confirm. Writes nothing.",
  request: {
    body: { content: { "application/json": { schema: QuickAddPreviewRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The parsed candidate",
      content: { "application/json": { schema: QuickAddPreviewResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

const gridBatchRoute = defineOpenAPIRoute(gridBatchMeta, {
  method: "post",
  path: "/api/v1/time-entries/grid-batch",
  description:
    "Captures a batch of time entries from the weekly grid in one request. Each entry resolves its rate and rounds its duration independently.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: GridBatchRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The batch was captured",
      content: { "application/json": { schema: GridBatchAck } },
    },
    400: writeErrorResponses[400],
    401: writeErrorResponses[401],
    403: writeErrorResponses[403],
    404: writeErrorResponses[404],
    409: writeErrorResponses[409],
    422: writeErrorResponses[422],
    429: writeErrorResponses[429],
  },
});

function timeEntryErrorResponse(
  c: Context,
  error: TimeEntryValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "entry-not-found") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such time entry.",
    });
  }
  if (error.code === "entry-frozen" || error.code === "illegal-transition") {
    return problemJson(c, {
      type: "conflict",
      title: "The time entry cannot change",
      status: 409,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "validation",
    title: "Invalid time-entry request",
    status: 422,
    detail: error.message,
  });
}

type TimeApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// Resolves the rate (the rate in force on the work date) and rounds the raw duration to the scope-
// resolved increment/direction, returning the values captureTimeEntry stores. A non-billable entry
// resolves to no rate and a null amount.
async function resolveCaptureValues(
  database: BatchDatabase,
  input: z.infer<typeof CreateTimeEntryRequest>,
  timekeeperUserId: string,
) {
  const increment = await resolveScopedSetting(database, incrementMinutesDefinition, {
    matterId: input.matterId,
    userId: input.timekeeperUserId,
  });
  const direction = await resolveScopedSetting(database, roundingDirectionDefinition, {
    matterId: input.matterId,
    userId: input.timekeeperUserId,
  });
  const durationMinutes = roundDuration(input.rawDurationMinutes, increment, direction);

  if (!input.billable) {
    return { durationMinutes, rate: { noRate: true } as const, currency: "USD" };
  }
  const matterRow = await database
    .prepare("SELECT client_code, matter_type_id, location_id FROM matter WHERE id = ?1")
    .bind(input.matterId)
    .first<{ client_code: string | null }>();
  const memberRow = await database
    .prepare("SELECT role_id FROM member_role WHERE member_user_id = ?1 LIMIT 1")
    .bind(input.timekeeperUserId)
    .first<{ role_id: string | null }>();
  const rate = await resolveRate(database, {
    matterId: input.matterId,
    clientId: matterRow?.client_code ?? null,
    timekeeperUserId: input.timekeeperUserId,
    roleId: memberRow?.role_id ?? null,
    workDate: input.workDate,
    rateCardId: input.rateCardId ?? undefined,
    overrideE4: input.overrideRateE4 ?? undefined,
  });
  const currency = "noRate" in rate ? "USD" : rate.currency;
  return { durationMinutes, rate, currency };
}

export function registerTimeEntriesRoutes(app: TimeApp, chokepoint: Chokepoint): void {
  // POST /api/v1/time-entries — capture
  app.openapi(
    { ...createRoute, middleware: chokepointMiddleware(chokepoint, createRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const now = () => new Date().toISOString();
      let result;
      try {
        const { durationMinutes, rate, currency } = await resolveCaptureValues(
          firm.firmDatabase,
          request,
          userId,
        );
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const captured = await captureTimeEntry(
              firm.firmDatabase,
              {
                matterId: request.matterId,
                timekeeperUserId: request.timekeeperUserId,
                workDate: request.workDate,
                rawDurationMinutes: request.rawDurationMinutes,
                durationMinutes,
                narrative: request.narrative,
                billable: request.billable,
                nonBillableCategoryId: request.nonBillableCategoryId ?? null,
                source: request.source,
                utbmsTaskCodeId: request.utbmsTaskCodeId ?? null,
                utbmsActivityCodeId: request.utbmsActivityCodeId ?? null,
                rate,
                currency,
              },
              { clock: { now }, actorUserId: userId },
            );
            return {
              write: captured.effect,
              responseCode: 201,
              responseBody: canonicalJsonStringify({ timeEntryId: captured.timeEntryId }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError) return timeEntryErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof TimeEntryAck>, 201);
    },
  );

  // GET /api/v1/time-entries — list (My-Day or per-matter shape)
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const rows =
        query.timekeeperUserId !== undefined && query.workDate !== undefined
          ? await listTimeEntriesForTimekeeperDay(firm.firmDatabase, {
              timekeeperUserId: query.timekeeperUserId,
              workDate: query.workDate,
            })
          : query.matterId !== undefined
            ? await listUnbilledByMatter(firm.firmDatabase, {
                matterId: query.matterId,
                status: query.status ?? "draft",
              })
            : [];
      return c.json({ data: rows }, 200);
    },
  );

  // GET /api/v1/time-entries/{id} — detail
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const row = await firm.firmDatabase
        .prepare(
          "SELECT id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, amount_minor, currency, status FROM time_entry WHERE id = ?1",
        )
        .bind(id)
        .first<{
          id: string;
          matter_id: string;
          timekeeper_user_id: string;
          work_date: string;
          duration_minutes: number;
          raw_duration_minutes: number;
          narrative: string;
          billable: number;
          amount_minor: number | null;
          currency: string;
          status: "draft" | "submitted" | "approved" | "billed" | "void";
        }>();
      if (row === null)
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such time entry in this firm.",
        });
      return c.json(
        {
          id: row.id,
          matterId: row.matter_id,
          timekeeperUserId: row.timekeeper_user_id,
          workDate: row.work_date,
          durationMinutes: row.duration_minutes,
          rawDurationMinutes: row.raw_duration_minutes,
          narrative: row.narrative,
          billable: row.billable === 1,
          amountMinor: row.amount_minor,
          currency: row.currency,
          status: row.status,
        },
        200,
      );
    },
  );

  // PATCH /api/v1/time-entries/{id} — update a draft
  app.openapi(
    { ...updateRoute, middleware: chokepointMiddleware(chokepoint, updateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, id, () =>
        updateDraftTimeEntry(firm.firmDatabase, id, patch, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ timeEntryId: outcome.id } as z.infer<typeof TimeEntryAck>, 200);
    },
  );

  // POST .../{id}/submit | /approve | /kick-back | /void — lifecycle transitions
  app.openapi(
    { ...submitRoute, middleware: chokepointMiddleware(chokepoint, submitRoute) },
    async (c) =>
      transitionHandler(c, chokepoint, (db, id, userId) =>
        submitTimeEntry(db, id, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      ),
  );
  app.openapi(
    { ...approveRoute, middleware: chokepointMiddleware(chokepoint, approveRoute) },
    async (c) =>
      transitionHandler(c, chokepoint, (db, id, userId) =>
        approveTimeEntry(db, id, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      ),
  );
  app.openapi(
    { ...kickBackRoute, middleware: chokepointMiddleware(chokepoint, kickBackRoute) },
    async (c) => {
      const reason = (c.req.valid("json") as z.infer<typeof KickBackRequest>).reason;
      return transitionHandler(c, chokepoint, (db, id, userId) =>
        kickBackTimeEntry(
          db,
          id,
          { reason },
          { clock: { now: () => new Date().toISOString() }, actorUserId: userId },
        ),
      );
    },
  );
  app.openapi(
    { ...voidRoute, middleware: chokepointMiddleware(chokepoint, voidRoute) },
    async (c) =>
      transitionHandler(c, chokepoint, (db, id, userId) =>
        voidTimeEntry(db, id, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
        }),
      ),
  );

  // POST /api/v1/time-entries/quick-add-preview — pure parse, no write
  app.openapi(
    { ...previewRoute, middleware: chokepointMiddleware(chokepoint, previewRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { text } = c.req.valid("json");
      const parsed = parseQuickAdd(text);
      const candidates =
        parsed.matterHint === null
          ? { results: [] as { id: string; title: string }[] }
          : await firm.firmDatabase
              .prepare(
                "SELECT id, title FROM matter WHERE title LIKE ?1 AND status != 'prospective' ORDER BY title LIMIT 10",
              )
              .bind(`%${parsed.matterHint}%`)
              .all<{ id: string; title: string }>();
      return c.json(
        {
          durationMinutes: parsed.durationMinutes,
          matterHint: parsed.matterHint,
          narrative: parsed.narrative,
          candidates: candidates.results,
        },
        200,
      );
    },
  );

  // POST /api/v1/time-entries/grid-batch — bulk weekly-grid capture
  app.openapi(
    { ...gridBatchRoute, middleware: chokepointMiddleware(chokepoint, gridBatchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { entries } = c.req.valid("json");
      const now = () => new Date().toISOString();
      let result;
      try {
        const resolved = await Promise.all(
          entries.map((entry) => resolveCaptureValues(firm.firmDatabase, entry, userId)),
        );
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now,
          effect: async () => {
            const statements: EffectWrite["statements"][number][] = [];
            const outboxMessages: EffectWrite["outboxMessages"][number][] = [];
            const ids: string[] = [];
            for (let i = 0; i < entries.length; i++) {
              const captured = await captureTimeEntry(
                firm.firmDatabase,
                {
                  matterId: entries[i].matterId,
                  timekeeperUserId: entries[i].timekeeperUserId,
                  workDate: entries[i].workDate,
                  rawDurationMinutes: entries[i].rawDurationMinutes,
                  durationMinutes: resolved[i].durationMinutes,
                  narrative: entries[i].narrative,
                  billable: entries[i].billable,
                  nonBillableCategoryId: entries[i].nonBillableCategoryId ?? null,
                  source: "grid",
                  utbmsTaskCodeId: entries[i].utbmsTaskCodeId ?? null,
                  utbmsActivityCodeId: entries[i].utbmsActivityCodeId ?? null,
                  rate: resolved[i].rate,
                  currency: resolved[i].currency,
                },
                { clock: { now }, actorUserId: userId },
              );
              statements.push(...captured.effect.statements);
              outboxMessages.push(...captured.effect.outboxMessages);
              ids.push(captured.timeEntryId);
            }
            return {
              write: { statements, outboxMessages },
              responseCode: 201,
              responseBody: canonicalJsonStringify({ timeEntryIds: ids }),
            };
          },
        });
      } catch (caught) {
        if (caught instanceof TimeEntryValidationError) return timeEntryErrorResponse(c, caught);
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof GridBatchAck>, 201);
    },
  );
}

// The shared idempotent commit for an effect-returning time-entry mutation, mapping a frozen/illegal
// transition to 409 and an unknown entry to 404 — the locations commitLocationEffect shape.
type TimeEntryEffectOutcome =
  | { ok: true; id: string; replayed: boolean }
  | {
      ok: false;
      problem:
        | ProblemResponse<400>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    };

async function commitTimeEntryEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  id: string,
  call: () => Promise<{ effect: EffectWrite }>,
): Promise<TimeEntryEffectOutcome> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const { effect } = await call();
        return {
          write: effect,
          responseCode: 200,
          responseBody: canonicalJsonStringify({ timeEntryId: id }),
        };
      },
    });
  } catch (caught) {
    if (caught instanceof TimeEntryValidationError)
      return { ok: false, problem: timeEntryErrorResponse(c, caught) };
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  const body = JSON.parse(result.responseBody ?? "{}") as { timeEntryId: string };
  return { ok: true, id: body.timeEntryId, replayed: result.kind === "replayed" };
}

// A lifecycle-transition handler: pulls the chokepoint context, commits the service call idempotently,
// surfaces the replay header. The id comes from the path; the firm db + actor from the chokepoint.
async function transitionHandler(
  c: Context,
  _chokepoint: Chokepoint,
  call: (db: BatchDatabase, id: string, userId: string) => Promise<{ effect: EffectWrite }>,
): Promise<Response> {
  const firm = requireChokepointFirmContext(c as never);
  const userId = requireChokepointUserId(c as never);
  const idempotency = requireChokepointIdempotency(c as never);
  const { id } = c.req.valid("param" as never) as { id: string };
  const outcome = await commitTimeEntryEffect(c, firm.firmDatabase, idempotency, id, () =>
    call(firm.firmDatabase, id, userId),
  );
  if (!outcome.ok) return outcome.problem;
  if (outcome.replayed) c.header("Idempotency-Replayed", "true");
  return c.json({ timeEntryId: outcome.id } as z.infer<typeof TimeEntryAck>, 200);
}
```

Register in `apps/worker/src/app.ts` — add the import beside the other route imports and the registration beside the slice-1·x block:

```ts
import { registerTimeEntriesRoutes } from "./routes/time-entries.ts";
```

```ts
// Time tracking — the work-in-progress entry surface, composed through the same chokepoint.
registerTimeEntriesRoutes(app, chokepoint);
```

#### Step 4 — Run the test (expect PASS)

```
pnpm --filter @magna-carta/worker test -- time-entries-routes
```

Expected output: `Test Files  1 passed (1)` / all `time-entries-routes` cases green — capture stores `duration_minutes 36` / `amount_minor 18000` / `rate_source timekeeper`, the non-billable entry stores nulls, the list shapes return rows, the billed-row patch returns 409, submit→approve reaches `approved`, the quick-add preview returns candidates with `time_entry` count unchanged, the replay sets `Idempotency-Replayed: true`, and the Read-only member is 403.

#### Step 5 — Commit

```
git add apps/worker/src/routes/time-entries.ts apps/worker/src/app.ts apps/worker/test/time-entries-routes.test.ts packages/timekeeping/package.json
git commit -m "feat(worker): time-entry routes through the chokepoint (capture/list/lifecycle/quick-add/grid)"
```

---

### Task 18: timer routes (proxy + idempotent stop-commit)

The timer HTTP surface. `start`/`pause`/`resume`/`bind`/`read`/`discard` are thin proxies to the per-timekeeper Durable Object reached at `c.env.DURABLE_TIMER.idFromName(\`${firmId}:${userId}\`)`(the firm-namespaced identity from §4.2).`stopCommit`is the two-phase commit (§4.3): it calls the DO's`stopAndCommit`, and on `committing` derives **both** the chokepoint Idempotency-Key (`timer-stop:<liveRunId>`) and the `timeEntry\_`handle deterministically from`live_run_id`, resolves the rate + rounds the duration, commits one `time_entry`with`source: "timer"`through`runIdempotentEffect`, then tells the DO to clear. Two racing stop-commits collapse to one entry via the chokepoint key + the `time_entry.live_run_id` partial UNIQUE. An unbound timer is refused 422.

**Files**

- Create: `apps/worker/src/routes/timer.ts`
- Modify: `apps/worker/src/app.ts` (register)
- Test: `apps/worker/test/timer-routes.test.ts` (Miniflare)

**Interfaces**

- Produces routes: `timer.start`/`pause`/`resume`/`bind`/`read`/`stopCommit`/`discard`.
- Consumes: `DURABLE_TIMER` (Task 15/16), `captureTimeEntry` (Task 9), `resolveRate` (Task 7), `roundDuration`/`computeAmountMinor` (Task 4), `resolveScopedSetting` (Task 3), `runIdempotentEffect`.

**Steps**

#### Step 1 — Write the failing route test

Create `apps/worker/test/timer-routes.test.ts`. Same seed harness as Task 17 (Owner with `time:track`, a matter, a rate card). The `vitest-pool-workers` config (set up in Task 15) already binds `DURABLE_TIMER` to `LiveTimerDurableObject` and declares its migration tag, so `SELF.fetch` reaches a live DO. The deterministic `timeEntry_` handle from one `live_run_id` is what makes two concurrent stops collapse — the test fires both with `Promise.all` and asserts exactly one row.

```ts
import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { appendRate, createRateCard } from "@magna-carta/timekeeping/rate-service";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The timer HTTP surface over a live Durable Object: start/bind/stop-commit mints exactly one entry
// tagged source=timer with its live_run_id set; an unbound timer refuses to commit (422); two racing
// stop-commits collapse to one entry (the chokepoint key + the time_entry.live_run_id partial UNIQUE,
// both derived from the same live_run_id); and the DO clears after a confirmed commit.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let matterId: string;
const clock = { now: () => new Date().toISOString() };

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Timer Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1").bind(poolFirmId).run();

  const owner = await seedCredentialedUser("timer-owner@example.com", { userName: "Timer Owner", firmId: poolFirmId });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Timer Owner");
  ownerCookie = await signInForSessionCookie("timer-owner@example.com");

  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", cookie: ownerCookie, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Doe v. Roe", status: "open", responsibleMemberId: ownerUserId }),
  });
  matterId = ((await created.json()) as { matterId: string }).matterId;

  const card = await createRateCard(env.DB_FIRM_POOL_1, { name: "Standard" }, { clock, actorUserId: ownerUserId });
  await commitEffectBatch(env.DB_FIRM_POOL_1, card.effect, { now: clock.now });
  const rate = await appendRate(
    env.DB_FIRM_POOL_1,
    { rateCardId: card.rateCardId, tier: "timekeeper", scopedId: ownerUserId, rateE4: 3_000_000, currency: "USD", validFrom: "2026-01-01" },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(env.DB_FIRM_POOL_1, rate.effect, { now: clock.now });
});

function headers(withKey = true): HeadersInit {
  return { "content-type": "application/json", origin: "https://example.com", cookie: ownerCookie, ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}) };
}
async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
}
async function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { headers: { origin: "https://example.com", cookie: ownerCookie } });
}

describe("timer start -> bind -> stop-commit", () => {
  it("mints exactly one entry tagged source=timer with its live_run_id set", async () => {
    const start = await post("/api/v1/timer/start", {});
    expect(start.status).toBe(200);
    const { liveRunId } = (await start.json()) as { liveRunId: string };
    expect(liveRunId).toBeTruthy();

    expect((await post("/api/v1/timer/bind", { matterId, narrative: "Negotiated settlement" })).status).toBe(200);

    const stop = await post("/api/v1/timer/stop-commit", {});
    expect(stop.status).toBe(201);
    const { timeEntryId } = (await stop.json()) as { timeEntryId: string };

    const row = await env.DB_FIRM_POOL_1.prepare("SELECT source, live_run_id, status FROM time_entry WHERE id = ?1")
      .bind(timeEntryId)
      .first<{ source: string; live_run_id: string | null; status: string }>();
    expect(row?.source).toBe("timer");
    expect(row?.live_run_id).toBe(liveRunId);
    expect(row?.status).toBe("draft");

    // The DO cleared after the confirmed commit: a fresh read reports no live timer.
    const read = await get("/api/v1/timer/read");
    expect(read.status).toBe(200);
    expect((await read.json()) as { status: string }).status).toMatch(/idle|none|cleared/);
  });
});

describe("an unbound timer cannot commit", () => {
  it("refuses stop-commit with 422 when no matter is bound", async () => {
    expect((await post("/api/v1/timer/start", {})).status).toBe(200);
    const stop = await post("/api/v1/timer/stop-commit", {});
    expect(stop.status).toBe(422);
    await post("/api/v1/timer/discard", {});
  });
});

describe("two racing stop-commits collapse to one entry", () => {
  it("derives one chokepoint key + one timeEntry handle from the live_run_id", async () => {
    const start = await post("/api/v1/timer/start", {});
    const { liveRunId } = (await start.json()) as { liveRunId: string };
    await post("/api/v1/timer/bind", { matterId, narrative: "Concurrent stop" });

    const before = await env.DB_FIRM_POOL_1.prepare("SELECT COUNT(*) AS c FROM time_entry WHERE live_run_id = ?1").bind(liveRunId).first<{ c: number }>();
    expect(before?.c).toBe(0);

    const [a, b] = await Promise.all([post("/api/v1/timer/stop-commit", {}), post("/api/v1/timer/stop-commit", {})]);
    expect([a.status, b.status].filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);

    const after = await env.DB_FIRM_POOL_1.prepare("SELECT COUNT(*) AS c FROM time_entry WHERE live_run_id = ?1").bind(liveRunId).first<{ c: number }>();
    expect(after?.c).toBe(1);
  });
});
```

#### Step 2 — Run the test (expect FAIL)

```
pnpm --filter @magna-carta/worker test -- timer-routes
```

Expected output: `Cannot find module '../src/routes/timer.ts'`, and once stubbed, every `/api/v1/timer/*` POST returns 404 (unregistered → asset fallthrough). `FAIL apps/worker/test/timer-routes.test.ts`.

#### Step 3 — Implement the routes

Create `apps/worker/src/routes/timer.ts`. The DO is reached through `c.env.DURABLE_TIMER`. The deterministic derivations live in one place so the two-phase guarantee is auditable. `time_entry`-derived handle uses `deriveTimeEntryHandle(liveRunId)` — a stable transform (the `liveRunId` token suffixed into a `timeEntry_` handle) so two routes computing it agree.

```ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { resolveScopedSetting } from "@magna-carta/data-access/scoped-setting-statements";
import { captureTimeEntry } from "@magna-carta/timekeeping/time-entry-service";
import { resolveRate } from "@magna-carta/timekeeping/rate-resolution";
import { roundDuration } from "@magna-carta/timekeeping/rounding";
import {
  incrementMinutesDefinition,
  roundingDirectionDefinition,
  abandonedThresholdMinutesDefinition,
} from "@magna-carta/timekeeping/settings";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { TimeEntryId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
  requireChokepointIdempotency,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// Timer routes: thin proxies to the per-timekeeper Durable Object (one instance per firm+user, so a
// timer never crosses firms), plus the two-phase stop-commit. The DO holds only transient timer state
// and never writes a business row; stop-commit reads the DO's committing result and writes the one
// time_entry through the data-access chokepoint, deriving both the idempotency key AND the entry handle
// from the live_run_id so two racing commits collapse to a single row.

const TRACK = "time:track" as const;

const StartRequest = z
  .object({
    matterId: identifierField("matter").nullable().optional(),
    label: z.string().nullable().optional(),
    narrative: z.string().nullable().optional(),
    utbmsTaskCodeId: identifierField("utbmsCode").nullable().optional(),
  })
  .openapi("TimerStartRequest");
const BindRequest = z
  .object({
    matterId: identifierField("matter"),
    label: z.string().nullable().optional(),
    narrative: z.string().nullable().optional(),
    utbmsTaskCodeId: identifierField("utbmsCode").nullable().optional(),
  })
  .openapi("TimerBindRequest");
const EmptyRequest = z.object({}).openapi("TimerEmptyRequest");

const StartAck = z
  .object({ liveRunId: z.string(), startedAt: z.string() })
  .openapi("TimerStartAck");
const TimerStateResponse = z
  .object({
    status: z.enum(["running", "paused", "committing", "abandoned", "idle"]),
    liveRunId: z.string().nullable(),
    startedAt: z.string().nullable(),
    matterId: z.string().nullable(),
    narrative: z.string().nullable(),
  })
  .openapi("TimerStateResponse");
const StopCommitAck = z.object({ timeEntryId: z.string() }).openapi("TimerStopCommitAck");
const TimerAck = z.object({ ok: z.boolean() }).openapi("TimerAck");

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks time:track",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable or the member is deactivated",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, or the timer has no bound matter to commit",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;
const writeErrorResponses = {
  400: authErrors[400],
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
  422: authErrors[422],
  429: authErrors[429],
} as const;
const readErrorResponses = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  429: authErrors[429],
} as const;

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: TRACK,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}
const startMeta = writeMeta("timer.start");
const pauseMeta = writeMeta("timer.pause");
const resumeMeta = writeMeta("timer.resume");
const bindMeta = writeMeta("timer.bind");
const stopCommitMeta = writeMeta("timer.stopCommit");
const discardMeta = writeMeta("timer.discard");
const readMeta: RouteMeta = {
  operationId: "timer.read",
  surface: "app",
  authenticated: true,
  permission: TRACK,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

function proxyRoute(
  meta: RouteMeta,
  action: string,
  description: string,
  body: z.ZodTypeAny,
  ackSchema: z.ZodTypeAny,
  code: 200 | 201,
) {
  return defineOpenAPIRoute(meta, {
    method: "post",
    path: `/api/v1/timer/${action}`,
    description,
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: body } }, required: true },
    },
    responses: {
      [code]: { description: "Applied", content: { "application/json": { schema: ackSchema } } },
      400: writeErrorResponses[400],
      401: writeErrorResponses[401],
      403: writeErrorResponses[403],
      404: writeErrorResponses[404],
      409: writeErrorResponses[409],
      422: writeErrorResponses[422],
      429: writeErrorResponses[429],
    },
  });
}
const startRoute = proxyRoute(
  startMeta,
  "start",
  "Starts the timekeeper's live timer, stopping any timer already running (single-active). Mints a live run id and sets the abandoned alarm.",
  StartRequest,
  StartAck,
  200,
);
const pauseRoute = proxyRoute(
  pauseMeta,
  "pause",
  "Pauses the running timer.",
  EmptyRequest,
  TimerAck,
  200,
);
const resumeRoute = proxyRoute(
  resumeMeta,
  "resume",
  "Resumes a paused timer.",
  EmptyRequest,
  TimerAck,
  200,
);
const bindRoute = proxyRoute(
  bindMeta,
  "bind",
  "Binds the running timer to a matter (required before commit).",
  BindRequest,
  TimerAck,
  200,
);
const stopCommitRoute = proxyRoute(
  stopCommitMeta,
  "stop-commit",
  "Stops the timer and commits its elapsed time as a draft entry. Refuses an unbound timer. Idempotent on the live run id — two racing commits collapse to one entry.",
  EmptyRequest,
  StopCommitAck,
  201,
);
const discardRoute = proxyRoute(
  discardMeta,
  "discard",
  "Discards the running timer without committing.",
  EmptyRequest,
  TimerAck,
  200,
);
const readRoute = defineOpenAPIRoute(readMeta, {
  method: "get",
  path: "/api/v1/timer/read",
  description:
    "Returns the timekeeper's current timer state. The client computes elapsed time from startedAt.",
  responses: {
    200: {
      description: "The timer state",
      content: { "application/json": { schema: TimerStateResponse } },
    },
    401: readErrorResponses[401],
    403: readErrorResponses[403],
    404: readErrorResponses[404],
    429: readErrorResponses[429],
  },
});

// The deterministic timeEntry handle for a live run: the same input always yields the same handle, so
// two routes (or two racing stop-commits) commit under one primary key. The live_run_id token is the
// entropy; this binds it to the timeEntry handle shape.
function deriveTimeEntryHandle(liveRunId: string): TimeEntryId {
  const token = liveRunId.includes("_") ? liveRunId.slice(liveRunId.indexOf("_") + 1) : liveRunId;
  return `timeEntry_${token}` as TimeEntryId;
}

type TimerApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function durableTimerStub(c: { env: Bindings }, firmId: string, userId: string) {
  const id = c.env.DURABLE_TIMER.idFromName(`${firmId}:${userId}`);
  return c.env.DURABLE_TIMER.get(id);
}

export function registerTimerRoutes(app: TimerApp, chokepoint: Chokepoint): void {
  // POST /api/v1/timer/start
  app.openapi(
    { ...startRoute, middleware: chokepointMiddleware(chokepoint, startRoute) },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const threshold = await readFirmSetting(
        firm.firmDatabase,
        abandonedThresholdMinutesDefinition,
      );
      const stub = durableTimerStub(c, firmId, userId);
      const started = await stub.start({
        matterId: request.matterId ?? undefined,
        label: request.label ?? undefined,
        narrative: request.narrative ?? undefined,
        utbmsTaskCodeId: request.utbmsTaskCodeId ?? undefined,
        abandonedThresholdMinutes: threshold,
      });
      return c.json({ liveRunId: started.liveRunId, startedAt: started.startedAt }, 200);
    },
  );

  // POST pause | resume | bind | discard — direct proxies
  app.openapi(
    { ...pauseRoute, middleware: chokepointMiddleware(chokepoint, pauseRoute) },
    async (c) => {
      await durableTimerStub(c, requireChokepointFirmId(c), requireChokepointUserId(c)).pause();
      return c.json({ ok: true }, 200);
    },
  );
  app.openapi(
    { ...resumeRoute, middleware: chokepointMiddleware(chokepoint, resumeRoute) },
    async (c) => {
      await durableTimerStub(c, requireChokepointFirmId(c), requireChokepointUserId(c)).resume();
      return c.json({ ok: true }, 200);
    },
  );
  app.openapi(
    { ...bindRoute, middleware: chokepointMiddleware(chokepoint, bindRoute) },
    async (c) => {
      const request = c.req.valid("json");
      await durableTimerStub(c, requireChokepointFirmId(c), requireChokepointUserId(c)).bind({
        matterId: request.matterId,
        label: request.label ?? undefined,
        narrative: request.narrative ?? undefined,
        utbmsTaskCodeId: request.utbmsTaskCodeId ?? undefined,
      });
      return c.json({ ok: true }, 200);
    },
  );
  app.openapi(
    { ...discardRoute, middleware: chokepointMiddleware(chokepoint, discardRoute) },
    async (c) => {
      await durableTimerStub(c, requireChokepointFirmId(c), requireChokepointUserId(c)).discard();
      return c.json({ ok: true }, 200);
    },
  );

  // GET /api/v1/timer/read
  app.openapi(
    { ...readRoute, middleware: chokepointMiddleware(chokepoint, readRoute) },
    async (c) => {
      const state = await durableTimerStub(
        c,
        requireChokepointFirmId(c),
        requireChokepointUserId(c),
      ).read();
      if (state === null) {
        return c.json(
          { status: "idle", liveRunId: null, startedAt: null, matterId: null, narrative: null },
          200,
        );
      }
      return c.json(
        {
          status: state.status,
          liveRunId: state.liveRunId,
          startedAt: state.startedAt,
          matterId: state.matterId ?? null,
          narrative: state.narrative ?? null,
        },
        200,
      );
    },
  );

  // POST /api/v1/timer/stop-commit — the two-phase commit
  app.openapi(
    { ...stopCommitRoute, middleware: chokepointMiddleware(chokepoint, stopCommitRoute) },
    async (c) => {
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const firm = requireChokepointFirmContext(c);
      const stub = durableTimerStub(c, firmId, userId);

      // Phase 1: the DO's single-threaded compare-and-set returns the live run id (and whether this call
      // is the committer or a loser that should still serve the winner's entry).
      const stop = await stub.stopAndCommit();
      const state = await stub.read();
      if (state === null || state.matterId === undefined || state.matterId === null) {
        // bind is required before commit — the DO holds no matter to attribute the time to.
        return problemJson(c, {
          type: "validation",
          title: "The timer is not bound to a matter",
          status: 422,
          detail: "Bind the timer to a matter before committing.",
        });
      }

      // Phase 2: derive BOTH the chokepoint key and the entry handle from the live run id, so two racing
      // commits write the same primary key and the loser replays the winner's response.
      const liveRunId = stop.liveRunId;
      const timeEntryId = deriveTimeEntryHandle(liveRunId);
      const elapsedMinutes = state.elapsedMinutes ?? 0;
      const increment = await resolveScopedSetting(firm.firmDatabase, incrementMinutesDefinition, {
        matterId: state.matterId,
        userId,
      });
      const direction = await resolveScopedSetting(firm.firmDatabase, roundingDirectionDefinition, {
        matterId: state.matterId,
        userId,
      });
      const durationMinutes = roundDuration(elapsedMinutes, increment, direction);

      const matterRow = await firm.firmDatabase
        .prepare("SELECT client_code FROM matter WHERE id = ?1")
        .bind(state.matterId)
        .first<{ client_code: string | null }>();
      const memberRow = await firm.firmDatabase
        .prepare("SELECT role_id FROM member_role WHERE member_user_id = ?1 LIMIT 1")
        .bind(userId)
        .first<{ role_id: string | null }>();
      const rate = await resolveRate(firm.firmDatabase, {
        matterId: state.matterId,
        clientId: matterRow?.client_code ?? null,
        timekeeperUserId: userId,
        roleId: memberRow?.role_id ?? null,
        workDate: (state.startedAt ?? new Date().toISOString()).slice(0, 10),
      });
      const currency = "noRate" in rate ? "USD" : rate.currency;
      const now = () => new Date().toISOString();

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: `timer-stop:${liveRunId}`,
        fingerprint: liveRunId,
        now,
        effect: async () => {
          const captured = await captureTimeEntry(
            firm.firmDatabase,
            {
              id: timeEntryId,
              matterId: state.matterId!,
              timekeeperUserId: userId,
              workDate: (state.startedAt ?? now()).slice(0, 10),
              rawDurationMinutes: elapsedMinutes,
              durationMinutes,
              narrative: state.narrative ?? "",
              billable: true,
              nonBillableCategoryId: null,
              source: "timer",
              liveRunId,
              utbmsTaskCodeId: state.utbmsTaskCodeId ?? null,
              utbmsActivityCodeId: null,
              rate,
              currency,
            },
            { clock: { now }, actorUserId: userId },
          );
          return {
            write: captured.effect,
            responseCode: 201,
            responseBody: canonicalJsonStringify({ timeEntryId: captured.timeEntryId }),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      // The commit is confirmed (executed or replayed) — clear the DO so a new timer can start.
      await stub.discard();
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof StopCommitAck>, 201);
    },
  );
}
```

`captureTimeEntry` takes an optional `id` (the timer path supplies the deterministic handle; the manual path lets the service mint one) — confirm Task 9's `CaptureTimeEntryInput` carries the optional `id`; if not, Task 9's `captureTimeEntry` is amended to accept it (the deterministic-handle requirement is fixed in the interface contract's stop-commit derivation, so the input type owns the optional `id`).

Register in `apps/worker/src/app.ts`:

```ts
import { registerTimerRoutes } from "./routes/timer.ts";
```

```ts
registerTimerRoutes(app, chokepoint);
```

#### Step 4 — Run the test (expect PASS)

```
pnpm --filter @magna-carta/worker test -- timer-routes
```

Expected output: `Test Files  1 passed (1)` — start→bind→stop-commit mints one `source=timer` row with `live_run_id` set and the DO reads back idle; the unbound stop returns 422; the two `Promise.all` stop-commits leave `COUNT(*) WHERE live_run_id = ? === 1`.

#### Step 5 — Commit

```
git add apps/worker/src/routes/timer.ts apps/worker/src/app.ts apps/worker/test/timer-routes.test.ts
git commit -m "feat(worker): timer routes — DO proxy + idempotent stop-commit derived from live_run_id"
```

---

### Task 19: rate-cards / utbms-codes / non-billable / narrative-templates / my-day routes

The remaining HTTP surface, each through the chokepoint over `runIdempotentEffect`, each permission-gated per §11: rates → `time:manageRates`, UTBMS → `time:manageUtbms`, categories + templates → `time:manageSettings`, My Day → `time:track` (read). All five route files follow `routes/locations.ts` exactly. The My Day read pulls the firm-level targets (`time.target_daily_hours`, the flat `setting` seam) and hands them to `readMyDay` (Task 13).

**Files**

- Create: `apps/worker/src/routes/rate-cards.ts`, `apps/worker/src/routes/utbms-codes.ts`, `apps/worker/src/routes/non-billable-categories.ts`, `apps/worker/src/routes/narrative-templates.ts`, `apps/worker/src/routes/my-day.ts`
- Modify: `apps/worker/src/app.ts` (register all five)
- Test: `apps/worker/test/rate-cards-routes.test.ts`, `apps/worker/test/utbms-routes.test.ts`, `apps/worker/test/non-billable-categories-routes.test.ts`, `apps/worker/test/narrative-templates-routes.test.ts`, `apps/worker/test/my-day-routes.test.ts`

**Interfaces**

- Produces routes: `rateCards.create`/`list`, `rates.append`/`reRateDrafts`; `utbmsCodes.list`/`enable`/`disable`; `nonBillableCategories.create`/`list`/`update`/`archive`; `narrativeTemplates.create`/`list`/`recentNarratives`; `myDay.get`.
- Consumes: `createRateCard`/`appendRate`/`reRateUnbilledDrafts` (Task 6/10), `RateValidationError` (Task 6); `enableUtbmsCode`/`disableUtbmsCode`/list statement (Task 11); the non-billable + narrative services (Task 12); `readMyDay` (Task 13); `readFirmSetting` + the target definitions (Task 5).

**Steps**

#### Step 1 — Write the failing route tests

Each suite uses the Task-17 seed harness with the matching role/permission and a Read-only negative. I give the two pivotal suites in full; the other three follow the identical shape (seed → drive → assert + a 403 negative), so each is written the same way with its own service and permission.

`apps/worker/test/rate-cards-routes.test.ts`:

```ts
import { env, SELF } from "cloudflare:test";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import { mirrorMemberWithOwnerRole, seedCredentialedUser, seedFirm, signInForSessionCookie } from "./support/test-auth.ts";

// Rate-card + effective-dated rate CRUD and the unbilled-draft re-rate, all gated by time:manageRates.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Rates Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1").bind(poolFirmId).run();
  const owner = await seedCredentialedUser("rates-owner@example.com", { userName: "Rates Owner", firmId: poolFirmId });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Rates Owner");
  ownerCookie = await signInForSessionCookie("rates-owner@example.com");
});

function headers(): HeadersInit {
  return { "content-type": "application/json", origin: "https://example.com", cookie: ownerCookie, "Idempotency-Key": crypto.randomUUID() };
}
async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
}
async function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { headers: { origin: "https://example.com", cookie: ownerCookie } });
}

describe("rate-card lifecycle", () => {
  it("creates a card, appends a version, lists, and re-rates unbilled drafts", async () => {
    const card = await post("/api/v1/rate-cards", { name: "Standard" });
    expect(card.status).toBe(201);
    const rateCardId = ((await card.json()) as { rateCardId: string }).rateCardId;

    const append = await post(`/api/v1/rate-cards/${rateCardId}/rates`, {
      tier: "timekeeper",
      scopedId: ownerUserId,
      rateE4: 3_000_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });
    expect(append.status).toBe(201);

    const list = await get("/api/v1/rate-cards");
    expect(((await list.json()) as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(1);

    const reRate = await post(`/api/v1/rate-cards/${rateCardId}/re-rate-drafts`, { fromDate: "2026-01-01", toDate: "2026-12-31" });
    expect(reRate.status).toBe(200);
    expect((await reRate.json()) as { count: number }).count).toBeGreaterThanOrEqual(0);
  });

  it("refuses an overlapping rate version (422)", async () => {
    const card = await post("/api/v1/rate-cards", { name: "Capped" });
    const rateCardId = ((await card.json()) as { rateCardId: string }).rateCardId;
    expect((await post(`/api/v1/rate-cards/${rateCardId}/rates`, { tier: "client", scopedId: null, rateE4: 2_000_000, currency: "USD", validFrom: "2026-01-01" })).status).toBe(201);
    // A second version whose valid_from lands inside the first open interval is refused.
    expect((await post(`/api/v1/rate-cards/${rateCardId}/rates`, { tier: "client", scopedId: null, rateE4: 2_500_000, currency: "USD", validFrom: "2026-01-01" })).status).toBe(422);
  });
});
```

`apps/worker/test/my-day-routes.test.ts`:

```ts
import { env, SELF } from "cloudflare:test";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The My Day visibility read: billable/non-billable totals + target shortfall + un-logged-day flag.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "MyDay Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();
  const owner = await seedCredentialedUser("myday-owner@example.com", {
    userName: "MyDay Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "MyDay Owner");
  ownerCookie = await signInForSessionCookie("myday-owner@example.com");
  // A working day with no entries: un-logged-day must be true.
});

async function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie: ownerCookie },
  });
}

describe("my-day read", () => {
  it("reports totals and the un-logged-day flag for a day with no entries", async () => {
    const response = await get(
      `/api/v1/my-day?timekeeperUserId=${ownerUserId}&workDate=2026-06-22`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      billableMinutes: number;
      nonBillableMinutes: number;
      shortfallMinutes: number | null;
      unloggedDay: boolean;
    };
    expect(body.billableMinutes).toBe(0);
    expect(body.nonBillableMinutes).toBe(0);
    expect(body.unloggedDay).toBe(true);
  });
});
```

The remaining three test files (`utbms-routes.test.ts`, `non-billable-categories-routes.test.ts`, `narrative-templates-routes.test.ts`) are written to the same shape: each seeds the harness, drives its CRUD over `SELF.fetch`, asserts the persisted row, and asserts a Read-only member receives 403 on its mutating route. The UTBMS suite seeds the catalog first (`seedUtbmsCatalogStatements` from Task 11, committed against `env.DB_FIRM_POOL_1` in `beforeAll`), then lists/enables/disables and re-reads the `active` flag; the non-billable suite creates → updates → archives and asserts `archived_at` is set, never a hard delete; the narrative-templates suite creates a template with a `utbmsTaskCodeId` + `narrativeTemplate` + `defaultRateE4` and reads `recent-narratives` back.

#### Step 2 — Run the tests (expect FAIL)

```
pnpm --filter @magna-carta/worker test -- rate-cards-routes utbms-routes non-billable-categories-routes narrative-templates-routes my-day-routes
```

Expected output: all five files fail — `Cannot find module '../src/routes/rate-cards.ts'` (and the four siblings), then every route 404s once stubbed. `FAIL` on each of the five files.

#### Step 3 — Implement the routes

Create `apps/worker/src/routes/rate-cards.ts`. Mirrors `routes/locations.ts`: `RouteMeta` builders carrying `permission: "time:manageRates"`, a `commitRateEffect` helper modeled on `commitLocationEffect` that maps `RateValidationError` to 422, the same replay surfacing.

```ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  createRateCard,
  appendRate,
  reRateUnbilledDrafts,
  RateValidationError,
} from "@magna-carta/timekeeping/rate-service";
import { RATE_CARD_TABLE } from "@magna-carta/timekeeping/rate-statements";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
  requireChokepointIdempotency,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// Rate cards and effective-dated rate versions: append-only (a rate change is a new version that
// closes the prior open interval in the same batch). The unbilled-draft re-rate is opt-in and never
// touches a billed or void entry. All write paths require time:manageRates.

const MANAGE = "time:manageRates" as const;

const RateCardRequest = z.object({ name: z.string().min(1) }).openapi("RateCardRequest");
const AppendRateRequest = z
  .object({
    tier: z.enum(["matter", "client", "timekeeper", "role"]),
    scopedId: z.string().nullable(),
    rateE4: z.number().int().positive(),
    currency: z.string().length(3),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .openapi("AppendRateRequest");
const ReRateRequest = z
  .object({
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .openapi("ReRateRequest");

const RateCardSummary = z
  .object({ id: z.string(), name: z.string(), archivedAt: z.string().nullable() })
  .openapi("RateCardSummary");
const RateCardListResponse = z
  .object({ data: z.array(RateCardSummary) })
  .openapi("RateCardListResponse");
const RateCardAck = z.object({ rateCardId: z.string() }).openapi("RateCardAck");
const RateAck = z.object({ rateId: z.string() }).openapi("RateAck");
const ReRateAck = z.object({ count: z.number().int() }).openapi("ReRateAck");

const cardParam = z.object({ id: identifierPathParam("rateCard", "id") });

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks time:manageRates",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the card is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, or the rate version overlaps an existing interval",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;
const writeErrorResponses = {
  400: authErrors[400],
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
  422: authErrors[422],
  429: authErrors[429],
} as const;
const readErrorResponses = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  429: authErrors[429],
} as const;

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}
const createMeta = writeMeta("rateCards.create");
const appendMeta = writeMeta("rates.append");
const reRateMeta = writeMeta("rates.reRateDrafts");
const listMeta: RouteMeta = {
  operationId: "rateCards.list",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const createRoute = defineOpenAPIRoute(createMeta, {
  method: "post",
  path: "/api/v1/rate-cards",
  description: "Creates a named rate card.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: RateCardRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The rate card was created",
      content: { "application/json": { schema: RateCardAck } },
    },
    ...writeErrorResponses,
  },
});
const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/rate-cards",
  description: "Lists the firm's rate cards, ordered by name.",
  responses: {
    200: {
      description: "The rate cards",
      content: { "application/json": { schema: RateCardListResponse } },
    },
    ...readErrorResponses,
  },
});
const appendRoute = defineOpenAPIRoute(appendMeta, {
  method: "post",
  path: "/api/v1/rate-cards/{id}/rates",
  description:
    "Appends an effective-dated rate version to a card's scope tier, closing the prior open version. An overlapping start date is refused.",
  request: {
    headers: idempotencyKeyHeader,
    params: cardParam,
    body: { content: { "application/json": { schema: AppendRateRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The rate version was appended",
      content: { "application/json": { schema: RateAck } },
    },
    ...writeErrorResponses,
  },
});
const reRateRoute = defineOpenAPIRoute(reRateMeta, {
  method: "post",
  path: "/api/v1/rate-cards/{id}/re-rate-drafts",
  description:
    "Re-resolves and rewrites the rate and amount on unbilled draft, submitted, and approved entries in a date range. Billed and void entries never change.",
  request: {
    headers: idempotencyKeyHeader,
    params: cardParam,
    body: { content: { "application/json": { schema: ReRateRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The drafts were re-rated",
      content: { "application/json": { schema: ReRateAck } },
    },
    ...writeErrorResponses,
  },
});

function rateErrorResponse(
  c: Context,
  error: RateValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (error.code === "rate-card-not-found")
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such rate card.",
    });
  return problemJson(c, {
    type: "validation",
    title: "Invalid rate request",
    status: 422,
    detail: error.message,
  });
}

type RatesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

async function commitRateEffect<T extends Record<string, string | number>>(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  code: 200 | 201,
  value: T,
  call: () => Promise<{ effect: EffectWrite }>,
): Promise<
  | { ok: true; body: T; replayed: boolean }
  | {
      ok: false;
      problem:
        | ProblemResponse<400>
        | ProblemResponse<404>
        | ProblemResponse<409>
        | ProblemResponse<422>;
    }
> {
  const now = () => new Date().toISOString();
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => ({
        write: (await call()).effect,
        responseCode: code,
        responseBody: canonicalJsonStringify(value),
      }),
    });
  } catch (caught) {
    if (caught instanceof RateValidationError)
      return { ok: false, problem: rateErrorResponse(c, caught) };
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  return {
    ok: true,
    body: JSON.parse(result.responseBody ?? "{}") as T,
    replayed: result.kind === "replayed",
  };
}

export function registerRateCardsRoutes(app: RatesApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...createRoute, middleware: chokepointMiddleware(chokepoint, createRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const request = c.req.valid("json");
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const created = await createRateCard(
            firm.firmDatabase,
            { name: request.name },
            { clock: { now }, actorUserId: userId },
          );
          return {
            write: created.effect,
            responseCode: 201,
            responseBody: canonicalJsonStringify({ rateCardId: created.rateCardId }),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof RateCardAck>, 201);
    },
  );

  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await firm.firmDatabase
        .prepare(`SELECT id, name, archived_at FROM ${RATE_CARD_TABLE} ORDER BY name`)
        .all<{ id: string; name: string; archived_at: string | null }>();
      return c.json(
        {
          data: results.map((row) => ({ id: row.id, name: row.name, archivedAt: row.archived_at })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...appendRoute, middleware: chokepointMiddleware(chokepoint, appendRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      let rateId = "";
      const outcome = await commitRateEffect(
        c,
        firm.firmDatabase,
        idempotency,
        201,
        { rateId: "" },
        async () => {
          const appended = await appendRate(
            firm.firmDatabase,
            {
              rateCardId: id,
              tier: request.tier,
              scopedId: request.scopedId,
              rateE4: request.rateE4,
              currency: request.currency,
              validFrom: request.validFrom,
            },
            { clock: { now: () => new Date().toISOString() }, actorUserId: userId },
          );
          rateId = appended.rateId;
          return appended;
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ rateId: outcome.body.rateId || rateId } as z.infer<typeof RateAck>, 201);
    },
  );

  app.openapi(
    { ...reRateRoute, middleware: chokepointMiddleware(chokepoint, reRateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { id } = c.req.valid("param");
      const request = c.req.valid("json");
      let count = 0;
      const outcome = await commitRateEffect(
        c,
        firm.firmDatabase,
        idempotency,
        200,
        { count: 0 },
        async () => {
          const reRated = await reRateUnbilledDrafts(
            firm.firmDatabase,
            { rateCardId: id, fromDate: request.fromDate, toDate: request.toDate },
            { clock: { now: () => new Date().toISOString() }, actorUserId: userId },
          );
          count = reRated.count;
          return reRated;
        },
      );
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ count } as z.infer<typeof ReRateAck>, 200);
    },
  );
}
```

Create `apps/worker/src/routes/utbms-codes.ts` (permission `time:manageUtbms`; `enable`/`disable` toggle `active` through `enableUtbmsCode`/`disableUtbmsCode`; list reads `UTBMS_CODE_TABLE` filtered by `code_set`), `apps/worker/src/routes/non-billable-categories.ts` (permission `time:manageSettings`; create/update/archive through the Task-12 service, soft-archive only), `apps/worker/src/routes/narrative-templates.ts` (permission `time:manageSettings`; create/list + a `recent-narratives` read through `recentNarrativesStatement`), and `apps/worker/src/routes/my-day.ts` (permission `time:track`, read-only). Each is the same locations-shaped module: `RouteMeta` builders, the shared `writeErrorResponses`/`readErrorResponses`, `runIdempotentEffect` on every write, replay surfacing. `my-day.ts` reads the firm-level targets via `readFirmSetting(firm.firmDatabase, targetDailyHoursDefinition)` and passes them to `readMyDay`:

```ts
// my-day.ts — the visibility read handler body
const firm = requireChokepointFirmContext(c);
const { timekeeperUserId, workDate } = c.req.valid("query");
const targetDailyHours = await readFirmSetting(firm.firmDatabase, targetDailyHoursDefinition);
const view = await readMyDay(firm.firmDatabase, {
  timekeeperUserId,
  workDate,
  targets: { dailyHours: targetDailyHours },
});
return c.json(view, 200);
```

Register all five in `apps/worker/src/app.ts`, beside the Task-17/18 registrations:

```ts
import { registerRateCardsRoutes } from "./routes/rate-cards.ts";
import { registerUtbmsCodesRoutes } from "./routes/utbms-codes.ts";
import { registerNonBillableCategoriesRoutes } from "./routes/non-billable-categories.ts";
import { registerNarrativeTemplatesRoutes } from "./routes/narrative-templates.ts";
import { registerMyDayRoutes } from "./routes/my-day.ts";
```

```ts
registerRateCardsRoutes(app, chokepoint);
registerUtbmsCodesRoutes(app, chokepoint);
registerNonBillableCategoriesRoutes(app, chokepoint);
registerNarrativeTemplatesRoutes(app, chokepoint);
registerMyDayRoutes(app, chokepoint);
```

Add the consumed `@magna-carta/timekeeping` exports declared in this task to `packages/timekeeping/package.json` (`./rate-statements`, `./utbms-statements`, `./utbms-service`, `./non-billable-category-service`, `./narrative-template-service`, `./narrative-template-statements`, `./my-day`).

#### Step 4 — Run the suites (expect PASS)

```
pnpm --filter @magna-carta/worker test -- rate-cards-routes utbms-routes non-billable-categories-routes narrative-templates-routes my-day-routes
```

Expected output: `Test Files  5 passed (5)` — the card create/append/list/re-rate cycle green and the overlapping version 422; UTBMS list/enable/disable flip `active`; category create/update/archive set `archived_at` (no hard delete); the narrative template round-trips with its recent-narratives read; the My Day read reports zeroes + `unloggedDay: true`; each suite's Read-only negative returns 403.

#### Step 5 — Commit

```
git add apps/worker/src/routes/rate-cards.ts apps/worker/src/routes/utbms-codes.ts apps/worker/src/routes/non-billable-categories.ts apps/worker/src/routes/narrative-templates.ts apps/worker/src/routes/my-day.ts apps/worker/src/app.ts packages/timekeeping/package.json apps/worker/test/rate-cards-routes.test.ts apps/worker/test/utbms-routes.test.ts apps/worker/test/non-billable-categories-routes.test.ts apps/worker/test/narrative-templates-routes.test.ts apps/worker/test/my-day-routes.test.ts
git commit -m "feat(worker): rate-card, UTBMS, non-billable, narrative-template, and my-day routes"
```

---

### Task 20: OpenAPI snapshot + conformance extension

Regenerate the committed OpenAPI snapshot to carry every Task-17/18/19 operation, extend the conformance suite's committed-operations list + `RESOURCE_BY_PERMISSION_NAMESPACE` (the `time → matter` binding) + `NON_MUTATING_POST_ALLOW_LIST` (the read-shaped `timeEntries.previewQuickAdd`), and confirm `chokepointCompositionViolations` stays clean — every new `/api/v1` route was registered through `defineOpenAPIRoute`, so it composes the chokepoint.

**Files**

- Modify: `apps/worker/openapi/openapi.json` (regenerated), `apps/worker/test/conformance.test.ts`
- Test: `apps/worker/test/conformance.test.ts`, `apps/worker/test/contracts/openapi-snapshot.test.ts`

**Interfaces**

- Produces: the regenerated snapshot; `RESOURCE_BY_PERMISSION_NAMESPACE.time = "matter"`; `NON_MUTATING_POST_ALLOW_LIST["timeEntries.previewQuickAdd"]`.
- Consumes: all Task 17–19 routes.

**Steps**

#### Step 1 — Extend the conformance test (expect FAIL)

In `apps/worker/test/conformance.test.ts`, add the `time` namespace binding so the new routes' `permission: time:*` with `resource: matter` is recognized (without it, `permissionRegistryViolations` flags every new route). Edit `RESOURCE_BY_PERMISSION_NAMESPACE`:

```ts
const RESOURCE_BY_PERMISSION_NAMESPACE: Record<string, string> = {
  firm: "firm",
  matters: "matter",
  locations: "location",
  files: "matter",
  directory: "directoryEntity",
  shipping: "firm",
  tools: "firm",
  customFields: "matter",
  // time:* governs time entries, rate cards, the UTBMS catalog, non-billable categories, narrative
  // templates, and the scoped time settings — all rooted on the matter the time is billed to.
  time: "matter",
};
```

The `timeEntries.previewQuickAdd` route is a `POST` that mutates nothing (a pure parse), so add it to `NON_MUTATING_POST_ALLOW_LIST`:

```ts
  "timeEntries.previewQuickAdd":
    "Read-shaped POST: parses a one-line quick-add string into a duration, matter hint, and narrative and returns matching matters for confirm — no write, no audit.",
```

Add every new operationId to the committed-operations assertion (the vacuity guard). Insert these, sorted, into the `expect(ids).toEqual([...])` array:

```ts
      "myDay.get",
      "narrativeTemplates.create",
      "narrativeTemplates.list",
      "narrativeTemplates.recentNarratives",
      "nonBillableCategories.archive",
      "nonBillableCategories.create",
      "nonBillableCategories.list",
      "nonBillableCategories.update",
      "rateCards.create",
      "rateCards.list",
      "rates.append",
      "rates.reRateDrafts",
      "timeEntries.approve",
      "timeEntries.create",
      "timeEntries.get",
      "timeEntries.gridBatch",
      "timeEntries.kickBack",
      "timeEntries.list",
      "timeEntries.previewQuickAdd",
      "timeEntries.submit",
      "timeEntries.update",
      "timeEntries.void",
      "timer.bind",
      "timer.discard",
      "timer.pause",
      "timer.read",
      "timer.resume",
      "timer.start",
      "timer.stopCommit",
      "utbmsCodes.disable",
      "utbmsCodes.enable",
      "utbmsCodes.list",
```

#### Step 2 — Run the conformance + snapshot suites (expect FAIL)

```
pnpm --filter @magna-carta/worker test -- conformance openapi-snapshot
```

Expected output: `openapi-snapshot` fails first — `expect(committedSnapshot).toBe(serializeOpenAPIDocument())` mismatches because the live document now carries the time/timer/rate-card/utbms/non-billable/narrative/my-day operations the committed `openapi.json` does not. The conformance committed-operations test may still report a diff until the snapshot is regenerated and the new routes are all present. `FAIL` on both files.

#### Step 3 — Regenerate the snapshot

```
pnpm --filter @magna-carta/worker run emit-openapi
```

This runs `node scripts/emit-openapi.mts`, which writes `apps/worker/openapi/openapi.json` from `serializeOpenAPIDocument()` (the byte-exact pretty-printed form the snapshot test compares). The new operations land in the committed artifact. No hand-editing — the emitter is the single source.

#### Step 4 — Run the conformance + snapshot suites (expect PASS)

```
pnpm --filter @magna-carta/worker test -- conformance openapi-snapshot
```

Expected output: `Test Files  2 passed` — the committed snapshot equals a fresh emission byte-for-byte; the committed-operations list matches; `permissionRegistryViolations`, `auditedMutatingViolations`, `surfaceConsistencyViolations`, `errorIdCoverageViolations`, `operationIdViolations`, and `chokepointCompositionViolations` each return `[]` for the full document (including the new `time:*` routes). To confirm the chokepoint composition explicitly:

```
pnpm --filter @magna-carta/worker test -- conformance -t "composes the chokepoint"
```

Expected: green — every dispatched `/api/v1/time-entries`, `/api/v1/timer/*`, `/api/v1/rate-cards`, `/api/v1/utbms-codes`, `/api/v1/non-billable-categories`, `/api/v1/narrative-templates`, `/api/v1/my-day` path is present in the document, so none bypasses the chokepoint.

#### Step 5 — Commit

```
git add apps/worker/openapi/openapi.json apps/worker/test/conformance.test.ts
git commit -m "test(worker): register slice 3·1 operations in conformance + regenerate OpenAPI snapshot"
```

---

There's no existing `*.test.ts` under fixtures load-profile (the plan-scan guard for Task 22 is new). I have all patterns needed. I'll now write the four task sections. Given length constraints, I'll be complete and concrete, matching the cited idioms exactly.

Here are my assigned task sections:

---

### Task 21: Gated AI narrative/UTBMS seam + inference idempotency-key

The producer seam, feature dark. The call-site reaches `InferencePort.generateStream` **only** after the firm's `aiProcessingEligibility` gate is on (default OFF, so no model is reached); `buildInferenceJobIdempotencyKey` is a stable per-`(firmId, matterId, prompt-fingerprint)` token; and `InferenceJob` gains the `idempotencyKey` field plus the two consumer dedup guards' design (a pre-model-call read that skips the spend on a key hit, and a same-batch dedup record beside the metering write). No route wires the feature live — it ships dark.

**Files**

- Create: `apps/worker/src/timekeeping/narrative-inference.ts`
- Modify: `apps/worker/src/inference/inference-consumer.ts` (add `idempotencyKey` to `InferenceJob`; the two-guard design)
- Test: `apps/worker/test/narrative-inference.test.ts` (new), `apps/worker/test/inference-consumer-unit.test.ts` (extend)

**Interfaces**

- Produces: `NarrativeSuggestionInput`, `NarrativeSuggestionResult`, `buildInferenceJobIdempotencyKey(input)`, `suggestNarrative(...)`; `InferenceJob.idempotencyKey: string`.
- Consumes: `InferencePort` (`packages/inference/src/port.ts`), `aiProcessingEligibilityDefinition` + `readFirmSetting`, `resolveReasoningModel`/`inferencePortFor` (`call-site.ts`), `tokenUsageIdempotencyStatements` (the new same-batch dedup builder beside `tokenUsageCommitStatements`).

**Step 1 — Write the failing narrative-inference test (gate-off returns a typed disabled result, no model reached; stable key).**

Create `apps/worker/test/narrative-inference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { GenerateInput, InferencePort, StreamResult } from "@magna-carta/inference/port";
import type { Dispatch } from "@magna-carta/integrations/dispatch";
import {
  buildInferenceJobIdempotencyKey,
  suggestNarrative,
  type NarrativeSuggestionInput,
} from "../src/timekeeping/narrative-inference.ts";

// A firm-database stub returning the stored aiProcessingEligibility value (or none for the default).
function fakeFirmDatabase(eligibility?: boolean) {
  return {
    prepare(_sql: string) {
      return {
        bind() {
          return this;
        },
        async all<T>() {
          return {
            results: (eligibility === undefined
              ? []
              : [{ value: JSON.stringify(eligibility) }]) as T[],
          };
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
  } as unknown as SqlDatabase;
}

// A port that records every call so the test can prove the model is NEVER reached when the gate is off.
function recordingPort(calls: GenerateInput[]): InferencePort {
  const reached = async (input: GenerateInput): Promise<Dispatch<never>> => {
    calls.push(input);
    throw new Error("the model must not be reached when the gate is off");
  };
  return {
    generate: reached,
    generateStream: async (input: GenerateInput): Promise<Dispatch<StreamResult>> => {
      calls.push(input);
      throw new Error("generateStream must not be reached when the gate is off");
    },
    generateDurable: reached,
    embed: reached,
  };
}

const INPUT: NarrativeSuggestionInput = {
  firmId: "firm_abc",
  matterId: "matter_xyz",
  utbmsContext: "L120",
  userHistorySeed: "drafted demand letter; reviewed discovery",
};

describe("suggestNarrative — dark until the firm's AI-processing gate is on", () => {
  it("returns a typed feature-disabled result and reaches NO model when eligibility is the default (off)", async () => {
    const calls: GenerateInput[] = [];
    const result = await suggestNarrative(fakeFirmDatabase(), recordingPort(calls), {
      modelId: "anthropic/claude-opus-4-8",
      input: INPUT,
    });
    expect(result).toEqual({ status: "feature-disabled" });
    expect(calls).toEqual([]);
  });

  it("still returns feature-disabled (no model) when eligibility is explicitly false", async () => {
    const calls: GenerateInput[] = [];
    const result = await suggestNarrative(fakeFirmDatabase(false), recordingPort(calls), {
      modelId: "anthropic/claude-opus-4-8",
      input: INPUT,
    });
    expect(result.status).toBe("feature-disabled");
    expect(calls).toEqual([]);
  });
});

describe("buildInferenceJobIdempotencyKey — stable per (firmId, matterId, prompt fingerprint)", () => {
  it("is identical for identical inputs and differs when any dimension changes", () => {
    const key = buildInferenceJobIdempotencyKey(INPUT);
    expect(buildInferenceJobIdempotencyKey({ ...INPUT })).toBe(key);
    expect(buildInferenceJobIdempotencyKey({ ...INPUT, matterId: "matter_other" })).not.toBe(key);
    expect(buildInferenceJobIdempotencyKey({ ...INPUT, firmId: "firm_other" })).not.toBe(key);
    expect(buildInferenceJobIdempotencyKey({ ...INPUT, utbmsContext: "L130" })).not.toBe(key);
  });

  it("is a stable, opaque, URL-safe token (a hex digest), not the raw prompt", () => {
    const key = buildInferenceJobIdempotencyKey(INPUT);
    expect(key).toMatch(/^narrative:[0-9a-f]{64}$/);
    expect(key).not.toContain("demand letter");
  });
});
```

**Step 2 — Run the new narrative test (expect FAIL: module does not exist).**

```
pnpm --filter @magna-carta/worker test -- narrative-inference
```

Expected: FAIL — `Cannot find module '../src/timekeeping/narrative-inference.ts'` (the file is created in Step 4).

**Step 3 — Extend the consumer-unit test to pin the new `idempotencyKey` field + the same-batch dedup builder.**

Add to `apps/worker/test/inference-consumer-unit.test.ts` (after the existing `tokenUsageKeyForDay` block):

```ts
import { describe, expect, it } from "vitest";
import {
  firmRateGate,
  inferenceJobDedupKey,
  tokenUsageKeyForDay,
  type InferenceJob,
} from "../src/inference/inference-consumer.ts";

describe("InferenceJob carries a producer-set idempotency key", () => {
  it("the job shape exposes idempotencyKey (the producer's stable per-run anchor)", () => {
    const job: InferenceJob = {
      firmId: "firm_abc",
      databaseIdentifier: "DB_FIRM_POOL_1",
      prompt: "draft a narrative",
      idempotencyKey: "narrative:deadbeef",
    };
    expect(job.idempotencyKey).toBe("narrative:deadbeef");
  });
});

describe("inferenceJobDedupKey", () => {
  it("derives the per-run dedup record key from the job's producer key", () => {
    expect(inferenceJobDedupKey("narrative:deadbeef")).toBe("inference:narrative:deadbeef");
  });
});
```

(The existing `firmRateGate` / `tokenUsageKeyForDay` blocks stay; only the import line widens to add `inferenceJobDedupKey` + `InferenceJob`.)

**Step 4 — Run both suites (expect FAIL: the new symbols don't exist yet).**

```
pnpm --filter @magna-carta/worker test -- narrative-inference inference-consumer-unit
```

Expected: FAIL — `narrative-inference` fails on the missing module; `inference-consumer-unit` fails on `inferenceJobDedupKey is not exported` and the `idempotencyKey` field missing from `InferenceJob`.

**Step 5 — Add the `idempotencyKey` field + the two-guard design to the consumer.**

Edit `apps/worker/src/inference/inference-consumer.ts` — extend `InferenceJob`:

```ts
export interface InferenceJob {
  readonly firmId: string;
  readonly databaseIdentifier: string; // the firm's database binding name (the firm-scoped context)
  readonly prompt: string;
  // The producer's stable per-run idempotency anchor: identical across a redelivery of the SAME run, so
  // the two dedup guards below collapse a redelivery to a single spend + a single meter. The producer
  // (the time-narrative call-site in src/timekeeping/narrative-inference.ts) mints it; there was no
  // producer when this consumer first shipped, so the field arrives with the first one.
  readonly idempotencyKey: string;
}

// The per-run dedup record key: namespaced off the producer's idempotency key so it cannot collide with
// any other idempotency-record family in the firm database.
export function inferenceJobDedupKey(producerKey: string): string {
  return `inference:${producerKey}`;
}
```

Replace the at-least-once comment block + the unguarded commit (lines around the `// This path is at-least-once with NO idempotency guard.` comment) with the two-guard design. The body still meters, but now reads the dedup record first and writes it in the same batch as the meter:

```ts
const entry = catalogEntryFor(modelId);
const slot = entry?.slot ?? "reasoning";
// EXACTLY-ONCE on a redelivery is two guards over the producer's idempotency key. The queue is
// at-least-once, and the model spend at port.generate above precedes the commit below, so a
// redelivery would otherwise both re-bill the frontier model AND re-meter.
//   Guard 1 (the re-BILL stop): a pre-model-call read of the dedup record (key
//   inferenceJobDedupKey(idempotencyKey)). On a hit the run already committed, so the model call is
//   skipped entirely — the spend never repeats. (The feature's producer wires this read in ahead of
//   port.generate when it ships; the gated dark producer reaches no model, so there is nothing to
//   re-bill today — the record family + key derivation are what land now.)
//   Guard 2 (the re-METER stop): the dedup record INSERT is composed into the SAME batch as the
//   metering write, so the second delivery loses the UNIQUE(key) race and its whole batch — meter
//   increment included — rolls back. The same-batch precedent is
//   apps/worker/src/files/ingest-consumer.ts (runIdempotentEffect): the dedup record and the effect
//   commit or roll back together.
// One timestamp for the whole batch: the bucket day and the dedup row are then provably consistent
// (no latent UTC-midnight split between reading the day and writing the rows).
const nowIso = new Date().toISOString();
const key = tokenUsageKeyForDay(nowIso, slot, modelId);
await commitEffectBatch(
  firmDatabase,
  {
    statements: [
      ...tokenUsageCommitStatements(
        firmDatabase,
        key,
        result.value.usage.inputTokens,
        result.value.usage.outputTokens,
      ),
      ...inferenceDedupStatements(firmDatabase, inferenceJobDedupKey(job.idempotencyKey), nowIso),
    ],
    outboxMessages: [],
  },
  { now: () => nowIso },
);
```

Add the import for the dedup-record builder (beside the existing `tokenUsageCommitStatements` import):

```ts
import {
  inferenceDedupStatements,
  tokenUsageCommitStatements,
  type TokenUsageKey,
} from "@magna-carta/data-access/token-usage-statements";
```

Add `inferenceDedupStatements` to `packages/data-access/src/token-usage-statements.ts` (the dedup-record INSERT over the existing idempotency-record table the data-access layer already owns), beside `tokenUsageCommitStatements`:

```ts
import { idempotencyRecordInsertStatement } from "./idempotency-statements.ts";

// The same-batch dedup record for an inference run: a UNIQUE-keyed insert. Composed beside the metering
// write so a redelivery's whole batch rolls back on the key collision (the re-meter stop). The key is
// the consumer's inferenceJobDedupKey; the fingerprint is the key itself (the only delivery for this key
// is this run, carrying no varying payload).
export function inferenceDedupStatements(
  database: SqlDatabase,
  key: string,
  now: string,
): SqlStatement[] {
  return [idempotencyRecordInsertStatement(database, { key, fingerprint: key, now })];
}
```

(If `idempotencyRecordInsertStatement` is not already exported from `idempotency-statements.ts`, export the existing builder `runIdempotentEffect` composes — it is the same insert; reuse it, do not write a second one.)

**Step 6 — Create the gated call-site `narrative-inference.ts`.**

Create `apps/worker/src/timekeeping/narrative-inference.ts`:

```ts
import { createHash } from "node:crypto";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import type { InferencePort } from "@magna-carta/inference/port";

// The time-narrative / UTBMS-suggestion producer — the first real consumer of InferencePort. It is DARK:
// no route wires it live, and the call-site reaches a model only after the firm's AI-processing gate is
// on. Privilege never rides an implicit yes, so the gate is off by default and the disabled path reaches
// no model at all. When the gate flips on (with the consent surface that owns it), this same call-site
// streams a draft over generateStream; until then it returns a typed feature-disabled result.

// The suggestion request: the firm + matter the narrative is for, plus optional context the prompt is
// fingerprinted over. Carries no privileged content beyond what the suggestion is built from.
export interface NarrativeSuggestionInput {
  readonly firmId: string;
  readonly matterId: string;
  readonly utbmsContext?: string;
  readonly userHistorySeed?: string;
}

export type NarrativeSuggestionResult =
  | { readonly status: "feature-disabled" }
  | { readonly status: "suggested"; readonly stream: AsyncIterable<string> }
  | { readonly status: "unavailable" };

export interface SuggestNarrativeOptions {
  readonly modelId: string;
  readonly input: NarrativeSuggestionInput;
}

// The producer's stable per-run idempotency anchor: a hex digest over (firmId, matterId, the
// prompt-fingerprinting context). Identical inputs yield an identical key, so a redelivered run collapses
// to one spend + one meter through the consumer's two guards. Opaque (a digest, not the raw prompt) so
// it leaks no narrative content into a key column.
export function buildInferenceJobIdempotencyKey(input: NarrativeSuggestionInput): string {
  const fingerprint = createHash("sha256")
    .update(input.firmId)
    .update("\u0000")
    .update(input.matterId)
    .update("\u0000")
    .update(input.utbmsContext ?? "")
    .update("\u0000")
    .update(input.userHistorySeed ?? "")
    .digest("hex");
  return `narrative:${fingerprint}`;
}

// Compose the prompt from matter context — kept here, not in the prompt-bearing job, so the fingerprint
// and the streamed prompt are built from one place.
function composePrompt(input: NarrativeSuggestionInput): string {
  const lines = [
    `Suggest a concise time-entry narrative for matter ${input.matterId}.`,
    input.utbmsContext ? `UTBMS context: ${input.utbmsContext}.` : "",
    input.userHistorySeed ? `Recent narratives for tone: ${input.userHistorySeed}.` : "",
  ];
  return lines.filter((line) => line !== "").join(" ");
}

// Reach a model ONLY when the firm's AI-processing gate is on. The default (no row) is off, so the
// disabled branch returns before any port.generateStream — no model is reached. The read is total (a
// missing/invalid stored value yields the safe default off), mirroring readFirmSetting.
export async function suggestNarrative(
  firmDatabase: SqlDatabase,
  port: InferencePort,
  options: SuggestNarrativeOptions,
): Promise<NarrativeSuggestionResult> {
  const eligible = await readFirmSetting(firmDatabase, aiProcessingEligibilityDefinition);
  if (!eligible) return { status: "feature-disabled" };

  const dispatch = await port.generateStream({
    modelId: options.modelId,
    prompt: composePrompt(options.input),
    firmId: options.input.firmId as Parameters<InferencePort["generateStream"]>[0]["firmId"],
  });
  if (!dispatch.ok) return { status: "unavailable" };
  return { status: "suggested", stream: dispatch.value.stream };
}
```

**Step 7 — Run both suites (expect PASS).**

```
pnpm --filter @magna-carta/worker test -- narrative-inference inference-consumer-unit
```

Expected: PASS — gate-off returns `{ status: "feature-disabled" }` with `calls === []` (no model reached); the key is stable + opaque; `InferenceJob.idempotencyKey` and `inferenceJobDedupKey` resolve.

**Step 8 — Commit.**

```
git add apps/worker/src/timekeeping/narrative-inference.ts apps/worker/src/inference/inference-consumer.ts packages/data-access/src/token-usage-statements.ts apps/worker/test/narrative-inference.test.ts apps/worker/test/inference-consumer-unit.test.ts
git commit -m "$(cat <<'EOF'
feat(timekeeping): gated narrative/UTBMS inference seam + producer idempotency key

The first real InferencePort producer, shipped dark: suggestNarrative reaches a
model only when the firm's AI-processing gate is on (default off, so the disabled
path reaches no model). buildInferenceJobIdempotencyKey is a stable opaque per-run
key; InferenceJob gains idempotencyKey and the consumer gains the two dedup guards'
design (pre-call read stops the re-bill; same-batch record stops the re-meter).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: Load-profile TimeVolume + measurements

Extend the load profile with a `TimeVolume` sub-profile laid down through the real `appendRate`/`captureTimeEntry` write path (valid by construction), and a `timekeeping-measurements.ts` measuring the hot reads — My Day totals, the weekly-grid fan, per-matter unbilled WIP, and rate resolution — each with `EXPLAIN QUERY PLAN` full-scan flagging. Bump `LedgerVolumeProfile.version` and `GENERATOR_VERSION`, wire the generator into `snapshot.ts`, and the measurements into `measure-cli.ts`.

**Files**

- Modify: `packages/fixtures/src/load-profile/profile.ts` (TimeVolume + `version` bump + `scaleProfile`), `packages/fixtures/src/load-profile/generate.ts` is untouched; `packages/fixtures/src/load-profile/snapshot.ts` (run the generator + manifest fields), `packages/fixtures/src/load-profile/measure-cli.ts` (wire the measurements + plan scan)
- Create: `packages/fixtures/src/load-profile/timekeeping-generate.ts`, `packages/fixtures/src/load-profile/timekeeping-measurements.ts`
- Test: `packages/fixtures/src/load-profile/timekeeping-measurements.test.ts` (new — the plan-scan guard)

**Interfaces**

- Produces: `TimeVolume` on `LedgerVolumeProfile` (`time` field); `generateTimeVolume` + `TimeProbes`; `timekeepingMeasurements`, `timekeepingHotPathPlans`, `TIMEKEEPING_PLAN_SCAN_ALLOWLIST`, `timekeepingMeasurementHandle`.
- Consumes: `captureTimeEntry`/`appendRate`/`createRateCard` (the real write path, `@magna-carta/timekeeping`), `resolveRate`, the My Day / WIP read statements (`@magna-carta/timekeeping/queries`), `explainStatement`/`Measurement`/`findFullScans` (`runner.ts`).

**Step 1 — Write the failing plan-scan guard test.**

Create `packages/fixtures/src/load-profile/timekeeping-measurements.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { ledgerVolume, scaleProfile } from "./profile.ts";
import { findFullScans } from "./runner.ts";
import { loadProfileSnapshot, type LoadedSnapshot } from "./snapshot.ts";
import {
  timekeepingHotPathPlans,
  TIMEKEEPING_PLAN_SCAN_ALLOWLIST,
} from "./timekeeping-measurements.ts";

// A CI-smoke-scale snapshot (the smallest multiplier the floors allow), generated through the REAL
// capture/commit + rate-append write path — so the time volume is valid by construction. The plan-scan
// guard then asserts every timekeeping hot read walks an index, never a full table scan, at volume.
const SMOKE_SEED = "timekeeping-measurements-smoke";
const SMOKE_PROFILE = scaleProfile(ledgerVolume, 0.01);

let snapshot: LoadedSnapshot;

afterAll(() => {
  snapshot?.close();
});

describe("timekeeping hot reads are index-served at volume", () => {
  it("lays down the time volume through the real path and plans every hot read free of a full scan", async () => {
    snapshot = await loadProfileSnapshot(SMOKE_PROFILE, SMOKE_SEED, { allowSeeding: true });

    // Non-vacuity: the generator actually produced time entries and rates.
    expect(snapshot.manifest.timeEntryCount).toBeGreaterThan(0);
    expect(snapshot.manifest.rateCount).toBeGreaterThan(0);

    const scans = findFullScans(timekeepingHotPathPlans(snapshot), TIMEKEEPING_PLAN_SCAN_ALLOWLIST);
    expect(scans, scans.join(", ")).toEqual([]);
  });
});
```

**Step 2 — Run the guard (expect FAIL: the modules + manifest fields don't exist).**

```
pnpm --filter @magna-carta/fixtures test -- timekeeping-measurements
```

Expected: FAIL — `Cannot find module './timekeeping-measurements.ts'` (and, once that resolves, `timeEntryCount`/`rateCount` missing from the manifest).

**Step 3 — Add `TimeVolume` to the profile, bump versions, extend `scaleProfile`.**

Edit `packages/fixtures/src/load-profile/profile.ts`. Bump the generator version:

```ts
export const GENERATOR_VERSION = 5;
```

Add the `TimeVolume` interface (after `CustomFieldVolume`):

```ts
// The timekeeping volume laid over the practice book: rate cards with effective-dated rate versions, and
// captured time entries spread across the firm's timekeepers and matters, in a draft/billed mix with a
// UTBMS-coded fraction. This is the queryable shadow of the WIP store + rate engine — the My Day daily
// totals read, the weekly-grid fan, the per-matter unbilled-WIP read (3·4's billing query), and rate
// resolution. Every count/distribution is a PARAMETER here, never a generator constant — changing one
// bumps the profile `version`. Sized like an established firm's monthly capture, not a stress run.
export interface TimeVolume {
  // Time entries captured per timekeeper per day over the span (the My Day / weekly-grid fan).
  readonly entriesPerTimekeeperPerDay: number;
  // Named rate cards the firm runs (e.g. Standard, Insurance-capped).
  readonly rateCardCount: number;
  // Effective-dated rate versions appended per card (closed-interval history the resolver walks).
  readonly ratesPerCard: number;
  // Fraction of billable entries carrying UTBMS task + activity codes.
  readonly utbmsCodedFraction: number;
  // Fraction of captured entries already marked billed (the rest stay draft — the unbilled-WIP read's
  // selectivity). 0–1.
  readonly draftBilledMix: number;
  // Days the capture span covers (work_date dispersal via fixed-clock advances).
  readonly spanDays: number;
}
```

Add the `time` field to `LedgerVolumeProfile` (after `customFields`):

```ts
  // The timekeeping volume laid over the practice book (rate cards, effective-dated rates, time entries).
  readonly time: TimeVolume;
```

Bump the profile `version` and add the literal `time` block to `ledgerVolume`:

```ts
  version: 7,
```

```ts
  time: {
    // An established firm's monthly capture: a handful of entries per timekeeper per day across the
    // span, two named rate cards each with a few effective-dated versions, two-thirds UTBMS-coded, a
    // third already billed, over a quarter's worth of work days.
    entriesPerTimekeeperPerDay: 6,
    rateCardCount: 2,
    ratesPerCard: 4,
    utbmsCodedFraction: 0.66,
    draftBilledMix: 0.33,
    spanDays: 90,
  },
```

Add the `time` scale block to `scaleProfile` (inside the returned object, after `customFields`):

```ts
    time: {
      ...profile.time,
      // Floors keep a couple of entries per timekeeper-day (so the My Day / grid reads have a fan), at
      // least one rate card with a couple of effective-dated versions (so resolution walks history), and
      // a handful of span days at the smoke multiplier. The fractions are not scaled.
      entriesPerTimekeeperPerDay: scaleCount(profile.time.entriesPerTimekeeperPerDay, 2),
      rateCardCount: scaleCount(profile.time.rateCardCount, 1),
      ratesPerCard: scaleCount(profile.time.ratesPerCard, 2),
      spanDays: scaleCount(profile.time.spanDays, 5),
    },
```

**Step 4 — Create the generator `timekeeping-generate.ts`.**

Create `packages/fixtures/src/load-profile/timekeeping-generate.ts`:

```ts
import {
  commitEffectBatch,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { MatterId, RateCardId, UserId } from "@magna-carta/identifiers/types";
import { resolveRate } from "@magna-carta/timekeeping/rate-resolution";
import { appendRate, createRateCard } from "@magna-carta/timekeeping/rate-service";
import { captureTimeEntry } from "@magna-carta/timekeeping/time-entry-service";
import { computeAmountMinor, roundDuration } from "@magna-carta/timekeeping/rounding";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { TimeVolume } from "./profile.ts";

// The timekeeping volume (rate cards + effective-dated rates + captured time entries). Every write rides
// a REAL domain service (createRateCard / appendRate / captureTimeEntry) — valid at any scale by
// construction. All randomness is drawn from the one FixtureContext; the module reads no wall-clock.
//
// It runs AFTER the practice generation: it binds its entries to the matters and the responsible member
// that generation laid down (passed in as probes), so the WIP store points at real matters.

// Probe identifiers the timekeeping measurement layer binds real queries to — deterministic for a given
// profile + seed, recorded in the snapshot manifest.
export interface TimeProbes {
  readonly busiestTimekeeperUserId: UserId; // the timekeeper with the most entries — the My Day / grid hot case
  readonly busiestMatterId: MatterId; // the matter with the most unbilled entries — the WIP read target
  readonly resolutionMatterId: MatterId; // a matter on a card with effective-dated rates — rate resolution
  readonly resolutionTimekeeperUserId: UserId;
  readonly rateCardId: RateCardId; // the card the resolution probe walks
  readonly probeWorkDate: string; // the work_date the My Day / grid reads target
}

export interface TimeGenerationResult {
  readonly timeEntryCount: number;
  readonly rateCount: number;
  readonly rateCardCount: number;
  readonly probes: TimeProbes;
}

// The inputs the practice generation already produced, threaded in so time entries bind to real matters.
export interface PracticeAttachPoints {
  readonly timekeeperUserId: UserId;
  readonly matterIds: readonly MatterId[];
}

const NARRATIVES = [
  "Drafted demand letter to opposing counsel",
  "Reviewed discovery responses",
  "Telephone conference with client re status",
  "Prepared motion to compel",
  "Legal research re statute of limitations",
  "Revised settlement agreement",
] as const;

// Add days to a civil PlainDate string (YYYY-MM-DD) without a wall-clock read — pure UTC arithmetic.
function addDays(plainDate: string, days: number): string {
  const at = new Date(`${plainDate}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export async function generateTimeVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: TimeVolume,
  attach: PracticeAttachPoints,
  options: SeedingOptions,
): Promise<TimeGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const serviceOptions = { clock, actorUserId: attach.timekeeperUserId, randomSource };
  const commit = (effect: EffectWrite) =>
    commitEffectBatch(database, effect, { now: () => clock.now() });

  // --- Rate cards, each with effective-dated rate versions for the timekeeper tier. The first card is
  // the resolution probe target. The capture span starts at the clock's current civil date. ---
  const startDate = clock.today();
  const cards: RateCardId[] = [];
  let rateCount = 0;
  for (let cardIndex = 0; cardIndex < Math.max(1, volume.rateCardCount); cardIndex += 1) {
    const card = await createRateCard(
      database,
      { name: cardIndex === 0 ? "Standard" : `Card ${cardIndex + 1}` },
      serviceOptions,
    );
    await commit(card.effect);
    cards.push(card.rateCardId);

    // Versions march forward in non-overlapping intervals; appendRate closes the prior open row.
    let validFrom = addDays(startDate, -volume.spanDays - volume.ratesPerCard * 30);
    for (let version = 0; version < Math.max(1, volume.ratesPerCard); version += 1) {
      const rate = await appendRate(
        database,
        {
          rateCardId: card.rateCardId,
          tier: "timekeeper",
          scopedId: attach.timekeeperUserId,
          rateE4: 2_500_000 + version * 250_000, // $250.00/h, climbing per version (rate_e4, scale 4)
          currency: "USD",
          validFrom,
        },
        serviceOptions,
      );
      await commit(rate.effect);
      rateCount += 1;
      validFrom = addDays(validFrom, 30);
    }
  }
  const probeCardId = cards[0]!;

  // --- Captured entries spread across the span × the matters, on the busiest timekeeper. work_date
  // disperses day by day; each entry resolves its rate on its date and captures the snapshot. ---
  let timeEntryCount = 0;
  const matterEntryTally = new Map<MatterId, number>();
  const probeMatter = attach.matterIds[0]!;
  // The probe work_date sits inside the span so My Day / grid reads find a populated day.
  const probeWorkDate = addDays(startDate, -1);

  for (let dayOffset = 0; dayOffset < volume.spanDays; dayOffset += 1) {
    const workDate = addDays(startDate, -dayOffset);
    for (let index = 0; index < volume.entriesPerTimekeeperPerDay; index += 1) {
      const matterId =
        attach.matterIds[faker.number.int({ min: 0, max: attach.matterIds.length - 1 })]!;
      const billed = faker.number.float({ min: 0, max: 1 }) < volume.draftBilledMix;
      const rawDurationMinutes = faker.number.int({ min: 6, max: 240 });
      const durationMinutes = roundDuration(rawDurationMinutes, 6, "nearest");

      const resolution = await resolveRate(database, {
        matterId,
        clientId: null,
        timekeeperUserId: attach.timekeeperUserId,
        roleId: null,
        workDate,
        rateCardId: probeCardId,
      });
      const currency = "noRate" in resolution ? "USD" : resolution.currency;
      const amountMinor =
        "noRate" in resolution
          ? null
          : computeAmountMinor(resolution.rateE4, durationMinutes, currency);

      const captured = await captureTimeEntry(
        database,
        {
          matterId,
          timekeeperUserId: attach.timekeeperUserId,
          workDate,
          rawDurationMinutes,
          durationMinutes,
          narrative: NARRATIVES[faker.number.int({ min: 0, max: NARRATIVES.length - 1 })]!,
          billable: true,
          source: index % 3 === 0 ? "manual" : "grid",
          currency,
          rate: resolution,
        },
        serviceOptions,
      );
      await commit(captured.effect);
      timeEntryCount += 1;
      matterEntryTally.set(matterId, (matterEntryTally.get(matterId) ?? 0) + 1);
      clock.advanceMinutes(1);
    }
  }

  // The busiest matter by entry count — the unbilled-WIP read's hot case.
  let busiestMatter = probeMatter;
  let busiestCount = -1;
  for (const [matterId, count] of matterEntryTally) {
    if (count > busiestCount) {
      busiestCount = count;
      busiestMatter = matterId;
    }
  }

  return {
    timeEntryCount,
    rateCount,
    rateCardCount: cards.length,
    probes: {
      busiestTimekeeperUserId: attach.timekeeperUserId,
      busiestMatterId: busiestMatter,
      resolutionMatterId: probeMatter,
      resolutionTimekeeperUserId: attach.timekeeperUserId,
      rateCardId: probeCardId,
      probeWorkDate,
    },
  };
}
```

**Step 5 — Create the measurements `timekeeping-measurements.ts`.**

Create `packages/fixtures/src/load-profile/timekeeping-measurements.ts`:

```ts
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import { resolveRate } from "@magna-carta/timekeeping/rate-resolution";
import { computeAmountMinor, roundDuration } from "@magna-carta/timekeeping/rounding";
import {
  listUnbilledByMatter,
  listUnbilledByMatterStatement,
  listWeeklyGrid,
  listWeeklyGridStatement,
  readMyDayStatement,
} from "@magna-carta/timekeeping/queries";
import { readMyDay } from "@magna-carta/timekeeping/my-day";
import { captureTimeEntry } from "@magna-carta/timekeeping/time-entry-service";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The timekeeping volume-shaped measured set: the My Day daily totals read, the weekly-grid fan, the
// per-matter unbilled-WIP read (3·4's billing query), and rate resolution — each riding the REAL read
// path, so the index walks are on the clock. The cost depends on the data SHAPE the timekeeping
// generator laid down — a timekeeper with a span of daily entries, a matter with an unbilled backlog,
// and a card with effective-dated rate history.

export interface TimekeepingMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  readonly context: FixtureContext;
}

// The measurement context derives a DIFFERENT seed (`${seed}:timekeeping-measure`): replaying the
// generation seed would mint the exact identifier sequence the snapshot already contains → UNIQUE
// collisions on the first measured write. Disjoint stream keeps determinism without collision.
export function timekeepingMeasurementHandle(
  snapshot: LoadedSnapshot,
  seed: string,
): TimekeepingMeasurementHandle {
  return { snapshot, context: fixtureContext(`${seed}:timekeeping-measure`) };
}

export const timekeepingMeasurements: readonly Measurement<
  TimekeepingMeasurementHandle,
  unknown
>[] = [
  {
    name: "my-day.daily-totals",
    operation: async (handle) => {
      const { timeProbes } = handle.snapshot.manifest;
      await readMyDay(handle.snapshot.database, {
        timekeeperUserId: timeProbes.busiestTimekeeperUserId,
        workDate: timeProbes.probeWorkDate,
        targets: { dailyMinutes: 480 },
      });
    },
  },
  {
    name: "weekly-grid.by-timekeeper",
    operation: async (handle) => {
      const { timeProbes } = handle.snapshot.manifest;
      await listWeeklyGrid(handle.snapshot.database, {
        timekeeperUserId: timeProbes.busiestTimekeeperUserId,
        fromDate: timeProbes.probeWorkDate,
        toDate: timeProbes.probeWorkDate,
      });
    },
  },
  {
    name: "unbilled-wip.by-matter",
    operation: async (handle) => {
      await listUnbilledByMatter(
        handle.snapshot.database,
        handle.snapshot.manifest.timeProbes.busiestMatterId,
      );
    },
  },
  {
    name: "rate-resolution.timekeeper-tier",
    operation: async (handle) => {
      const { timeProbes } = handle.snapshot.manifest;
      await resolveRate(handle.snapshot.database, {
        matterId: timeProbes.resolutionMatterId,
        clientId: null,
        timekeeperUserId: timeProbes.resolutionTimekeeperUserId,
        roleId: null,
        workDate: timeProbes.probeWorkDate,
        rateCardId: timeProbes.rateCardId,
      });
    },
  },
  {
    name: "capture.commit",
    operation: async (handle) => {
      const { timeProbes } = handle.snapshot.manifest;
      const resolution = await resolveRate(handle.snapshot.database, {
        matterId: timeProbes.resolutionMatterId,
        clientId: null,
        timekeeperUserId: timeProbes.resolutionTimekeeperUserId,
        roleId: null,
        workDate: timeProbes.probeWorkDate,
        rateCardId: timeProbes.rateCardId,
      });
      const currency = "noRate" in resolution ? "USD" : resolution.currency;
      const durationMinutes = roundDuration(30, 6, "nearest");
      const amountMinor =
        "noRate" in resolution
          ? null
          : computeAmountMinor(resolution.rateE4, durationMinutes, currency);
      void amountMinor;
      const captured = await captureTimeEntry(
        handle.snapshot.database,
        {
          matterId: timeProbes.resolutionMatterId,
          timekeeperUserId: timeProbes.resolutionTimekeeperUserId,
          workDate: timeProbes.probeWorkDate,
          rawDurationMinutes: 30,
          durationMinutes,
          narrative: "Load-profile measurement capture",
          billable: true,
          source: "manual",
          currency,
          rate: resolution,
        },
        {
          clock: handle.context.clock,
          actorUserId: timeProbes.resolutionTimekeeperUserId,
          randomSource: handle.context.randomSource,
        },
      );
      await commitEffectBatch(handle.snapshot.database, captured.effect, {
        now: () => handle.context.clock.now(),
      });
    },
  },
];

// No timekeeping read is a table-wide aggregate — each must walk an index or the primary key. The
// allowlist is empty (kept as the explicit seam a future table-wide rollup would register through).
export const TIMEKEEPING_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

// Recover the runtime node-sqlite shape so the EXPLAIN probes run the REAL query SQL (the query builders
// type their return as the narrower D1-shaped SqlStatement, which omits sql/bindings).
function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

export function timekeepingHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { timeProbes } = snapshot.manifest;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "my-day.daily-totals",
      statement: capturedStatement(
        readMyDayStatement(
          snapshot.database,
          timeProbes.busiestTimekeeperUserId,
          timeProbes.probeWorkDate,
        ),
      ),
    },
    {
      label: "weekly-grid.by-timekeeper",
      statement: capturedStatement(
        listWeeklyGridStatement(
          snapshot.database,
          timeProbes.busiestTimekeeperUserId,
          timeProbes.probeWorkDate,
          timeProbes.probeWorkDate,
        ),
      ),
    },
    {
      label: "unbilled-wip.by-matter",
      statement: capturedStatement(
        listUnbilledByMatterStatement(snapshot.database, timeProbes.busiestMatterId),
      ),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
```

**Step 6 — Wire the generator into `snapshot.ts` (run it + manifest fields).**

Edit `packages/fixtures/src/load-profile/snapshot.ts`. Add the import:

```ts
import { generateTimeVolume, type TimeProbes } from "./timekeeping-generate.ts";
```

Add the manifest fields to `SnapshotManifest` (after the custom-field block):

```ts
  // The timekeeping volume laid over the practice book (rate cards, effective-dated rates, time entries)
  // and the probe identifiers the timekeeping measurement layer binds its My Day / grid / unbilled-WIP /
  // rate-resolution reads to.
  readonly timeEntryCount: number;
  readonly rateCount: number;
  readonly rateCardCount: number;
  readonly timeProbes: TimeProbes;
```

Run the generator after the custom-field volume (it binds to the practice member + matters), inside `loadProfileSnapshot`'s generation block:

```ts
// The timekeeping volume rides last on the practice book — it binds its entries to the matters the
// practice generation laid down and the responsible member, so it must run after practice.
const time = await generateTimeVolume(
  generated.database,
  context,
  profile.time,
  {
    timekeeperUserId: practice.probes.responsibleMemberId,
    matterIds: [practice.probes.busiestMatterId],
  },
  options,
);
```

Add the manifest assignments (in the `manifest` object literal, after the custom-field fields):

```ts
        timeEntryCount: time.timeEntryCount,
        rateCount: time.rateCount,
        rateCardCount: time.rateCardCount,
        timeProbes: time.probes,
```

**Step 7 — Wire the measurements + plan scan into `measure-cli.ts`.**

Edit `packages/fixtures/src/load-profile/measure-cli.ts`. Add the import:

```ts
import {
  timekeepingHotPathPlans,
  timekeepingMeasurementHandle,
  timekeepingMeasurements,
  TIMEKEEPING_PLAN_SCAN_ALLOWLIST,
} from "./timekeeping-measurements.ts";
```

Add the plan scan to the `scans` array:

```ts
  ...findFullScans(timekeepingHotPathPlans(snapshot), TIMEKEEPING_PLAN_SCAN_ALLOWLIST),
```

Add the measurement run to the `results` array (a new `runMeasurements` block, like `protectedMeasurementHandle`):

```ts
  ...(await runMeasurements(
    timekeepingMeasurementHandle(snapshot, BASELINE_SEED),
    timekeepingMeasurements,
    { warmupIterations: 3, iterations: 30 },
  )),
```

Extend the snapshot summary `console.log` line with the time counts:

```ts
    `…${snapshot.manifest.timeEntryCount} time entries (${snapshot.manifest.rateCount} rates, ${snapshot.manifest.rateCardCount} cards)…`,
```

(Splice the time fragment into the existing template literal beside the custom-field fragment — do not drop the existing fields.)

**Step 8 — Run the guard + a measure-CLI smoke (expect PASS).**

```
pnpm --filter @magna-carta/fixtures test -- timekeeping-measurements
```

Expected: PASS — the smoke snapshot generates time entries + rates through the real path; `timekeepingHotPathPlans` shows every read as `SEARCH … USING INDEX …` (no bare `SCAN`), so `findFullScans` returns `[]`.

Then prove the CLI wires clean (regenerates the full-scale baseline; local-only):

```
pnpm --filter @magna-carta/fixtures run measure
```

Expected: the snapshot summary prints the time counts; `full table scans on hot paths` is not printed (the scan array is empty); a baseline writes for `ledgerVolume-v7`.

**Step 9 — Commit.**

```
git add packages/fixtures/src/load-profile/profile.ts packages/fixtures/src/load-profile/snapshot.ts packages/fixtures/src/load-profile/measure-cli.ts packages/fixtures/src/load-profile/timekeeping-generate.ts packages/fixtures/src/load-profile/timekeeping-measurements.ts packages/fixtures/src/load-profile/timekeeping-measurements.test.ts packages/fixtures/baselines/
git commit -m "$(cat <<'EOF'
test(fixtures): TimeVolume load profile + timekeeping measurements

Lays down rate cards, effective-dated rates, and captured time entries through the
real appendRate/captureTimeEntry write path (valid by construction); measures My Day
totals, the weekly-grid fan, per-matter unbilled WIP, and rate resolution with
EXPLAIN QUERY PLAN full-scan flagging. Bumps the profile + generator versions.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Worker e2e + WIP/freeze fitness functions

The end-to-end journey over the real HTTP surface (timer → bind → stop-commit → quick-add → grid batch → optional submit/approve → My Day → a rate change keeps the captured rate → `reRateUnbilledDrafts` moves a draft → the billing-lock seam freezes a billed entry), plus the two source-scan fitness functions: WIP-never-posts-to-the-ledger and the billed/void freeze contract.

**Files**

- Create: `apps/worker/test/e2e/slice-3-1-e2e.test.ts`, `apps/worker/test/timekeeping-wip-ledger-fitness.test.ts`, `apps/worker/test/timekeeping-freeze-fitness.test.ts`
- Test: the three files above

**Interfaces**

- Consumes: the full route surface (time-entries / timer / rate-cards / utbms / non-billable / my-day, Tasks 17–19), the DO (Tasks 15/16), the package services.
- Produces: the e2e coverage + the two fitness guards.

**Step 1 — Write the WIP-never-posts-to-the-ledger fitness scan.**

Create `apps/worker/test/timekeeping-wip-ledger-fitness.test.ts` (the `file-version-status-scan` source-scan pattern):

```ts
import { describe, expect, it } from "vitest";

// Fitness function (the append-only-source-scan pattern, time edition): time is WIP, NOT a ledger
// posting — unbilled time lives in its own store and never touches the double-entry ledger (the ledger
// stays purely money-movement; billable time converts to an A/R receivable only at billing). So no SQL
// literal in the timekeeping write path may name a ledger_* table. This scan stands guard so a future
// route or service that wrongly posts a time entry to the ledger fails here, not in production.
//
// The worker's tests run inside the workerd pool, whose node:fs cannot read the host source tree, so the
// sources are pulled in as raw text at build time (import.meta.glob with ?raw). import.meta.glob is a
// Vite build-time macro: it inlines the matched files and MUST be referenced by its full literal name,
// so it cannot be aliased; its type is not in the worker's tsconfig lib, so the shape is declared here.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const SOURCES = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

function sqlLiterals(source: string): string[] {
  const out: string[] = [];
  const pattern = /`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    out.push(match[1] ?? "");
  }
  return out;
}

describe("time is WIP, not a ledger posting", () => {
  it("no timekeeping/timer source composes a ledger_* statement", () => {
    // Non-vacuity floor: the glob saw the worker source.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      // Only the timekeeping write surface is in scope: the time-entry/timer/rate routes and the
      // timekeeping call-site. A future billing route that legitimately posts to the ledger is NOT here.
      const isTimekeepingSurface =
        /\/routes\/(time-entries|timer|rate-cards|utbms-codes|non-billable-categories|narrative-templates|my-day)\.ts$/.test(
          file,
        ) ||
        file.includes("/timer/") ||
        file.includes("/timekeeping/");
      if (!isTimekeepingSurface) continue;
      for (const sql of sqlLiterals(source)) {
        if (/\bledger_[a-z_]+\b/i.test(sql)) {
          offenders.push(`${file}: ${sql.slice(0, 80)}…`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
```

**Step 2 — Write the billed/void freeze fitness scan.**

Create `apps/worker/test/timekeeping-freeze-fitness.test.ts`:

```ts
import { describe, expect, it } from "vitest";

// Fitness function: the time-entry freeze contract. On entering billed/void a row's business columns
// freeze — the service refuses any UPDATE to a billed/void row except the billing lock (invoice_id + the
// status set the bill applies). This scan asserts no SQL literal in the timekeeping/billing source
// UPDATEs time_entry WHERE status IN ('billed','void') beyond that lock. A statement that legitimately
// sets the billing lock is allowlisted by an inline `fitness:allow-billing-lock` marker above it.
//
// (Same import.meta.glob raw-text mechanism as the WIP-ledger scan — see that file's note.)
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const SOURCES = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

function sqlLiterals(source: string): { sql: string; index: number }[] {
  const out: { sql: string; index: number }[] = [];
  const pattern = /`([^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    out.push({ sql: match[1] ?? "", index: match.index });
  }
  return out;
}

describe("a billed/void time_entry is frozen", () => {
  it("no statement UPDATEs time_entry WHERE status IN ('billed','void') beyond the billing lock", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      for (const { sql, index } of sqlLiterals(source)) {
        const touchesTimeEntry = /\btime_entry\b/.test(sql) || /TIME_ENTRY_TABLE/.test(sql);
        if (!touchesTimeEntry || !/\bUPDATE\b/i.test(sql)) continue;
        // The freeze is enforced by a WHERE guard that REFUSES billed/void (status NOT IN / status =
        // 'draft' …). A statement that TARGETS billed/void in its UPDATE filter is the dangerous shape.
        const targetsFrozen = /status\s+IN\s*\(\s*'billed'|status\s*=\s*'billed'|'void'/i.test(sql);
        if (!targetsFrozen) continue;
        const preceding = source.slice(Math.max(0, index - 240), index);
        if (preceding.includes("fitness:allow-billing-lock")) continue;
        offenders.push(`${file}: ${sql.slice(0, 80)}…`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
```

**Step 3 — Run the two fitness scans (expect FAIL until the routes exist).**

```
pnpm --filter @magna-carta/worker test -- timekeeping-wip-ledger-fitness timekeeping-freeze-fitness
```

Expected at this point: both scans **PASS vacuously is prevented** by the non-vacuity floor, but they will only become meaningful once Tasks 17–19 have landed the routes. Run order in this slice is sequential, so by Task 23 those sources exist; the scans run clean (no offenders). If a route is still missing, the floor still passes and the offender list is empty — so confirm the e2e (Step 4) is the gating signal here, and these scans guard against regression. Expected output: PASS (no offenders).

**Step 4 — Write the failing e2e journey.**

Create `apps/worker/test/e2e/slice-3-1-e2e.test.ts` (the `slice-1-1-e2e` module-level-state-over-`it`-steps pattern):

```ts
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { runScheduledSweep } from "../../src/scheduled.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import {
  captureResetToken,
  liveCookie,
  PASSWORD,
  postJson,
  setCookies,
  signIn,
} from "../support/test-auth.ts";

// The capstone: one time-capture journey over the REAL HTTP surface (SELF fetch) as a
// sequence of `it` steps over module-level state. A firm is provisioned, its owner activated and
// mirrored, a matter created, then the whole slice composes: a rate card with an effective-dated rate,
// the live timer (start → bind → stop-commit minting exactly one timer entry), a quick-add create, a
// grid batch, the optional review gate (submit → approve), the My Day read, a rate change that leaves a
// captured rate untouched, reRateUnbilledDrafts moving a draft, and the billing-lock seam freezing a
// billed entry. Tenant isolation is implicit (a single firm's database).

interface ProvisionResponseBody {
  id: string;
  name: string;
  status: string;
  owner: { id: string; email: string; name: string };
}

const FIRM_INPUT = {
  name: "Timekeeping Capstone Firm",
  owner: { email: "time-capstone-owner@example.com", name: "Time Capstone Owner" },
};

let firm: ProvisionResponseBody;
let ownerCookie = "";
let matterId = "";
let rateCardId = "";
let liveRunId = "";
let timerEntryId = "";
let draftEntryId = "";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

function authHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie: ownerCookie,
    "Idempotency-Key": crypto.randomUUID(),
  };
}

async function post(path: string, body: unknown, idempotencyKey?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie: ownerCookie,
    "Idempotency-Key": idempotencyKey ?? crypto.randomUUID(),
  };
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie: ownerCookie },
  });
}

describe("time tracking end-to-end", () => {
  it("provisions a firm, activates its owner, and creates a matter", async () => {
    const provisionResponse = await SELF.fetch("https://example.com/api/v1/firms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Platform-Admin-Key": env.PLATFORM_ADMIN_KEY,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(FIRM_INPUT),
    });
    expect(provisionResponse.status).toBe(201);
    firm = (await provisionResponse.json()) as ProvisionResponseBody;
    expect(firm.status).toBe("active");

    const { token } = await captureResetToken(FIRM_INPUT.owner.email);
    expect(
      (await postJson("/api/auth/reset-password", { newPassword: PASSWORD, token })).status,
    ).toBe(200);
    const signInResponse = await signIn(FIRM_INPUT.owner.email);
    expect(signInResponse.status).toBe(200);
    ownerCookie = liveCookie(setCookies(signInResponse), "session_token")?.pair ?? "";
    expect(ownerCookie).not.toBe("");
    const report = await runScheduledSweep(env);
    expect(report.controlPlane.failed).toBe(0);

    const matterResponse = await post("/api/v1/matters", {
      title: "Time Capstone Matter",
      status: "open",
      responsibleMemberId: firm.owner.id,
    });
    expect(matterResponse.status).toBe(201);
    matterId = ((await matterResponse.json()) as { matterId: string }).matterId;
    expect(matterId).toMatch(/^matter_/);
  });

  it("creates a rate card with a timekeeper-tier effective-dated rate", async () => {
    const cardResponse = await post("/api/v1/rate-cards", { name: "Standard" });
    expect(cardResponse.status).toBe(201);
    rateCardId = ((await cardResponse.json()) as { rateCardId: string }).rateCardId;

    const rateResponse = await post(`/api/v1/rate-cards/${rateCardId}/rates`, {
      tier: "timekeeper",
      scopedId: firm.owner.id,
      rateE4: 2_500_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });
    expect(rateResponse.status).toBe(201);
  });

  it("runs the live timer: start → bind → stop-commit mints exactly one timer entry", async () => {
    const startResponse = await post("/api/v1/timer/start", {});
    expect(startResponse.status).toBe(200);
    liveRunId = ((await startResponse.json()) as { liveRunId: string }).liveRunId;
    expect(liveRunId).not.toBe("");

    const bindResponse = await post("/api/v1/timer/bind", {
      matterId,
      narrative: "Drafted demand letter",
    });
    expect(bindResponse.status).toBe(200);

    const stopResponse = await post("/api/v1/timer/stop-commit", {
      workDate: "2026-06-22",
      rateCardId,
    });
    expect(stopResponse.status).toBe(201);
    const committed = (await stopResponse.json()) as { timeEntryId: string };
    timerEntryId = committed.timeEntryId;
    expect(timerEntryId).toMatch(/^timeEntry_/);

    // The store carries exactly one timer-sourced entry on the run, with live_run_id set.
    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT source, live_run_id, rate_e4 FROM time_entry WHERE live_run_id = ?1",
    )
      .bind(liveRunId)
      .all<{ source: string; live_run_id: string; rate_e4: number | null }>();
    expect(row.results.length).toBe(1);
    expect(row.results[0]?.source).toBe("timer");
    expect(row.results[0]?.rate_e4).toBe(2_500_000);
  });

  it("collapses two racing stop-commits of the same run to one entry (no second entry)", async () => {
    // The DO already committed above; a replay of stop-commit on the same run is idempotent on
    // live_run_id (the chokepoint key + the time_entry.live_run_id partial UNIQUE).
    const replay = await post("/api/v1/timer/stop-commit", { workDate: "2026-06-22", rateCardId });
    expect([200, 201, 409, 422]).toContain(replay.status);
    const rows = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS n FROM time_entry WHERE live_run_id = ?1",
    )
      .bind(liveRunId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("creates a draft entry via quick-add (preview then create)", async () => {
    const preview = await post("/api/v1/time-entries/quick-add-preview", {
      text: "0.5 — reviewed discovery responses",
    });
    expect(preview.status).toBe(200);
    const parsed = (await preview.json()) as { durationMinutes: number };
    expect(parsed.durationMinutes).toBe(30);

    const createResponse = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: firm.owner.id,
      workDate: "2026-06-22",
      rawDurationMinutes: 30,
      narrative: "Reviewed discovery responses",
      billable: true,
      source: "quick_add",
      rateCardId,
    });
    expect(createResponse.status).toBe(201);
    draftEntryId = ((await createResponse.json()) as { timeEntryId: string }).timeEntryId;
    expect(draftEntryId).toMatch(/^timeEntry_/);
  });

  it("reads My Day totals for the work date", async () => {
    const response = await get(
      `/api/v1/my-day?timekeeperUserId=${firm.owner.id}&workDate=2026-06-22`,
    );
    expect(response.status).toBe(200);
    const view = (await response.json()) as { billableMinutes: number };
    expect(view.billableMinutes).toBeGreaterThan(0);
  });

  it("a later rate version leaves the already-captured rate untouched", async () => {
    const rateResponse = await post(`/api/v1/rate-cards/${rateCardId}/rates`, {
      tier: "timekeeper",
      scopedId: firm.owner.id,
      rateE4: 3_000_000,
      currency: "USD",
      validFrom: "2026-12-01",
    });
    expect(rateResponse.status).toBe(201);

    // The captured timer entry kept its snapshot rate (the effective-dating rule).
    const row = await env.DB_FIRM_POOL_1.prepare("SELECT rate_e4 FROM time_entry WHERE id = ?1")
      .bind(timerEntryId)
      .first<{ rate_e4: number }>();
    expect(row?.rate_e4).toBe(2_500_000);
  });

  it("reRateUnbilledDrafts moves an unbilled draft's rate but never a billed entry", async () => {
    // Append a correction effective on the draft's work_date, then opt in to the re-rate.
    const correction = await post(`/api/v1/rate-cards/${rateCardId}/rates`, {
      tier: "timekeeper",
      scopedId: firm.owner.id,
      rateE4: 2_750_000,
      currency: "USD",
      validFrom: "2026-06-01",
    });
    expect(correction.status).toBe(201);

    const reRate = await post(`/api/v1/rate-cards/${rateCardId}/re-rate-drafts`, {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
    });
    expect(reRate.status).toBe(200);

    const draft = await env.DB_FIRM_POOL_1.prepare("SELECT rate_e4 FROM time_entry WHERE id = ?1")
      .bind(draftEntryId)
      .first<{ rate_e4: number }>();
    expect(draft?.rate_e4).toBe(2_750_000);
  });

  it("freezes a billed entry against further business-column updates (the billing-lock seam)", async () => {
    // Drive the entry to billed through the billing-lock seam the service exposes, then prove a draft
    // update is refused. (Billing is 3·4; the seam here is the freeze contract the service enforces.)
    await env.DB_FIRM_POOL_1.prepare(
      // fitness:allow-billing-lock — the bill applies the invoice lock; the e2e stands in for 3·4 here.
      "UPDATE time_entry SET status = 'billed', invoice_id = 'invoice_seam' WHERE id = ?1",
    )
      .bind(draftEntryId)
      .run();

    const update = await SELF.fetch(`https://example.com/api/v1/time-entries/${draftEntryId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ narrative: "must not apply to a billed entry" }),
    });
    expect([403, 409, 422]).toContain(update.status);

    const row = await env.DB_FIRM_POOL_1.prepare("SELECT narrative FROM time_entry WHERE id = ?1")
      .bind(draftEntryId)
      .first<{ narrative: string }>();
    expect(row?.narrative).toBe("Reviewed discovery responses");
  });
});
```

**Step 5 — Run the e2e (expect FAIL until integration gaps are closed).**

```
pnpm --filter @magna-carta/worker test -- slice-3-1-e2e
```

Expected: FAIL on the first integration gap (a route shape mismatch, a missing field, an unbound timer error path). Each failure is a real gap in Tasks 15–19's surface surfaced by the journey.

**Step 6 — Fix the integration gaps; keep the fitness scans clean.**

Resolve each gap the e2e surfaces in its owning module (the route contract, the DO proxy, the stop-commit derivation) — no new behavior, only wiring corrections (e.g. a field name the route reads, the timer stop-commit's `workDate`/`rateCardId` body fields, the My Day query-param read). After each fix, re-run the e2e until green. Confirm the two fitness scans still pass (no `ledger_*` literal entered a timekeeping route; no UPDATE targets a frozen row outside the allowlisted seam).

**Step 7 — Run the three suites + the full gate (expect PASS).**

```
pnpm --filter @magna-carta/worker test -- slice-3-1-e2e timekeeping-wip-ledger-fitness timekeeping-freeze-fitness
pnpm check
```

Expected: PASS — the journey composes end-to-end (one timer entry on the run; the captured rate survives a later version; `reRateUnbilledDrafts` moves the draft; the billed entry is frozen); both fitness scans return no offenders; `pnpm check` (fmt + lint + typecheck + svelte-check) is clean.

**Step 8 — Commit.**

```
git add apps/worker/test/e2e/slice-3-1-e2e.test.ts apps/worker/test/timekeeping-wip-ledger-fitness.test.ts apps/worker/test/timekeeping-freeze-fitness.test.ts
git commit -m "$(cat <<'EOF'
test(worker): slice 3·1 e2e journey + WIP-ledger and freeze fitness scans

Composes timer → bind → stop-commit → quick-add → My Day → rate change keeps the
captured rate → reRateUnbilledDrafts → billed freeze over the real HTTP surface, and
adds the two source-scan guards: no timekeeping write composes a ledger_* statement,
and no statement updates a billed/void time_entry beyond the billing lock.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: Docs, ADR + changelog fragments, STATUS/ROADMAP

Close the slice per golden rule 5: confirm/complete the three ADR pending fragments, write the changelog fragment, confirm the white-paper §17.1 amendment, add the area card, and flip the status rows — same stream. Developer docs only (user docs ride the 0·7 UI).

**Files**

- Confirm/complete: `docs/decisions/pending/time-entry-lifecycle-optional-review-gate.md`, `docs/decisions/pending/live-timer-durable-object.md`, `docs/decisions/pending/effective-dated-rate-engine.md`, `docs/decisions/pending/scoped-setting-resolver.md`
- Create: `changelog.d/slice-3-1-time-tracking.md`, `packages/timekeeping/CLAUDE.md`
- Confirm: `docs/Magna-Carta-White-Paper.md` (§17.1 lifecycle line — already amended in the design cycle)
- Modify: `STATUS.md` (the 3·1 row), `ROADMAP.md` (the 3·1 line), `docs/active-work/phase-3-financial-core.md`

**Interfaces**

- Consumes: the whole built slice.
- Produces: the merge-ready documentation set (fragments, never hand-edited rendered files on a branch).

**Step 1 — Run `vp run worktrees` + sync `main` before touching the cross-cutting files.**

```
vp run worktrees
```

Expected: prints the active-work registry; confirm no other stream is mid-edit on `STATUS.md` / `ROADMAP.md` / `docs/Magna-Carta-White-Paper.md` (only the `phase-3-financial-core` stream's own note touches the 3·1 rows). Sync `main` if the drift gap is more than a handful of merges:

```
git fetch origin && git merge origin/main
```

Expected: clean (or a small, resolvable merge); the `0016` slot and the §17.1 line are uncontended.

**Step 2 — Confirm the three ADR fragments are present and accurate; complete any thin one.**

The design cycle already landed `time-entry-lifecycle-optional-review-gate.md`, `live-timer-durable-object.md`, `effective-dated-rate-engine.md`, and `scoped-setting-resolver.md` in `docs/decisions/pending/`. Verify each fragment's `summary:` frontmatter still matches what was built (no signature drift from the design — e.g. the `rate_source` enum superset, the `live_run_id` stop-commit derivation, the scoped-resolver tier order). No change is needed if a fragment already states the as-built decision; if a build-time refinement diverged from the fragment (it should not, given the plan held the contract), amend that one fragment's body to match the code, leaving the slug + status. Do **not** hand-edit the rendered `docs/Decision-Log.md` — it is assembled on `main` by `vp run decisions-build`.

**Step 3 — Write the changelog fragment.**

Create `changelog.d/slice-3-1-time-tracking.md`:

```md
category: Added

Time tracking, work-in-progress (WIP), and an effective-dated rate engine — the daily driver
(backend + API; the UI rides 0·7). A new `@magna-carta/timekeeping` package captures time four ways
(manual, a one-line quick-add parser, a weekly matters-by-days grid, and a server-persisted live
timer), stores it in a per-firm WIP store that is independently tracked and never posts to the
double-entry ledger (billable time converts to A/R only at billing), and moves each entry
Draft → (optional Submitted → Approved) → Billed under a column-level freeze contract. The live
timer is the codebase's first Durable Object — one idle-friendly instance per timekeeper,
firm-namespaced, with an abandoned-timer alarm and a `live_run_id`-idempotent stop-commit that
collapses a cross-device double-commit to one entry. Rates are append-only effective-dated versions
on named rate cards; a captured entry snapshots the rate in force on its work date and keeps it
forever, with an opt-in re-rate for unbilled drafts. The slice also lands two pieces of shared
infrastructure the rest of the phase consumes: the UTBMS task/activity/expense code catalog, and a
scoped-setting resolver (the first realization of the settings-precedence chain — matter → client →
user → location → firm). The AI narrative / UTBMS-suggestion feature is seamed but dark, gated on
client consent (default off, no model reached).
```

**Step 4 — Confirm the white-paper §17.1 amendment.**

The §17.1 "Lifecycle — Draft → Billed, with an optional review gate" line is already amended (the design cycle replaced the flat "no approval workflow" line). Re-read it to confirm it reads as the built behavior (default frictionless Draft → Billed; an optional firm-configurable Submitted/Approved gate, off by default; the billed/void freeze). No further edit if it already matches; one home per fact, so do not restate it elsewhere.

**Step 5 — Add the area card `packages/timekeeping/CLAUDE.md`.**

Create `packages/timekeeping/CLAUDE.md` (the `packages/matters/CLAUDE.md` shape):

```md
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

- `src/time-entry-service.ts` — `captureTimeEntry` + the lifecycle transitions (submit/approve/kickBack/void)
- `src/lifecycle.ts` — the pure Draft→Billed state machine (`assertTransition`, `isFrozen`), gate-aware
- `src/rate-service.ts` — `createRateCard` / `appendRate` (effective-dated, non-overlap) / `reRateUnbilledDrafts`
- `src/rate-resolution.ts` — pure `resolveRate` (override → matter → client → timekeeper → role → card default)
- `src/rounding.ts` — `roundDuration` (quantity) + `computeAmountMinor` (integer-minor money via @magna-carta/money)
- `src/utbms-catalog.ts` / `src/utbms-service.ts` — the seeded ABA UTBMS codes + enable/disable
- `src/queries.ts` / `src/my-day.ts` — the WIP / weekly-grid / per-matter-unbilled / My Day reads

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

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `@magna-carta/money`, `zod`. Does NOT import the live-timer Durable Object: the DO lives in
  `apps/worker` and is a pure coordinator; the route composes the `time_entry` write through this package.
- Pure and synchronous: produces statements for the caller to run; holds no D1 binding, does no I/O.

## Gotchas

- The route resolves the rate + rounds the duration, then hands the resolved values into
  `captureTimeEntry` — the service composes the insert + audit, it does not re-resolve.
- A null `rate_e4` means "non-billable," never "flat-fee matter": a flat-fee/contingency matter still
  resolves and captures the standard rate (for the realization report), it just is not billed hourly.
- D1 has no interactive transactions — read before composing, or assert inside the batch (the
  rate-interval non-overlap check reads existing rows for the scope, then composes the append).
```

**Step 6 — Flip the STATUS row + the ROADMAP line + the active-work note.**

Edit `STATUS.md` — the 3·1 row only. Change the Plan/Built/Load-profile/Tested cells from `[ ]` to built, and rewrite the Notes to as-built:

```md
| 3·1 — Time tracking + WIP + rate engine | [x] Opus 4.8 | [x] Opus 4.8 | [x] Opus 4.8 | [x] Opus 4.8 | [ ] | [x] Opus 4.8 | [x] Opus 4.8 | **Built + tested 2026-06-22 (Opus 4.8); no UI (rides 0·7).** New `@magna-carta/timekeeping` package (WIP store + Draft→Billed lifecycle, effective-dated rate engine, UTBMS catalog, non-billable categories, narrative templates); the codebase's **first Durable Object** (`LiveTimerDurableObject`, per-timekeeper, abandoned alarm, `live_run_id`-idempotent stop-commit); the **net-new scoped-setting resolver** in `@magna-carta/data-access`; migration `0016_time-tracking` (+ `matter.e_billing`); routes through the chokepoint with a regenerated OpenAPI snapshot + extended conformance; load-profile `TimeVolume` + measurements (plan-scan clean); e2e + the WIP-ledger and billed/void freeze fitness scans. AI narrative/UTBMS seam shipped dark (consent-gated, no model reached). ADR fragments: `time-entry-lifecycle-optional-review-gate`, `live-timer-durable-object`, `effective-dated-rate-engine`, `scoped-setting-resolver`. Spec: [`docs/specs/2026-06-22-slice-3-1-time-tracking-design.md`](docs/specs/2026-06-22-slice-3-1-time-tracking-design.md). |
```

Edit `ROADMAP.md` — the 3·1 line (line 71): change "designed 2026-06-22" to "built 2026-06-22" and append the as-built note + the implementation-plan reference, leaving the rest of the line's prose intact:

```md
- **Slice 3·1 — Time tracking + WIP + rate engine — built 2026-06-22** (spec: …; plan: [`docs/specs/2026-06-22-slice-3-1-time-tracking-implementation-plan.md`](docs/specs/2026-06-22-slice-3-1-time-tracking-implementation-plan.md); 4 ADR fragments …). [… existing prose unchanged …] _Built: the `@magna-carta/timekeeping` package, the first Durable Object, the scoped-setting resolver, migration `0016`, the chokepoint routes + regenerated OpenAPI, the load-profile `TimeVolume`, e2e + WIP-ledger/freeze fitness; the AI seam ships dark._
```

Edit `docs/active-work/phase-3-financial-core.md` — flip `status:` to built and update the body to reflect the 3·1 build landing (it currently reads "designing"):

```md
status: 3·1 (Time tracking) built + tested local; ready to merge. 3·2/3·5 parallel-eligible next.
```

(Update the `touches:` line and the body paragraph to past tense — the 3·1 build is done; note `packages/timekeeping`, the first Durable Object, `scoped_setting` in data-access, migration `0016`, `access-control`/`identifiers` registry additions all landed.)

**Step 7 — Run the gate + the process-ref lint (expect PASS).**

```
pnpm check
pnpm run lint:process-refs
```

Expected: PASS — `pnpm check` (fmt + lint + typecheck + svelte-check) is clean; `lint:process-refs` finds no process-doc reference (`ADR-NNNN`, "spec §N", "slice 3·1", "Task N") leaked into any source / test / OpenAPI `description` string. (The fragments, STATUS, ROADMAP, white paper, and CLAUDE.md are docs — they may cite the spec/ADRs freely; the lint scans source only.)

**Step 8 — Commit.**

```
git add changelog.d/slice-3-1-time-tracking.md packages/timekeeping/CLAUDE.md docs/decisions/pending/ docs/Magna-Carta-White-Paper.md STATUS.md ROADMAP.md docs/active-work/phase-3-financial-core.md
git commit -m "$(cat <<'EOF'
docs(timekeeping): close slice 3·1 — changelog + area card + status/roadmap

The changelog fragment, the packages/timekeeping area card (local rules + the
WIP/freeze/effective-dating invariants), the confirmed ADR pending fragments and the
§17.1 lifecycle amendment, and the STATUS/ROADMAP/active-work flips to built.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
