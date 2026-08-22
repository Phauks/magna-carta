---
category: Fixed
audience: internal
---

**`main` has been red since two directory routes landed: the emitted contract carries them and the
conformance inventory does not.**

`directory.listMatterParties` and `directory.unlinkMatterParty` are in the committed OpenAPI document
and were missing from the not-vacuous operation list the conformance suite checks against it. The
suite deep-compares the two, so it failed on every branch cut from `main` — three separate agents
tripped over it today and correctly declined to fix someone else's red inside their own change.

Two lines, in alphabetical position. The suite passes: 42 tests.

The durable fix is still owed — deriving the inventory from the emitted document rather than keeping
a hand-maintained parallel list, so a route cannot ship without it.
