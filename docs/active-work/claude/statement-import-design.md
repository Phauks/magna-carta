---
branch: claude/statement-import-design
worktree: /home/user/magna-carta/.claude/worktrees/statement-import-design
area: PDF bank-statement import for trust reconciliation — design only (owner extension T10)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/claude/
---

Design-only stream. It produces a spec, an implementation plan, and one ADR fragment at
`status: Proposed` for importing a bank statement as a **PDF** into the trust reconciliation that
already shipped (`packages/trust/src/{bank-statements,statement-import,matching,reconciliation,three-way-proof}.ts`,
migration `20260805T200000_trust-reconciliation`, ADR-0246). It feeds that reconciliation; it does
not replace it, and it changes nothing about what a reconciliation means.

**No feature code, no schema, no migration, no route, no parser.** Trust accounting is analysis plus
owner flags rather than a unilateral build, and golden rule 8 puts the spec before the code either
way. Nothing here flips a `roadmap.d/` node — a design ships no capability, and
`pnpm run lint:ledger-staleness` would rightly object to a status that claimed otherwise.

**Not touched.** No file under `packages/`, `apps/`, `crates/`, `containers/`, or
`packages/database/`. Not `CLAUDE.md`, `STATUS.md`, `ROADMAP.md`, the white paper,
`docs/conventions/`, `roadmap.d/`, or any rendered tracker.

**Overlap watch.** `changelog.d/` and `docs/decisions/pending/` are shared append-only fragment
directories (one new file each, uniquely named — the collision-free discipline they exist for).
Everything else is new files under `docs/specs/` and `docs/active-work/claude/`.
