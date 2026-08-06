---
branch: claude/fix-batch-r2-operational
worktree: .claude/worktrees/agent-a582015ad5e6d920d
area: Fix batch for review campaign 2 — the operational area (custodian, case calendar, their worker routes, one per-firm migration)
status: building
touches: packages/custodian/src/, packages/custodian/test/, packages/calendar/src/, packages/calendar/test/, apps/worker/src/routes/custody.ts, apps/worker/src/routes/calendar.ts, apps/worker/src/contracts/problem-types.ts, apps/worker/test/problem.test.ts, packages/database/drizzle/per-firm/, packages/database/src/per-firm-migrations.ts, docs/reviews/2026-08-06-campaign-2-operational.md, changelog.d/fix-batch-r2-operational.md
---

Applies every finding in
[`docs/reviews/2026-08-06-campaign-2-operational.md`](../../reviews/2026-08-06-campaign-2-operational.md)
— one high, six medium, seven low.

The high is the release gate: the member who checked identity is now the authenticated actor rather
than a request-body field, and the witness is validated against the firm's member roster. The
migration `20260806T040000_operational-fixes` adds the release-signatory triggers and the two
`custody_stocktake` freeze triggers; it takes the next dense journal idx at merge time, so a stream
merging first should expect this branch to retag rather than to collide.

Contract moves: `CustodyReleaseAuthorization` loses `identityVerifiedByUserId`, the stocktake
reconciliation response gains its truncation fields, and the generated API client is regenerated.
Other in-flight branches that regenerate the contract will collide on the generated files; the later
merger regenerates.
