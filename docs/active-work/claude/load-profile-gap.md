---
branch: claude/load-profile-gap
worktree: /home/user/magna-carta/.claude/worktrees/load-profile-gap
area: Load-profile volume profiles + measured sets for custodian and calendar (the two built subsystems with no baseline)
status: building
touches: packages/fixtures/src/load-profile/, packages/fixtures/package.json, packages/fixtures/baselines/, packages/fixtures/test/load-profile-smoke.test.ts, packages/fixtures/CLAUDE.md, status.d/4-2-custodian.md, status.d/6-1-case-calendar.md, status.d/6-2-calendar-firm-events-resources.md, changelog.d/, docs/decisions/pending/
---

Closing the measurement gap: custodian and calendar shipped without volume profiles, so their query
surfaces have no baseline to regress against. This stream adds a `custodian` and a `calendar` volume
to the one existing harness (`packages/fixtures/src/load-profile/`) — profile parameters, generators
over the real write paths, per-domain measurement modules with EXPLAIN plan probes, the smoke wiring,
and a regenerated committed baseline. The profile `version` bumps, which renames the baseline file
and invalidates every cached snapshot by design.

Backend and harness only — no UI, and **no query is rewritten in this pass**; anything the numbers
find is reported for a follow-up. Nothing outside `packages/fixtures/` changes except the three
status fragments whose `load-profile` column this closes.
