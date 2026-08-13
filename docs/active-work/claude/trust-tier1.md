---
branch: claude/trust-tier1
worktree: .claude/worktrees/trust-tier1
area: trust — the bank-charge carve-out (owner flag T3) and the unclaimed-funds diligence workflow (owner flag T16)
status: building
touches: packages/trust/, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/, packages/database/test/node-sqlite.test.ts, packages/identifiers/, packages/access-control/src/registry.ts, apps/worker/src/per-firm-migrations.ts, docs/specs/, changelog.d/, docs/decisions/pending/, status.d/3-2-trust-accounting-jurisdiction-compliance.md
---

Two owner-directed trust items, both in the domain layer plus schema. No route layer and no UI in
this stream — the deferred remainder is written into
`docs/specs/2026-08-12-trust-bank-charges-and-unclaimed-funds.md`.

**The bank-charge carve-out** wires the firm's own money into a trust account for the single purpose
the conduct rules permit — bearing the institution's service charges — and makes "single purpose"
structural: a separate closed-category table with no column a client or matter could be named in, a
second composition door narrower than the client-money one, the same `account_balance` zero floor a
matter leaf carries, a distinct `trust:firmFunds` capability seeded to Owner/Admin alone, and a new
leg on the three-way proof so a cushion never reads as a `book-to-client` disagreement.

**Unclaimed funds** is a read and an evidence trail. Dormancy is computed at read time against a
window the reader states and is stored nowhere; the diligence file records each locate attempt when
it was made; and the closure attaches a disbursement that already posted through the ordinary
authorized path rather than composing one.

Two migrations taken: `20260812T000000_trust-firm-funds-and-unclaimed-funds` (idx 54) and
`20260812T000001_seed-trust-firm-funds-permission` (idx 55).
