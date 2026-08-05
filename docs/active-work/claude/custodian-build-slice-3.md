---
branch: claude/custodian-build-slice-3
worktree: .claude/worktrees/agent-a13c7ae85f441fc9b
area: Slice 4·2·3 Custodian — gated release (identity and authority captured before an original leaves)
status: building
touches: packages/custodian/, packages/database/, packages/data-access/, packages/telemetry/, apps/worker/, changelog.d/, status.d/, docs/user/, docs/decisions/pending/
---

Build stream for slice 4·2·3 of Custodian, continuing from the merged register
(`claude/custodian-build-slice-1`) and review/reports/labels (`claude/custodian-build-slice-2`)
slices, against the accepted design (`docs/specs/2026-08-04-custodian-design.md`) and its
implementation plan (`docs/specs/2026-08-04-custodian-implementation-plan.md`).

Ships one thing, completely:

- **Gated release.** An original cannot leave the firm's custody until identity and authority are
  captured. The gate is a precondition on the movement write path that already records the borrower —
  no second write path, no new route — plus four columns on the append-only ledger row that carry the
  capture, and a `BEFORE INSERT` trigger that refuses a `released` row without it. Two-signatory
  release is an optional per-firm policy, off by default, read at the gate.

Deliberately NOT built here:

- **The authority vocabulary.** What authority suffices to release an original (letters testamentary,
  letters of administration, a power of attorney and the fact that a power of attorney dies with its
  grantor) is jurisdiction-supplied and owner-gated. The column is free text the firm writes, exactly
  as the ownership role and the destruction basis are, and no platform enum or catalog is invented.
- **Deposit and release receipts.** Document automation now exists, but its assembly path is
  matter-routed and matter-permissioned, and a receipt for a matterless packet would have to route
  through the system holding matter. The binding half already ships: a signed receipt links to the
  packet as a `custody_scan` of kind `receipt`.
- **Client-portal visibility of "items we hold for you".** No portal grant model exists yet, and the
  design's own open question asks for the granularity to be settled before that model hardens.
- **The destruction workflow and any retention policy.** Unchanged and owner-gated:
  `custody_destruction_request` is still a table with no service and no route, and there is still no
  retention column, default, derived value, or sweep.

Files this stream owns:

- `packages/custodian/**`
- `packages/database/src/per-firm-schema.ts` (append-only edits to `custody_movement`), the new
  per-firm migration + its journal entry + the refreshed per-firm snapshot
- `packages/data-access/src/pii-registry.ts` (the new ledger columns)
- `packages/telemetry/src/metrics.ts`
- `apps/worker/src/routes/custody.ts`, `apps/worker/src/contracts/problem-types.ts`,
  `apps/worker/test/contracts/problem.test.ts`, `apps/worker/openapi/openapi.json`,
  `packages/api-client/src/**` (regenerated)
- `docs/user/features/safe-custody-register.md`, `status.d/4-2-custodian.md`, `changelog.d/`,
  `docs/decisions/pending/`
