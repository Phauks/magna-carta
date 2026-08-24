---
category: Fixed
audience: internal
---

**Two file-manager rulings were marked `settled` in the ledger while the screen still had the
defect, because the harness asserted the wrong property. The owner raised each of them three times.**

The sidebar toggle is the clean example. The complaint was a dark panel behind an active button. The
rule sets `box-shadow: none` and the check asserted exactly that — `box-shadow` was `none`, the check
passed, and the thing being pointed at was `background: var(--mc-surface-selected)`, a fill. The
check tested a reading of the words rather than the screen, and a passing check is louder than a
person repeating themselves.

Renaming was the other: the field was built from `f.name` and `.select()`ed whole, so the extension
was always shown and always selected. No check covered it at all, and the ledger row saying
`regressed` was merged without anyone acting on it.

Both are fixed, and both now have checks that would have caught them: the toggle's computed
background is compared against the toolbar's with the pointer parked away from the button (`:hover`
legitimately raises the surface, and measuring under the cursor reads that as the active fill), and
rename is exercised in both extension modes — shown, where the selection must stop before the
extension, and hidden, where the field must carry none and the commit must put it back.

Nine more round-seven rulings landed with them: delete works at last (files soft-delete; a folder
with contents asks, and keeping them is the default); folder rows match file rows (an unclassed icon
was rendering at 200px in a 32px row); Home reaches the root; a folder's Size reads bytes and count;
colour is a submenu of square swatches; document type is editable where it is displayed; the tab
strip scrolls; the signature modal is rebuilt on the dialog's own structure and decodes the signature
name into its four documented parts rather than showing an opaque string; a digest can be verified
against a file hashed in the browser; and archive members render on the matter's own table, with the
columns they cannot answer left empty rather than invented.

The harness is 51 checks, up from 40. A dialog is now capped so a long one cannot push its own Close
button off-screen — found because the rebuilt modal did exactly that.
