# Payments — design

**Status:** Design only. No code, no schema, no migration, no route. Seven of the twelve owner flags
in this document decide **what gets built**; the implementation plan beside it
([`2026-08-15-payments-implementation-plan.md`](2026-08-15-payments-implementation-plan.md)) does not
start until those seven are answered.

**Owner-flag series: `K`.** Numbered in its own letter series so an answer to a payments question can
never be mistaken for an answer to a trust (`T`), discovery (`P`), notifications (`N`), financial
(`F`) or other design's flags.

**White paper:** _Payments_, read with _Financial Core — Trust accounting_ and _Financial Core —
Billing_. **Binding decisions:** ADR-0032 (the payments posture), ADR-0181 (PCI SAQ A), ADR-0091 and
ADR-0092 (the integration port system and its connection model), ADR-0008 / ADR-0072 (the ledger),
ADR-0009 / ADR-0032 (trust). **Invariants:**
[`docs/conventions/invariants.md`](../conventions/invariants.md),
[`packages/trust/CLAUDE.md`](../../packages/trust/CLAUDE.md),
[`packages/billing/CLAUDE.md`](../../packages/billing/CLAUDE.md).

**Rules read, not invented:** [`docs/research/trust-rules/`](../research/trust-rules/) (the
56-jurisdiction narrative corpus) and
[`docs/research/2026-08-07-nevada-trust-accounting-rules.md`](../research/2026-08-07-nevada-trust-accounting-rules.md).

---

## 1. What was already settled, and what has drifted

Payments is nine capabilities in the feature ledger and eight of them are `not-started`. What is
_decided_ is considerably more than what is built, and none of it is reopened here.

| Already settled                                                                                                                                                                  | Where          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Payments is a **port** with swappable vendor adapters; the goal is lowest fees, which is an architecture problem rather than a vendor one                                        | ADR-0032       |
| **ACH is the default, prominent rail**; card is the convenience fallback. Interchange is the network floor and no processor prices below it                                      | ADR-0032       |
| **Fees never touch trust.** Trust deposits land gross; a fee debits operating, enforced by separate deposit routing rather than by a caller choosing well                        | ADR-0032       |
| **Surcharge on operating card payments only**, where the jurisdiction permits it; never on a trust deposit, never on debit                                                       | ADR-0032       |
| **Helcim is the launch adapter**; Stripe/Dwolla, Adyen, and Confido/Gravity Legal are named swap seams. LawPay-style turnkey processors rejected as the primary                  | ADR-0032       |
| **PCI SAQ A via the hosted payment modal** (the HelcimPay.js iframe) returning a `cardToken` — not the in-DOM tokenizer (SAQ A-EP), not the raw card API (SAQ D). No PAN, no CVV | ADR-0181       |
| The payment surface carries **no third-party scripts**, per PCI v4.0.1                                                                                                           | ADR-0181       |
| A port is named in our vocabulary, an adapter publishes a **capability descriptor**, dispatch is a **typed sum that never throws**, and a connection is scoped by the port       | ADR-0091, 0092 |
| Credentials live in the per-firm envelope-encrypted `firm_secret` store behind `CredentialStore`; an adapter never sees key material                                             | ADR-0092, 0084 |

Two drifts worth recording rather than repeating:

- **The white paper still says "hosted fields / tokenization (e.g. Helcim.js)".** ADR-0181 rejected
  exactly that, by name, because in-DOM tokenization is SAQ A-EP. The white paper's _Payments_
  wording is superseded and should be corrected when that area is next edited; this document builds
  against ADR-0181.
- **The feature ledger's `payments.trust-separation` node says the invariant has "no payment code to
  enforce it yet".** That is half true and the wrong half is load-bearing: the rule is already
  enforced structurally, by `assertTrustComposition`, for every caller including a card rail that
  does not exist. The payments work does not _add_ the enforcement; it inherits it by calling
  `composeTrustEntry`, and its own job is to have somewhere else for the fee to go.

## 2. The mechanism a payment has to fit

Billing shipped. A payment is the other half of a mechanism that exists, and almost every question
below is answered by the mechanism rather than by this design.

**An invoice has no stored total and no stored balance.** Both derive from `invoice_matter_balance`,
one row per matter on the bill. "Outstanding" is `total_minor - applied_minor` on that row. A payment
therefore never touches the `invoice` header and cannot drift from the subledger.

**Value reaches an invoice through exactly one door.** `composeInvoiceApplication` writes an
append-only `invoice_application` row plus an unguarded delta on `invoice_matter_balance`, and the
bounds CHECK on that column is what aborts a whole D1 batch when more value is applied than the bill
can absorb. There is no second path and this design adds none.

