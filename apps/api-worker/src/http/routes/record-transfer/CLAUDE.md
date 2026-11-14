# api-worker routes/record-transfer — CLAUDE.md

**Purpose.** The record transfer over HTTP: starting a run, giving it a source file, reading a file's first rows, asking for a pass and reading how it came out. One domain module of the Worker's route tree: `index.ts` mounts every file here as one sub-app, `operations.ts` is the committed list of what it registers, and `shared.ts` holds the permission, the two route metas and the declared refusals. The Worker-wide rules are in [`../../../CLAUDE.md`](../../../../CLAUDE.md); the domain's own rules are in [`packages/record-transfer/CLAUDE.md`](../../../../../../packages/record-transfer/CLAUDE.md); the design is [`docs/specs/2026-11-10-record-transfer-framework-design.md`](../../../../../../docs/specs/2026-11-10-record-transfer-framework-design.md).

## Local rules

- **One permission, `firm:transferRecords`, on every route, reads included.** A run's files are every client the firm has. Do not put a read here on `directory:edit` or leave it ungated.
- **A pass never runs on the request.** `passes.ts` records the request and its outbox message in one idempotent batch and answers 202. The work is `src/background/record-transfer/pass-consumer.ts`, reached through the shared per-firm queue's dispatch table.
- **The upload stores the bytes first and the row second**, and takes the object back when the row is refused. It asks for no Idempotency-Key: the file's digest is what refuses the same bytes twice, with 409.
- **The preview is the only route that answers values from a file.** It reads three rows from the stored object when asked and stores nothing. Do not add file values to any other answer, to a log line or to a problem's detail: a reader's fault is a fixed sentence, and a refusal names identifiers from the request.
- **An object key never leaves.** `transfer-views.ts` in the package builds every answer, and leaves out a file's object key, a pass's report key and a pass's stored rules.
- **A run that has ended takes no file and no pass.** Both writes read the run first and answer 409.

## Gotchas

- **A pass's state is derived, not stored.** `stalled` is a started pass with no ending after twenty minutes; nothing writes it.
- **The report read answers `{ report: null, failure: null }` for a pass that has not ended**, and exactly one of the two after.
- **The test drives the queue by hand.** `test/record-transfer.test.ts` delivers the message through `perFirmQueue`, because the outbox relay does not run inside a test.
