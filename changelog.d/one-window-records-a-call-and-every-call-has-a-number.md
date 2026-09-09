---
category: Changed
audience: internal
---

**Recording a call and reading one are the same window, because there is no reason for two.** A call
was recorded in an action dialog and read in a record window. Both rendered the same fields through
the same component, and both disagreed about everything around those fields: one had tabs and the
other did not, one printed and the other did not, one called its commit Save under a heading and the
other under an action bar. Two surfaces for one record is two things for a reader to learn and two
places for the next field to be added to only one of. There is one now, and the only difference
between its states is whether it opened with a record in it — a new one opens straight into the
fields, asks where it belongs, and carries the number it is about to be given.

**A call's length is typed, and it is allowed to disagree with the clock.** The round before this one
worked the duration out from a start and an end, which is right until somebody is put on hold: an
hour on the line and twenty minutes of call are two true facts about one call, and computing either
from the other asserts they are the same number. `communication.ended_at` is now stored beside
`duration_seconds`; the length is typed and reads `20`, `45m`, `1h 5m` or `1:20`; and an end fills an
EMPTY length and never overwrites one somebody wrote. Where the two differ, the form and the record
say both, so the gap reads as the hold it is.

**Every call and text carries a number a person can say out loud, and it exists before the record
does.** `2026-09-08-0042` — the day it happened, and that day's own sequence. A handle is what the
platform joins on; it is not something a receptionist can write on a message slip or read back down a
telephone, and a call is quoted out loud more often than any other record a firm keeps, because the
person on the other end of it is still on the line. So the window shows the number the next record
for that day WOULD draw, before anything is saved, and says that it is a preview rather than a
reservation; the record's own number replaces it the moment there is a record. The migration that
adds the column numbers every row already on the table, so the log has no rows without one.

The sequence is the shared counter idiom (`@magna-carta/sequence-numbering`) with one departure worth
naming: it has **no allocation table**. The general warning that a unique index on a rendered number
cannot stand in for one is about schemes carrying a segment that varies within a counter scope, and
this scheme carries none — the day IS the scope key — so two draws that observed the same value in
one day render byte-identical strings and the partial unique index aborts the loser exactly as an
allocation primary key would.

**The description is the row's second line rather than a column.** It is prose, and usually longer
than every other fact on the row put together, so as a column it was either truncated to a few words
— which is not a description — or wide enough to push the facts off the screen. It has the row's full
width underneath the facts now, through the one table's own row-detail, which is the same mechanism
the time sheet's description already sat in.

**Digits past the end of a phone number are an extension, not a formatting failure.** `AsYouType`
stops formatting silently once the digits exceed what a country's numbers hold, so typing a direct
dial onto the end of a number turned `(312) 555-0148` into a run of fourteen digits under the cursor.
The overflow now rolls into an extension the shared phone field owns, and the split is the longest
prefix libphonenumber calls possible rather than the country's digit count — so a North American
number typed with its trunk 1 is not cut a digit short. The two halves store as one string,
`+13125550148x4102`, which the formatter reads back into both. The Directory's contact rows had built
their own extension input beside the shared field; they use the field's own now, which is the last
half of that pair that was still built twice.

**And an intake starts from the form, not only from a record.** Save And Start An Intake records the
call first and hands the saved row up — an intake with no account of the call that caused it is what
the control exists to prevent. The provenance tab is a History rail, in the shape every other record
window uses.
