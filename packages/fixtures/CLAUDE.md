# @magna-carta/fixtures — CLAUDE.md

**Purpose.** The deterministic synthetic-data harness (ADR-0034, ADR-0072). Factories call REAL
domain write paths — `createAccount` / `postEntry` / `reverseEntry` — never raw inserts; data is
valid by construction and scenarios double as integration tests.

**White paper:** _Synthetic data & fixtures (test & demo seeding)_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:**
[`docs/specs/2026-06-09-ledger-core-and-fixtures-design.md`](../../docs/specs/2026-06-09-ledger-core-and-fixtures-design.md).

## Key files / entry points

- `src/context.ts` — one seed → faker + fixed clock + seeded identifiers
- `src/local-database.ts` — in-memory per-firm database at current schema
- `src/guard.ts` — production seeding guard
- `src/demo-chart-of-accounts.ts` — the demo chart of accounts
- `src/factories.ts` — entity factories over the real write paths
- `src/scenarios.ts` — composed multi-step scenarios
- `src/demo-firm.ts` — the full demo-firm seed

## Invariants that apply here

- **One seed carries all determinism.** Seeded faker + the fixed clock + `seededRandomSource` —
  nothing else may produce randomness or read wall-clock time. Same seed → byte-identical rows
  (outbox `id` excepted — minted unseeded inside data-access; documented seam).
- **Real write paths only.** A raw business-table INSERT in this package is a bug. (Direct SQL is
  allowed only to corrupt state on purpose in tests, or via `setAccountBoundsStatement` — the
  Phase-3 seam primitive.)
- **Never in production.** Every seeding entry point goes through `guard.ts`; this package is never
  imported by production worker code (boundary rule, ADR-0070).
- **Demo data is demo data.** The demo chart of accounts is explicitly NOT the Phase-3 product
  chart-of-accounts template.

## Dependencies & contracts

- Depends on: `@magna-carta/ledger` (the write paths), `@magna-carta/data-access`
  (`commitEffectBatch`), `@magna-carta/database` (node-sqlite local adapter + migrations),
  `@magna-carta/identifiers` (seeded source), `@magna-carta/money`.
- Node-only modules (`local-database`) never ship to Workers.

## Gotchas

- node:sqlite is experimental on Node — warning noise is expected.
- The fixed clock advances only when scenarios explicitly move it.
