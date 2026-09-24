---
category: Added
audience: public
---

**Shipping's `matterContext` moves from `none` to `optional`, and the buy flow gained a matter picker.** Until now the wizard never sent a `matterRef`, so every shipment was created with a null matter — and `chargeToCaptureInputs` treats a null matter as a firm-administrative charge with nowhere to disburse and emits nothing. The whole cost-recovery path was built, tested and structurally unable to fire: `packages/costs`, the outbox event, the adapter and the per-line idempotent capture, all correct, and nothing ever gave them a matter.

`optional` rather than `required` because the schema already says so — `shipment.matter_ref` is nullable, and a firm posts plenty of mail to a bank or an insurer with nothing to bill. The picker offers "No matter" as a real answer rather than treating an unfiled shipment as an omission, and the step says what the choice decides.

The consumer's own suite already covered the null-matter case; what had no test was a matter reaching a shipment at all, so the round trip — draft, register row, shipment read — is now asserted, along with the no-matter case beside it.

Unchanged and deliberately so: whether the platform's service fee is billed on to the client. That is already a per-firm setting defaulting to off (`cost.recover_platform_fee.shipping_service_fee`), and postage as a pass-through is always recovered regardless.

## Public

**A shipment can now say which matter it belongs to.** Choose the matter when you draft it, and the postage is recorded against that matter as a recoverable cost — which is what lets it be billed back.

Mail the firm sends on its own account needs no matter, and the picker says so rather than making you invent one.
