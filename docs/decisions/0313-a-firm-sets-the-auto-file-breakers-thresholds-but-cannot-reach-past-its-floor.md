---
number: 313
slug: a-firm-sets-the-auto-file-breakers-thresholds-but-cannot-reach-past-its-floor
status: Proposed
date: 2026-08-14
area: Email
summary: "The auto-file rule circuit breaker's thresholds become a per-firm setting on the existing firm-setting idiom, with the shipped numbers — twenty-five firings per rule per rolling hour, three undos within the last ten firings — as the platform defaults, so a firm that never touches them sees no change. The owner's answer directed that the thresholds be settable and said nothing about whether a firm may set one that disables the protection; because a circuit breaker exists to stop runaway automation, a floor is enforced rather than left open. Every threshold is a whole number inside a finite range, and the undo threshold may not exceed the recent-fire window it is counted over — a threshold above its own window could never be reached, which would leave the breaker reading as configured while never tripping. The fire ceiling is finite for a second, independent reason: the activity read walks up to the threshold plus one row per candidate rule per captured message, so an unbounded threshold would be an unbounded read on the capture path. The bounds live in the domain package beside the guardrail that applies them, the request and stored-value schema is built from those bounds, and the pure decision function re-checks them and treats a violation as unevaluable evidence, so a stored value nothing can act on stages the capture instead of filing past a guardrail that cannot fire."
---

**A firm sets the circuit breaker's thresholds. A firm cannot set the circuit breaker aside.**

**Context:** The auto-file rules engine's blast bound — a rule that fires more often than a person
would reverts to staging and asks to be looked at — shipped with its thresholds fixed in code:
twenty-five firings per rule per rolling hour, and three undos within the rule's last ten firings.
The design that built it flagged the numbers as an owner decision, describing them as user-visible
and not correctness-critical. The owner's answer was that a firm should be able to set them, with the
shipped numbers as the platform defaults.

The answer settled that the thresholds are configurable. It did not say whether a firm may choose a
value that leaves the breaker unable to fire, and neither did the design — the flag was written as a
question about which numbers to pick, not about what the range of pickable numbers is.

**Decision:**

**The thresholds are one per-firm setting, on the idiom already in use.** A single
`emails.auto_file_circuit_breaker` value on the per-firm `setting` table (no schema change, no
migration), with one definition and one read helper shared by the settings route and the capture
consumer — the shape the scan-policy settings and the auto-file direct-filing ceiling both use, so
the API and the queue path cannot drift apart on what a firm chose. The defaults are exactly the
shipped numbers, which is what makes this change invisible to a firm that ignores it.

**The range is bounded, and the bound is a floor on the protection rather than a validation
formality.** A guardrail whose whole purpose is to stop runaway automation must not have an off
switch reachable by writing a large number into a settings field. Three rules, each with its own
reason:

- **A finite ceiling on the fire threshold.** An arbitrarily large threshold is the off switch. It is
  also an unbounded read: the activity walk is capped at the threshold plus one row per candidate
  rule per captured message, precisely so the reported count can reach the threshold, which means the
  threshold sizes a read on the capture path. Five hundred firings in an hour is runaway under any
  firm's reading of its own mail.
- **The undo threshold may never exceed the recent-fire window.** The undo count is capped by the
  window it is counted over, so a higher threshold could never be reached. That failure is worse than
  an error, because it is silent: the setting reads back exactly as written and the breaker simply
  never trips.
- **Every floor is one rather than zero.** A zero fire threshold trips on a rule's first firing and a
  zero undo threshold trips on every firing whether or not anything was undone — both stop unattended
  filing entirely, which is not a setting anybody means to write.

**The bounds have one home and three enforcement points that cannot disagree.** They are declared in
`@magna-carta/email-filing` beside the guardrail that reads them; the settings route's request schema
and the stored-value schema are the same schema, built from those bounds; and the pure decision
function re-checks them, treating thresholds it cannot act on as **unevaluable evidence** rather than
clamping them. Unevaluable means the capture stages — the module's existing fail-closed arm — so the
worst case of a bad stored value is a message waiting for a person, never a message filed past a
guardrail that could not fire. Absent thresholds are read the same way, consistent with every other
field in the evidence: a gatherer that did not resolve them did not answer the question, and an
unanswered question is never permission.

**Considered and rejected: letting a firm disable the breaker explicitly.** It is the honest
alternative — a firm that understands the risk could take it — and it is refused because the failure
mode this guardrail defends against is not one the firm chooses knowingly. A mailing list added to a
correspondent rule, a bounce loop, an autoresponder from a client's domain: in every case the firm
that turned the breaker off did so months earlier for an unrelated reason and is not present when it
would have mattered. **Considered and rejected: clamping an out-of-range stored value to the nearest
bound.** Clamping is friendlier and it is also a silent rewrite of a firm's stated intention; the
setting would read back as one thing and behave as another, which is the same class of dishonesty as
an unreachable threshold.

**Consequence:** The F7 flag is closed. `GET`/`PATCH /api/v1/firm/email-auto-file-policy` carry
`circuitBreaker` beside `directFilingPermitted`; the operation set is unchanged, so no permission or
conformance inventory moved. The user-facing guide states the defaults, that an administrator can
move them, and that the protection cannot be switched off. No user interface ships with this — the
surface is the API, and the administrative screen is the owner's to design.
