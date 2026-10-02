---
number: 393
slug: a-retired-ledger-is-recognized-not-refused
status: Proposed
date: 2026-08-29
area: Platform / Database & migrations
summary: "The migration runner reconciles a known retired migration lineage instead of refusing it. When a database's applied ledger is exactly the pre-2026-07-04 sequential chain that a baseline collapse replaced (per-firm: 36 ids; control-plane: 7 ids), the runner atomically rewrites those ledger rows to the single baseline tag — schema untouched — and then applies the pending tail. The retired chains live as a committed constant beside the runner, and only the complete chain qualifies: a strict prefix, or any other unknown tag, still refuses with the existing deploy-mismatch error, because the unknown-tag guard's real job — detecting code older than the schema — must not weaken. Chosen over keeping legacy rows marked superseded (the ledger then never matches the journal and every future reader needs the map) and over a one-off operational data fix (unauditable, and per-firm Durable Objects cannot be reached one by one)."
---

**A ledger written under ids this code retired is history to reconcile, not a newer schema to fear.**

**Context.** On 2026-07-04 both migration lineages were collapsed: each sequential `00NN` chain
became a single timestamp-id baseline, verified schema- and seed-equivalent, and the journals reset.
The collapse was done "while pre-production (no firm onboarded)" — but production databases
provisioned before it existed and carried applied-ledger rows under the retired ids. The runner's
unknown-tag guard treats any applied tag the bundle does not know as a newer schema than the code
and refuses. For these databases that reading is exactly backwards: the schema is *older* history,
not newer. The consequence in production was total: the scheduled control-plane migration pass
failed every 5 minutes, pre-collapse per-firm Durable Objects threw on every wake, no post-collapse
migration could ever apply, and registration 500ed.

**Decision.** A reconciliation step in `runPendingMigrations`, before the unknown-tag guard, for
both targets (D1 and Durable Object SQLite — the runner is the shared chokepoint, so both get it):

- The retired chains are a committed constant, `LEGACY_BASELINES` in
  `packages/database/src/legacy-baselines.ts` — the exact ordered id lists recovered from the
  pre-collapse journals, mapped to the baseline tag that replaced them. Immutable history, like the
  migrations themselves; a future collapse appends an entry.
- A database qualifies only when its applied set is **exactly** one complete retired chain and the
  bundle carries the matching baseline. The runner then calls a new atomic
  `MigrationTarget.supersedeAppliedMigrations`: delete the retired rows, insert the baseline row,
  one transaction (D1 `batch`, Durable Object `transactionSync`). No schema SQL runs — the schema
  already is the baseline's, which is what the collapse verified. The pending tail then applies
  normally, and the run report says `reconciledToBaseline`.
- Everything else still refuses with the unchanged message. In particular a **strict prefix** of a
  retired chain does not qualify: its schema stops partway through a chain whose SQL no longer
  ships, so recording the baseline would misstate what the database holds. Every database live at
  the collapse had been migrated to the chain's head by the scheduled pass, so the complete chain is
  the only shape production contains — a prefix is a genuinely unknown situation and gets a human.

**Considered and rejected.**

- **Keep the retired rows, add the baseline row (or a superseded marker).** More visible history,
  but then the ledger never again matches the journal, every future run re-runs the recognition
  logic forever, and every other ledger reader needs the map too. The replacement makes the ledger
  converge to exactly what a post-collapse database shows; git holds the history.
- **A one-off operational fix (SQL against production ledgers).** Reaches the control-plane D1, but
  per-firm databases are one Durable Object per firm, addressable only by waking them — and waking
  them runs this exact code. The fix has to live where the wake path runs. It is also unauditable
  and repeats for every environment ever provisioned pre-collapse.
- **Weaken the guard (warn and continue past unknown tags).** Rejected outright: the guard is what
  keeps an old deploy from mangling a newer schema, and this incident does not make that risk less
  real.
- **Re-ship the retired SQL so the old chain can complete.** Reintroduces 43 migrations the
  collapse existed to remove, and helps only the prefix case that production does not contain.

**Consequences.** Pre-collapse databases heal on their next migration pass — control-plane on the
next scheduled run, each firm on its Durable Object's next wake — with no operator action, then
proceed to head. The reconciliation is a one-time event per database and idempotent under crash
(the rewrite is atomic; a re-run either sees the retired chain again or an ordinary ledger). The
`MigrationTarget` seam grows one method, implemented by both real targets and the test fakes. What
this does not do: rescue a database whose ledger is a prefix of a retired chain or contains any tag
outside the map — those still refuse loudly, which is the guard doing its job.
