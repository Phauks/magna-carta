---
worktree: C:/dev/magna-carta-worktrees/claude/zen-ramanujan-rh7zbg
area: The Messaging screen's third review round — one window for recording and reading a call, a typed duration beside the span, a reference number every call carries, the description as the row's second line, and an extension the phone field understands
status: review
touches: packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm, packages/communications, apps/api-worker/src/routes/communications.ts, apps/api-worker/openapi/openapi.json, packages/api-client, apps/web/src/lib/communications, apps/web/src/lib/directory/phone-entry.ts, apps/web/src/lib/directory/phone-number-field.svelte, apps/web/src/lib/directory/sections/contact-section.svelte, apps/web/src/routes/(app)/messaging, apps/web/src/routes/(app)/matters/[id]/messaging, status.d, docs/conventions/design-corrections.md, docs/user/features/calls-and-texts.md
---

The owner's third review of the deployed Messaging screen, worked through in one pass. It adds two
per-firm columns and a table — `communication.reference_number`, `communication.ended_at` and
`communication_number_counter` — so a concurrent stream generating a per-firm migration should sync
before it does; the journal head is `20260908T215427_communication-reference-number-and-end`, and
that migration backfills a number onto every row the table already holds.

It also changes two files outside this subsystem, and anything touching them should take this
branch's version: `$lib/directory/phone-number-field.svelte` now owns the extension half (the
Directory's contact rows no longer build their own beside it), and `$lib/directory/phone-entry.ts`
gained the overflow split and an extension argument on `checkPhoneEntry`.
