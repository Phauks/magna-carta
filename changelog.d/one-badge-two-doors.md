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

**There were three writers, not two.** The in-place re-scan is the third, and it sets the column
unconditionally with the flagged reason — null for a clean verdict — so a version already badged
`active-content` had that badge erased the first time an engine-version bump re-scanned it. Not by a
weekly sweep — that helper selects on `scan_verdict = 'unscanned'`, so it can never see a badged
version, and no cron routes to it. The re-scan runs from the ingest consumer, reached three ways:
downloading or previewing a version whose recorded engine is stale, a member re-scanning a matter,
and — the one that makes this wider than it looks — the nightly storage passes. Both the editing
tiering sweep and the object-dimension backfill re-put objects at the same key, and a `PutObject`
under the `files/` prefix is an ingest notification like any other, so versions nobody has ever
opened were re-scanned too. The badge
is now `scanDetailFor` in `@magna-carta/file-manager/verdict`, called by all three. Fixing it in place
would have left copies free to diverge again; this is one home with its own unit tests.

**A second literal in the same function named the wrong file type.** The template scan hardcoded the
OOXML wordprocessingml MIME as its `sniffedContentType` for every template, including a fillable PDF.
It now passes the type for the kind the preparation arm actually validated the bytes as — deliberately
not the `?kind=` the presigned PUT was signed for, which nothing forces the registration body to match.
This changed no behaviour: the scan container hands the type only to heuristics that ignore it and
dispatch on magic bytes, and the prefilter that would consult it is built but deliberately unwired. It
is corrected because the value is a claim about the bytes and it was false, and because a truthful type
is what makes wiring the prefilter a no-op instead of a misclassification arriving with it.

**What this does not do yet, on either side.** No surface shows an `active-content` badge to anyone —
which is a narrower claim than "nothing reads the column", and the narrower one is what is true.
`scan_detail` reaches a client on five file paths: two flagged-download refusals in `routes/files/files.ts`,
and as `quarantineReason` on the file list, the file read, and the upload poll, which `apps/web`
renders. All five are gated on a verdict the badge cannot have — `flagged` or `quarantined` — and
every quarantine writer records its own reason rather than a badge, so no reader can reach one. The template column has no
reader at all. So this fixes a STORED FACT ahead of
the surface that will read it, on both paths — not a visible regression. Neither is backfilled: a file
regains its badge the next time access re-scans it, and a template version registered before this keeps
its `null` permanently, because nothing re-scans templates.

Recording it right first is deliberate rather than incidental. A badge the platform never wrote is not
something a later screen can recover, and the whole defect here is two writers quietly disagreeing about
a value nobody was looking at.

**Both call sites are pinned by tests that fail when the fix is reverted.** The re-scan writer fails
`ingest-consumer.test.ts`; the template writer fails `pdf-form-templates.test.ts`. The template one
needed a deployed engine answering clean-with-active-content, because that is the single verdict the
replaced expression and `scanDetailFor` disagree on — the old one already recorded the reason for
`unscanned`, which is all the pool's engine-less stub can produce. Two earlier attempts tried to
smuggle a marker through the bytes and failed, because the route scans the output of the form scrub
and the scrub re-serializes the document. The bytes were never the seam: `resolveScanPort` reads
`SCAN_SERVICE` off the request env, so the test overrides that binding with a fake engine, exactly as
`scan-unreachable-engine-seam.test.ts` drives an engine that will not answer.

**Not changed, and worth stating.** A template version activating on an `unscanned` verdict is not a
defect — `packages/file-manager/CLAUDE.md` records it as explicit launch policy for a firm with no
engine deployed, and the template path mirrors the file path exactly. A deployed engine that will not
answer still raises `ScanFaultError` out of the registration handler, which is safe (nothing commits)
but reaches the caller as an Error ID rather than the retry-shortly `503` `scan-diagnose` gives for
the same fault; the effect callback owes a write and a response code rather than a `Response`, so
that fix belongs one level out and is filed rather than forced in here.
