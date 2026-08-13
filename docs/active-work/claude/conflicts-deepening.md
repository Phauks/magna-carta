---
branch: claude/conflicts-deepening
worktree: .claude/worktrees/conflicts-deepening
area: Conflicts 4·1 deepening — trigger coverage and search depth (design only, no application code)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream answering the owner's scope call on the conflicts 4·1 deepening — **both gaps**,
trigger coverage and search depth (recorded in the orchestrator's queue-when-time scopes as item
112). Produces a design spec, a five-slice implementation plan, and six ADR fragments. **No
application code, no schema, no migration** — nothing under `packages/`, `apps/`, or
`packages/database/drizzle/` is touched on this branch, so it cannot collide with a build stream.

The design covers: the reporting posture (the platform reports what it searched and found, and never
asserts a matter is conflict-free); the event-driven re-check ledger that fires a check when the
corpus moves under an already-checked matter; a typed per-edge-class traversal budget with a recorded
closure cap; a second, additive organization match key; and the rule that no conclusion is ever
recorded without a live reviewer's name on it.

Twelve questions are flagged for the owner rather than decided — every one of them changes what the
platform asserts about a firm's ethical position (default name-role breadth, lateral-hire imputation,
re-scan cadence, carry-forward default, tiered disposition authority, the traversal caps, expired-edge
traversal, notification escalation, firm-marked non-expandable entities, policy-raise re-scan, an
open-the-matter gate, and a signable engagement memorandum).
