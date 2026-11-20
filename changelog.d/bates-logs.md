---
category: Changed
audience: public
---

**Separate Bates logs per matter.** A matter now keeps as many named Bates logs as it needs (table `bates_log` from the `bates-logs` per-firm migration), each with its own prefix and padding, counting from its own start. Every `bates_range` names its log, and the overlap guard holds within a log only, so two logs may share a prefix. The migration gives each earlier matter and prefix a log of its own. `GET` and `POST /api/v1/matters/{matterId}/bates-logs` list and start logs, `PATCH .../bates-logs/{logId}` renames one (a duplicate name is 409 `bates-log-name-taken`), and taking a range now sends `logId` in place of a prefix and padding. `GET .../bates-prefixes` is removed. A log's prefix and padding never change, and a log is never deleted, by trigger. The PDF Editor's Bates tab and the exhibit package pick a log or start a new one.

## Public

A matter can now keep separate Bates logs, one for each filing or production that needs its own numbers. Pick the log in the PDF Editor's Bates tab or when making an exhibit package, or start a new one with its own name, prefix and digits. Each log counts on its own.
