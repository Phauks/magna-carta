---
category: Added
---

Custodian — gated release. An original no longer leaves a firm's custody until the authority it
leaves on and the identity check made on the person collecting it are both on the record. The gate is
a precondition on the one movement write path that already records the borrower, so there is still no
release route, no release service, and no second place the append-only invariant has to hold; a
`released` movement now has to name who collected the property and carry the capture, and the capture
is frozen on the ledger row itself, which can never be edited or deleted. Two-signatory release is a
per-firm policy, off by default, and the two signatories must be two people. Three `BEFORE INSERT`
triggers make all of that structural rather than a service convention — triggers rather than CHECK
constraints deliberately, so releases recorded before the gate existed stay exactly as they were
recorded instead of being made to pass a rule nobody applied at the time. The authority itself is
free text a firm writes: what document suffices to release an original varies by jurisdiction, and
the register encodes none of it. Adds the `custody-release-not-authorized` problem type and the
`custody.releaseGated` counter. The daily check-out stays frictionless and is deliberately not gated.
