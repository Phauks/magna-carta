---
number: 447
slug: a-record-nobody-can-open-is-a-record-nobody-can-correct
status: Proposed
date: 2026-09-08
area: Communications layer
summary: "A row in the call and text log opens into the platform's record window, and a member-produced row is correctable there through a new communications.update operation; a carrier-produced row is refused, because editing one would turn an observation into a recollection wearing an observation's badge. The window's fields ARE the entry form's, rendered by one component, so recording a call and correcting one cannot drift into two layouts. Where a record belongs stays out of those fields and lives in the window's action bar instead: a matter and a set-aside reason each move the row between queues through their own concurrency-safe act, and folding them into a field patch would let a correction to a description silently re-file a message somebody else had just filed."
---

**A log people stop trusting is worse than one that is occasionally re-opened.**

**Context:** The call and text log shipped with no record window, deliberately: every field was on the
row, so a window would have been a second way to read what was already on screen, and activating a row
did the thing a reader was actually reaching for — it went to the matter. The queue's rows opened the
filing dialog instead, and a row a member could not file did nothing at all.

That reasoning was about READING, and it did not survive the owner's review of the deployed screen on
2026-09-08: "cannot double click into a call entry". The half it missed is that a hand-logged call is
somebody's recollection typed at speed — a digit in the number, the wrong direction, a length entered
in seconds where the field wanted minutes — and the log had no correction path of any kind. The only
remedy for a wrong record was a second record beside it, which is how a log stops being believed.

**Decision:** A row opens into `RecordWindow`, the platform's one record window, on both messaging
surfaces. `PATCH /api/v1/communications/{id}` corrects the record's own fields.

**The fields are the entry form's, literally.** `communication-fields.svelte` renders the recording
dialog and the record window's editing mode, so correcting a call asks exactly the questions recording
one asked, in the same places. Two layouts would have disagreed about where the number sits within a
week, and this subsystem already carries the evidence for that: the previous form asked a text for its
words and a call for its summary under different labels and different layouts, which is the thing the
owner's "for all intents and purposes, the text and calls should look the same" was about.

**A correction resolves the whole record, never a partial SET.** The channel decides which content
fields may be filled — a body belongs to a text, a duration to a call, and both are CHECKs — so an
omitted field is filled from the row and the result is re-validated as if it were being logged fresh.
A patch builder emitting a partial UPDATE would let a channel change land without the content change
that has to accompany it, and the failure would surface as a constraint violation rather than a
refusal anybody can act on.

**A carrier-produced row is refused.** `producer` exists so a member's recollection and the network's
report of the same call are never confused, and a member editing the second would defeat exactly that.
The refusal is stated on the disabled control rather than hiding it.

**Where it belongs is not a field.** A matter and a set-aside reason each have their own
concurrency-safe statement — the whole point being that two people filing the same message in the same
instant cannot both succeed — so they stay acts in the window's action bar, one press from an opened
row, and the entry form's own "Belongs to" control is absent in the window rather than offering a
second way to do the same thing. The alternative, folding the anchor into the patch, was built first
and discarded: it made one Save into three writes with a partial-failure state to explain, for a
gesture that reads worse than the two separate ones.

**Consequences:** `communications.update` joins the surface, gated by `communications:log` with the
queue key deciding whether an unfiled row is reachable at all. Getting to the matter from a filed row
is still one press, from inside the record rather than by activating it. The record window also gives
the one act the log had no home for — starting an **intake** from a call, with the caller carried into
the matters subsystem's own window as a prefill rather than this screen learning how to open a matter.
