# Shipping & postage (EasyPost adapter) — design

**Status:** Accepted (design) · **Date:** 2026-06-16 · **Owner:** Trevor Goldsmith
**White-paper home:** _Integrations_ (and the _Plugin / Add-on system_ port foundation)
**Research input:** provider investigation, 2026-06-16 (Pirate Ship integration surface · API-first label providers · USPS commercial discount tiers · certified-mail support · EasyPost Forge platform billing) — synthesized inline; not a standing research doc.
**ADRs:** **ADR-0094 (shipping & postage subsystem + EasyPost as the first credentialed adapter — new)** · **ADR-0095 (API-key credential kind — amends ADR-0091/ADR-0092)** · builds on ADR-0091/0092 (port system + connection model), ADR-0084 (the `firm_secret` credential store, slice 1·2), ADR-0003 (tenancy), ADR-0022 (code-as-contract), ADR-0039 (compute placement), ADR-0078 (cheap-seam-now), ADR-0083 (load-profile accretion).

This is the implementation-grade design for **shipping & postage** — generating mailing packages and certified mail through EasyPost, plugged into the built integration port system. It is the **first credentialed adapter**, so it also lands the framework seams that the port spec deferred to "the first credentialed adapter": the per-firm `integration_connection` repository, the `firm_secret`-backed `CredentialStore`, and the worker connection-management routes.

The work decomposes into three gated pieces:

- **A — `ShippingPort` + EasyPost adapter** (the integration). Gate: port framework (built) + slice 1·2 `firm_secret` backing (in progress) + the API-key credential extension below.
- **B — shipping vertical slice** (schema → data-access → API → UI → tests). Consumes A through the port.
- **C — service fee + client cost recovery.** Designed as a seam now; built with the Phase 3 financial core. The shipment carries the cost columns + matter link up front (ADR-0078) so the build is a posting hook, not a retrofit.

---

## 0. Why EasyPost, not Pirate Ship

The original request named Pirate Ship. It is the wrong tool twice over for a law firm, and the investigation is recorded here so the choice is not relitigated:

- **No integration surface.** Pirate Ship has no public/developer API; its 14 integrations are inbound — they pull orders _from_ a named e-commerce store. There is no path for an application to push a shipment and receive a label. The only non-store option is manual spreadsheet upload.
- **No certified mail or return receipt.** Pirate Ship does not support Certified Mail at all — which is a hard requirement for legal mail (service of process, certified letters), not a nice-to-have.

EasyPost keeps the value (the cheap-postage proposition) and adds what the firm needs: a real REST API; USPS rates negotiated **at or below** USPS Commercial Pricing (the same tier Pirate Ship draws from); certified mail + return receipt + electronic proof of delivery/signature as USPS extra services; and a white-label platform billing model (§3) that makes the firm-facing service-fee economics work. The port stays vendor-neutral, so Shippo or USPS-direct can be added later as sibling adapters without touching callers.

## 1. Module placement

- **`@magna-carta/integrations`** (built) — _additive only_ (ADR-0095): widen the credential union with `ApiKeyCredential` (`{ kind: "apiKey"; apiKey: string }`) and add `{ kind: "apiKey"; scope }` to `CredentialRequirement`. `AdapterContext.credential` already carries any `Credential`, so nothing else in the framework changes. The OAuth/refresh-token/Durable-Object-lock machinery is untouched and unused by this adapter.
- **`@magna-carta/shipping`** — new domain package. Defines `ShippingPort` (our vocabulary), the canonical record schemas + zod boundary, and the **EasyPost adapter** under `adapters/easypost/`. Depends inward on `@magna-carta/integrations` (port + canonical base), `@magna-carta/identifiers` (handles), `@magna-carta/money` (amounts). No D1, no Hono, no `env` — I/O arrives through the injected credential accessor.
- **`packages/data-access`** — lands the deferred `integration_connection` repository (firm-scoped) and the new `shipment` / `shipmentLabel` / `trackingEvent` repositories, all behind the firm-scoped gate (golden rule 3).
- **`packages/database`** — one per-firm migration: `integration_connection`, `shipment`, `shipment_label`, `tracking_event`. Label PDFs live in **per-firm R2**, referenced by key — never in D1 (golden rule 3).
- **`apps/worker`** — composition root: registers the EasyPost adapter at startup; mounts connection-management routes, shipping routes, and the EasyPost tracking webhook through the slice 0·5 chokepoint.
- **SvelteKit app** — the shipping UI, styled only through `@magna-carta/design-system` (golden rule 2). Built after the design-system foundation (0·7a) lands.

Direction: `integrations` ← `shipping`/`data-access`; `worker` wires them. The adapter depends inward on the port, never the reverse.

## 2. A — `ShippingPort` + EasyPost adapter

