---
slug: trust-close-hard-block-ratified
status: Accepted
area: Trust accounting
date: 2026-08-05
summary: "The owner ratified T12 as shipped: a matter whose client trust ledger holds a non-zero balance or an active disputed-funds hold refuses to close, with no override path. The refusal names the amount, the account, the held portion, and the movements that clear it. An unclaimed-funds workflow, if built later, becomes a real exit rather than an override. In the same review the owner directed that two-person disbursement authorization be built now: a disbursement requires a second member's approval before the movement posts, with the approver recorded as the authorizer — the recorded_by / authorized_by split the movements slice laid down in anticipation. Design specifics the owner did not state (threshold versus all disbursements, single-trust-manager firms) ship as recommended defaults, flagged."
---

**T12 ratified: the zero-balance close precondition is a hard block. Two-person disbursement authorization is authorized to build.**

**Context:** The close precondition shipped as the trust analysis's recommended default — a hard
block — flagged for owner review because T12 carried no owner answer. Separately, the movements slice
recorded the authenticated submitter as both recorder and authorizer, with the columns split so a
real authorization workflow could arrive without migration; that too was flagged.

**Decision:** On 2026-08-05 the owner kept the hard block exactly as shipped, and chose to build
two-person authorization now rather than leave authorizer-equals-submitter standing. A pending
disbursement awaits a second member's approval; the approver must differ from the submitter; the
movement posts only on approval with the approver as `authorized_by`.
