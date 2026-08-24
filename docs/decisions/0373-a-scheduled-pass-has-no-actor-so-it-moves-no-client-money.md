---
number: 373
slug: a-scheduled-pass-has-no-actor-so-it-moves-no-client-money
status: Proposed
date: 2026-08-16
area: Financial Core — Billing
summary: "No billing automation moves client money, and the reason is structural rather than a scheduling deferral. The trust authorization posture is built on an actor: resolveTrustAuthorizationDisposition takes a UserId, the seeded posture is that an authority holder acts alone and anybody else routes to one, and the per-firm triggers hold the same predicate at the database. A cron pass is nobody, and minting a platform principal would mint one that can release client money and cannot be held to anything. The payments design reaches the same wall from the other side: a stored card token is a protected() column, so decrypting one is a permission check plus a committed audit row against a principal an unattended context does not have. Automations are therefore split into three tiers by what the act does to somebody outside the firm — internal and reversible (a draft, a record), becomes-evidence-or-is-told-to-a-client (finalize, deliver, remind), and money moves — and an unattended pass acts freely in the first, only under a firm setting pinned to a recorded human authorization in the second, and never in the third. A source scan over the automations module proves it, on the precedent of the scan billing already carries against trust."
---

**An automation that cannot name who authorized it may not do anything that requires authorization,
and money leaving a client ledger requires a person by construction.**

**Context.** Slice 3·7 is the scheduled, no-client-present layer over billing, and the obvious feature
requests all point the same way: bill the retainer matters monthly, take the earned fee when the bill
is final, charge the card on the plan's due date. Each is a small amount of code over composers that
already exist, and each is wrong for the same reason.

The trust subsystem's authority-based posture is not a policy read at a route — it is a predicate over
an **actor**. `resolveTrustAuthorizationDisposition` takes `actor: UserId`; the seeded version-1
posture is that a holder of the trust authority may act alone and anybody else routes to a holder; and
the triggers in the per-firm migration hold the same predicate at the database precisely because a
route is one code path among several that reach those tables. Every unattended path would have to
supply an actor. There is no member representing the platform, and creating one would create a
principal that can release client money, appears in no firm's staffing, and cannot be asked why.

Payments arrives at the same wall from the other direction, independently. A stored card token is a
`protected()` column, so obtaining plaintext is a permission check plus a committed audit row against a
principal whose permission can be checked. The payments design already records this as a reason to
prefer building stored methods late. Two subsystems designed months apart both say the unattended
charge is the thing that does not fit.

**Decision, in three parts.**

**1. Automations are tiered by consequence, and the tier decides what an unattended pass may do.**

- **Internal, reversible, asserts nothing** — composing a draft invoice, writing a reminder record,
  raising a replenishment request, writing a run row. A draft is voidable, posts no ledger entry, locks
  no work-in-progress, and has been shown to nobody. An unattended pass acts here freely.
- **Becomes evidence, or is told to a client** — finalizing an invoice, delivering a bill, sending a
  client a reminder. Permitted only under a firm setting that defaults **off** and only where a
  recorded human authorization is still standing: a named authorizer who is an active member holding
  the capability the automation exercises, and a pinned fee-agreement version still in force.
- **Money moves** — taking an earned fee from trust, charging a payment method, disbursing. **Not
  permitted, at all, by anything scheduled.**

**2. The line is a source scan, not a rule to remember.** No file in the automations module may
import or call `composeTrustToOperatingTransfer`, `applyTrustFundsToInvoices`,
`applyEarnedFeesUnderAuthorizationPolicy`, or `composeInvoiceApplication`. It fails on an import as
well as a call, so a helper that reaches for a trust composer's types does not open the door. This is
the same instrument billing already carries against trust and payments carries against both, for the
same reason: a boundary that depends on everybody remembering it is a boundary that has already been
crossed somewhere.

**3. An automation's authorization is a record with a version and an expiry posture, not a boolean.**
A recurring schedule and a payment plan each name **who** authorized it, **when**, **what fee-agreement
version was in force**, and — for a plan — the exact dated instalments, materialized at authorization
rather than derived later. Staleness is **derived on every pass and never stored**, so a pause clears
itself when its condition clears: a superseded fee agreement, a closed matter, or an authorizer who is
no longer an active member holding the capability each pauses the automation and records why. A stored
pause would need un-setting by hand and would be wrong the moment the condition changed.

**Considered and rejected.** **A platform member.** It is the shortest path and it is the whole
problem: a principal that can release client money and belongs to nobody defeats the posture rather
than satisfying it. **Attributing the act to the schedule's authorizer.** Superficially reasonable and
worse than the platform member, because it puts a real person's name on a release they were not present
for and did not see the amount of; the authority posture binds whoever *lets the money go*, and that is
a moment, not a standing instruction. **Letting a firm opt in to unattended fee transfers.** An
override is a path, and a path becomes the path — the billing design's own reasoning about why the
earned-fee precondition has no override applies with more force here, because there the friction is
felt by somebody who is present.

**Consequences.** The payment plan this slice can deliver is a record, a schedule, a derived standing,
and a missed-instalment prompt — not a charge, and not "not yet a charge": the third wall survives
payments shipping. Evergreen replenishment reads trust balances through trust's own reads and writes
nothing to a trust table. A firm that wants its bills finalized automatically turns on one setting whose
default is off and whose authorizer must hold `billing:finalize`. And the thing the platform will never
do on a schedule is exactly the thing the trust rules are about. Builds on **ADR-0009** and **ADR-0032**
(trust and the fee separation), the authority-based authorization posture, and **ADR-0181** (the PCI
posture behind the stored-token constraint).
