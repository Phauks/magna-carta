---
number: 340
slug: the-public-intake-form-reads-nothing-so-it-can-reveal-nothing
status: Proposed
date: 2026-08-15
area: Client intake
summary: "The public intake submission path performs no lookup against firm data — it writes one row and returns — so its answer cannot depend on the content of the submission. One response for a name the firm already represents, a name adverse to a current client, an unknown name, a repeat submission and a switched-off form. The rule is enforced by construction rather than by answering identically after a lookup, because a form that consults the Directory answers measurably slower for a name with candidates and a probing script gets its oracle from the clock. No duplicate detection, no entity resolution, no conflicts check, no matter-type routing that could refuse an unsupported area of law; every one of those is available a moment later on the staff side of triage, where the caller is a member and the reveal is authorised. A rate-limit refusal may report the caller's own budget, which is a fact about the caller and not about the content."
---

**A form that says "we already act for someone by that name" has leaked, and so has one that merely
takes longer to say nothing — so the public path reads nothing at all.**

**Context:** the public intake form is an unauthenticated endpoint on the marketing host that anybody
on the internet can post to, reaching a system holding the firm's whole client corpus. The
absence-not-existence posture and the registration route's rule that every outcome within a door
answers identically both already apply. What neither of them covers is the shape a helpful intake
form naturally takes: look the name up, offer to link the existing contact, refuse politely if the
firm cannot act. Each of those is a disclosure to an anonymous caller about who the firm represents.

**Decision:** the public submission path performs **no read against firm data**. It validates the
shape, writes one `intake_submission` row, and returns. No duplicate detection, no entity resolution,
no conflicts check, no matter-type routing, no "we may already act for you", no acknowledgement copy
that names a practice team the form did not choose.

The rule is held by construction rather than by convention, and the reason is latency. Answering
identically **after** a lookup still leaks: the response arrives measurably later for a name with
duplicate candidates than for one without, and a script probing names reads the difference off the
clock. A rule enforced by "and then return the same body" is a rule a profiler defeats. The
structural version — one write, no read — has a source scan behind it that a reviewer can check.

A rate-limit refusal is permitted to say what it says today: the caller's own remaining budget and
retry window. That is a fact about an IP address, not about a name, and it is the same reasoning
already settled for invitation refusals. What may never vary with content is the status, the body,
the shape or the time.

The route's posture is the registration route's, unchanged: a public surface, unauthenticated, no
permission, optional idempotency because a browser form mints no key, and the tightest rate-limit
bucket the platform has.

**Considered and rejected:** duplicate detection on the public form with an identical response (the
timing oracle); refusing submissions for practice areas the firm does not handle (an instant refusal
is itself a statement about the firm); telling a repeat submitter their earlier enquiry was received
(a probe confirms a name is known); a slower but constant-time lookup (constant time is asserted, not
observed, and every future read on that path silently breaks it).

**Consequences:** the staff triage surface carries every read the public one gives up — duplicate
candidates, conflicts, routing — where the caller is a member and the disclosure is authorised. A
firm sees a triage queue rather than a pre-resolved one, which is the cost of the guarantee.
