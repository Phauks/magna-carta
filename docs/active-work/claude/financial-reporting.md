---
branch: claude/financial-reporting
worktree: .claude/worktrees/financial-reporting
area: Slice 3·6 — financial and trust-compliance reporting, design and implementation plan only (no product code)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, status.d/3-6-financial-reporting.md, roadmap.d/reports.md
---

Design-only cycle for the reporting surface over the finished financial core: the spec, the
implementation plan, and the ADR fragments. **No product code, no schema, no routes** in this
stream — nothing under `packages/` or `apps/` is touched.

Scope follows the owner's answer already on record in the forward queue
(`docs/active-work/claude/passive-dev-orchestrator-m7f9jw.md`, "Task 113 — financial reporting
surface, all four, bar-audit pack first"): all four report families, bar-audit pack as slice 1.

**What a concurrent stream should know.** The build this plans will eventually touch
`packages/ledger/src/statements.ts`, `packages/trust/src/statements.ts`,
`packages/billing/src/statements.ts`, `packages/access-control/src/registry.ts`, and two per-firm
migration slots — none of them in this stream, all of them named in the plan so whoever builds it
syncs `main` first. `packages/ledger/src/statements.ts` in particular is also touched by the dormant
`slice-3-5-operating-general-ledger` branch, whose chart of accounts this design depends on for the
operating-book reports it defers.

Nine questions are flagged for the owner in the design's open-questions section; none blocks starting
the first sub-slice, because each changes what a pack prints rather than how it is computed.
