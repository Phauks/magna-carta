---
number: 446
slug: a-call-that-belongs-to-no-matter-is-set-aside-with-a-reason
status: Proposed
date: 2026-09-08
area: Communications layer
summary: "A call or a text may be anchored to a matter OR set aside with a stated reason from a closed vocabulary — spam, firm business, nothing came of it — and never to both. The unrouted queue is redefined as rows carrying neither, so it is a list that can actually be emptied; the set-aside rows keep their words, their number and their instant and stay in the firm-wide read, and returning one to the queue is a first-class act. The vocabulary is enforced in packages/communications rather than as a SQLite CHECK, because the column is added to a populated table and SQLite cannot add a CHECK to one without the destructive rebuild expand-contract forbids. In the same round the log form's counterparty number gains an explicit country, which makes storing E.164 honest for the first time — the server still refuses to canonicalize on its own, because it has no way to know the country, and the form does."
---

**A queue nobody can empty is a queue nobody works.**

**Context:** The call and text log gave a row exactly one anchor: a matter, or nothing. Nothing meant
the unrouted queue, and the queue was the firm-wide screen's whole reason to exist — the place an
inbound text from a number nobody recognises waits for somebody to decide which case it belongs to.

The decision that surface asks for is not always available. The owner named the cases on 2026-09-08,
from the deployed screen: some calls are spam, some never turn into anything, some are the firm's own
business — the landlord, a vendor, the bar association. None of those can be filed, because there is
no matter to file them onto, and the log offered no other way for them to leave the queue. So they
stayed in it. A receptionist working the queue on a Monday morning meets last month's wrong numbers
first, and after a few weeks of that the queue stops being read at all — which is the same as not
having built it.

Deleting them is not the answer either. What was said still happened; a firm asked six months later
whether it ever heard from a particular caller has to be able to say so, and the pattern itself is a
fact worth keeping — whether the firm's number is being called by salesmen, or by real enquiries that
are dying, are different problems with different answers.

**Decision:** A row is on a matter, or **set aside** with a stated reason, or waiting while nobody has
decided. Exactly one of the three, never two.

`communication.disposition` is nullable and holds one of `spam`, `firmBusiness`, `noAction`. Four
things follow, and each was the alternative considered and rejected:

**Not a boolean.** "Not a matter" alone would empty the queue and lose the one fact anybody would
later want. The vocabulary is closed and the act cannot be performed without choosing from it, so the
firm can be asked what its phone is actually carrying.

**Not a status the queue keeps.** `scope=unrouted` now means matter and disposition both null, and the
queue count with it. A set-aside row leaves the list somebody is meant to empty and stays in
`scope=all`, which is the record; a fourth scope reads exactly the set-aside rows. Leaving them in the
queue with a flag on the row would have made the queue's own number a lie.

**Not both anchors at once.** "This is spam AND it is on the Whitfield matter" is not a fact anybody
can act on, and a row carrying both would make every read decide which of the two to believe. The
pair is refused at the service; filing a set-aside row clears its reason in the same statement, which
is what a firm deciding a written-off call was real work after all actually means.

**Not a CHECK.** Every other closed vocabulary in this table is a SQLite CHECK as well as a type. This
one is not, and the reason is mechanical rather than a lapse: the column is added to a table that
already holds rows, SQLite cannot add a CHECK to one without a destructive table rebuild, and
`test/expand-contract.test.ts` forbids that rebuild. `normalizeDisposition` in
`packages/communications/src/validation.ts` is therefore the constraint, and every write path goes
through it. The next baseline collapse can fold the CHECK in for free.

**The same round settles the counterparty number.** The column was deliberately not canonicalized to
E.164, because canonicalizing needs the firm's own country and this subsystem has no way to know it.
That reasoning is still right about the SERVER and was never right about the FORM: a person recording
a call can be asked which country the number is in, and now is — a dial-code control beside the
digits, reusing the Directory's own number knowledge rather than re-deriving it. So the form composes
the international form and stores that, the server still refuses to guess, and a number that will not
parse is stored exactly as it was typed. Display reformats only what is already canonical; handing a
free-text number to a parser that assumes a country turns "ext 4102" into "4102", which is a different
fact.

**Consequences:** Two operations (`communications.setDisposition`, `communications.clearDisposition`),
both gated by `communications:reviewUnrouted` — setting a row aside reads an unrouted row on its way,
exactly as filing one does, so it sits behind the same key that reveals the queue at all. A fourth tab
on the firm-wide screen, and a fourth thing the Matter column can say. The audit log gains two events
and carries the reason and the reason it replaced, which are enums; it still carries no words and no
number. Reporting on what the firm's phone actually receives is now possible and is not built.
