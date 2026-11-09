# Payments — implementation plan

**This plan does not start.** Seven build-gating owner flags in
[`2026-08-15-payments-design.md`](2026-08-15-payments-design.md) — **K1 through K7** — decide what is
in it. Two of them (K1, K2) decide whether stages 1 and 3 below exist at all, and one (K3) decides
whether stage 4 is buildable. The plan is written now so that answering those seven flags is the only
work between here and a first commit.

**Ordering principle.** Each stage is a vertical slice — schema through the firm-scoped data-access
layer, domain, route, interface, tests and documentation — and each ships something a firm can use.
The ordering is by _how much of it can be true without an outside party_: the manual receipt needs
nobody, the operating card rail needs a merchant account, and the trust rail needs a merchant account
configured a specific way plus a trust schema change.

---

## Stage 1 — The manual receipt (gated on K1; no processor, no port)

The whole point of this stage is that it has no external dependency at all. It closes the gap that
motivated the work: billing shipped and a firm cannot record being paid.

1. **Two account roles.** Add `payments_clearing` and `merchant_fees` to `ACCOUNT_ROLES` in
   `packages/billing/src/types.ts`. They resolve through the existing `firm_account_role` map and
   **refuse by name when unmapped**, exactly as `accounts_receivable` does. `merchant_fees` is unused
   in this stage and is added now because the map is configuration a firm sets once (gated on K8).

   **The TypeScript array is not the constraint, and adding a role to it alone ships a role the
   database refuses.** `firm_account_role` carries a DDL `CHECK` listing every permitted role by
   name, and SQLite cannot widen one in place — so this step is a table rebuild with a data copy, not
   an edit to a constant. The general-ledger slice needs the same widening for two more roles, and
   doing it twice means rebuilding a table the first slice just rebuilt. Read
   [`2026-08-26-account-role-vocabulary-widening.md`](2026-08-26-account-role-vocabulary-widening.md)
   before starting this task: it recommends one widening for all four roles, ahead of both slices,
   and names what has to be answered first.

2. **Open the `payment` kind.** Remove `payment` from the refusal in
   `packages/billing/src/application.ts` and delete the `KINDS_WITH_A_WRITE_PATH` guard's comment
   about rails being a later slice. No schema change: the CHECK already admits the kind and
   `invoice_application_entry_paired` already requires it to name its own entry.
3. **The receipt composer.** A new `packages/billing/src/receipt.ts`: takes an invoice, a matter, an
   amount, a method (`check` | `cash` | `wire` | `card_terminal`), a reference, an effective date and
   a recording member; composes `Dr Operating Bank / Cr Accounts Receivable` through the account-role
   map and the application that names it, in one batch. Pure, returns `EffectWrite`, no clock read.
4. **Receipt and application stay two acts.** Compose them together when the amount fits and refuse
   the application alone when it does not — the money is recorded either way. Section 4.3 of the
   design; the refusal names the invoice and its state.
5. **Route, contract, interface.** `POST /invoices/{id}/receipts` behind `billing:apply`, with the
   idempotency requirement the mutating-route convention sets, OpenAPI as code-as-contract, and the
   receipt surface on the invoice detail page through `@magna-carta/design-system`.
6. **Fitness.** Every `payment` application names exactly one entry crediting accounts receivable for
   its amount.
7. **Docs.** `docs/user/` for the firm-facing "record a payment" task; the changelog fragment; the
   ledger nodes.

**Depends on nothing outside the repository.** If K1 is answered yes, this stage can start the day the
flags come back.

## Stage 2 — The payments package, the port, and the record (gated on K2, K9)

1. **`@magna-carta/payments`**, pure: no D1, no Hono, no `env`, an injected `HttpClient`.
   `PaymentsPort` with the five methods in the design's section 5.1, canonical records built with
   `canonicalRecordSchema` carrying `remoteId` and opt-in `raw`, every method returning `Dispatch`.
   Modelled on `packages/shipping` file for file.
2. **The capability descriptor** with the ten operations named in the design. `grossTrustSettlement`
   and `separateFeeAccount` are the two the trust rail branches on.
3. **`payment` and `payment_event` schema.** Append-only triggers on both, including the
   `no_replace` BEFORE INSERT guard the other financial tables carry. `UNIQUE (adapter_id,
   remote_event_id)` on `payment_event`. No status column on either.
