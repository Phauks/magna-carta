# Custodian retention and destruction — mechanism ships, policy does not

**Status:** Proposed
**Date:** 2026-08-04
**Area:** Custodian

## Context

The deleted-file lifecycle built a policy-driven destruction path and wrote "blocked by any
legal/discovery/Custodian hold" into it against a Custodian hold surface that did not exist. Building
Custodian means building that surface, and it raises the question the earlier brainstorm deferred to
spec time as "per-item-type retention defaults": what retention periods does the platform ship?

The research is unambiguous that the answer varies materially. The ABA model rule and Texas default
around five years; New York and Illinois around seven; Ontario's guidance runs to fifteen against its
ultimate limitation period; at least one professional liability fund recommends ten. And the guidance
that governs this subsystem's actual content — the Law Society's wills-and-probate file retention
guidance, state bar and malpractice-carrier loss-prevention material — converges on the opposite
point: originals of intrinsic value sit **outside** the routine retention clock entirely and are
returned to the client or kept, not destroyed on a timer.

State will-deposit statutes carry the same variance with real teeth: a deposit-within-ten-days-of-death
rule in one state, thirty days with liability for all damages in another, enforcement by arrest of a
non-complying custodian in a third.

## Decision

**Custodian ships the mechanism and supplies no policy.**

**What ships.** `review_on` and `review_interval_months` as dates a firm sets. `retention_until` as a
nullable column a firm sets per packet or item — **no default, no derived value, and no code path
that computes one**. A `custody_hold` table with kinds `legal` / `discovery` / `client_instruction` /
`dispute` / `unclaimed`, blocking release and destruction while permitting a location move. A
two-person destruction request/approval workflow where requester and approver must differ. No
destruction sweep.

**One hard refusal is encoded, with no override in the API: an item flagged `intrinsic_value` cannot
be destroyed.** This is encoded because it is not jurisdictional — no jurisdiction's rules produce
"destroy the client's original will because a retention timer expired", and every source consulted
converges on it. Overriding it requires clearing the flag, which is a deliberate, audited, human act
on a specific object rather than an API parameter.

**What is flagged as jurisdiction-specific and therefore an owner or verified-catalog decision, never
a default this design invents:** retention periods by item type and jurisdiction; will-deposit and
lodgement deadlines on death; whether the original goes to a court or a personal representative; what
authority document suffices to release; whether two signatories are required; unclaimed-property and
escheat treatment; and whether a client must be notified before destruction.

**When a jurisdiction catalog is eventually built**, it follows the trust-rules catalog pattern:
jurisdiction-keyed reference data verified against primary legal text at build time, shipped one
jurisdiction at a time, with an explicit "not encoded for your jurisdiction" state — never a silent
generic fallback.

## Considered options

**Shipping ABA-model retention defaults (five years) with a per-jurisdiction override** — rejected.
A default is a platform opinion about when to destroy a client's irreplaceable property, and the
firms most likely to leave it untouched are the ones least equipped to notice it is wrong for their
state. The failure is silent and irreversible.

**Encoding a first jurisdiction now to prove the pattern** — rejected for this slice. A catalog that
is 90% right is worse than no catalog because it will be trusted, and verifying primary statutory
text is work with a standing maintenance obligation attached, not a build-time task that finishes.

**A soft warning instead of a hard refusal on intrinsic-value destruction** — rejected. A warning
that can be clicked through is a warning that will be clicked through, and the object on the other
side of it cannot be recreated.

**Modelling "unclaimed" as a packet status rather than a hold kind** — rejected. "We cannot locate
the owner" is exactly a do-not-destroy condition with logged contact attempts, so modelling it as a
hold makes it inherit the destruction blocker rather than needing a parallel check.

## Consequences

**Positive.** A firm cannot be led into destroying an original by a platform default it did not
choose. The hold table gives the deleted-file destruction path its first real Custodian blocker, so
a scanned copy bound to a held packet is protected by the same mechanism as everything else. The
absence of policy is explicit and documented rather than an omission a later reader mistakes for an
oversight.

**Negative.** Out of the box the subsystem offers no retention automation at all, which is less than
the earlier brainstorm implied and less than a firm migrating from a system that had one will expect.
Review dates and reports carry that weight until a verified catalog exists, and the highest-value
differentiator in the subsystem — the will-on-death statutory deadline engine — stays unbuilt behind
an explicit owner decision.

**Open.** Whether the jurisdiction catalog is wanted at all, and which jurisdiction is encoded first,
is an owner decision. It is the single largest piece of deferred value in Custodian and the one that
would most clearly separate the product from the incumbents, which is why it is flagged rather than
quietly dropped.
