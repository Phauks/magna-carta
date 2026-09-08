---
category: Added
audience: public
---

**Members come out of a zip and onto the matter.** The file manager could browse an archive and
never open one: the controls existed and were disabled, each naming the archive-extraction engine as
what it waited on. `packages/file-manager/src/zip-member-extract.ts` is that engine, and
`POST /api/v1/files/{id}/archive-extractions` is the route over it.

Extraction is selective by construction. A member is located from its own local header offset and
only its compressed bytes are read, so pulling one document out of a multi-gigabyte archive costs
that document rather than the archive; nothing ever holds the container. The inflate is the
runtime's own `DecompressionStream("deflate-raw")`, which was available all along and which nothing
in this repository used, so there is no compression library and no C or C++ near an attacker's
bytes.

A zip is a format designed to be lied to, so every length in it is treated as a claim. Size and
ratio are checked against the firm's caps before anything is read, the inflate is capped as it
streams rather than after it has been held, and the inflated bytes are checked against both claims
the archive made about them, its recorded length and its CRC-32. A member whose bytes do not match
its container is refused rather than filed, which is the case that matters: a member somebody
swapped is exactly a member that inflates cleanly. The firm's `archiveCaps` have existed with only
`maxEntries` ever read; `maxUncompressedBytes` and `maxExpansionRatio` now govern what they were
written for.

Every extracted member re-enters through the ordinary ingest gate, sniffed and scanned fresh, with
`declaredContentType: null` because a name inside an archive is the other party's claim about its
contents. The verdict-inheriting duplicate path is deliberately not used: the archive passed the
gate and its members never did.

## Public

**Take files out of a zip without leaving the app.** Open a zip on a matter's Files page and you
could already see what was inside it. Now you can get it out: select what you want and choose
Extract, or extract the whole archive at once. Each file lands beside the zip it came from and is
checked on the way in exactly like a file you upload.

Some members will not come out, and the screen says which and why rather than counting them: one
that is password-protected inside the archive, one packed in a way the application cannot open, one
whose contents do not match what the archive recorded for it. The rest still arrive.
