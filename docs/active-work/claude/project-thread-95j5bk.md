---
worktree: C:/dev/magna-carta-worktrees/claude/project-thread-95j5bk
area: call log, the Record Communication window (number first, several calls at once, Identification and History tabs, Activity)
status: building
touches: apps/web/src/lib/communications, apps/web/src/lib/components/button-choice.svelte, apps/web/src/routes/(app)/messaging/+page.svelte, docs/user/features/calls-and-texts.md, docs/conventions/design-corrections.md, packages/communications, packages/database/src/per-firm-schema.ts, apps/api-worker/src/http/routes/communications
---

Redesigns the window that records a call or text, from Trevor's approved mockup (2026-11-09). The
first pull request is screen-only. The second adds the Activity field (answered, transferred, message
taken, spam), the caller ID text and message tasks as four columns on `communication`; spam marks are
counted from the rows themselves, so no table was needed.
The caller lookup in `apps/web/src/lib/communications/caller-lookup.ts` belongs to the call-logging
stream; this stream moves its display into the Identification tab once it lands.
