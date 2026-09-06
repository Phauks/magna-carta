---
category: Added
audience: public
---

**A matter can be re-checked on demand, and the firm's floor is readable.** Reads 3 and 4 of the
conflicts read surface, and both were routes the machinery was already waiting for.

`POST /api/v1/matters/{matterId}/conflicts-rechecks` on `conflicts:run` takes **no scope**, and that
is why it exists beside the general check route rather than being a call to it. "Re-check this
matter" has no scope for a caller to state, and a scope field would invite a screen to compose a
narrower search than the firm requires. It names no subjects either: `runConflictsCheck` reads the
matter's own live parties, so a party added since the last check is searched without anybody listing
them — which is the staleness a re-check exists to answer.

It is recorded as a MANUAL run naming the member who asked, and carries no cause. A cause is a
corpus change the platform noticed; a person asking now is not one. It also neither reads nor
satisfies the automatic re-check ledger — an open cause stays open, because the interval between a
cause and the check that answered it is evidence about the firm's procedure, and a manual run did
not answer it.

`GET /api/v1/firm/conflicts-policy` is `readConflictsPolicy` behind a route, on `conflicts:read` —
every member who can read a check is held to the floor, so a reviewer looking at a check that fell
short of it has to be able to see what it is. The check runner now states the floor instead of
marking it unreadable.

The route declares 409 among its responses because the shared conflicts error mapper can return the
idempotency chokepoint's refusal, and the typechecker caught the omission: a response a route can
produce but does not declare is a contract that lies about what a caller may receive.

## Public

**You can re-check a matter without filling in a form.**

Where a matter's conflicts standing is shown, "Re-check now" runs a fresh check against the matter's
current parties — including anyone added since the last one — to the firm's own standard. There is
nothing to configure, because there is nothing you should have to decide: the firm sets how
thoroughly checks are run, and that setting is what runs.

The check is recorded as yours, with your name on it, and it takes you straight to what it found.

**The firm's own standard is now shown where you run a check.** The panel used to say an empty field
takes the firm's setting without being able to tell you what that setting was. It now names the
sources every check must search, the strictness it must reach, and the depth and limits it runs to.
