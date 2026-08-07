---
category: Added
---

**Disbursement authorization is now the firm's own policy.** Whether money leaving a client trust
ledger takes a second person becomes per-firm configuration — off, above a threshold amount, or
always — with an independent option requiring that whoever lets money go holds the authority to act
on client money (the new `trust:authorize` capability, seeded to Owner/Admin and Attorney). The
shipped default is the strict posture every firm already had: always two-person, no authority
requirement — nothing relaxes on migrate, and relaxing is an explicit, versioned, audited act
recording who changed the posture, when, and from what.

**The earned-fee application follows the same policy.** Taking earned fees out of trust against
finalized invoices now rides the same approval queue as a disbursement: a pending application
request names its invoices, another member approves it, and the approval re-checks everything —
invoice finality, the client's identity, the matter's unpaid share, the available balance — against
the world as it stands then. Under a relaxed posture the direct single-actor application returns.

**A pending request keeps the policy it was submitted under**, in both directions: relaxing the
posture does not unlock a request proposed under the strict one, and tightening it does not strand a
request the old policy exempted. Every rule — the second person, the exactness of the recorded
basis, the authority requirement, the stamp itself — is enforced by database triggers, not route
discipline, exactly as the two-person rule was before it became a policy.
