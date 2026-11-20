# api-worker routes/record-transfer — CLAUDE.md

**Purpose.** The record transfer over HTTP: starting a run, giving it a source file, reading a file's first rows and a column's values, saving a file's mapping, asking for a pass, reading how it came out, getting its rejected rows back, and accepting or stopping the run. One domain module of the Worker's route tree: `index.ts` mounts every file here as one sub-app, `operations.ts` is the committed list of what it registers, and `shared.ts` holds the permission, the two route metas and the declared refusals. The Worker-wide rules are in [`../../../CLAUDE.md`](../../../../CLAUDE.md); the domain's own rules are in [`packages/record-transfer/CLAUDE.md`](../../../../../../packages/record-transfer/CLAUDE.md); the design is [`docs/specs/2026-11-10-record-transfer-framework-design.md`](../../../../../../docs/specs/2026-11-10-record-transfer-framework-design.md).

## Local rules

- **One permission, `firm:transferRecords`, on every route, reads included.** A run's files are every client the firm has. Do not put a read here on `directory:edit` or leave it ungated.
- **A pass never runs on the request.** `passes.ts` records the request and its outbox message in one idempotent batch and answers 202. The work is `src/background/record-transfer/pass-consumer.ts`, reached through the shared per-firm queue's dispatch table.
- **The upload stores the bytes first and the row second**, and takes the object back when the row is refused. It asks for no Idempotency-Key: the file's digest is what refuses the same bytes twice, with 409.
- **A large file comes in pieces through `file-uploads.ts`, and keeps the upload's rules.** Pieces go to the bucket under the file's own key; the row is written only by the completion, after the joined object's digest is read, and a duplicate or a refused row takes the object back. Nothing is stored between the requests: the caller returns the upload's identifier, which can only name an upload under this run's key. A piece is held in memory, so it is capped at what the single-request upload holds.
- **Three reads answer values from a file, and nothing else does.** The preview (three rows), the column values (at most 500 values of at most 100 characters, so free text does not leave through it) and the rejected rows of a finished pass. Each reads the stored object when asked and stores nothing. Do not add file values to any other answer, to a log line or to a problem's detail: a reader's fault is a fixed sentence, and a refusal names identifiers from the request.
- **The rejected-rows download is sent a line at a time and named for the pass.** A source file's own name is a person's word and may hold a client's name, so it is never a download's file name.
- **A saved mapping is an object, written before its audit row.** `files.ts` puts it at the key the package builds and then commits the audit row. The body is the strict shape in the package's contract; do not loosen it to an open record, because that is what keeps a row of a file out of it.
- **Accepting and abandoning read the run and its passes first.** Both answer 409 while a pass is requested or running (a stalled pass holds nothing up), answer the run as it stands when asked for the ending it already has, and answer 409 for the other ending. Accepting never asks for a conflicts check on the request: it writes one outbox message, and `src/background/record-transfer/run-accepted-consumer.ts` records the requests.
- **An object key never leaves.** `transfer-views.ts` in the package builds every answer, and leaves out a file's object key and a pass's report key. A pass's stated rules are answered by their own read (`recordTransfer.getPassRules`) and by no list.
- **A run that has ended takes no file, no pass and no mapping save.** Each write reads the run first and answers 409.

## Gotchas

- **A pass's state is derived, not stored.** `stalled` is a started pass with no ending after twenty minutes; nothing writes it.
- **The report read answers `{ report: null, failure: null }` for a pass that has not ended**, and exactly one of the two after.
- **The test drives the queue by hand.** `test/record-transfer.test.ts` delivers the message through `perFirmQueue`, because the outbox relay does not run inside a test.
