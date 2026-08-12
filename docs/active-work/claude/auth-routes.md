# claude/auth-routes — the registration, invitation and attempt-budget backend

**Scope.** Build the Worker routes the shipped sign-in screens were designed against: self-serve
registration with the three-way role fork, invitation redemption (code + last name + date of
birth) behind one neutral failure, and an attempt budget the 429 actually carries. Backend and
contract only — no UI redesign; the live screens are wired only where the change is a few lines.

**Deliberately out of scope** (left as named seams, still listed in
`apps/web/src/lib/auth/unbuilt-capabilities.ts`): passkeys/WebAuthn, the one-time email sign-in
link, firm identity providers, workspace selection, the second-factor channel choice, and
Turnstile (an owner-setup runbook item).

## Files this stream expects to touch

- `packages/database/src/control-plane-schema.ts`, `packages/database/drizzle/control-plane/**`
  (control-plane lineage idx 4 — `registration`, `invitation`, `firm.display_name`)
- `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts`
- `apps/worker/src/auth.ts`, `apps/worker/src/app.ts`, `apps/worker/src/scheduled.ts`,
  `apps/worker/src/control-plane-migrations.ts`
- `apps/worker/src/auth-attempt-budget.ts`, `apps/worker/src/registration-secrets.ts`,
  `apps/worker/src/firm-provision-consumer.ts` (new)
- `apps/worker/src/routes/registrations.ts`, `apps/worker/src/routes/invitations.ts` (new)
- `apps/worker/src/chokepoint/rate-limiter.ts`, `apps/worker/src/chokepoint/chokepoint.ts`,
  `apps/worker/src/contracts/problem.ts`, `apps/worker/src/contracts/problem-types.ts`
- `apps/worker/openapi/openapi.json` + `packages/api-client/src/**` (regenerated, never hand-merged)
- `apps/worker/test/conformance.test.ts` (the not-vacuous operation list)
- `apps/web/src/lib/auth/unbuilt-capabilities.ts`, `apps/web/src/lib/auth/client.ts`
- `docs/user/features/registering.md`, `docs/user/features/signing-in.md`

## Overlap notes

`apps/worker/src/app.ts` and the conformance operation list are the collision-prone files — both
are append-only in practice (one `register*Routes` call, one sorted operation id). The control-plane
migration lineage is at idx 3 on main; this stream takes idx 4.
