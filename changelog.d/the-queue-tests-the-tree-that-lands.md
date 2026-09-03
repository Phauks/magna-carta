---
category: Changed
audience: internal
---

**The gate is ready for a merge queue, and the conventions say what is true again.** Every red check the first full battery found on 2026-09-02 was two branches merged minutes apart and never tested together, which the pull-request tier cannot see by construction. The `merge_group` tier now resolves its diff base from the queue's own payload, and while the austerity holds it defers the fan-out sinks exactly as the pull request does (the sink lint alone is a 2-core runner for twenty-six minutes per merge). The setting that turns the queue on is a repository ruleset, so `docs/deploy-queue.md` carries it as its first entry, with the values to pick and why; it replaces the billing-block entry, which cleared on 2026-09-01.

The conventions stop describing a blocked gate: `build-performance.md`'s austerity section records what happened in August and what the revert is now a decision against, `operations.md`'s quality-gates section names the jobs the gate actually has and the tiers that actually run, and `CLAUDE.md` no longer says the gate of record is blocked.

Two things found on the way. The generated OpenAPI client was behind the committed snapshot for the third time (#445, #459, and now #486 each regenerated the snapshot and left the client), and is regenerated; a queued merge runs the drift check on the tree that lands, which is what stops a fourth. And `check:scoped`'s format step refused a change whose every script file the formatter ignores, which is exactly what a client regeneration looks like; it now carries `--no-error-on-unmatched-pattern` as its lint-only sibling already did, with a test pinning that shape.

And one real regression, found because this change runs the full battery: #477's grid publishes the frame's visible width to CSS from a resize observer, and it wrote the property inside the observer's own callback on every notification. Under the story suite's load that churn made the column-filter field lose focus to its menu while a word was being typed. The write now lands on the next frame and only when the width changed; the full story suite passes.
