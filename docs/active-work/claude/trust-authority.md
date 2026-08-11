# claude/trust-authority — authority-based trust authorization

**Scope.** Build the merged authority-based authorization design for money leaving a client ledger:
an authority holder acts alone, a member without the authority raises a request that routes to
somebody who holds it. Seeds the firm's shipped posture as data (version 1: `off` plus
`require_authorized_approver`), adds the shared disposition read both money-out paths choose
route-versus-solo from, makes the solo release one atomic act, and carries the same choice into
billing's earned-fee application.

**Design:** `docs/specs/2026-08-10-trust-authority-based-authorization.md`.

## Files this stream expects to touch

- `packages/database/drizzle/per-firm/20260808T020000_trust-authority-default-posture.sql` (new,
  seed-only) and `packages/database/drizzle/per-firm/meta/_journal.json`
- `apps/worker/src/per-firm-migrations.ts`
- `packages/trust/src/authorization-policy.ts`, `packages/trust/src/disbursement-authorization.ts`,
  `packages/trust/CLAUDE.md`
- `packages/billing/src/apply-authorization.ts`
- `apps/worker/src/routes/trust.ts`, `apps/worker/src/routes/billing.ts`,
  `apps/worker/openapi/openapi.json` (re-emitted), `packages/api-client/src/` (regenerated)
- `packages/trust/test/`, `packages/billing/test/`, `apps/worker/test/` (the fixture and suite edits
  the seeded posture forces)
- `changelog.d/trust-authority-based-authorization-build.md`,
  `docs/decisions/pending/trust-authority-based-authorization-build.md`,
  `status.d/3-2-trust-accounting-jurisdiction-compliance.md`,
  `docs/user/features/trust-authorization.md`

## Overlaps to watch

- **The per-firm migration journal.** `claude/discovery-5-2-1` and `claude/directory-pronouns` both
  hold idx 51 on `origin/main`. This stream takes idx 51 too, with the tag timestamp
  `20260808T020000` chosen to sort after both of theirs, so whichever merges last renumbers without
  reordering anything.
- `apps/worker/openapi/openapi.json` and `packages/api-client/src/` are regenerated, never
  hand-merged — re-emit after a sync rather than resolving a conflict by hand.
- No UI in this stream: `apps/web` is deferred.
