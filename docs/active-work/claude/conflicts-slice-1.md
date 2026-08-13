---
branch: claude/conflicts-slice-1
worktree: .claude/worktrees/conflicts-slice-1
area: Conflicts 4·1 deepening slice 1 — the reporting posture (posture read, honest zero-hit report, vocabulary fitness function)
status: building
touches: packages/conflicts/, apps/worker/src/routes/conflicts.ts, apps/worker/openapi/openapi.json, packages/api-client/src/, apps/worker/test/, tooling/lint-conflicts-vocabulary/, vite.config.ts, package.json, .github/workflows/gate.yml, packages/fixtures/src/load-profile/conflicts-measurements.ts, changelog.d/, status.d/slice-4-1-conflicts.md, docs/user/features/, docs/active-work/
---

Slice 1 of the conflicts deepening, per
[`docs/specs/2026-08-13-conflicts-deepening-implementation-plan.md`](../../specs/2026-08-13-conflicts-deepening-implementation-plan.md).
The reporting posture only: **no new matching, no new firing, no schema change.**

- **The posture read** — `readMatterConflictsPosture`, one derived per-matter read computed from rows
  at read time and holding no state of its own: the latest check with its scope verbatim, the
  shortfall between that scope and the firm's **current** policy, undisposed counts by evidence tier,
  disposition counts by kind with their reviewers, every source recorded `unavailable` with its
  reason, and a `neverChecked` state distinct from checked-and-nothing-surfaced. No aggregate, and no
  field named `clear`, `clean`, `ok`, `passed`, or `status`.
- **The honest zero-hit report** — `describeCheck`, a pure statement list saying what ran, what did
  not and why, and how many candidates surfaced. A check that surfaced nothing ends **"Nothing
  surfaced."** — a statement about the search, never about the matter.
- **The vocabulary fitness function** — `pnpm run lint:conflicts-vocabulary`, modelled on the shipped
  `tooling/lint-custodian-vocabulary.mjs`, wired into the gate's governance step.

Triggers, the re-check ledger, traversal budgets, match keys, and the adjudication read models are
slices 2 through 5 and are **not** touched here.

**Migration:** none. The per-matter check index this read walks
(`conflicts_check_subject_matter_created_id_index`) already ships.

**No collision with the streams holding `packages/database/drizzle/per-firm/`,
`apps/worker/src/per-firm-migrations.ts`, or `packages/database/src/per-firm-schema.ts`** — this
branch touches none of them. It does re-derive `apps/worker/openapi/openapi.json` and the generated
client, so a second stream adding a route wants to re-derive after this merges rather than beside it.
