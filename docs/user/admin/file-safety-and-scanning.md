# File safety and scanning

Every file uploaded to your firm is scanned before anything else touches it. Under **Settings ›
Documents › File Safety & Scanning** an administrator decides how deep that scan looks, how sure it
has to be before it flags a file, and what the firm may do with a file it flagged.

## Scan depth

**Scan Depth** is one of three:

- **Core**: the high-confidence rules that catch known malware.
- **Extended**: Core, plus the broader threat rules. This adds thousands more high-confidence
  malware rules and a set of heuristic suspicious-pattern rules, which count only when they score
  at or above the suspicion threshold.
- **Full**: every rule the engine carries, including the noisiest.

Whichever depth you choose, the antivirus signatures and the structural checks on PDF, Office and
ZIP files always count. A deeper scan flags more; a shallower one flags less.

Beneath the depth the page shows the **Scan Engine** every upload is scanned by, as it reports
itself: the engine's own version, the YARA ruleset it was built with, and the malware definitions
it boots with. If no scan engine is reporting to your deployment the page says so; uploads are then
recorded as unscanned rather than clean.

**Rules At This Depth** states what the chosen depth means, and changes as you choose. The list of
rule families inside each depth is marked as coming: the engine does not report them yet.

## Suspicion threshold

**Suspicion Threshold** is a whole number from 0 to 100. A heuristic rule's match counts only when
its score reaches this number, so a lower threshold flags more files and a higher one fewer.

## Flagged files

**Flagged Files** decides what the firm may do with a file the scan flagged: hold it so nobody can
open it, ask first so it can be opened once the risk is acknowledged, or allow it, openable and
marked as flagged. A flagged file is never deleted. **Confirm Identity First** asks a member to sign
in again before they open a flagged file.

## Saving

Changes stage on the page and land together when you press **Save** and confirm the recap. A
change to what a flagged file may do asks once more before it lands, because it is the firm
deciding that a file its own scanner distrusts may be opened. What you save reaches the next upload
and the next download at once; nothing is re-scanned.

## Who can change it

Reading and changing the scan policy needs the `firm:manageScanPolicy` permission, which is granted
to the Admin role. Everybody else sees the firm's answers stated and can ask for a change from
the row.

## Related features

- [`upload-readiness.md`](upload-readiness.md): checking that uploads can reach the firm's storage.
- [`../features/seeing-what-version-you-are-on.md`](../features/seeing-what-version-you-are-on.md):
  the versions of every other part of the platform.
