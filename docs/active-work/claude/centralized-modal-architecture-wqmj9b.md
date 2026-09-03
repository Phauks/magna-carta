---
worktree: /home/user/magna-carta (remote session)
area: The fee arrangement moves into the matter status window and leaves the Fees screen; an arrangement version links to the signed agreement on file
status: building
touches: apps/web/src/lib/matters/matter-status-dialog.svelte, apps/web/src/lib/billing/fee-ledger.svelte, apps/web/src/lib/billing/fee-details-panel.svelte, apps/web/src/lib/billing/amend-agreement-dialog.svelte, apps/web/src/lib/billing/arrangement-dialog.svelte (deleted), apps/web/src/lib/billing/billing-api.ts, packages/billing/src/arrangements.ts, packages/database/src/per-firm-schema.ts + drizzle/per-firm, apps/api-worker/src/routes/billing.ts, packages/api-client (regenerated), tooling/lint-one-ui/registry.json, docs/user/features/billing-fee-arrangements.md, docs/conventions/design-corrections.md
---

Owner ruling 2026-09-03: the fee arrangement's facts, history and Amend live in the matter status
window behind the seal, and leave the Fees screen entirely. The intake agreement the client signs at
opening is linkable from the arrangement version (a filed matter document, the conflicts waiver's
precedent). A concurrent stream should stay out of the files named above until this lands.
