---
category: Added
audience: internal
---

**Analysis: "Save New Version" is the only one of three version-cutting paths that does not know what
it is replacing, and the platform already contains the mechanism that does.**

The owner asked for this two rounds ago — the button felt confusing and worrying, and the request was
to identify the necessity, the improvement, and any replacement. `docs/specs/2026-08-24-save-new-version-analysis.md`
is the answer.

Three paths cut a version. `initiateCheckin`/`commitCheckinVersion` records the **base version** the
working copy was taken from and compares it on return: fast-forward if the base is still current,
otherwise the bytes still commit but as a `conflict_pending` conflicting copy, current is not
advanced, and a human reconciles. An unchanged round trip cuts no version at all.

`commitVersion` — the plain upload path, which "Save New Version" uses — has none of that. It reads
exactly one thing about the file it is replacing: whether the incoming hash equals the current hash,
and skips as a duplicate if so. There is no base and no divergence concept; `diverged` exists only on
the check-in result type.

So two people who both use Save New Version on the same document produce two versions, the second
silently becomes current, and nothing records that they collided. Neither person is told. The same
scenario through check-out / check-in is refused the current slot and flagged for reconciliation.
Same bytes stored either way — the difference is whether the system knows.

The recommendation is to retire the button and split the two jobs hiding inside it: editing outside
the platform becomes Check Out / Check In (both already built, neither surfaced), and a revision
arriving from elsewhere becomes "Add Revision" carrying its provenance. Neither refuses a write. One
question is left for the owner, on whether a checked-out file is read-only for everyone else.