4. **Identifiers.** `payment` and `paymentEvent` in `packages/identifiers/src/registry.ts`, spelled
   in full.
5. **Fitness and a source scan.** No file in `@magna-carta/payments` composes a `trust_*` statement.

## Stage 3 — The operating card and ACH rails, end to end (gated on K2, K7, K8, K10)

1. **The Helcim adapter** behind the port, with the hosted-modal session, the settlement pull, the
   refund, and `verifyWebhook`. Credential `{ kind: "apiKey", scope: "firm" }`, resolved through
   `CredentialStore` over `firm_secret`. Never log the key; never splice an upstream body into an
   error detail.
2. **The webhook route**, the platform's first: raw-byte signature verification before any parsing,
   constant-time compare, timestamp window, per-firm unguessable path segment, and
   `runIdempotentEffect` keyed `payments:{adapterId}:{remoteEventId}`. It does **not** mount
   `idempotencyMiddleware` — that middleware consumes the raw stream the signature is computed over.
3. **The clearing-account posting pair.** Capture posts `Dr Payments Clearing / Cr Accounts
   Receivable`; settlement posts `Dr Operating Bank` plus `Dr Merchant Fees` against
   `Cr Payments Clearing`. One settlement entry per bank line.
4. **The scheduled settlement pull** on the existing daily cron pass, re-asserting the processor's
   truth over stored events. Not optional: webhooks are lost.
5. **The payer surface**, whose shape K7 decides — staff-operated modal, one-time pay link, or
   deferred to the portal.
6. **Refunds.** Full refund as a `reversal` application with its stated reason; partial refund as a
   full reversal plus a smaller payment application in one batch.
7. **Fitness.** The clearing balance equals captured-but-unsettled; no `charged_back` event shares an
   effective date with its payment's `captured` event.

## Stage 4 — The trust rail (gated on K2, K3, and a confirmed merchant configuration)

**Do not start this stage before K3 is answered.** Without a representable returned deposit, a firm
that takes an ACH return or a chargeback on a trust deposit has an unrecordable event and an
unreconcilable statement, which is worse than not offering the rail.

1. **The returned-deposit movement kind** (K3), if the owner directs it: a fourth
   `TRUST_MOVEMENT_KIND` with the processor as counterparty and no authorizer, on the bank-charge
   precedent, plus the shape CHECK amendment and the fitness re-proof. This is a change to
   `@magna-carta/trust` and belongs to that package, not to payments.
2. **The descriptor gate.** The trust rail dispatches `capability-unsupported` unless the adapter
   declares both `grossTrustSettlement` and `separateFeeAccount`.
3. **The deposit.** `composeTrustDeposit` with method `card` or `electronic_transfer`, for the
   **gross** amount, through `composeTrustEntry`. Payments reimplements no trust rule and composes no
   trust statement of its own.
4. **The fee, entirely elsewhere.** `Dr Merchant Fees / Cr Operating Bank`, an unrelated entry, joined
   to the deposit only by the `payment` row.
5. **The refusals, each with its own test:** a netted deposit; a fee line on a trust entry; a
   firm-funds movement composed from payments; a firm-money deposit onto a client leaf dressed as a
   client deposit.
6. **The uncollected-funds hold** (K11), if directed.
7. **Fitness.** Every payment-produced `trust_movement` has a gross entry amount and a `payment` row
   naming it; no `payment_event` names both a trust entry and a fee entry.

## Deliberately not in this plan

- **Surcharge** (K6). It needs a typed jurisdiction requirement that does not exist, primary-source
  research across 56 jurisdictions, an attorney review of each profile, and card-network
  registration — the last of which is procurement with weeks of lead time, on the A2P 10DLC
  precedent.
- **Stored payment methods** (K5). Shape settled in the design; whether to build it is not.
- **The operating bank reconciliation.** The clearing account is designed so it will work; building
  it is the operating general ledger's slice.
- **The platform's own subscription billing.** A different payer and a different direction, with its
  own specified seam.
- **The Texas transit-account arrangement and the Arizona merchant-fee cushion.** Both are lawful
  shapes the corpus records and neither is buildable without jurisdiction research and an attorney
  review that has not happened.
