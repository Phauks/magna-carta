---
category: Fixed
audience: internal
---

Production databases provisioned before the 2026-07-04 baseline collapse were bricked by their own
history: their `_migrations` ledger holds the retired sequential ids (`0000_foundational-tables`, …),
the shipping bundle knows only the timestamp-id baseline, and the runner's unknown-tag guard read
that as "code older than schema" and refused. Every scheduled control-plane pass failed, every
pre-collapse FirmDatabase Durable Object threw on wake, no post-July-4 migration could ever apply,
and `POST /api/v1/registrations` 500ed on its first read.

The runner now recognizes a ledger that is EXACTLY one retired chain — recorded as a committed
constant in `packages/database/src/legacy-baselines.ts`, verified schema- and seed-equivalent to the
baseline that replaced it — and atomically rewrites those rows to the baseline tag before the guard
runs, then applies the pending tail normally. Once, per database; the next run is an ordinary no-op.
Any other unknown tag — including a strict prefix of the retired chain, whose schema the baseline
would misrepresent — still refuses with the same message, because there it really does mean a newer
schema than the deployed code. Both targets (control-plane D1 via the scheduled pass, per-firm
Durable Object SQLite on wake) get the same rewrite through one new atomic `MigrationTarget` method.
No committed migration SQL changed.
