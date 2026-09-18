---
worktree: C:/dev/magna-carta-worktrees/claude/upbeat-darwin-vooof8
area: Trust, first production round — the matter's Trust section wired to the firm's trust accounts and the movement routes, the firm-level Trust screen behind the sidebar row, and the route that opens a trust account
status: review
touches: apps/web/src/lib/trust, apps/web/src/routes/(app)/trust, apps/web/src/routes/(app)/matters/[id]/trust, apps/web/src/lib/navigation/destinations.ts, apps/web/src/lib/money/money-sections.ts, apps/web/src/lib/matters/sections.ts, apps/web/src/lib/reports/reports-api.ts, apps/api-worker/src/routes/trust.ts, apps/api-worker/openapi/openapi.json, packages/api-client/src/types.gen.ts, apps/web/test, status.d/3-2-trust-accounting-jurisdiction-compliance.md, roadmap.d/financial.md, changelog.d, docs/user/features
---

The Trust surfaces go live for the first time. The matter's Trust section stops standing empty:
it reads the firm's trust accounts, reads the matter's ledger against one, and records deposits,
proposes payments out under the firm's posture, and transfers money between two of the client's
matters. The sidebar's Trust row lights up over a firm-level screen: the accounts register, the act
that opens an account (a new `POST /api/v1/trust/accounts`, the one route the slice lacked), and per
account the approval queue with its verbs, the statements and reconciliations as read, the
bank-charge cushion and the authorization posture. The reconciliation workbench, statement entry
and import, and the unclaimed-funds file stay backend-only this round and say so on the screen.
Another stream touching `apps/web/src/lib/trust` or the trust routes should coordinate here.