- **Operations (our domain vocabulary, not EasyPost's):** `validateAddress`, `rateShipment`, `buyLabel`, `getTracking`, `refundLabel`. The port is named in our terms; the adapter maps EasyPost's `Address` / `Shipment` / `Rate` / `Tracker` payloads into it.
- **Extra services are canonical options, not operations.** A `ShipmentOptions` record carries `certifiedMail?`, `returnReceipt?: "none" | "electronic" | "physical"`, `signatureConfirmation?`, `insuranceAmount?` (money). The adapter maps these to EasyPost `options` (`certified_mail`, `return_receipt`, …). Modeling them as data, not methods, keeps the operation set small and lets the descriptor advertise support without method explosion.
- **Canonical models** — each carries the vendor-native `remoteId` and an opt-in untouched `raw`, validated through `canonicalRecordSchema` at the boundary (external data is untrusted): `Address` (+ verification result), `Parcel` (dimensions/weight or a predefined package), `Rate` (carrier, service, `amount` money, delivery-day/ETA estimate), `Label` (tracking code, carrier/service, R2 label ref, `cost` money), `TrackingEvent` (status, occurred-at, location, message).
- **Capability descriptor:** `adapterId: "easypost"`, `category: "shipping"`, `credential: { kind: "apiKey", scope: "firm" }`, all operations supported, `passthroughAvailable: true` (EasyPost has a long carrier/option tail; the proxy escape hatch is available but never the spine). Errors map into the framework's `IntegrationProblem` taxonomy (`auth` | `rate_limit` | `validation` | `upstream` | `network`), which drives retry and the connection health state machine.
- **Scope is firm, not user.** A firm has one shared postage account/wallet; the connection keys on `{ firmId }`. (The ethical-wall argument that makes calendar/email user-scoped is weak for outbound postage.)
- **First-credentialed-adapter seams this slice lands** (deferred by ADR-0091/0092 to exactly this point): the per-firm `integration_connection` D1 repository; the **`firm_secret`-backed `CredentialStore`** (`get`/`put` over slice 1·2's `getSecret`/`putSecret`, `firm:manageSecrets`-gated, envelope-encrypted) — _gated on 1·2_; and the worker connect/health/disconnect routes. No OAuth, no refresh lock — an API key has no refresh.

## 3. Provider relationship — EasyPost Forge

- **Forge, Child Users, Centralized Billing.** Magna Carta holds the parent EasyPost account; each firm is a **child user** created via the parent key (at firm provisioning or first shipping use). The firm's credential is its child-user API key, stored in `firm_secret`. Postage bills flow through the parent — Magna Carta controls postage and firm-facing pricing, which is what makes the §5 service-fee model possible.
- **Free-label allowance is parent-level (platform-aggregate),** across all firms — not per firm. The fee policy therefore computes margin from EasyPost's **actual charged cost per label** (returned on purchase), never from an assumed per-firm free tier.
- **Test vs production mode** is part of the connection record so a firm (and CI) can exercise the flow against EasyPost test keys.
- **Procurement / commercial gate (not engineering):** Forge is a contracted EasyPost platform product. Like the calendar adapter's CASA gate, _building_ the adapter and _contracting Forge_ are separate tracks — name it early and start it in parallel; engineering builds against the documented API regardless.

## 4. B — shipping vertical slice

- **Per-firm schema:**
  - `shipment` — `{ id (shipment_…), matter_ref?, from_address, to_address, parcel, options, status, selected_rate?, carrier?, service?, tracking_code?, label_ref?, postage_cost_minor?, service_fee_minor?, created/updated, audit }`. Status: `draft → rated → purchased → in_transit → delivered | refunded`.
  - `shipment_label` — `{ id, shipment_ref, format, r2_key, tracking_code, cost_minor, voided }`.
  - `tracking_event` — `{ id, shipment_ref, status, occurred_at, location?, message?, remote_id }`.
- **Label handling:** EasyPost returns a label at an expiring URL. On purchase the worker fetches the PDF and stores it in per-firm R2 (reusing the file-manager storage path); the app serves it from R2, never by hotlinking EasyPost.
- **API (code-as-contract, OpenAPI, through the chokepoint):**
  - `POST /v1/shipments` — create a draft (from/to/parcel/options, optional `matter_ref`).
  - `POST /v1/shipments/:id/rates` — rate-shop (`rateShipment`).
  - `POST /v1/shipments/:id/purchase` — buy the selected rate (`buyLabel`); **idempotent** (chokepoint idempotency key + EasyPost idempotency) so a retried purchase never double-buys; stores the label to R2; advances status.
  - `GET /v1/shipments/:id/label` — the stored label PDF.
  - `GET /v1/shipments/:id/tracking` — tracking events.
  - `POST /v1/shipments/:id/refund` — void/refund an unused label (`refundLabel`).
  - `POST /v1/webhooks/easypost` — HMAC-verified tracking ingress: append `tracking_event`, advance status.
  - Connection management: `POST /v1/integrations/shipping/connection` (store the child-user key → `firm_secret`, create the connection), `GET` health, `DELETE` disconnect — `firm:manageSecrets`-gated, audited.
- **UI flow** (design-system only): recipient (a Directory contact / matter party / manual address) → package (predefined letter/flat/box, or dimensions + weight) → options (certified, return receipt, signature, insurance) → **rate-shop** (carrier / service / price / ETA) → confirm, showing **postage and the explicit service fee as separate lines** → buy → print label PDF → track. Plus an admin connection screen (connect/rotate key state, wallet health). Linked to **Matters** and **Directory** (both built) and firm **Locations** (built) for from-addresses.

## 5. C — service fee + client cost recovery (seam now, built with Phase 3)

- **Service fee (platform revenue, Magna Carta → firm).** A **configurable fee policy** at the firm/plan level — _not_ a hardcoded "3,000 free / $0.05," because EasyPost does not publish the monthly/lifetime nature of the free tier or the overage price, and the allowance is parent-aggregate (§3). On purchase the shipment records EasyPost's actual charged cost (`postage_cost_minor`) and the computed `service_fee_minor`; margin is derived from truth and stays correct whatever EasyPost's real tier is. Surfaces on the firm's platform invoice. EasyPost FlexRate (platform-side markup) is the **non-chosen** alternative — rejected because a law firm needs the true postage and the fee as _separate_ itemized lines.
- **Cost recovery (firm → client).** Postage (± the service fee, per firm preference) posts as a **matter disbursement / hard cost** into the ledger for client recovery. Built with the Phase 3 financial core. Until then the cheap seam is already in place (ADR-0078): the shipment carries `matter_ref` + the cost columns, so the Phase 3 build is a posting hook that turns a purchased shipment into a cost entry — not a schema retrofit.

## 6. Cross-cutting

- **Money.** Every amount flows through `@magna-carta/money` (`amount_minor`); no floats, no ad-hoc currency math.
- **Secret safety.** The child-user API key is never logged, `JSON.stringify`-d, or placed on any telemetry/observable path (golden rule 4 + the framework's `Credential` discipline). At rest it lives only in `firm_secret` (envelope-encrypted, per-firm).
- **Idempotency.** Purchase is idempotent end-to-end; the webhook reconciles by `(remote_id)` so a redelivered tracking notification is a no-op.
- **Compute placement (ADR-0039).** Single purchase + label fetch run inline. Tracking is async by nature (webhook). A bulk/batch label run offloads to a Queue — a designed seam, not built until a batch use case exists.

## 7. Testing & load profile

- **`@magna-carta/shipping` unit:** the canonical/zod boundary (valid maps through, malformed refused), descriptor honesty, adapter mapping against mocked EasyPost payloads (including certified-mail / return-receipt option mapping and address verification), and error-taxonomy mapping (EasyPost errors → `IntegrationProblem` categories).
- **data-access:** the `integration_connection` and shipment repositories through the firm-scoped gate — tenant isolation proven (a connection or shipment never resolves across firms; a credential never crosses firms).
- **Worker (Miniflare):** the connect flow (API key → `firm_secret` seam), purchase (mocked EasyPost) with idempotency, webhook HMAC verification + tracking append, and label→R2 storage; connection-management routes audited through the 0·5 chokepoint.
- **Fitness:** API-key redaction (no secret on any log path), adapter-not-imported-by-core (dependency-inversion guard), and every registered adapter ships a descriptor.
- **Load profile (accretion rule, ADR-0083):** shipments-per-matter + tracking-event volume joins the harness through the real write paths; volume-shaped reads (a firm's shipment list, a matter's shipments, a shipment's tracking history) join the measured set. Data via write-path fixtures, never raw inserts (ADR-0034).

## 8. Decisions recorded & docs to update

- **New ADRs (Decision Log):** **ADR-0094** (shipping & postage subsystem + EasyPost as the first credentialed adapter — provider rationale per §0, Forge billing per §3) and **ADR-0095** (the API-key credential kind — amends ADR-0091/0092, which assumed the first credentialed adapter would be OAuth).
- **On build:** a new slice row in [`ROADMAP.md`](../../ROADMAP.md) + [`STATUS.md`](../../STATUS.md) (and a STATUS correction — the integration port framework is built, not `[ ]`); the white-paper _Integrations_ section gains the shipping feature; `CHANGELOG.md`; and user docs ([`docs/user/`](../user/)) ship with the UI (golden rule 5). The build gate is slice 1·2's `firm_secret` backing (in progress); piece C additionally gates on the Phase 3 financial core.
