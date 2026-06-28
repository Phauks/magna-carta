---
category: Added
---

Costs and expenses — per-matter disbursement work-in-progress (WIP) (backend + API; no UI). A new
`@magna-carta/costs` package captures hard and soft disbursements into a per-firm `cost_entry` WIP
store that is independently tracked and never posts to the double-entry ledger (a cost converges onto
an invoice only at billing, 3·4), and moves each entry Draft → (optional Submitted → Approved) →
Billed under the same column-level freeze contract time entries use. The slice extracts that shared
lifecycle out of `@magna-carta/timekeeping` into a new `@magna-carta/billing-core` package — the
`BillableStatus` state machine, the `isFrozen`/`canTransition`/`assertTransition` freeze contract,
and the `billing.approval_required` review-gate definition — so time and costs share ONE workflow
(and 3·4 billing inherits it); timekeeping's `lifecycle.ts` is now a thin re-export that aliases
`BillableStatus` as `TimeEntryStatus`, and 3·1's suite re-verifies green. Costs also land a
generalized recoverable-charge seam: a producer that fronts a billable charge on a matter's behalf
emits a canonical `RecoverableChargeEvent` instead of reaching into the cost tables, with a closed
`pass_through` vs `platform_fee` kind — a third-party charge the firm fronted is always recovered as
a client disbursement, while a Magna-Carta-absorbed fee (e-signature, messaging, shipping handling)
is recovered only under a per-category firm policy (`cost.recover_platform_fee.<category>`, default
off). Shipping (`shipment.purchased`) is the only wired producer (postage unblended from the firm
service fee); e-signature, messaging, and voice are documented seams. Consuming that seam is the
codebase's first per-firm queue consumer — a topic dispatch over the single bound per-firm queue,
keyed on `message.topic`, resolving the firm database by a two-hop (`firmId` → control-plane
`database_identifier` → bound D1), acking-and-ignoring topics it does not own (a deliberate
divergence from the control-plane sweep's throw-on-unknown), and posting recovered disbursements
idempotently behind a per-line `${shipmentId}:${category}` key and the `cost_entry` `recovery_ref`
unique index. A billable cost on an electronic-billing matter requires a UTBMS expense code at
capture, except a system-recovered cost, which lands as uncoded draft WIP rather than being dropped
(the coding requirement re-enforces at the 3·4 bill gate). Migration `0022_burly_piledriver`;
permissions `costs:track` and `costs:approve`; routes ride the chokepoint with a regenerated OpenAPI
snapshot and extended conformance; load-profile `CostVolume`. Deferred to deploy-activation: the
wrangler `consumers` declaration that subscribes the Worker to the per-firm queue (the dispatch
branch is dormant until then). Deferred to 3·4: the `cost.recorded` emission, the cost → A/R posting,
and how recovered costs get LEDES-coded.
