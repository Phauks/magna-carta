# claude/dead-seams

**Scope.** Two unrelated seams that were declared, never connected, and left behind a comment
explaining that they were unconnected. Each is resolved on its own terms; nothing else changes.

1. **The storage-meter Analytics Engine trend port** (`packages/file-manager/src/metering-statements.ts`)
   — a raw `writeDataPoint` port nothing implements and nothing calls. Withdrawn, with the reason a
   trend is not kept recorded where the port was.
2. **The email-filing notification raise** (`packages/email-filing/src/seams.ts`) — an in-process
   raise that `@magna-carta/notifications` cannot subscribe to, because it subscribes to outbox
   topics and email filing committed none. Replaced with an `email.filed` outbox topic written in
   the same batch that puts a link in `filed`, plus the one registry entry that subscribes to it.

**Files expected to touch**

- `packages/file-manager/src/metering-statements.ts`, `packages/file-manager/test/metering-statements.test.ts`
- `packages/email-filing/src/topics.ts` (new), `src/seams.ts`, `src/index.ts`, `package.json`, `test/seams.test.ts`
- `packages/notifications/src/registry.ts`, `packages/notifications/test/registry-fitness.test.ts`
- `apps/worker/src/routes/emails.ts`, `apps/worker/src/emails/capture-consumer.ts`, `apps/worker/src/scheduled.ts`
- `apps/worker/test/` — the two filing paths' topic coverage
- `changelog.d/`, `docs/decisions/pending/` — fragments only

**Not touched.** No schema change, no migration, no binding, no route contract, no OpenAPI snapshot,
no UI. `packages/notifications` gains one registry entry and no new mechanism.

**Overlap watch.** `changelog.d/` and `docs/decisions/pending/` are the only shared directories, and
both take one new file rather than an edit. Nothing here edits `CLAUDE.md`, `STATUS.md`,
`ROADMAP.md`, the white paper, `docs/conventions/`, or `docs/deploy-queue.md`.
