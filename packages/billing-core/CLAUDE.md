# @magna-carta/billing-core — CLAUDE.md

**Purpose.** The shared billable work-in-progress (WIP) lifecycle + the firm review-gate definition,
extracted out of `@magna-carta/timekeeping` so time entries and costs (and 3·4 billing) run on ONE
state machine and ONE freeze contract instead of drifting copies. Pure and dependency-light: a five-
state enum, the gate-keyed transition tables, the freeze predicate, the illegal-transition error, and
a single firm-setting definition. No I/O, no clock, no database.

**Spec:**
[`docs/specs/2026-06-23-slice-3-3-costs-expenses-design.md`](../../docs/specs/2026-06-23-slice-3-3-costs-expenses-design.md).

## Key files / entry points

- `src/lifecycle.ts` — `BillableStatus` (`draft|submitted|approved|billed|void`) + the gate-keyed
  transition tables + `canTransition` / `assertTransition` / `isFrozen` (the pure state machine).
- `src/lifecycle-error.ts` — `IllegalTransitionError` (carries `from`/`to`/`gateOn`); each consumer
  maps it to its own domain error at the HTTP 409 boundary.
- `src/review-gate.ts` — `approvalRequiredDefinition`, the `billing.approval_required` firm setting
  (default off), namespaced `billing.*` so it is shared across time and costs.
- `src/index.ts` — re-exports the three modules.

## Invariants that apply here

- **Frozen = `billed` or `void`.** `isFrozen` is the single source of truth; nothing leaves a frozen
  state, and `void` is reachable from any non-frozen state under either gate. In-flight `submitted`/
  `approved` rows drain to `billed` when the gate is turned off (so a firm that disables the gate
  never strands work).
- **Transitions only via `assertTransition` / `canTransition`.** Consumers never hand-roll the legal
  moves; they call into this package so the rules stay in one place.
- **The review gate is default OFF.** `billing.approval_required` defaults to `false` — the
  frictionless `draft → billed` path holds unless a firm opts in.

## Dependencies & contracts

- Depends only on `@magna-carta/data-access` (for the `FirmSettingDefinition` type) and `zod`. Holds
  no D1 binding, reads no clock, does no I/O — a pure leaf.

## Gotchas

- **It is consumed by BOTH `@magna-carta/timekeeping` and `@magna-carta/costs` (and 3·4 billing will
  join).** A change to the lifecycle, the transition tables, or the review-gate default RIPPLES to
  both domains — re-run both the time-entry and cost-entry lifecycle/freeze suites after any edit
  here, never just one.
- **Timekeeping re-exports `BillableStatus` as `TimeEntryStatus`.** `packages/timekeeping/src/lifecycle.ts`
  is a thin re-export aliasing the type; do not reintroduce a second lifecycle in timekeeping — the
  alias exists precisely so the rest of the time package compiles unchanged against the shared enum.
- The error this package throws is generic (`IllegalTransitionError`); each consumer catches it and
  rethrows its own domain error (timekeeping and costs each present their own 409 vocabulary). Do not
  leak `IllegalTransitionError` to an HTTP boundary directly.
