---
worktree: /home/user/magna-carta/.claude/worktrees/invoice-delivery
area: The invoice delivery record — the append-only row the billing design specified and nothing built
status: building
touches: packages/database, packages/billing, apps/worker/src/routes/billing.ts, packages/data-access/src/pii-registry.ts, roadmap.d/financial.md, status.d/, changelog.d/, docs/decisions/pending/, docs/user/
---

Builds `invoice_delivery`: the append-only row per delivery attempt the billing design specified
(channel, recipient reference, timestamp, external reference, outcome), the delivery-state read the
apply-funds surface is meant to show, and the billing routes that record and list one. No invoice
renderer and no client-facing channel — a delivery record here records that a firm gave a bill to a
client, it does not transmit one. Adds one per-firm migration at the lineage head plus its snapshot,
and one PII registry entry for the recipient reference.

Stays out of `tooling/` and `packages/fixtures`, which another stream owns.
