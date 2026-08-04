---
category: Fixed
---

- **Two matters opened at the same instant can no longer be handed the same place in the firm's
  numbering sequence.** A number draw reserved its place by re-reading a counter and then advancing it
  only if nobody else had — and where that check lost, the duplicate was expected to be caught by the
  rule that no two matters may carry the same number. That rule only sees the finished number, so it
  caught nothing whenever the firm's scheme mixes something that varies per matter into the number
  without also resetting the counter on it: a client code, staff initials, a matter-type code. Two
  matters opened together for different clients then rendered `ACME-0001` and `BRIGHTON-0001` — two
  different numbers, both claiming the firm's first file of the sequence, with the counter left at 2 so
  the duplication was invisible from then on. Each draw now records the sequence position it consumed,
  and the database refuses a second claim on a position already taken: the losing request rolls back
  whole and immediately re-draws on the next number. Numbers a firm has already assigned are untouched.

- **Opening a matter twice no longer overwrites the number it was already given.** The open path
  checked that a matter was still a prospective consultation and then wrote the new number as a
  separate step, so two opens in flight together — or an open arriving just after someone closed the
  matter — could rewrite an already-open matter's number, its opening date, and its state, with the
  displaced number simply gone. The write is now conditional on the matter still being a prospective
  consultation, and the request that loses is told the matter was opened or closed concurrently instead
  of being handed a number that ended up on no matter at all.

- **A closed matter can no longer be closed a second time.** Re-closing silently moved the recorded
  close date and announced a second closure to everything downstream — a January closure re-run in June
  moved the date that retention and archival clocks run from by five months, with nothing recording
  that it had moved. Closing an already-closed matter is now refused, and a close that arrives at the
  same moment as another close leaves the first close date standing. A retried request carrying the
  same idempotency key still replays its original response, as before.

- **Changing a matter's number now records the number it replaced.** A manual, court, or legacy number
  overwrites the previous one in place, and nothing retained the old value — so a filing or invoice
  quoting the earlier number resolved to nothing anywhere in the system. The audit entry and the change
  event now both carry the displaced number.