**`payment` is already a first-class application kind.** The `invoice_application_kind_check`
constraint has admitted `'payment'` since the invoices migration, deliberately, because SQLite cannot
widen a CHECK without a destructive table rebuild the schema policy forbids. Today
`composeInvoiceApplication` refuses the kind by name (`application-kind-not-built`), with a comment
saying why: an application with nothing on the firm's books to match it would reduce what a client
owes with no posting behind it.

**The trigger already tells a payment what to do.** `invoice_application_entry_paired` requires every
kind except `trust_transfer` and `credit_note` to name its own `entry_id`. A payment application is
therefore obliged to carry the ledger entry that recorded the money arriving. **No billing schema
change is needed for an operating payment.** That is the single most useful fact in this section.

**`billing:apply` already exists** and its registry comment already reads "move client money onto a
finalized invoice (payments, earned fees taken from trust)". Payments needs no new billing
capability.

**The outbox already names the topic.** `packages/data-access/src/outbox-statements.ts` uses
`'payment.capture'` as its illustrative topic. The asynchronous seam was anticipated.

On the trust side the mechanism is stricter and the relevant parts are these:

- `composeTrustEntry` is the only supported door for an entry touching client money, and its
  no-commingling check refuses **any** line outside the trust account — an operating bank, an income
  account, a fee expense. A processor fee has nowhere to sit on a trust entry at all.
- The **second door**, `composeTrustFirmFundsEntry`, admits exactly two lines: the account's
  firm-funds node and that same account's bank leaf. `trust_firm_funds_movement` has two kinds,
  `firm_funds_deposit` and `bank_charge`, and no others.
- Attribution is **derived** from the matter's own client party and re-checked on every movement. A
  caller does not name whose money a leaf holds.
- `TrustMovementMethod` already includes `card` and `electronic_transfer`, recorded as a value rather
  than buried in a description, because a jurisdiction rule cannot forbid a method the engine cannot
  see. **A trust deposit by card is already expressible today.**
- The three-way proof is `bank = book = client + firm funds`, every leg computed from dated ledger
  rows, and a reconciliation match is **one statement line clearing one ledger entry**.

## 3. Where the processor fee lands for a trust-destined payment

This is the question the design lives or dies on, so it is answered in parts.

### 3.1 It lands on the firm's operating account, as the firm's own expense, always

A trust-destined payment produces **two independent ledger entries and no link between them at the
entry level**:

|           | Entry                                                                     | Door                                           |
| --------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| The money | `Dr Trust Bank / Cr the client's matter leaf`, for the **gross** amount   | `composeTrustDeposit` → `composeTrustEntry`    |
| The fee   | `Dr Merchant Fees (expense) / Cr Operating Bank`, for the processor's fee | the plain ledger — no trust account is touched |

There is no third option, and the reason is structural rather than preferential. Netting the fee out
of the deposit needs one entry with a trust leaf and a fee expense on it, which
`assertTrustComposition` refuses as `commingled-entry`. Putting the fee on the firm's cushion inside
the trust account needs a `trust_firm_funds_movement` kind that does not exist, and the one that does
exist — `bank_charge` — means the institution's service charge, which a card processor's discount fee
is not.

**The two halves cannot be joined by a ledger entry, so they are joined by a record.** That is the
central design move of this whole subsystem: the `payment` row names the trust movement and the fee
entry, and the join lives outside the ledger precisely because putting it inside would be the
commingling.

### 3.2 What the operating account has to do to make that lawful

The fee has to be **debited from a different bank account than the one the deposit landed in**, and
that is a configuration at the processor, not a computation here. The merchant account serving the
trust rail must be set up so that:

1. **Deposits settle gross** — the full transaction amount reaches the trust bank account, with
   nothing withheld.
2. **Deposits settle per transaction**, not as a batched net figure (section 6 explains why this is a
   reconciliation requirement and not only a compliance one).
3. **Every fee, adjustment, reversal and chargeback is debited from the operating account**, never
   from the trust account.

This is the arrangement the industry calls a dual-account or split merchant configuration, and it is
what the trust rules are actually asking for when they say a fee may not reduce client principal. The
platform cannot verify a processor's back-office configuration, so it does the next best thing: the
**capability descriptor declares it**. An adapter that cannot state
`grossTrustSettlement: { supported: true }` and `separateFeeAccount: { supported: true }` returns
`capability-unsupported` for the trust rail, which is a first-class dispatch outcome the caller
branches on rather than an error it catches. The operating rail is unaffected and still works.

### 3.3 What happens when a processor debits a fee from the same account it deposited into

It cannot be recorded, and that is the correct outcome. Walking the three things a firm or a future
developer would reach for:

- **Net it out of the deposit.** Refused by `assertTrustComposition`. The deposit lands gross or not
  at all.
