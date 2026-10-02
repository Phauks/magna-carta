---
number: 463
slug: a-matters-paper-file-is-kept-at-an-office-and-that-is-not-the-office-that-runs-it
status: Accepted
date: 2026-09-14
area: Matters
summary: "A matter names two offices, not one: matter.location_id is the office the matter is run out of, and a new nullable matter.physical_file_location_id is the office the firm's own paper file for it is kept at. Both point at location; the matter detail read joins location twice and answers both with resolved names; the write is the existing matters:edit patch, and null is a real answer. The status window's Physical File renders the second through the one office link and sets it through the one office picker, while Held In and Destroy After keep the Soon mark because neither has a record behind it."
---

**Where a matter's paper file is kept is its own office reference, and collapsing it into the office
that runs the matter would send somebody to a building the folder has left.**

**Context:** the owner's standing ruling on the matter status window is that its Location links to
the office record, through one modular component used wherever an office is named. The window had
two candidate Locations and the ruling had to say which. The matter header's citation already names
`matter.location_id`, the office the work is run out of. The status window's Physical File panel is a
different thing: three rows — Location, Held In, Destroy After — that all read "Not recorded" behind
a Soon mark, describing the firm's own folder for the matter. The reading taken is the second, which
is the one literally on the window; the first is a smaller piece of the same component and is served
by the same office link wherever the header wants it.

Reading them as one fact was the available shortcut and is the failure this decision exists to
prevent. A firm boxes a closed matter's folder with other matters' folders, commonly at a remote
store it keeps as an office of its own, and a matter opened at Carson City can have its file at
Sparks. Deriving the file's whereabouts from the office that runs the matter would state, with the
confidence of a record, a place the folder is not.

**Decision:** `matter` gains `physical_file_location_id`, nullable, referencing `location`, beside
the existing `location_id`. Both are offices; neither is derived from the other; a matter with no
recorded paper-file office answers null rather than falling back. `selectMatterDetailStatement` joins
`location` twice under two aliases and the detail read answers `physicalFileLocationId` with a
resolved `physicalFileLocationName`, on the same terms and for the same reason the type and the
owning office are resolved there — a screen cannot print a handle at a person, and a name per round
trip is the N+1 the platform forbids. The write is the existing `PATCH /api/v1/matters/{id}` behind
`matters:edit`, because recording where a folder sits is a correction to the matter's own fields and
not a lifecycle step; an absent key leaves it standing and an explicit null clears it, which is the
honest answer for a firm that has lost track of a file.

What the folder physically sits INSIDE stays unmodelled, and the "Held In" row keeps its Soon mark.
One container holds several matters' folders, so a container is a record a matter points at rather
than a column here, and a column would decide the medium — box, drawer, safe, shelf — for every firm,
which the owner has already refused. "Destroy After" keeps its Soon mark for a harder reason: there
is no retention clock anywhere in the platform to derive a destruction date from, and the custody
register is explicit that it runs no timer at all. A date invented here would be a date somebody
destroys a client's file on.

**Consequences:** a nullable column and an additive contract field, so nothing that reads a matter
today changes. The matter detail read pays one more primary-key LEFT join. The status window now
makes a read of its own when it opens — the matter's two offices — because the record the matter
chrome holds does not carry the field and a window that re-reads is what keeps a file moved from
another surface from being stated where it used to be; folding the field into that shared record
would remove the request and is a follow-up rather than a correction. The office family
(`$lib/offices`) gains its second and third consumers, which is the first evidence that the modular
piece the ruling asked for is actually modular: the status window links through `OfficeLink`, the
window and the New Matter dialog both pick through `OfficePicker`, and nothing imports the older
`VocabularyPicker` any more. A firm that wants a file's movement HISTORY — who boxed it, when, where
it went — has a seam and no rule: the column records where the file is, not how it got there.
