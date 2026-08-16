---
category: Changed
audience: internal
---

Ten merges landed in one stretch and the roadmap's _Now_ section still described the state before
them. Discovery's next step was the processing lane that had just shipped. Notifications' next step
was the comparison sweep that shipped two slices ago. Human verification on the anonymous endpoints
did not appear at all.

The per-capability ledger was correct the whole time — every slice flipped its own `roadmap.d/` node
in its own commit, and the build register renders from those. What goes stale is the narrative, which
is hand-written on purpose: it is the one place that says which stream to pick up next and why, and
that judgement cannot be generated from a node's status.

Three streams now read true, and each names its gate where it has one. Discovery says privilege review
is waiting on two owner flags and which two, and separates them from the pair that gate the production
slice after it. Notifications says what its three production paths are and which two answers stand in
front of the remainder. Auth records that human verification is shipped and dormant, with the
inversion that matters — the widget is a prerequisite for its own activation, because the registration
screens are live and mint no token, so provisioning the secret first would refuse every real signup.
