---
branch: claude/review-campaign-2-operational
worktree: .claude/worktrees/agent-abe47cb8a90bf7bf7
area: Review campaign 2 — the operational area (custodian slices 4·2·2–4·2·4 + destruction + will-deposit catalog, the case calendar, the matter-close advisory, their routes and statements)
status: review
touches: docs/reviews/2026-08-06-campaign-2-operational.md, changelog.d/review-campaign-2-operational.md
---

A read-only adversarial review. This stream reads `packages/custodian/`, `packages/calendar/`,
`apps/worker/src/routes/custody.ts`, `apps/worker/src/routes/calendar.ts`, and the per-firm
migrations behind them, and writes **only** the two files listed in `touches` — no source file, no
test, no cross-cutting file. Nothing here conflicts with a builder working in either package; the
review cites file and line, so a stream that reshapes either package should expect the citations to
drift rather than the file to collide.

Findings: one high (a two-signatory custody release is composable into one person), six medium,
seven low. Fixes are proposed, not applied — each one belongs to whoever owns the area.
