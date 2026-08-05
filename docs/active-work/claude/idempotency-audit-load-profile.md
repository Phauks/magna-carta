---
branch: claude/idempotency-audit-load-profile
worktree: .claude/worktrees/agent-a2cb9edae41a23a2e
area: two independent small items — the binary-body idempotency audit and its structural guard, and the documentAutomation load-profile volume profile
status: review
touches: apps/worker/src/contracts/route-meta.ts, apps/worker/test/conformance.test.ts, packages/fixtures/src/load-profile/, packages/fixtures/test/load-profile-smoke.test.ts, packages/fixtures/baselines/, status.d/2-6-document-automation.md, changelog.d/
---

One batch, two unrelated items.

**Binary-body idempotency audit + structural guard.** Every `/api/v1` operation was audited for the
hazard the email add-in route surfaced: the chokepoint's required-idempotency gate fingerprints a
request through Hono's body cache, which caches decoded text, so a binary body on a
`idempotency: "required"` route is UTF-8-mangled (or its later read rejects) before the handler sees
it. **Zero live hits** — all 105 required-idempotency operations carry a JSON body or no body, and all
ten declared `application/octet-stream` operations are `optional`. What ships is the enforcement: a
registration-time guard in `defineOpenAPIRoute` that refuses the combination at startup, and two
conformance fitness functions — one over the emitted document (declared non-JSON body + required), one
source-scan over `apps/worker/src/routes/` that closes the blind spot of a route which reads the
request body raw without declaring a body at all (`fileIntegrity.hash`, `scan.diagnose`).

**The `documentAutomation` load-profile volume profile.** The volume profile deferred by all three
document-automation slices: template/version/assembly/field-mapping counts as profile parameters, a
generator over the real catalogue write paths, and the four measured operations the design names
(catalogue list, current-version resolve, full merge-context batch, custom-field manifest read).
Regenerates the committed baseline at `ledgerVolume-v9`.
