---
category: Added
audience: public
---

`$lib/export` — the common tabular export seam: one document shape (title, second-stamped instant,
table sections) built from exactly what a screen shows, with plain-text and CSV renderers over it
(byte-order mark, CRLF, RFC 4180 quoting). Firm Usage is the first consumer; its Download Report is
now a format menu, and its filenames carry a timestamp to the second. Native .xlsx waits on a
deliberate library adoption; Word and PDF belong to document assembly's one rendering path
(docs/decisions/pending/a-data-export-is-one-document-and-a-format-is-a-renderer.md).

## Public

**Download the usage report in the format your next step wants.** Firm Usage's Download Report now
offers plain text or a CSV that opens straight in Excel and other spreadsheets, and every file's
name carries the date and time it was generated, down to the second, so two snapshots never blur
together.
