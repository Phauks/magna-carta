---
worktree: /home/user/magna-carta
area: Race-condition testing — the survey, the shared interleaving harness, the guarded-write fix it found, and the fitness function holding both
status: review
touches: packages/data-access, packages/database, packages/fees, packages/costs, packages/timekeeping, packages/billing, packages/trust, packages/matters/test, apps/api-worker/src/firm-database, apps/api-worker/src/routes/fees.ts, apps/api-worker/src/routes/costs.ts, tooling/lint-guarded-writes, package.json, vite.config.ts, docs/conventions/testing.md, docs/research/, docs/decisions/pending, changelog.d
---

Started as a read-only survey of the race surface (`docs/research/2026-09-16-race-condition-testing.md`) and now carries the first two recommendations plus the fix they found.

`@magna-carta/data-access/interleave` runs a competing writer at a named point inside a mutation and refuses to pass when that point was never reached; it replaces three local copies (matters, trust, and one the lint found). The verifiers written with it showed a guarded write protecting its row while answering 200, and an audit row recorded for the refused edit — so `guarded(statement, label)` now aborts its transaction, which is the only ordering that takes the audit row with it. **This touches the write chokepoint** (`effect-batch.ts`, both SQLite adapters, the Durable Object RPC and its proxy) and widens `EffectWrite.statements` to a union, which moved nine `SqlStatement[]` annotations in billing, trust and the worker routes. No API contract moves: the refusal maps onto the 409 those routes already return. `pnpm run lint:guarded-writes` is the new gate, and all 134 guard-shaped statements have since been triaged one at a time — 51 guarded, 89 exempted with a stated reason, none undecided — so the lint now fails on a new one rather than counting it. That pass also found three chokepoint bypasses calling `database.batch()` directly, which would have dropped a guard silently.
