---
category: Added
audience: public
---

Email auto-file — the rule circuit breaker's thresholds are now a per-firm setting, on the settings
idiom the scan policy and the direct-filing ceiling already use.

The breaker's two numbers were fixed in code: twenty-five firings per rule per rolling hour, and
three undos within a rule's last ten firings. Both remain the platform defaults, so a firm that never
touches the setting sees exactly the behaviour that shipped. What changes is that the numbers are
resolved per firm — `emails.auto_file_circuit_breaker` on the existing `setting` table, so there is no
schema change and no migration — and read through one helper by both the settings route
(`GET`/`PATCH /api/v1/firm/email-auto-file-policy`, which now carries `circuitBreaker` beside
`directFilingPermitted`) and the capture consumer. The queue path and the API cannot disagree about
what a firm chose.

**The thresholds are settable; the breaker is not optional.** The design that raised the question
named the numbers and said nothing about a floor, so one is enforced rather than assumed. Every
threshold is a whole number inside a fixed range — one to five hundred firings per hour, one to a
hundred for the recent-fire window and the undo count — and `maxUndosInRecentFires` may not exceed the
`recentFireWindow` it is counted over, because a threshold above the window it is measured against
could never be reached and the breaker would read as configured while never tripping. The fire
ceiling is finite for a second reason as well: the activity read walks up to the threshold plus one
row per candidate rule per captured message, so an unbounded threshold is an unbounded read on the
capture path.

One definition of what a firm may set: the bounds live in `@magna-carta/email-filing` beside the
guardrail that applies them, the zod schema that refuses a bad write is built from those bounds, and
the pure decision function re-checks them — thresholds it cannot act on are unevaluable evidence, so
the capture stages rather than filing past a guardrail nothing can reach. Absent thresholds are
treated the same way, on the rule the module already holds for every other field: a gatherer that did
not answer the question has not given permission.

## Public

**Your firm can now tune when an auto-file rule stops itself.**

A rule that suddenly starts firing far more often than a person would — a mailing list, a bounce
loop, an autoresponder — goes back to staging and asks to be looked at. So does a rule whose recent
filings you keep undoing. Out of the box that is twenty-five filings in an hour, or three of the last
ten undone, and an administrator can move both to suit how much mail your firm handles.

What cannot be done is switching the protection off. The numbers move within a sensible range, and a
rule that runs away always stops.
