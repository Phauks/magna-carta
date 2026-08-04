---
branch: claude/email-capture-mint-route
worktree: C:/dev/magna-carta-worktrees/claude-email-capture-mint-route
area: Email capture-address mint / rotate / revoke — the writer for the forward-CC token index
status: building
touches: packages/data-access/src/email-filing-statements.ts, packages/data-access/src/email-capture-route-statements.ts, packages/email-filing/src/capture-token.ts, apps/worker/src/routes/capture-addresses.ts, apps/worker/src/emails/, apps/worker/src/costs/recoverable-charge-consumer.ts, apps/worker/src/app.ts, apps/worker/wrangler.jsonc, apps/worker/openapi/openapi.json, packages/api-client, apps/worker/test/conformance.test.ts, docs/conventions/operations.md
---

Builds the mint/rotate/revoke surface for forward/CC capture addresses — the missing writer for the
control-plane `email_capture_route` token index and the per-firm `email_capture_address` store. Until
this lands the index is empty and every forwarded message bounces.

The two databases have no shared transaction, so the ordering is asymmetric and deliberate: **mint**
commits the per-firm row plus a transactional-outbox row in one atomic per-firm batch and lets the
relay dispatch the control-plane insert (converges; never a silent half-write), while **revoke and
rotate** flip the control plane FIRST so routing stops immediately (fail closed).

Do not step on: `apps/worker/src/routes/emails.ts` route ordering, the per-firm topic dispatch table
in `apps/worker/src/costs/recoverable-charge-consumer.ts` (its handler signature gains `env`), the
`queues.consumers` list in `apps/worker/wrangler.jsonc` (this stream activates the shared per-firm
job queue), and the committed OpenAPI snapshot + generated API client.
