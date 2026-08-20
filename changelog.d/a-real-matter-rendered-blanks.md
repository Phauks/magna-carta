---
category: Fixed
audience: internal
---

**A real matter rendered blanks where a sample matter rendered detail.** The client's mapper for a
live matter read hardcoded seven fields to null: the matter type, the Location, the responsible
attorney, the e-billing flag, and all three instants. Only the three in-repo sample matters — the
fixtures the interface is reviewed against — ever showed those, which is the worst way round for a
demonstration to be wrong.

Three of the seven the contract already carried and the client's payload type simply did not accept,
so they were parsed away on arrival. The other four the contract did not carry at all.

The detail read now resolves the type, the Location and the responsible member to **names**, in the
same statement, rather than answering with the identifiers a screen cannot print at a person. That
is a separate statement from the one the lifecycle service uses: deciding whether a matter may open
or close has no business paying for three joins to learn a name it will never render. All three
joins are outer, and an unset type or an archived member reads as an honest null rather than an
identifier standing in for a name.

The three collections stay empty on purpose and now say so in the code. Files, time entries and
costs each have their own list endpoint on their own screen; filling them from the matter read would
be three calls the overview does not need and a record that goes stale the moment one of those
screens writes.
