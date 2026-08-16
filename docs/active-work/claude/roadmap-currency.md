---
worktree: /home/user/magna-carta/.claude/worktrees/roadmap-currency
area: ROADMAP.md narrative currency after the 2026-08-15/16 merges
status: review
touches: ROADMAP.md, changelog.d/
---

Ten merges landed in one stretch and `ROADMAP.md`'s _Now_ section still described the state before
them: discovery's next step was the processing lane that shipped, notifications' next step was the
sweep that shipped two slices ago, and human verification appeared nowhere. The per-capability ledger
stayed correct throughout — each slice flipped its own `roadmap.d/` node — but the narrative that
tells a reader which stream to pick up next is hand-written and does not move on its own.

Narrative only. No ledger node, no status fragment, no generated file.
