---
category: Changed
audience: public
---

**The details panel's version history and safety history are `DataTable` grids, the Hashes tab
computes on entry for a chosen version and compares against a given digest, and a file can be
checked again.** `GET /api/v1/files/{id}/scans` reads a file's safety history off the audit log;
the commit, re-scan and quarantine audit rows now carry the verdict, engine and detail they
recorded, so each line keeps the engine that ran it. `POST /api/v1/files/{id}/rescan` enqueues a
`FileRescan` message the ingest consumer runs regardless of engine staleness and without the dedup
cache, keyed on the request's audit id, which its result row carries back. `fileIntegrity.verify`
accepts an optional `versionId`; `FileVersionItem` carries the scan facts. `safetyKeyOf` no longer
grades a missing document type as `info`, and the `untyped` issue kind is gone.

## Public

**A document's details panel reads as tables, and a safety check can be run again.** Version
History is a table: version, date, size and who created it, with each row's controls beside it.
The Hashes tab computes the fingerprints as it opens, for the version chosen in its dropdown, and
a new **Compare Against a Digest You Were Given** field takes a typed or pasted digest, or a file
from your device, and says whether it matches. The Safety tab lists every check the document has
had, with when, which version, which engine and what it found, and **Check Again** asks for a
fresh one; **Re-run Safety Check** on the right-click menu does the same for a selection.
**File's Own Date** is now **Source File Date**, with what it means beside it. A document with no
document type no longer carries an Info safety mark.
