---
slug: trust-authority-based-authorization-build
status: Proposed
area: Trust accounting
date: 2026-08-11
summary: "The build of authority-based trust authorization, and the three calls the design left to it. (1) The seeded version-1 posture is INSERT ... WHERE NOT EXISTS: a firm that has already written a posture keeps it, both because its choice must not be appended over and because version 1 over an existing version 1 would abort the dense-version trigger and leave that firm unmigrated. (2) A solo release is ONE atomic write — the request, the movement, and the decision recording the footing ride one batch through composeTrustDisbursementSubmission — rather than a proposal followed by a self-decision, because between those two calls the request is pending and another member can settle it as a two-person approval nobody asked for; the solo arm composes nothing new, reusing the same request composer, the same composeTrustDisbursement, and the same decision statement in the order the triggers need. (3) The route-versus-solo choice for earned fees lands on the SUBMIT endpoint rather than the direct-apply one, so no request body has to be widened and the direct endpoint keeps its role as the last guard; billing's applyEarnedFeesUnderAuthorizationPolicy resolves the invoices to learn the amount, asks the shared disposition, and delegates to the direct path or the queue. resolveTrustAuthorizationDisposition is a read in front of the guarantees and adds no fifth mirror: it calls the existing predicate and the same two membership reads the triggers count, asks the authority question FIRST and unconditionally of the ACTOR, and every path out of it is a refusal or a route. The lone-holder exception is extracted into one helper both the disposition and the approval resolution call, so the count-plus-membership pair cannot drift. Open question 1 from the design — whether the exception should count trust:authorize rather than trust:manage — is NOT taken: the design flags it for ratification, and the change would relax a firm with three managers and one authority holder from two-person to solo. No UI in this slice."
---

**Authority-based trust authorization, built — and the three calls the design deferred to the build.**

**Context:** The merged design
(`docs/specs/2026-08-10-trust-authority-based-authorization.md`) settled the model: no new policy
kind, no widened CHECK, no new column, no edit to any of the four exemption mirrors. The owner's
posture is the stored triple with `require_authorized_approver = 1`, the shipped default changes by
seeding rather than by re-reading the absent row, and the one addition is a shared disposition read.
This records what building it actually required.

**Decision:** (1) **The seed is conditional on an empty table.** `INSERT ... SELECT ... WHERE NOT
EXISTS (SELECT 1 FROM trust_authorization_policy)`. A firm that has already written its own posture
keeps it — appending a platform version over a decision a firm made would be the migration
overruling the firm — and the guard is load-bearing a second way: an unconditional version-1 insert
into a table that already holds version 1 aborts on the dense-version trigger and the UNIQUE index,
which would leave exactly those firms unmigrated. `set_by` carries a platform sentinel handle
(`user_platformPosture000000`) meaning "the posture the platform shipped", well-formed so nothing
downstream special-cases it and belonging to no member so no reader mistakes it for a person.

(2) **A solo release is one atomic act.** `composeTrustDisbursementSubmission` composes the request,
the movement, and the decision naming the footing into ONE effect when the disposition says solo.
The alternative — propose, then self-decide on the approval endpoint — leaves a window in which the
request is pending and any other authorised member can settle it as an ordinary two-person approval
the submitter never asked for; under the new default that window would exist on every payment an
authority holder makes. The solo arm introduces no second posting path: it reuses
`composeTrustDisbursementRequest`, the same `composeTrustDisbursement` an approval would have used,
and the same decision statement, ordered so the decision triggers see the request row and the
posting the same batch already wrote. Every guard therefore still fires and takes the proposal down
with the payment.

(3) **Billing's route-versus-solo choice lands on the submit endpoint.** The direct-apply endpoint's
request body carries no method, payee or purpose, so making *it* the chooser would have meant
demanding those of every direct application to serve the queue case. Instead
`applyEarnedFeesUnderAuthorizationPolicy` sits behind `POST /billing/trust-application-requests`,
mirroring the disbursement path exactly, and the direct endpoint keeps its role as the surface for a
member who knows they may act alone — with `composeTrustToOperatingTransfer`'s refusal unchanged
behind it as the last guard before a posting.

(4) **The disposition adds no fifth mirror, and asks the authority question first.**
`resolveTrustAuthorizationDisposition` calls `trustAuthorizationRequiresSecondPerson` rather than
restating it, and reads the same two membership sets the triggers count. The authority gate is
evaluated first and on its own, because it binds whoever lets money go at any amount, and it is
always a question about the ACTOR's membership — never about whether the firm has a holder. Every
path out of the function is a refusal, a route, or a solo answer the composers and triggers would
independently accept; an unrecognised policy kind propagates the predicate's throw.

(5) **The lone-holder pair lives in one helper.** `resolveLoneTrustManagerException` returns both
"the firm has exactly one holder" and "the actor IS that holder", and the disposition, the approval
resolution, and the transfer composer all call it. The two halves were previously written out three
times; a count without the membership half is precisely the defect the shipped fix closed.

**Consequences:** Every fresh per-firm database starts authority-based, so the trust and billing
suites that exercise two-person behaviour now write an `always` version, and both test fixtures
grant their member `trust:authorize` alongside `trust:manage` — which is what the platform's own
role seed gives a real firm's attorney. Two response contracts widened: the disbursement request ack
gains `status`, the movement it posted, and the members who can approve it; the trust-application
request ack gains the same shape for `applied`-versus-`pending`. No new operation, permission,
metric, problem type, table or column. UI is deferred.

**Flagged rather than decided:** (1) **The design's open question 1 is left open.** The lone-holder
exception still counts `trust:manage`. Making it count `trust:authorize` would tighten a firm with
one manager and several authority holders and RELAX a firm with three managers and one authority
holder — the latter goes from needing two people above a threshold to letting the single holder act
alone. The design recommends the change but marks it "only if the owner ratifies", and a change that
reduces a firm's controls in one direction is not one to make unratified. It stays cheap while no
firm has stored a decision. (2) **The seed relaxes a firm that has no policy row.** Such a firm has
always-two-person today and gets authority-holder-solo. The design's safety argument is that no
firms exist; that is not something this repository can prove, so it is stated here rather than
assumed. (3) Design open questions 2 (two people or three above the threshold), 3 (separating
solo-restricted-to-holders from peer approval) and 4 (the sentinel `set_by`) are unchanged and
un-taken; the sentinel is implemented as recommended and remains reversible while the table holds
only seeded rows.
