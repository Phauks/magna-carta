---
worktree: /home/user/magna-carta
area: Race-condition testing — the survey, then the shared interleaving harness and its first applications
status: review
touches: packages/data-access, packages/fees, packages/costs, packages/timekeeping, packages/matters/test, docs/conventions/testing.md, docs/research/, docs/decisions/pending, changelog.d
---

Started as a read-only survey of the race surface (`docs/research/2026-09-16-race-condition-testing.md`); now also carries its first recommendation. `@magna-carta/data-access/interleave` is a shared harness that runs a competing writer at a named point inside a mutation and refuses to pass when that point was never reached. It replaces the local copy in the matters tests and adds verifiers for the fee freeze, the cost billing lock, and the retroactive re-rate. No production source is changed — the only `src/` file added is the dev/test-only harness and its exports entry.