- **Record it against the firm's cushion in the trust account.** Unrepresentable. The second door's
  category is closed at two kinds, `trust_firm_funds_movement` carries no payee, and widening it
  would need a jurisdiction fact nobody has (section 3.4). Note carefully that this is _not_ the same
  as the bank-charge case even though the money moves identically: the rule text authorizes the
  cushion for the institution's service charges and says nothing about a card processor's discount
  rate.
- **Have the firm deposit its own money to cover it.** This one is the trap, because it _is_
  expressible: `composeTrustDeposit` takes a free-text `source`, so a firm could deposit its own
  money onto a client's matter leaf and call the source "the firm". The composition guard cannot
  catch it — the entry's other leg is the trust bank, so no line is outside the trust account and
  nothing looks wrong. **That is bare commingling wearing a client deposit's face, and the design
  must refuse it by name rather than document it as a workaround.**

So what the platform actually does is **surface it and refuse to paper over it**. A processor fee
debited from the trust bank arrives as a bank statement line that no ledger entry can clear. It sits
in `readUnmatchedTrustBankStatementLines` forever, the three-way proof reports a `bank-to-book`
difference of exactly that amount, and `closeTrustReconciliation` freezes the unbalanced answer. That
is the existing posture ("an unbalanced proof is recorded, never forced") applied to a condition
reconciliation exists to catch, and it is the honest state: the firm's merchant account is
misconfigured and the firm has a real shortfall in a client trust account.

Owner flag **K12** asks whether the platform should go one step further and _name_ that diagnosis on
the reconciliation surface ("a payment processor is debiting this trust account") rather than showing
an ordinary unmatched line. It is a detectable pattern; it is also a claim about the firm's conduct
on a record a disciplinary body may read, which is why it is a flag and not a decision.

### 3.4 What could not be established

**The jurisdiction fact that would settle whether a processor fee may reduce client principal is
unresearched, on the only jurisdiction the platform ships.**

`@magna-carta/trust-jurisdictions` already carries a typed requirement for exactly this question —
`processorFees: { mayChargeClientPrincipal: boolean }` — in the `data` bucket, meaning a wrong silence
would assert a wrong fact about the world and it may therefore **never** resolve from silence.
Nevada's profile records it as `GAP`, with the note: NRPC 1.15, SCR 78, SCR 216-221 and the State Bar
of Nevada's trust-accounting handbook were all searched for `credit card`, `processing fee`,
`merchant`, `surcharge` and `processor`, and no hit addresses how a card-processing fee interacts with
a trust deposit. The State Bar ethics-opinions index was never worked through, so this is
_unresearched_ rather than _silent_ — the two are opposite types here and the field refuses to
resolve. Nevada also ships with `attorneyReview: null`, so every requirement on it currently refuses
with `jurisdiction-not-verified` regardless.

The wider corpus is consistent about the principle and thin about the authority. Across the 56
jurisdictions the recurring line is "processing fees must not be charged against client principal;
the lawyer must ensure chargebacks and fees do not invade other clients' funds" — but it is marked
`[KNOWLEDGE]` or `Unknown / needs verification` in the large majority of entries, meaning it is the
general understanding rather than a verified primary-source quote. Four jurisdictions do address it
expressly, and they matter because they are the ones that would change the design:

- **Arizona** (ER 1.15(b) with Rule 43(a)) is the most explicit trust rule on cards in the country.
  It permits the lawyer's own funds in trust not only for bank service charges but expressly to
  **pay merchant or credit-card transaction fees and to offset credit-card chargebacks**, and to
  cover earned fees bundled into a single card transaction that also pays advance fees. Arizona's
  carve-out is materially broader than the second door this platform built.
- **Texas** (2023 amendments) permits a card or electronic advance payment to be received in a
  **non-trust account** and transferred to trust within two business days, and requires the lawyer to
  **reimburse the trust account for any chargeback, surcharge or ACH-reversal shortfall within three
  business days** and before any disbursement.
- **Maine** (RPC 1.15(b)(1)) has the same two-business-day transit-account carve-out for effecting a
  card payment.
- One further jurisdiction in the verification pass permits firm funds in trust for "bank service
  charges **and fees associated with credit card payments or electronic funds transfer payments**".

So there are at least three distinct lawful arrangements in the corpus — gross-to-trust with a
separate fee account, a transit account with a stated transfer window, and a broadened firm-funds
cushion that absorbs merchant fees and chargeback offsets — and the platform structurally supports
exactly the first. **This design does not pick between them and does not need to**, because the
arrangement it implements is safe under every possible answer to the unresearched question: it never
charges the client's principal, so it does not exercise the permission `processorFees` would grant. Any
arrangement that _would_ need the field to resolve is refused by name until it does. That inherits the
corpus's refusing-rather-than-defaulting posture instead of inventing a softer one.

What a future slice would need before it could build the Arizona or Texas shape: primary-source
research on `processorFees` for the jurisdictions concerned, an attorney review of each profile, and
in the Texas case a whole new typed requirement for the transit window and the reimbursement deadline.
Owner flags **K2** and **K3** hold that line.

