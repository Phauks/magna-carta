---
category: Changed
audience: internal
---

**The matters docket shows every matter by default and the scope control is gone.** "The working
docket / Open matters / Closed matters / Consultations" duplicated a narrowing the table's own Status
filter already performs, and the owner ruled it out twice.

Removing it needed a read change rather than a deletion: the matters listing omits unnumbered
consultations by default and its status parameter takes one status, never all. So the screen now
reads both streams in parallel, merges them, and carries the two server cursors as one token. Merging
across page boundaries is safe only because the grid sorts what it holds, and that reason is written
where the merge happens — it would not be safe for a surface rendering rows in fetch order. Either
stream failing fails the whole read, because half a docket looks exactly like a small firm.

**Opening a matter is one screen.** Entry on the left across three tabs — the matter, the client, the
people — and Clearance standing permanently on the right: the conflict check with its subjects
derived live from the title and client as they are typed, the consultation fee, and the trust
deposit. Clearance is deliberately not a fourth tab, and the reason is recorded: it is not more data
being entered, it is the gate the entry has to pass, and a gate behind a tab is one somebody has to
remember to go and look at. It fits 1280x720 without scrolling.

**A defect on the screen whose job is saying who carries the matter:** the Responsible Attorney field
showed its ghost text while the seat was filled. It now shows who holds the seat at rest and clears
to the whole roster on focus, and a collecting seat empties after each pick.

The matter's Custodian tab stops reading Soon — the surface is real and the sidebar already said
Alpha. Every other section was audited against its route in the same pass; the ones still marked Soon
are stubs, correctly.
