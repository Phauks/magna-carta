# claude/trust-authorization-policy

**Scope.** Owner-directed: two-person disbursement authorization becomes a per-firm policy — off,
threshold-based, or always — with an independent approver-authority option, and billing's earned-fee
application follows the same policy. Fail-closed platform default keeps the shipped always-two-person
posture. Policy changes are audited and versioned; a pending request keeps the policy version it was
created under.

**Files expected to touch.**

- `packages/database/src/per-firm-schema.ts` — `trust_authorization_policy` table; new columns on
  `trust_disbursement_request` (`policy_id`, `kind`, `operating_description`),
  `trust_disbursement_decision` (rebuild: `transfer_id`, `policy_exempt` basis), `trust_transfer`
  (`recorded_by`, `policy_id`, `approved_request_id`); `invoice_trust_application_line`
- `packages/database/drizzle/per-firm/20260807T050000_trust-authorization-policy.sql` + snapshot
- `apps/worker/src/per-firm-migrations.ts`
- `packages/identifiers/src/registry.ts` (+ types)
- `packages/access-control/src/registry.ts` — new `trust:authorize` permission
- `packages/trust/src/authorization-policy.ts` (new), `disbursement-authorization.ts`,
  `transfer.ts`, `statements.ts`, `types.ts`, `packages/trust/CLAUDE.md`
- `packages/billing/src/apply-trust-funds.ts`, `apply-authorization.ts` (new), `statements.ts`
- `apps/worker/src/routes/trust.ts`, `routes/billing.ts`, `trust-refusal-problems.ts`,
  `contracts/problem-types.ts`, regenerated OpenAPI/api-client artefacts
- Tests: `packages/database/test/trust-authorization-policy.test.ts` (new),
  `packages/trust/test/*`, `packages/billing/test/*`, `apps/worker/test/trust-authorization-routes.test.ts`,
  `apps/worker/test/billing-routes.test.ts`, permission inventories (`me.test.ts`,
  `auth-provisioning-e2e.test.ts`, `node-sqlite.test.ts`, access-control registry test, conformance)
- Fragments: `changelog.d/trust-authorization-policy.md`,
  `docs/decisions/pending/trust-authorization-policy.md`, `status.d` fragment, `roadmap.d/`,
  `docs/user/` trust guide

**Migration tags.** `20260807T050000` (pre-assigned; notifications holds `20260807T020000`, catalog
slices 2–4 holds `20260807T040000`).
