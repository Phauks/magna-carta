---
category: Added
audience: internal
---

**The matter file manager's rulings are written down and checked by a browser. Three settled
decisions were silently reverted in one round of mockup review, and nothing caught any of them.**

Design review on this surface runs in rounds: it is built, the owner walks it, corrections come
back. Each round was rebuilding the page from scratch, so anything decided two rounds earlier and
not restated in the newest message came back as whatever the model would have produced unprompted.
In one round that cost the forward button, the breadcrumb's home icon (back to the word "Files"),
and the matter search's position (back into the file-manager toolbar) — none of them mentioned in
the instructions that undid them, all of them already settled.

`docs/conventions/file-manager-rulings.md` is the cumulative ledger: every ruling, numbered, each
marked `settled`, `regressed`, `open` or `superseded`. A ruling in it is not re-proposed. It is
linked from `design-corrections.md`, which already carried the same lesson from the sign-in flow's
fifteen revisions.

`tooling/file-manager-rulings/` is the half that does not rely on anyone reading. It opens the
surface in headless Chromium and asserts each mechanically-checkable ruling — that Back, Forward and
Up all exist and that Forward enables once Back is used; that the breadcrumb root is an icon; that
the inspector carries five named tabs and offers no action buttons; that every column but Name
drags; that clicking a row does not open the inspector. It found two real defects while it was being
written: an "already removed" line that was still on the page because the script that removed it had
aborted before writing, and a hover-only `visibility` rule that made every version-row button
untargetable while a presence-only assertion passed.

The harness is also what keeps the ledger honest. A status is a claim about the built screen, and
it goes stale the moment a round builds something without returning to the table — twenty-six rows
were stale on the first reconciliation, all of them understating what had been built. That direction
of staleness costs the same as the other one: it sends the next round to rebuild what already
exists, which is exactly how the forward button was lost. The ledger now opens with the rule that
the harness runs first and any row it contradicts is corrected in the same commit. Standing at
reconciliation: 99 settled, 21 open, 1 regressed (renaming still selects the extension), 1
superseded.

Only mechanically-checkable rulings are in the tool. Taste stays a person's job.
