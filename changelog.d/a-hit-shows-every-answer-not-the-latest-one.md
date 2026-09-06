---
category: Added
audience: public
---

**A conflicts hit shows every answer recorded against it, not just the last one.** The conflicts log
is append-only precisely so that a reviewer who clears a hit and later reverses leaves both acts
standing — a reversal is a second row, never an edit — and until now nothing read that back. The hit
window showed the reviewer's latest word and a line saying the earlier ones were on the record and
unreadable.

`GET /api/v1/conflicts/hits/{hitId}/dispositions` serves the trail on `conflicts:read`, oldest
first, each entry carrying its own rationale, its reviewer, and for a waiver its own waiver record
and what that record is short of. `readDispositionTrail` uses the same `created_at`/`rowid`
tie-break `readCurrentDisposition` does, so the two reads can never disagree about which answer is
the latest — the pair that most needs a stable order is an answer and its reversal.

The hit's existence IS checked, unlike the matter posture read and for the opposite reason: "no such
hit" is not a state with a meaning of its own, so an empty trail must mean "nobody has answered this
hit" and nothing else. Conflating them would let a mistyped handle read as an unanswered candidate.

**The conformance gate caught a real contract bug on the first emit.** Reusing `DispositionDetail`
in the new response registered one component name under two schema shapes — the check response uses
it as `.nullable()`, and zod-to-openapi carries the component name onto the nullable schema, which
that library resolves first-write-wins. A trail entry is now its own component, which is also the
honest reading: on the check response `disposition` is the latest word and null means unanswered; on
the trail every entry is an act that happened and there is no null to express.

## Public

**You can see every answer a hit has ever had.**

Opening a candidate showed the most recent decision and nothing before it. It now shows the whole
history in order — who answered, when, what they said, and for a waiver what the firm holds to
evidence it.

That history is the point of the record. An answer is never edited: a reviewer who changes their
mind records another, and both stay on the log, so the sequence a firm is asked about later is the
sequence it can produce.

A candidate nobody has answered says so plainly, rather than looking like one with nothing to show.
