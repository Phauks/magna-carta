---
branch: claude/stale-absence-comments
worktree: /home/user/magna-carta/.claude/worktrees/stale-absence-comments
area: Resolve the notifications matter-team audience against matter_assignment, then sweep the tracked source for absence comments that have quietly become false
status: review
touches: packages/notifications, packages/database/src/per-firm-schema.ts, packages/file-manager/src/metering-statements.ts, packages/email-filing/src/seams.ts, packages/custodian/src/reminders.ts, packages/design-system/src/lib/components/accordion, apps/web/src/lib/tools/tool-presentation.ts, apps/web/src/routes/(app)/forms/assemble, apps/worker/src/emails/capture-consumer.ts, apps/worker/test, changelog.d/, docs/decisions/pending/
---

Two pieces of work, and the first is an instance of the second.

**The `matter-team` audience.** `packages/notifications/src/recipients.ts` narrowed `matter-team` to
the responsible member and reported `substituted: true`, on a comment that was true when it was
written and false two merges later — `matter_assignment` is a per-matter team table. The resolver now
reads it: the responsible member unioned with every currently-valid assignment held by an active
member, deduplicated and clamped in one statement, with the validity window read exactly as
`packages/document-assembly/src/merge-statements.ts` reads it. No type declares
`audienceSubstitutedFrom` any more and a fitness test holds that. New test file
`packages/notifications/test/recipients.test.ts`.

**The absence sweep.** A hand pass over every comment in the tracked source that asserts something
does not exist, checked against the tree. Deliberately not a linter — that class was measured and
found unrulable. Findings are corrected where they land: `packages/database/src/per-firm-schema.ts`
(one line, the encumbrance seam), `packages/file-manager/src/metering-statements.ts`,
`packages/email-filing/src/seams.ts`, `packages/custodian/src/reminders.ts`, the accordion component,
the tools listing, the assemble scaffold, and three worker test fixtures.

Nothing here changes schema, a migration, or a route. A concurrent stream should note that the
per-firm schema edit is a comment on one existing column and touches no table definition.
