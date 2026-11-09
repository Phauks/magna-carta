---
worktree: cloud session (claude/project-thread-1k0wkf)
area: Communications — caller lookup on a typed number (Directory match, area code, paid Telnyx caller ID)
status: building
touches: packages/caller-lookup, packages/communications, packages/directory, packages/database (per-firm migration), apps/api-worker/src/http/routes/communications, apps/web/src/lib/communications/communication-fields.svelte, docs/conventions/operations.md, docs/operating-costs.md
---

Adds `packages/caller-lookup` and a per-firm `caller_identity` table, two routes under
`/api/v1/communications/caller-lookup`, and a component mounted under the number field of the call
record. The record-communication redesign stream owns the rest of `communication-fields.svelte` and
the record window; this stream owns only the one mount line and `caller-lookup.svelte`.
