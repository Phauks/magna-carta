---
branch: claude/trust-two-person-authorization
worktree: .claude/worktrees/agent-a3e45a6d3b0b60268
area: Trust — two-person authorization for disbursements out of a client ledger
status: building
touches: packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/20260805T170000_trust-disbursement-authorization.sql, packages/database/drizzle/per-firm/meta/, packages/database/test/trust-disbursement-authorization.test.ts, packages/identifiers/src/registry.ts, packages/identifiers/src/types.ts, packages/trust/src/disbursement-authorization.ts, packages/trust/src/statements.ts, packages/trust/src/movements.ts, packages/trust/src/types.ts, packages/trust/src/trust-validation.ts, packages/trust/package.json, packages/trust/CLAUDE.md, packages/trust/test/, packages/data-access/src/pii-registry.ts, apps/worker/src/routes/trust.ts, apps/worker/src/contracts/problem-types.ts, apps/worker/src/per-firm-migrations.ts, apps/worker/test/trust-routes.test.ts, apps/worker/test/trust-authorization-routes.test.ts, apps/worker/test/conformance.test.ts, apps/worker/test/contracts/problem.test.ts, apps/worker/openapi/openapi.json, packages/api-client/src/ (regenerated), changelog.d/trust-two-person-authorization.md, status.d/3-2-trust-accounting-jurisdiction-compliance.md, docs/research/2026-08-04-trust-accounting-analysis.md
---

The movements slice recorded the authenticated submitter as both recorder and authorizer, with the
columns already split so a real authorization workflow could arrive without a migration. The owner
directed on 2026-08-05 that it be built now. This stream builds it: a disbursement becomes a pending
request awaiting a second member's approval, and the trust movement posts only on approval, with the
approver as `authorized_by` and the submitter as `recorded_by`.

Scope: two new per-firm tables (the append-only request and the one append-only decision that
settles it, journal idx 31), the approver-differs rule as a database trigger rather than route
discipline, the existing `composeTrustDisbursement` running unchanged in the approver's context so
the available-balance ceiling is re-read at approval time, and the request/approval/rejection/
withdrawal routes replacing the direct `trust.disburse` operation. Deposits and matter transfers are
untouched.

Overlap watch: anything else editing `packages/trust/`, the per-firm migration journal tail, or the
committed OpenAPI snapshot. A stream landing another per-firm migration must take idx 32.
