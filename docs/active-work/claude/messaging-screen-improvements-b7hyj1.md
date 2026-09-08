---
worktree: C:/dev/magna-carta-worktrees/claude/messaging-screen-improvements-b7hyj1
area: The Messaging screen's review round — the record form's vocabulary and fields, opening a record, a set-aside reason for calls that are not matters, and the /communications → /messaging rename
status: review
touches: packages/communications, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm, apps/api-worker/src/routes/communications.ts, apps/api-worker/openapi/openapi.json, packages/api-client, apps/web/src/lib/communications, apps/web/src/routes/(app)/messaging, apps/web/src/lib/time/matter-picker.svelte, apps/web/src/lib/calendar/participant-picker.svelte, apps/web/src/lib/calendar/time-zone-picker.svelte, apps/web/src/lib/time/time-record-window.svelte, apps/web/src/lib/matters/new-matter-dialog.svelte, apps/web/src/lib/navigation/destinations.ts, status.d, roadmap.d/communications.md, docs/user/features/calls-and-texts.md
---

The owner's review of the deployed Messaging screen, worked through in one pass. It touches the per-firm
schema (one added column, `communication.disposition`), so a concurrent stream generating a per-firm
migration should sync before it does — the journal head is `20260908T022553_communication-disposition`.

It also fixes a crash that is not this screen's alone: a bare `Combobox.GroupHeading` throws when the
listbox opens, and four pickers shipped one — `matter-picker`, `time-zone-picker`, `participant-picker`
and the time record window's file picker. Anything touching those four files should take this branch's
version.