## 4. What a payment record is

### 4.1 Two tables, and no status column on either

**`payment`** — the intent and its destination. One row per attempt a firm or a client makes to move
money, whatever becomes of it.

Carries: the rail (`ach` | `card`), the destination (`operating` | `trust`), the amount and currency,
the client entity, the matter (for a trust destination, required; for an operating destination, the
invoice's), the adapter id, the processor's own payment reference, who initiated it, and when. It
carries **no status**.

**`payment_event`** — one append-only row per event the processor confirms: `authorized`, `captured`,
`settled`, `refunded`, `returned`, `charged_back`, `failed`. Each names the `payment` it belongs to,
the processor's own event id, the effective date the event happened on, and — where the event moved
money on the firm's books — the ledger entry it composed.

**Both are append-only by trigger**, on exactly the reasoning `invoice_application`, `trust_movement`
and `credit_note` already carry. Everything financial in this repository is append-only and payments
is not the exception.

**A payment's state is derived from its events**, the same way a pending disbursement request is a
request no decision names and an active hold is a hold no release names. This is not stylistic
consistency for its own sake: a status column and an event log will disagree the first time a webhook
arrives out of order, and the column is the one that will be believed.

### 4.2 What the payment record is _for_

Three things, and it is worth being explicit because a reader will otherwise wonder why the ledger is
not enough:

1. **It is the join the ledger cannot express.** The gross movement and the fee are two entries that
   may not share one, so the payment row is what says they were one event (section 3.1).
2. **It is the idempotency anchor.** `UNIQUE (adapter_id, remote_event_id)` on `payment_event` is
   what makes a replayed webhook lose at commit rather than be pre-checked away (section 5).
3. **It is the record of money that arrived and could not be applied.** Which is the next section.

### 4.3 Recording receipt is never gated on the money fitting an invoice

The `invoice_matter_balance` bounds CHECK aborts the **whole batch** when an application would exceed
what the bill can absorb. That is correct and must not be weakened. But it has a consequence that
decides the sequencing of this entire subsystem: if recording that money arrived rode the same batch
as applying it to an invoice, then an over-payment would abort the record of money the firm has
already received.

So: **receipt and application are two acts.** The payment lands, its ledger entry posts, and the
`invoice_application` of kind `payment` is composed separately — in the same batch when it fits, and
not at all when it does not. Money the firm holds and cannot apply is a visible, reportable state,
which is what it actually is.

This resolves three of the four cases the brief asks about, without new machinery:

- **Partial payment** — an application for less than the matter's outstanding balance. Nothing
  special happens; this is the ordinary path.
- **Over-payment** — the excess is received cash with no application. It is _not_ automatically a
  client credit, and cannot be under the built schema: `client_credit.credit_note_id` is `NOT NULL`,
  so a credit exists today only as the residue of a credit note, and SQLite cannot relax a `NOT NULL`
  without the destructive table rebuild the schema policy forbids. Owner flag **K4**.
- **Payment against a superseded invoice** — invoices are never superseded. A finalized invoice is
  frozen and there is no un-finalize; a bill issued in error is corrected by a credit note standing
  beside it, and its `total_minor` never moves. So the real cases are a bill already fully applied
  (credited, written off, or paid) and a draft or voided invoice with no balance rows at all. In both
  the application is refused and the money stays received-and-unapplied. The refusal names the
  invoice and its state; it does not lose the payment.

## 5. The rails, the port, and the webhook

### 5.1 The port

A new pure package `@magna-carta/payments` defines `PaymentsPort` in our vocabulary, following
`@magna-carta/shipping`'s shape exactly — no D1, no Hono, no `env`, an injected `HttpClient`, every
method returning a typed `Dispatch` so an adapter maps a vendor failure into a first-class
`adapter-error` rather than throwing.

```
openPaymentSession(request)        -> Dispatch<PaymentSession>   // the hosted-modal handoff
readPayment(remotePaymentId)       -> Dispatch<CanonicalPayment> // the reconciliation pull
listSettlements(range)             -> Dispatch<readonly Settlement[]>
refundPayment(request)             -> Dispatch<CanonicalRefund>
verifyWebhook(rawBody, headers)    -> Dispatch<readonly CanonicalPaymentEvent[]>
```

`verifyWebhook` is on the port deliberately: the signature scheme is the vendor's and the route must
never learn it, exactly as the shipping route never learns EasyPost's error shapes.

Capability descriptor operations: `hostedModal`, `cardRail`, `achRail`, `grossTrustSettlement`,
`separateFeeAccount`, `refund`, `partialRefund`, `surcharge`, `storedMethod`, `webhookSignature`.
Credential requirement: `{ kind: "apiKey", scope: "firm" }` — a merchant account belongs to the firm,
not to an individual attorney.

**The two-destination problem.** ADR-0032 enforces fee separation by "routing trust vs. operating
payments to separate deposit destinations", and the registry resolves exactly one connection per
`{firm, principal, category}`. Two merchant configurations in one category is not something it can
express. The design carries both destinations inside one connection's credential payload — the split
is the processor's own configuration and our side names which of the two a given payment targets —
because widening the registry to serve one adapter is the wrong direction. Owner flag **K9** confirms
this before the adapter is written, since the fallback is a registry change.

### 5.2 The webhook, which is the platform's first

**There is no inbound webhook anywhere in this repository.** Payments introduces the idiom, so it is
specified rather than assumed.

**Authentication.** Helcim signs with an HMAC over the raw body. Verification is over the **raw
bytes**, before any parsing, with a constant-time comparison and a timestamp window that rejects a
replayed capture. The secret lives in `firm_secret` behind `CredentialStore`, like every other
integration credential.

**Which firm?** A webhook arrives at the platform, not at a firm, and the signing secret is per-firm —
so the firm has to be identified _before_ the signature can be checked, which rules out taking it
from the body (attacker-controlled until the signature verifies) and rules out an ordinary session.
The firm is therefore named by an **unguessable per-firm path segment** minted at connect time and
rotatable. Not the firm id: a firm id is not a secret and appears in ordinary URLs. Owner flag
**K10** confirms the rotation story.

**Idempotency, and a concrete hazard.** The platform's chokepoint keys on the `Idempotency-Key`
_header_, which a processor does not send. Two consequences:

- The route does not mount `idempotencyMiddleware`. It calls `runIdempotentEffect` directly with a
  key it derives itself: `payments:{adapterId}:{remoteEventId}`. The `deriveStoredKey` seam exists
  for tenant-prefixing a shared table and is not what this needs — the per-firm databases are
  physically isolated already.
- **`idempotencyMiddleware` reads the body through `context.req.json()` and consumes the raw
  stream.** Any future attempt to mount it in front of a webhook route would destroy the bytes the
  signature is computed over, and the failure would look like a wrong secret rather than a consumed
  stream. Naming it here so nobody rediscovers it at three in the morning.
- The commit-time guarantee is the `UNIQUE (adapter_id, remote_event_id)` index, not the pre-check.
  A guarded insert that could store a row is a write, not a guard — the same reasoning
  `releases_hold_id` and `reverses_application_id` already carry.

**Webhooks are lost.** The self-serve provisioning spec already says so for the platform's own
subscription billing, and it is no less true here. A **scheduled reconciliation pull** on the existing
daily cron pass re-asserts the processor's settlement truth over our stored events, using
`listSettlements`. This is not an optimization to add later; a payments subsystem whose only input is
a webhook stream is a payments subsystem that will silently lose money.

### 5.3 Settlement, and the clearing account

A processor does not deposit each payment as it is captured. It captures now and deposits later, and
if the fee is netted at deposit then the bank line is `gross − fees` for a whole batch.

Posting the gross receipt straight against the operating bank would make one bank line correspond to
two entries in opposite directions, which is the shape a reconciliation cannot express. So the
operating rail uses a **clearing account**:

| Moment     | Entry                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Capture    | `Dr Payments Clearing / Cr Accounts Receivable` — named by the `invoice_application` of kind `payment` |
| Settlement | `Dr Operating Bank` (net) + `Dr Merchant Fees` (the fee) `/ Cr Payments Clearing` (gross)              |

The clearing balance is then a real, meaningful figure — money the processor is holding — and the
settlement entry corresponds one-to-one with the bank line. Two new `firm_account_role` members,
`payments_clearing` and `merchant_fees`, resolved through the existing map, which **refuses by name
when unmapped** exactly as `accounts_receivable` does. A firm that has not mapped them cannot take a
card payment, and the refusal says which role is missing and where to set it.

The trust rail has **no clearing account**, and cannot: a clearing account is not a trust account, so
an entry pairing it with a matter leaf is refused. The trust deposit is recorded when the money
reaches the trust bank, gross, and the fee is the unrelated operating entry of section 3.1. That
asymmetry between the rails is a consequence of the composition guard and is not a gap.

## 6. What a payment looks like to the three-way reconciliation

This is the part most likely to be gotten wrong quietly, so it is stated as a requirement rather than
a description.

**`composeTrustReconciliationMatch` ties one statement line to one ledger entry.** The one-to-one rule
is checked in the composer and re-proved by the fitness suite; `packages/trust/CLAUDE.md` records the
one-line-covers-several-items case as "a real shape this does not yet express", where the proof
reports the resulting difference rather than hiding it.

Now consider a processor that batch-settles: one nightly deposit to the trust bank covering ten
clients' payments. Ten `trust_movement` deposits exist on ten different matter leaves; one bank line
exists. Nine of the ten entries stay outstanding forever, the tenth might match by luck, one bank line
stays unmatched, and the three-way proof reports a difference every single month. A firm would learn
to ignore its reconciliation — which is worse than not having one, because the ignored report is also
the one that would have caught a real misappropriation.

**Therefore: per-transaction gross settlement to the trust bank account is a hard requirement of the
trust rail, declared in the capability descriptor and refused when absent.** It happens to be what the
gross-deposit rules want as well, but the reason it is non-negotiable here is the reconciliation, and
that reason is the more likely one to be forgotten.

Three further reconciliation consequences, none of which needs new machinery:

- **An ACH deposit recorded on capture but not yet at the bank** is an outstanding deposit in transit.
  `selectOutstandingTrustBankItemsStatement` already handles it and the adjusted bank balance already
  adds it. Nothing to build.
- **A returned ACH or a chargeback against trust** reverses the bank line, and section 7.2 explains
  why it cannot currently be recorded at all.
- **The firm-funds cushion leg is untouched.** Payments never composes a firm-funds movement, so
  `book = client + firm funds` holds exactly as before.

For the **operating** side there is no reconciliation surface at all yet — the three-way proof is
trust-only. The clearing account of section 5.3 is designed so that an operating bank reconciliation,
when it is built, sees one entry per bank line. That is a foundation added while in the area rather
than a retrofit.

## 7. Refunds, chargebacks, and the closed period

### 7.1 A refund is never a deletion

Nothing financial in this repository is deleted, and a refund is not the exception.

**An operating refund in full** is a `payment_event` of kind `refunded` plus an `invoice_application`
of kind `reversal` — which already exists, already requires a stated reason by trigger, already
subtracts because a reversal subtracts, and is already UNIQUE on `reverses_application_id` so a double
reversal loses at commit. Its own entry reverses the receipt.

**A partial refund** cannot be a partial reversal: the UNIQUE index means a payment application is
reversed exactly once, whole. So a partial refund is **a full reversal plus a fresh, smaller payment
application, in one batch** — precisely the shape trust already uses, where "a partial release is a
release plus a new, smaller hold". Two entries where one would seem to do, using only mechanisms that
are built and proven, and the arithmetic is exact.

**A trust refund is a disbursement, and payments composes none of it.** Returning money from a client's
trust ledger to the payer is money leaving a client ledger: it goes through
`trust_disbursement_request`, carries `authorized_by`, and is subject to the firm's authorization
policy at the version the request was stamped with. Payments records the linkage and nothing else.
This is the same boundary billing already holds, where a reversal refuses a trust transfer by name
because putting money back into a client's ledger is a trust movement composed and authorized there.

### 7.2 A chargeback against a trust deposit is currently unrepresentable

`TRUST_MOVEMENT_KINDS` is `deposit`, `disbursement`, `matter_transfer`, and the `trust_movement` shape
CHECK requires `authorized_by` on money leaving a client ledger. A processor clawing back a deposit is
money out that **nobody at the firm authorized** — structurally the same situation as a bank service
charge, which is exactly why the bank charge needed its own closed category rather than a movement.

There is no fourth kind and adding one changes a trust CHECK constraint, so it is not settled here.
Owner flag **K3** holds it, with three options and a recommendation:

- **A fourth movement kind, `returned_deposit`**, carrying the processor as counterparty and no
  authorizer, on the bank-charge precedent. Recommended: it describes a real event that will happen,
  and refusing to record it means a firm cannot reconcile a real bank statement.
- **Refuse the trust rail entirely** until the kind exists. Coherent, and it is what the design does
  in the meantime.
- **Widen the second door.** Refused: a returned client deposit is client money, and the second door
  exists precisely so that firm-funds mechanics can never express a movement of somebody else's
  money.

And beneath that sits the harder problem, which no movement kind solves. Reversing a deposit whose
funds have since been spent — an earned fee taken, a disbursement made — drives the matter leaf
negative and the `account_balance` bounds CHECK aborts the whole batch. That refusal is correct: it is
the platform declining to let one client's chargeback be paid out of another client's money, which is
the hazard the corpus names in a dozen jurisdictions. What it leaves is a real shortfall, an unmatched
bank line, and a firm that owes its own trust account. Texas codifies the cure (reimburse within three
business days, before any disbursement) and **the platform cannot represent the cure**: the firm
putting operating money onto a client's matter leaf is either bare commingling (section 3.3) or a
mechanism nobody has designed. Recorded as an open compliance gap, flagged, not invented.

### 7.3 A chargeback carries its own date, never the original payment's

A chargeback arrives weeks or months after the payment. Dating its entry to the payment's effective
date would backdate a movement into a period a firm may already have reconciled — and while a closed
`trust_reconciliation` is frozen by trigger and can never move, the **live** proof for that period
would silently change, so the frozen attestation and the current answer for the same period would
disagree with no record of why.

So: **the effective date of a chargeback entry is the date the chargeback happened.** The relationship
to the original payment is carried by the `payment_event` row, which is where a relationship belongs.
A firm that needs the period restated supersedes the reconciliation, which is the mechanism that
already exists for exactly this.

## 8. Stored payment methods

ADR-0181 settled the capture path: the hosted modal returns a `cardToken` and the app stores the token
plus last-four and brand, never a PAN and never a CVV. What it did not settle is whether a token is
stored at all — a one-off payment needs no stored method.

**Whether to build it is owner flag K5.** A stored card is a materially different consent posture from
a one-off payment (the firm can charge it without the client present), the client portal that would
collect that consent is entirely `not-started`, and a stored-method feature without a consent record
is a feature that will be regretted.

**If it is built, the shape is settled here**, because getting it wrong is expensive:

- The token is a `protected()` column on a `payment_method` row — the data-access layer's encrypted,
  role-gated, audited field type. Never a plain column, and never `firm_secret`: that store holds
  per-connection integration credentials, not per-client rows.
- The consequence of `protected()` is that a decrypt is a permission check plus a committed audit row
  before any plaintext returns. That is the right cost — "the firm charged a client's stored card"
  should leave a record — but it means a stored-card charge cannot run in an unattended context
  without a principal whose permission can be checked. That constrains the feature and is a reason to
  prefer building it late.
- Last four, brand and expiry sit in the clear beside it. No blind index: nothing searches by card.
- Crypto-shred reaches it for free, like every other protected field.
- A trust-destined stored-card charge is refused. Charging a client's card unattended to fund a trust
  account is a movement of client money initiated by nobody, and the disbursement model's whole
  posture is that money movements name a person.

## 9. Surcharge

ADR-0032 permits an optional surcharge on **operating card payments only**, never on trust, never on
debit, where the jurisdiction allows it. Nothing here reopens that. What this design records is what
it would actually take, because the feature ledger currently reads as though it is gated only on the
trust jurisdiction machinery:

- **The jurisdiction requirement does not exist.** `TypedRequirements` has ten members and none of
  them is surcharge legality. `processorFees.mayChargeClientPrincipal` is a different question — it is
  about client _principal_ in trust, not about a fee added to an operating invoice payment. A new
  typed requirement is needed. It belongs in the **`restriction`** bucket, not `data`: a wrong silence
  under-restricts, handing a lawyer a practice a state bans, so it may resolve to "off" only on a
  silence that was recorded as read.
- **That requirement needs 56 jurisdictions of primary-source research and an attorney review each**,
  under the existing rule that a value without a verbatim quote is not shippable.
- **It also needs card-network registration**, which is procurement, not engineering: advance
  registration with the networks, disclosure at the point of sale, a cap at the merchant discount
  rate, and debit never surcharged. The right precedent is the A2P 10DLC registration in the
  communications layer — a procurement prerequisite with weeks of lead time, treated like an
  entitlement rather than a task.

Owner flag **K6** confirms surcharge stays out of the first slice. The node stays `not-started`.

## 10. What this design deliberately does not cover

- **The platform's own subscription billing** — Magna Carta charging a firm. That is a different
  payer, a different direction, and a seam already specified in
  [`2026-08-10-self-serve-firm-provisioning-and-entitlements.md`](2026-08-10-self-serve-firm-provisioning-and-entitlements.md),
  whose one writer is `setFirmEntitlementTier`. Nothing in this document touches it, and the two must
  not share an adapter, a connection, or a table.
- **The operating general ledger and an operating bank reconciliation.** The clearing account is
  designed so that reconciliation will work when it exists; building it is not this subsystem.
- **The client portal.** Payments needs a payer-facing surface and the portal is `not-started` in
  every one of its nodes. Owner flag **K7**.
- **E-signature**, which the white paper long ago moved out of this area.

## 11. Owner flags

**These decide what gets built. The implementation plan does not start until all seven are answered.**

**K1 — Does the first slice ship the manually recorded receipt, decoupled from any processor?**
This is the most consequential question in the document and it is not about payments at all. Billing
shipped four fee models, credit notes, client credits, write-offs and the trust application — and a
firm still cannot record a client's cheque, because `composeInvoiceApplication` refuses the `payment`
kind for **every** rail, not only the electronic ones. A manual receipt needs no port, no adapter, no
webhook, no processor account and no PCI posture: it is one composer, one ledger entry through the
account-role map, and one application. It closes the "a firm can produce an invoice and has no way to
be paid for it" gap on its own, and everything else in this document is an accelerant on top of it.
Recommendation: yes, and it is slice one.

**K2 — Is the trust rail in scope for the first electronic slice at all?**
It requires a merchant configuration confirmed with the processor (gross, per-transaction, separate
fee and chargeback account — section 3.2), and it requires K3. The operating rail requires neither.
Recommendation: operating rail first, trust rail second, and say so out loud rather than letting it
slip.

**K3 — The returned-deposit movement kind.** Section 7.2. A processor clawing back a trust deposit is
money out with no authorizer, which `trust_movement` cannot express. Adding a fourth kind changes a
trust CHECK constraint and is the owner's call. Without it, an ACH return or a chargeback against
trust is unrecordable and the trust rail should not ship.

**K4 — Over-payment.** Section 4.3. `client_credit.credit_note_id` is `NOT NULL` and cannot be relaxed
without a destructive rebuild the schema policy forbids, so an over-payment cannot open a client credit
through the built mechanism. Options: leave the excess as received-and-unapplied cash and report it
(the design's default, and safe); add a nullable `payment_id` sibling column plus a shape CHECK
requiring exactly one source; or refuse over-payment at the application boundary and require a refund.

**K5 — Stored payment methods: built, or not.** Section 8. Different consent posture; the portal that
would collect the consent does not exist. If built, the shape is settled.

**K6 — Surcharge stays out of the first slice.** Section 9. Needs a jurisdiction requirement that does
not exist, 56 jurisdictions of research, attorney review, and card-network registration.

**K7 — Who initiates a payment, given the portal is not started?** Options: staff-operated only (the
firm opens the hosted modal on the client's behalf, in the office or over the phone); a one-time pay
link, on the precedent of the one-time link that proves a mailbox; or wait for the portal. This
decides whether the first slice has a client-facing surface at all.

**These decide how it is built, not whether.**

**K8 — The clearing account and its two account roles.** Section 5.3. Confirm `payments_clearing` and
`merchant_fees` rather than posting gross and fee straight against the operating bank.

**K9 — Two deposit destinations inside one connection.** Section 5.1. Confirm before the adapter is
written; the fallback is widening the registry's one-connection-per-category resolution.

**K10 — The per-firm webhook path token and its rotation.** Section 5.2.

**K11 — Does an uncollected ACH deposit into trust carry a hold until it settles?** Several
jurisdictions have a collected-funds rule that forbids disbursing against an uncleared deposit, and
`available = balance − active holds` is exactly the ceiling that would enforce it. The tension: holds
are the **disputed-funds** mechanism, `trust_hold.reason` is free text so it is expressible, and
repurposing a trust mechanism for a neighbouring purpose is precisely what the retainer-floor rule
warns against. Recommendation: yes, with the reason recorded, because the alternative is a second
restriction mechanism on the same balance.

**K12 — Should an unmatched processor-fee line on a trust statement be named as a diagnosis?**
Section 3.3. Detectable; also a claim about the firm's conduct on a record a disciplinary body may
read.

## 12. Fitness functions this design owes

Every structural claim above must be re-provable over stored rows, or it is being trusted rather than
held.

- No `payment_event` names a ledger entry that touches a trust account **and** an entry that touches a
  fee expense. The two are separate entries by construction; this proves construction held.
- Every `invoice_application` of kind `payment` names exactly one ledger entry that credits accounts
  receivable for its amount — the mirror of the existing
  `billingCompositionsWithoutTheirReceivablePostingStatement`.
- Every `trust_movement` a payment produced has method `card` or `electronic_transfer` and a
  `payment` row naming it, and its entry's amount equals the payment's **gross** amount, never a net
  one. A netted trust deposit is the failure this whole design exists to prevent, and it must be
  detectable after the fact and not only refused before it.
- The payments clearing account's balance equals the sum of captured-but-unsettled payments.
- A source scan asserting that no file in `@magna-carta/payments` composes a `trust_*` statement —
  the same scan billing already carries, for the same reason.
- No `payment_event` of kind `charged_back` shares its effective date with the `captured` event of the
  same payment (section 7.3).

## 13. Test plan sketch

- **The refusals, by name**, one test each: a netted trust deposit, a fee line on a trust entry, a
  firm-funds movement composed from payments, a trust rail on an adapter whose descriptor lacks
  `grossTrustSettlement`, an application to a fully-applied invoice, an application to a draft.
- **The batch-abort cases**, committed rather than pre-checked: two concurrent applications racing for
  one remainder; a chargeback reversing a deposit whose leaf has been spent down.
- **Webhook idempotency at commit**: the same processor event id delivered twice, with the second
  losing on the UNIQUE index and not on a read-then-write.
- **Signature verification over raw bytes**, including the case where the body would parse identically
  but the bytes differ.
- **A settlement that reconciles**: a gross capture, a fee, and a net deposit, proving the clearing
  account returns to zero and one bank line matches one entry.
- **A trust deposit that reconciles**: gross to the trust bank, the fee entirely on operating, the
  three-way proof balanced, and the firm-funds leg unmoved.
