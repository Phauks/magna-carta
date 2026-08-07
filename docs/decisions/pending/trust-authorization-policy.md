---
slug: trust-authorization-policy
status: Accepted
area: Trust accounting
date: 2026-08-07
summary: "Two-person disbursement authorization becomes a per-firm policy (owner override of T12's shipped default): off, threshold (a second person for amounts strictly above a stated minor-unit amount), or always, plus an independent approver-authority option requiring whoever lets money go to hold the new trust:authorize capability — a capability predicate, never a role name, seeded to Owner/Admin and Attorney and deliberately narrower than trust:manage. The shipped default is the strict posture (always two-person, authority off), so no firm's controls weaken on migrate. The policy is an append-only, densely versioned table; changing it takes trust:authorize and writes an audit row naming from and to. Every request and transfer stamps the version current at submission and is decided under that stamp — an in-flight authorization keeps the policy it was created under, in both directions — with the stamp, the basis exactness (second_person / sole_trust_manager / policy_exempt), and the authority requirement all held by database triggers. The earned-fee application follows the same policy through the same queue: an application is a trust_disbursement_request of kind earned_fee_application whose invoice lines billing keeps beside it, approved through billing, posting a transfer that records submitter, approver, request, and policy version. Open question flagged for the owner: whether changing the policy itself (relaxing the posture) should take a second person, and whether matter-to-matter reallocations should fall under the policy — both currently outside it."
---

**The two-person rule becomes the firm's posture — versioned, stamped on every request, and still the database's business.**

**Context:** The two-person disbursement control shipped platform-wide with three recommended
defaults flagged, and the owner overrode the first: "a partner should have the full capability to
deal with money... two person disbursement does not need to always exist. But could be a requirement
that it must be sent to someone with the authority to act." The earned-fee application (billing's
trust application) was directed to follow the same policy. The direction is settled; the decisions
here are the model that implements it.

**Decision:** (1) **Three postures plus an orthogonal authority flag.** `off` (the deciding member
acts alone), `threshold` (a second person for amounts strictly above a stated `amount_minor`),
`always`; independently, `require_authorized_approver` demands that whoever lets money go — the
second-person approver, or the sole actor where the posture exempts the amount — is an active member
holding `trust:authorize`. "Authority to act" is encoded as that capability predicate, never a
hard-coded role name: the platform seeds it to Owner/Admin and Attorney, and a firm shapes authority
by granting the key.

(2) **The default is the strict one, as an absent row.** A firm with no policy row has always
two-person and no authority requirement — the exact shipped behavior — so the migration relaxes
nobody, and relaxation is only ever an explicit act.

(3) **The policy is append-only and densely versioned; changes are audited.** A posture change is a
new version row (who, when, what) plus an audit_log entry carrying the from/to shape; the
version-dense trigger makes a concurrent change lose loudly. Changing the posture requires
`trust:authorize` — relaxing how client money moves is itself an act of authority over it.

(4) **A pending authorization keeps the policy it was created under.** Requests and transfers stamp
the current version at submission; every decision trigger and the shared approval resolution read
the stamp, never the latest row. Relaxing does not unlock an in-flight request; tightening does not
strand one. Stamp-is-current triggers stop a caller reviving a superseded posture.

(5) **One queue, two consumers, one predicate.** The earned-fee application becomes a
`trust_disbursement_request` of kind `earned_fee_application`: billing keeps the invoice lines
beside it, approval re-resolves them and composes the transfer through trust's own composer, and the
decision, the transfer, and the applications commit as one batch. The
`trustAuthorizationRequiresSecondPerson` predicate and the policy rows are shared, so the two
money-out paths cannot drift; the recorded basis gains `policy_exempt`, stating on the decision's
face that the stamped policy did not require a second person. The rebuild of
`trust_disbursement_decision` (SQLite cannot widen a CHECK in place) is the one reviewed table
rebuild, exhaustive-copy, same-transaction.

**Consequences:** Under the default posture a multi-manager firm now needs the queue for earned-fee
applications too — a strengthening of the application path, which previously took one actor; the
direct single-actor application returns the moment a firm relaxes its posture. The lone-manager
exception is unchanged and now also names the transfer path. Flagged rather than decided: whether a
posture RELAXATION should itself take a second person (currently one authorized, audited actor), and
whether matter-to-matter reallocations — which move no money out of trust — should fall under the
policy (currently they do not, as before).
