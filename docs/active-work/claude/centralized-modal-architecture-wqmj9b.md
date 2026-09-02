---
worktree: /home/user/magna-carta (remote session)
area: Migrating the billing and costs panels onto ActionDialog
status: building
touches: apps/web/src/lib/billing/, apps/web/src/lib/costs/, tooling/lint-one-ui/registry.json, changelog.d/
---

The second family onto the modal shell that landed in #466. Twelve panels — ten in billing, two in
costs — lose their hand-written scaffold and gain the unsaved-work guard none of them had.

**A concurrent stream should stay out of `apps/web/src/lib/billing/` and `apps/web/src/lib/costs/`
until this lands**, and out of `tooling/lint-one-ui/registry.json`: each migration deletes its own
`hand-composed-modal` allowance in the same edit, so any branch touching that list will conflict.

`apps/web/src/lib/costs/cost-review-window.svelte` is NOT in scope and keeps its allowance — it is a
screen presented over the app rather than an act asked of a reader, and the owner's ruling on
2026-09-02 was that a full-screen surface stays a design choice each time rather than becoming a
third shell.
