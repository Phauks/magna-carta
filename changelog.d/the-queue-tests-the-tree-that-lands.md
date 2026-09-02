---
category: Changed
audience: internal
---

**The gate is ready for a merge queue, and the conventions say what is true again.** Every red check the first full battery found on 2026-09-02 was two branches merged minutes apart and never tested together, which the pull-request tier cannot see by construction. The `merge_group` tier now resolves its diff base from the queue's own payload, and while the austerity holds it defers the fan-out sinks exactly as the pull request does (the sink lint alone is a 2-core runner for twenty-six minutes per merge). The setting that turns the queue on is a repository ruleset, so `docs/deploy-queue.md` carries it as its first entry, with the values to pick and why; it replaces the billing-block entry, which cleared on 2026-09-01.

The conventions stop describing a blocked gate: `build-performance.md`'s austerity section records what happened in August and what the revert is now a decision against, `operations.md`'s quality-gates section names the jobs the gate actually has and the tiers that actually run, and `CLAUDE.md` no longer says the gate of record is blocked.
