---
category: Changed
audience: internal
---

`pnpm check` led with its most expensive and most fragile pass. That is the wrong end: a run that dies
partway reports nothing about the steps behind the one that died, and the type-aware lint pass —
tsgolint over roughly 3,300 files — has been observed OOM-killed at step one of eight in a container,
taking the whole chain down before anything else had spoken.

The two checks that cost seconds and cannot fail spuriously now lead: the build-reference sync, then
the drizzle snapshot freshness that landed a few merges ago specifically to catch a destructive
migration. Both together are under four seconds. Everything slow follows them.

This matters more than the ordering usually would. The gate of record has started no job since
2026-08-05 — an account-side billing block, not a workflow fault — so the whole-repo chain run by hand
is what a merge currently leans on. A chain whose cheap high-signal checks sit behind a pass that can
be killed is one that answers nothing on the machines where it dies.

Also swept nine stream notes for branches that have landed. The registry lists them now rather than
leaving them to be noticed, which is what made a nine-note backlog visible as a single line.
