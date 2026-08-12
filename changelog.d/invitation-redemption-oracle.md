---
category: Fixed
---

**A refused invitation redemption no longer reveals whether the code exists.** The refusal published a
remaining-attempts number taken from the invitation row, and the row is found by the code alone — so
anybody could type a guessed code with an invented surname and date of birth and read the answer off
that one number: four left meant a live invitation with exactly that code, five meant no such code (or
one already used, revoked or expired), zero meant a live code currently locked out. The two facts the
invitation asks for on top of the code were doing nothing to stop it, because they guard the comparison
and not the lookup. That is the enumeration the whole surface is arranged to make impossible — a
machine for confirming that a named code belongs to a real person at a real firm — and it was reachable
without knowing a single thing about the person.

Every unsuccessful redemption now answers with one identical document, whatever the lookup found: the
same status, the same sentence, and a budget that counts **the caller's own** attempts rather than the
invitation's. The caller's ladder is a real one — five tries from one address, then a pause — so the
number on screen is still honest and still enforced, and it is a fact the caller already knew. The
lockout countdown that used to appear only when a real invitation was locked is now the caller's own
countdown, for the same reason: a locked invitation is an invitation that exists.

The invitation's own attempt counter and its lockout are untouched. They are what stops somebody
walking a date of birth against a code they genuinely hold, and they still spend, still lock, and still
refuse the correct answer once spent — they simply do so silently. A refusal on a code that matched
nothing now performs the same control-plane write as one that matched, so the difference the body no
longer carries is not left sitting in a stopwatch instead.
