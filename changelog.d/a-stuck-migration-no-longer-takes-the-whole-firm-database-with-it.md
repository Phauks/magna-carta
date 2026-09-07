---
category: Changed
audience: internal
---

A firm database whose lineage is stuck now says so, instead of refusing every question including that one.

Migrations run in the `FirmDatabase` durable object's constructor, and a constructor that rejects takes the entire object with it — every read, every write, and, because the diagnostic reads are firm-scoped like everything else, the surfaces whose only job is to explain what happened. One statement in one migration put a firm completely dark, with the fault legible nowhere. That happened twice in a day.

The object comes up either way now. The fault is recorded rather than rethrown, and what it costs is business data, which stays refused: the schema is at a consistent state but an older one than this build's code was written against, and serving reads across that gap would trade an outage for wrong answers. The refusal carries the fault, so it explains itself instead of surfacing as a bare platform error.

What it no longer costs is the ability to ask what is wrong. The durable object answers a migration read outside that gate — a question about the fault cannot be refused because of the fault — and the health panel's schema row asks through it. That row used to be an ordinary statement, which meant the one check that could name a stuck lineage was the check a stuck lineage silenced: it reported "Not read" about its own subject. It now reports which migration the database reached.

The database section's own copy control is gone with it: the panel's copy control takes the whole diagnosis from the top, and two copy gestures differing only in scope is a choice a reader has to make without being told which is which.
