---
branch: claude/auto-file-wiring
worktree: .claude/worktrees/agent-a31e571574bc6f768
area: Email filing — auto-file rules, build slice 2 (evaluation wired into the capture consumer)
status: building
touches: packages/email-filing/src/capture.ts, packages/email-filing/test/capture.test.ts, packages/data-access/src/email-filing-statements.ts, packages/matters/src/queries.ts, apps/worker/src/emails/, apps/worker/src/routes/, apps/worker/src/app.ts, apps/worker/openapi/openapi.json, packages/api-client/src/ (regenerated), apps/worker/test/, changelog.d/, status.d/email-filing.md, docs/decisions/pending/, docs/user/features/filing-email-to-a-matter.md, docs/active-work/
---

Build slice 2 of the auto-file rules plan: the engine slice 1 shipped stops firing from nothing. A
captured message that no entrance routed now has its rules evaluated in the capture consumer, off the
request path, and the result rides the capture's own atomic batch.

What it lands:

- An optional `resolveAutoFileDecision` port on `CapturePorts`, called inside `captureEmail` at the
  point `matterId` and `linkState` are decided — so the automatic link rides the existing atomic write
  batch and the existing idempotency outcome body. An absent port is today's behaviour exactly; a
  throwing port degrades to it and never loses the capture.
- `auto_file_rule_id` carried on `CaptureLinkPlan` and written by the shipped link insert: null means
  a person made the link, non-null names the rule that did.
- `apps/worker/src/emails/auto-file-evaluation.ts` — the bounded evidence gatherer (rule lookup by
  match value, the thread's filed matters, subject matter numbers, the message's existing links, the
  target matters' state, the creators' current access through `filterAccessibleMatters`, and the
  per-rule activity the circuit breaker reads).
- The decision ledger write, the `emails.autoFiled` / `emails.autoFileStaged` audit rows, and the
  circuit breaker's suspension — all in the capture's batch.
- The firm-level direct-filing ceiling as a `setting` row plus its read/patch route pair, on the
  scan-policy precedent, bound to the existing `emails:manageCaptureAddresses` administrative lane.

No migration: slice 1 landed both tables and the nullable link column, and the firm policy is a
`setting` row.

## Overlap to watch

- **`apps/worker/openapi/openapi.json` and `packages/api-client/src/`** are contended by several
  streams (case calendar, add-in client API, matter assets, the two trust streams, the undeclared-body
  fix). This stream adds one route pair and re-emits both; the second to merge re-emits again.
- **`apps/worker/src/app.ts`** is contended by the add-in client API and matter assets streams; this
  stream adds one route registration line.
- **`apps/worker/test/conformance.test.ts`** carries the operation inventory every new route extends.
- **`packages/data-access/src/email-filing-statements.ts`** gains one column on the link insert and
  one bounded read; the add-in client API stream reads that module but does not write it.
- No new permission and no new problem type, so none of the permission inventories move.
