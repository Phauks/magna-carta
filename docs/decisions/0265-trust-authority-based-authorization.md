---
number: 265
slug: trust-authority-based-authorization
status: Proposed
date: 2026-08-10
area: Trust accounting
summary: "Authority-based trust authorization, owner-directed: a member holding trust:authorize releases client money alone below the firm's threshold, and a member without it routes to one who has. The shipped machinery already expresses this — no new policy kind, no widened CHECK, no new column, no edit to any of the four exemption mirrors: the owner's posture is the stored triple (kind, threshold, require_authorized_approver = 1), because that flag binds whoever lets money go and therefore turns an amount-only exemption into an actor-conditional one. Peer approval above the threshold falls out rather than being added: the decider is the second person, and the flag binds the decider. The shipped strict default changes by SEEDING a version-1 row (policy off, authority required) in a new per-firm migration rather than by re-reading the absent row, so the migration stays purely additive, the NULL stamp keeps describing exactly the history it describes, and the new default is auditable data in each firm's own posture history; safe because no firms exist, and in-flight requests keep their stamped policy by construction (the request carries policy_id, the resolution loads that stamp, and the mirrors join it rather than MAX(version)). Routing needs no schema: trust_disbursement_request is already the kind-tagged, policy-stamped pending queue for both money-out paths, so the only addition is a shared resolveTrustAuthorizationDisposition read that lets callers choose route-versus-solo before composing — the composers' refusals stay guards and never become routes. The four-cell matrix is the cross product of two predicates already implemented (the decider holds authority; the decider differs from the submitter above the threshold), so the two above-threshold cells collapse into one enforcement path and no mirror grows. The audit vocabulary does not grow either: basis states the relation between actors, the stamped policy version states the rule, and widening the basis CHECK would cost a second rebuild of trust_disbursement_decision. Open: whether the lone-holder exception should count trust:authorize rather than trust:manage (cheap now, expensive after the first firm), whether above-threshold means two people or three, whether solo-restricted-to-holders should be separable from peer approval, and whether a platform sentinel is acceptable as set_by on the seeded row."
---

**Authority-based authorization for money leaving a client ledger — expressed in the posture that
already shipped, with a seeded default rather than a re-read one.**

**Context:** The two-person disbursement control became a per-firm posture (off / threshold /
always, plus `require_authorized_approver`), shipped strict by default. The owner then directed the
model it should actually express, verbatim:

> "one person should be able to do trust authorizations. really, the person who can approve can do
> it solo. but if someone doesn't have that, it needs to go to a person to approve."

Settled in follow-up: an authority holder acts solo **below** any firm-set threshold; **above** it
even a holder needs a second person, and the firm may require that second person to also hold
authority (peer approval — two holders satisfy it, no regress); the lone-holder exception covers a
firm with one authority holder. Design: `docs/specs/2026-08-10-trust-authority-based-authorization.md`.

**Decision:** (1) **No new policy kind.** The owner's model is the stored triple with
`require_authorized_approver = 1`. That flag binds whoever *lets money go* — the second-person
approver and the sole actor on an exempt amount alike — so with it set, an amount the threshold
exempts can still only be released by a holder, and a non-holder's self-decision is refused, leaving
the request pending for one. Peer approval above the threshold is a consequence: the decider is the
second person, and the flag binds the decider. An `'authority'` kind would be more self-describing
but costs a widened CHECK (a second rebuild of an evidentiary table), a new branch in all four
exemption mirrors — three of them triggers that today read only the stamped row and the amount — and
a further value the "unrecognized kind requires two people" fallback must keep refusing safely.
Legibility is answered in the admin surface, which names the composed postures; the database gains
no synonym for a sentence the UI can compose.

(2) **The default changes by seeding, not by re-reading.** A new per-firm migration inserts version
1 — `policy = 'off'`, `require_authorized_approver = 1` — for every firm. The absent-row reading
stays strict and keeps describing the history it describes; the new default is data, visible in each
firm's posture history with a version and a timestamp, and no shipped trigger is touched. `set_by`
takes a documented platform sentinel meaning "the posture the platform shipped, never a person"; the
seed writes no audit row, because the append-only version row is the record. Safe because no firms
exist, and because `trust:authorize` is seeded narrowly (Owner/Admin and Attorney).

(3) **In-flight authorizations keep their stamped policy — confirmed, not assumed.** The request
carries `policy_id`, the shared approval resolution loads that stamp rather than the current row,
and every mirror joins the stamp rather than `MAX(version)`. A seeded version 1 therefore governs
only what is submitted after it exists. At cutover the pending set is empty regardless.

(4) **Routing needs no new shape.** `trust_disbursement_request` is already the kind-tagged,
policy-stamped queue for both money-out paths, with pending derived from the absence of a decision.
The disbursement path already routes structurally — the refused self-decision simply leaves the
request pending. The earned-fee path keeps its composer refusal as the last guard before a posting
and gains the routing arm one level up, in billing's choice between the direct application and the
queue. The one addition is a shared read, `resolveTrustAuthorizationDisposition`, so both callers
decide route-versus-solo *before* composing instead of catching a refusal; it calls the existing
predicate and adds no fifth mirror.

(5) **The matrix is two predicates, not four cases.** P1: the decider holds `trust:authorize` when
the stamped policy requires it. P2: the decider differs from the submitter when the amount is above
the stamped threshold. Below-threshold holder acts solo (`policy_exempt`); below-threshold
non-holder is refused by P1 and routes to a holder (`second_person`); above-threshold both cells
collapse to the same enforcement — two distinct people, with P1 binding whichever of them decides.
No mirror grows, no column is added. The three-human reading of "approver plus second" is
deliberately refused: it would need a second decision row and the loss of `UNIQUE(request_id)`, the
index that makes two concurrent approvals produce one payment.

(6) **The basis vocabulary does not grow.** `second_person`, `sole_trust_manager`, `policy_exempt`
state the relation between the actors; the stamped policy version states the rule, and an examiner
joins the two. `authorized_solo` / `authorized_peer` would duplicate the policy row into a column
that can then disagree with it, and would cost a second full rebuild of
`trust_disbursement_decision`, with `policy_exempt` meaning two different things either side of it.
The composed sentence is rendered by the surface from `(basis, stamped policy)`.

**Consequences:** Every fresh per-firm database starts authority-based, so tests and fixtures that
exercise two-person behaviour must write their own `always` or `threshold` version instead of
leaning on the absent row — a bounded edit across the trust and billing suites, part of the build
slice. Firms wanting a ceiling write a `threshold` version; the per-authorization threshold's
known limitation (no per-payee or per-day aggregation) is unchanged. Matter-to-matter reallocations
remain outside the policy. The shipped flag "should one person be able to dismantle the two-person
control" is answered by implication: an authority holder acts alone on client money, and changing
the posture already requires `trust:authorize`.

**Flagged rather than decided:** (1) The lone-holder exception counts `trust:manage` while the
posture is about `trust:authorize`; making it count the authority capability costs two trigger
recreates, near-free today and materially more expensive after the first firm — worth settling in
the same slice. (2) Whether "above the threshold, approver plus second" means two people or three.
(3) Whether "solo restricted to holders" should be separable from "peer approval above the
threshold" — recommended unrepresentable, since a second person who cannot authorize is a witness
and the record has no column for one. (4) Whether a platform sentinel is acceptable as `set_by` on
the seeded row, against seeding at provisioning with the founding owner instead.
