# @magna-carta/shipping — local notes

The shipping & postage domain: the `ShippingPort` (our vocabulary — `validateAddress`,
`rateShipment`, `buyLabel`, `getTracking`, `refundLabel`) and the EasyPost adapter behind it.

- Pure package — no D1, no Hono, no `env`. The adapter takes an injected `HttpClient`; the worker
  backs it with `fetch`, tests with a fake.
- Certified mail / return receipt / signature / insurance are canonical `ShipmentOptions`, not
  operations — the adapter maps them to EasyPost `options`.
- Canonical records carry `remoteId` + opt-in `raw`, built with `canonicalRecordSchema` and validated
  at the boundary (EasyPost output is untrusted).
- The credential is an API key (`{ kind: "apiKey", scope: "firm" }`) — one postage account per firm.
  Never log it or splice an upstream body into an error detail.
