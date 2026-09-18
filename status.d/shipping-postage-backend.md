---
slice: Shipping & postage (backend)
group: cross-cutting
order: 5
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: done by="Opus 5"
load-profile: done
tested: done by="Opus 5"
branch: claude/tender-curie-4ddymh
active-work: docs/active-work/claude/tender-curie-4ddymh.md
next:
link-spec:
link-plan:
adrs:
blocked-by:
---

`@magna-carta/shipping` + EasyPost adapter; shipment/label/tracking tables, idempotent purchase, `shipment.purchased` cost-recovery seam. The per-firm credential read is built: a connected integration's credential lives in its own `integration_credential` table under `integrations:useConnection`, not in `firm_secret` under the administrator's `firm:manageSecrets`, so the member who does the mailing can use the account without being handed the firm's whole vault. Connect, rate-shop, purchase, track and refund all operate, driven end to end against the real store rather than a fake. Webhook ingress deferred; buying real postage waits on the EasyPost Forge contract, which is commercial rather than engineering.
