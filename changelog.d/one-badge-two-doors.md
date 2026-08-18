---
category: Fixed
audience: internal
---

**The active-content badge was recorded on uploaded files and dropped on templates — the path where
it matters most — because the same decision was written twice.**

When the scan engine reports a clean verdict over bytes that still hold PDF JavaScript or Office
macros, `computeVerdict` returns `activeContent: true` and the file-ingest path records
`scan_detail: "active-content"`. The template-registration path recomputed that decision inline and
wrote `null` for every clean verdict, so the one signal the platform actually computes about
executable content survived on uploaded files and was discarded on templates. A template is, by the
route's own comment, untrusted content a firm will run against privileged data.

**There were three writers, not two.** The weekly re-scan sweep is the third, and it sets the column
unconditionally with the flagged reason — null for a clean verdict — so a version already badged
`active-content` had that badge erased the first time an engine-version bump re-scanned it. The badge
is now `scanDetailFor` in `@magna-carta/file-manager/verdict`, called by all three. Fixing it in place
would have left copies free to diverge again; this is one home with its own unit tests.

**A second literal in the same function named the wrong file type.** The template scan hardcoded the
OOXML wordprocessingml MIME as its `sniffedContentType` for every template, so a fillable PDF reached
the engine's prefilter classified as a Word document. It now passes the type for the kind the
preparation arm actually validated these bytes as — deliberately not the `?kind=` the presigned PUT
was signed for, which nothing forces the registration body to match. Structural heuristics dispatch on magic
bytes and were unaffected; what was wrong is the class handed to the signature engine.

**What this does not do yet.** On the template side the badge is now recorded and nothing reads it —
`document_template_version.scan_detail` has no reader today, and there is no template re-scan sweep
the way file versions re-scan on access, so versions registered before this keep their `null`
permanently. The column being right is the precondition for a surface that shows it, not the surface.
The file side is different: it had a reader all along, which is why the erasing re-scan mattered.

**Not changed, and worth stating.** A template version activating on an `unscanned` verdict is not a
defect — `packages/file-manager/CLAUDE.md` records it as explicit launch policy for a firm with no
engine deployed, and the template path mirrors the file path exactly. A deployed engine that will not
answer still raises `ScanFaultError` out of the registration handler, which is safe (nothing commits)
but reaches the caller as an Error ID rather than the retry-shortly `503` `scan-diagnose` gives for
the same fault; the effect callback owes a write and a response code rather than a `Response`, so
that fix belongs one level out and is filed rather than forced in here.
