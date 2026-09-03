---
category: Fixed
audience: public
---

**A conflicts hit names the party it is about.** The candidate list carried an entity handle and
nothing else, and the column that should have named the party said "Not served" on every row: the
check read put `entity_id` on the wire unresolved, and naming each row from the browser would have
been one request per row.

The read that fixes it already existed. `readSubjectFactsBatch` resolves a set of entity ids in one
query per node table per hundred ids, chunked at D1's bound-parameter cap, and it had been on the
WRITE path all along, seeding the matcher. `readEntityDisplayNames` beside it does the same for a
reader — a person's stored display name falling back to the name parts, an organization's to its
legal name — and `GET /api/v1/conflicts/checks/{checkId}` now carries a `party` on every hit.

It is resolved on the READ rather than copied onto the log. The log is append-only and records the
entity by reference, so a reviewer deciding today sees the name the firm holds today; a hit whose
entity no longer resolves at all — a merge after the check, which the append-only rule makes
reachable — reports an unresolved party and never an absent one, because a conflicts hit with no
party would invert what the row means.

**Two N+1 reads went with it.** The handler was resolving dispositions with a per-hit
`readCurrentDisposition` inside a `Promise.all` — the exact shape `readHitDispositionStates` was
written to replace, and whose own comment names it as the mistake the posture read cannot afford.
The checks screen was separately spending one Directory read per hit a reviewer opened. The handler
now makes two set-valued reads and the screen makes none: only a waiver's consenting party, which is
a different entity, is still read one at a time.

A general "name these entity ids" endpoint was deliberately NOT built. It would have been a
Directory batch read reachable with `conflicts:read`, which is a wider grant than this surface needs.

## Public

**A conflicts check now tells you who each candidate is.**

The list of candidates a check surfaced showed a record handle where the party's name belongs, and
you had to open each one to find out who it was. Every row now names the person or organization it
matched, as the Directory holds them today.

Where a name cannot be shown, the row says which of the two reasons applies rather than sitting
blank: the record was merged into another after the check ran, or the Directory holds it and nobody
has named it. A candidate is never shown as having no party — that is the one thing a conflicts hit
always has.

**The printed conflicts report improves most.** It could previously only name a party somebody had
opened on screen, so every other candidate printed as a raw handle on the document a firm hands a
court. It now names them all.
