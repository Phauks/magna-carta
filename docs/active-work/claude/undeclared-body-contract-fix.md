---
branch: claude/undeclared-body-contract-fix
worktree: .claude/worktrees/agent-a17950e0244eaee7e
area: Worker API contract — declare the raw-bytes request bodies two operations actually read
status: building
touches: apps/worker/src/routes/file-integrity.ts, apps/worker/src/routes/scan-diagnose.ts, apps/worker/openapi/openapi.json, packages/api-client/src/ (regenerated), apps/worker/test/conformance.test.ts, changelog.d/undeclared-body-contract-fix.md
---

`fileIntegrity.hash` (`POST /api/v1/file-integrity/hash`) and `scan.diagnose`
(`POST /api/v1/scan/diagnose`) both stream `c.req.raw.body` — the bytes to hash and the bytes
to scan are the request body — while their `defineOpenAPIRoute` definitions declared no request
body at all. A consumer generating a client from the contract could not send what the endpoint
requires.

Scope: declare `application/octet-stream` bodies on both operations, matching the conventions of
the already-declared binary routes (`emails.file`, `fileType.verify`, `ocr.recognize`,
`ocr.searchable`, `emailInspector.inspect`, the five `fileRepair` routes). Both stay
`idempotency: "optional"` — the registration-time guard in
`apps/worker/src/contracts/route-meta.ts` refuses `required` paired with a non-JSON body, and
that guard is correct: the chokepoint's required-idempotency gate fingerprints through a
text-decoding body cache that mangles binary bytes.

Regenerates the committed OpenAPI snapshot and `@magna-carta/api-client`, and updates the
conformance suite's declared-binary inventory (10 octet-stream operations before, 12 after).

No handler behavior changes and no ADR — this is a contract correction, not a decision.
