# @magna-carta/shipping — local notes

The shipping & postage domain: the `ShippingPort` (our vocabulary — `validateAddress`,
`rateShipment`, `buyLabel`, `getTracking`, `refundLabel`) and the EasyPost adapter behind it.

- Pure package — no D1, no Hono, no `env`. The adapter takes an injected `HttpClient`; the worker
  backs it with `fetch`, tests with a fake.
- Certified mail / return receipt / signature / insurance are canonical `ShipmentOptions`, not
  operations. Certified mail, return receipt, and signature map into EasyPost `options`; **insurance
  does not** — EasyPost takes it as a top-level decimal-dollar string on the buy request, so it rides
  `BuyLabelRequest.insuranceAmountMinor` and is converted at the boundary like any other money field.
- **EasyPost supports no idempotency key**, on any endpoint. A retried buy is a second real purchase,
  so double-buy protection belongs to the caller (the worker's per-shipment purchase claim) — never to
  a request header this API ignores. Do not reintroduce one.
- Canonical records carry `remoteId` + opt-in `raw`, built with `canonicalRecordSchema` and validated
  at the boundary (EasyPost output is untrusted).
- The credential is an API key (`{ kind: "apiKey", scope: "firm" }`) — one postage account per firm.
  Never log it or splice an upstream body into an error detail.
- **The per-firm credential read is still an unbuilt seam, and that is answered, not thrown.** Until
  the marketplace slice wires it, connecting an account and every carrier operation answer `501`
  `not-implemented` (`apps/api-worker/src/routes/communications/shipping.ts`), sourced from the framework's
  `credential-store-not-implemented` dispatch outcome. Drafting a shipment deliberately still
  succeeds — a draft is the firm's own addresses and parcel and needs no carrier.
