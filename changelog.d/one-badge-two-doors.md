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

The badge is now `scanDetailFor` in `@magna-carta/file-manager/verdict`, called by both paths. Fixing
it in place would have left two copies free to diverge again; this is one home with its own unit
tests, which is the shape that makes the next divergence impossible rather than unlikely.

**A second literal in the same function named the wrong file type.** The template scan hardcoded the
OOXML wordprocessingml MIME as its `sniffedContentType` for every template, so a fillable PDF reached
the engine's prefilter classified as a Word document. It now passes the type the presigned PUT was
signed for, from the table that already holds it per kind. Structural heuristics dispatch on magic
bytes and were unaffected; what was wrong is the class handed to the signature engine.

**Not changed, and worth stating.** A template version activating on an `unscanned` verdict is not a
defect — `packages/file-manager/CLAUDE.md` records it as explicit launch policy for a firm with no
engine deployed, and the template path mirrors the file path exactly. A deployed engine that will not
answer still raises `ScanFaultError` out of the registration handler, which is safe (nothing commits)
but reaches the caller as an Error ID rather than the retry-shortly `503` `scan-diagnose` gives for
the same fault; the effect callback owes a write and a response code rather than a `Response`, so
that fix belongs one level out and is filed rather than forced in here.
