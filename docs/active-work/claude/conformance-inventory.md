---
worktree: C:/dev/magna-carta-worktrees/claude/conformance-inventory
area: Add two missing operation ids to the conformance inventory (red on main)
status: review
touches: apps/worker/test/conformance.test.ts, changelog.d
---

Two lines. The emitted contract carries `directory.listMatterParties` and
`directory.unlinkMatterParty`; the conformance suite's inventory did not.
