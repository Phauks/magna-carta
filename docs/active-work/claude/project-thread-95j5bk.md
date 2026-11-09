---
worktree: C:/dev/magna-carta-worktrees/claude/project-thread-95j5bk
area: call log, the Record Communication window (number first, several calls at once, Identification and History tabs)
status: building
touches: apps/web/src/lib/communications, apps/web/src/lib/components/button-choice.svelte, apps/web/src/routes/(app)/messaging/+page.svelte, docs/user/features/calls-and-texts.md, docs/conventions/design-corrections.md
---

Redesigns the window that records a call or text, from Trevor's approved mockup (2026-11-09). This
first pull request is screen-only. A second adds the Activity field (answered, transferred, message
taken, spam), the caller ID text, call-back tasks and spam marks, which need columns and a table.
The caller lookup in `apps/web/src/lib/communications/caller-lookup.ts` belongs to the call-logging
stream; this stream moves its display into the Identification tab once it lands.
