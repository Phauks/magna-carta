---
worktree: C:/dev/magna-carta-worktrees/claude/main-report-generation-screen-ynuxnr
area: Reports — the report screen (catalogue + run screen), the report registry, the trust-account listing route
status: building
touches: apps/web/src/lib/reports, apps/web/src/routes/(app)/reports, apps/web/src/lib/navigation/destinations.ts, apps/web/src/lib/trust/trust-gaps.ts, apps/api-worker/src/routes/trust.ts, packages/trust/src/account-tree.ts, packages/trust/src/statements.ts, roadmap.d/reports.md, status.d/3-6-financial-reporting.md, ROADMAP.md, docs/user/features
---

The first screen for Reports: `/reports` renders every report the platform declares — the
trust-compliance pack live, the financial, productivity and operational families visible and marked
Soon — and `/reports/<report>` runs one over a period, a knowledge instant and its subject, with the
export menu over the same presentation the screen draws. Everything a report says about itself is
declared once in `$lib/reports/report-registry.ts` (permission, temporal contract, scope controls,
reader, presenter); the screens render from it. Adds `GET /api/v1/trust/accounts`, which the trust
ledger's `account` gap has been waiting on — that gap's wording is updated here, the ledger's wiring
is not. A concurrent stream on the money sections or the trust ledger should not touch
`trust-gaps.ts` without syncing.
