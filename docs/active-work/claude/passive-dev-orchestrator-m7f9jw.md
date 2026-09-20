---
worktree: (none — this stream runs in the primary checkout)
area: Passive development — whatever fix or slice is in front of it, plus the feature ledger and the documents rendered from it
status: building
touches: apps/api-worker/src/routes/documents/templates.ts, apps/api-worker/openapi/openapi.json, packages/api-client/src/types.gen.ts, apps/api-worker/test/pdf-form-templates.test.ts, roadmap.d/, docs/now.md, docs/now.html, docs/decisions-open.html, changelog.d/, tooling/doc-fragments/, tooling/lint-ledger-staleness/
---

Currently on the template-registration scan edge: a deployed-but-unreachable engine raised
`ScanFaultError` out of the handler as an Error ID, where `scan-diagnose` answers the identical fault
with a retryable `503`. The refusal is built one level out from the idempotent effect, whose callback
owes a write and a response code rather than a `Response`. Adding a declared response changes the
contract, so the committed OpenAPI snapshot and the generated client move with it.

A concurrent stream touching `apps/api-worker/src/routes/documents/templates.ts`, the templates contract, or the
scan port wiring will collide here.

This stream also touches `roadmap.d/` and `tooling/lint-ledger-staleness/` on most passes, which is
every other stream's collision surface — a branch that flips a node's status while this one is
rendering conflicts on all three generated documents. Sync before flipping one, and rebuild with
`vp run register-build` rather than editing the output.
