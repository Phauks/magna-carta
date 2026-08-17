---
number: 329
slug: a-processor-event-is-append-only-and-its-remote-id-is-the-idempotency-key
status: Proposed
date: 2026-08-15
area: Payments
summary: "A payment carries no status column: state is derived from an append-only payment_event log, the same way a pending disbursement is a request no decision names and an active hold is a hold no release names. A status column and an event log disagree the first time a webhook arrives out of order, and the column is the one that gets believed. The webhook is the platform's first inbound one, so the idiom is specified: signature verification over the RAW bytes before any parsing, with a constant-time compare and a replay window; the firm named by an unguessable per-firm path segment, because the signing secret is per-firm and the body is attacker-controlled until the signature verifies; runIdempotentEffect keyed payments:{adapterId}:{remoteEventId} rather than the Idempotency-Key header a processor does not send; and UNIQUE (adapter_id, remote_event_id) as the commit-time guarantee rather than a read-then-write pre-check. idempotencyMiddleware must never be mounted in front of a webhook route — it reads the body through context.req.json() and consumes the raw stream the signature is computed over. A scheduled settlement pull re-asserts the processor's truth, because webhooks are lost."
---

**The processor's state lives in an append-only log, and the webhook that carries it is the first inbound one this platform has.**

**Context:** a payment has a lifecycle — authorized, captured, settled, refunded, returned, charged back — and every one of those transitions is the processor's fact rather than ours. There is a strong pull toward a status column, and this repository has refused it everywhere else for a reason that applies with more force here than anywhere: webhooks arrive out of order, are delivered more than once, and are lost.

There is also no inbound webhook anywhere in this repository to copy from. The integration framework's adapters are all outbound. So the idiom is specified here rather than inherited, and getting it wrong is a class of failure — a forged capture, a replayed refund, a payment recorded twice — that is expensive in exactly the way the rest of the financial core is careful about.

**Decision:**

(1) **No status column, on either table.** `payment` holds the intent and destination; `payment_event` holds one append-only row per confirmed processor event, each naming the processor's own event id, the effective date the event happened on, and the ledger entry it composed where it moved money. State is derived. Both tables carry the append-only triggers the rest of the financial core carries, including the `no_replace` BEFORE INSERT guard, because `INSERT OR REPLACE` does not fire the update or delete triggers.

(2) **Signature verification is over the raw bytes, before any parsing**, with a constant-time comparison and a timestamp window that rejects a replay. The scheme is the vendor's and belongs behind the port as `verifyWebhook`, so the route never learns it — the same boundary that keeps EasyPost's error shapes out of the shipping route.

(3) **The firm is named by the URL path, by an unguessable per-firm segment.** The signing secret is per-firm, so the firm must be identified before the signature can be checked; the body cannot supply it because the body is attacker-controlled until the signature verifies. A firm id will not do — it is not a secret and appears in ordinary URLs. The segment is minted at connect time and rotatable.

(4) **Idempotency is keyed on the processor's event id and settled at commit.** The route calls `runIdempotentEffect` with `payments:{adapterId}:{remoteEventId}`; the per-firm databases are physically isolated, so no tenant prefix is needed. The guarantee is `UNIQUE (adapter_id, remote_event_id)` on `payment_event`, which makes a duplicate delivery lose its whole batch at commit, on the same reasoning as `releases_hold_id` and `reverses_application_id`. A guard that could store a row is a write, not a guard.

(5) **`idempotencyMiddleware` is never mounted in front of a webhook route.** It reads the body through `context.req.json()` and consumes the raw stream, so the bytes the signature is computed over would be gone — and the failure would present as a wrong secret rather than as a consumed stream. This is recorded as a decision rather than a comment because the middleware is the house idiom for exactly this kind of route and reaching for it is the obvious move.

(6) **A scheduled settlement pull is part of the design, not a later hardening.** On the existing daily cron pass, `listSettlements` re-asserts the processor's truth over stored events. The self-serve provisioning spec already states the principle for the platform's own subscription billing — webhooks are lost, reconciliation is not optional — and a payments subsystem whose only input is a webhook stream loses money quietly.

**Consequences:** the platform gains an inbound-webhook idiom that the messaging and telephony ports will inherit rather than reinvent, and it is specified with the signature, the tenant routing and the idempotency answered together, because each of the three constrains the other two. The rotation story for the path segment is flag K10 in `docs/specs/2026-08-15-payments-design.md`. Builds on **ADR-0063** (idempotency), **ADR-0064** (the outbox), **ADR-0091** and **ADR-0092** (the port and its credentials).
