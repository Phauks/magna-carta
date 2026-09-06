---
category: Added
audience: public
---

**The numbering scheme has an editor, and a matter's number can be set by hand.** Settings ·
Matter Numbering replaces its Soon stub with two editors over the routes that already existed
(`GET`/`PUT /api/v1/numbering-scheme`, `POST /api/v1/numbering-scheme/preview`): one for the matter
number and one for the consultation sequence, each an ordered list of parts (text, the one counter,
year, date opened, office code, practice-area code, client code, attorney initials, client name)
with the scoping flag drawn as "restarts the count", starters for the common shapes, and a live
preview rendered by the server against a sample matter whose values are printed beside it. The
model lives in `apps/web/src/lib/matters/numbering-scheme.ts`; the editor in
`numbering-scheme-editor.svelte`. The matter's status window gains a Number block with Set Number
(Change Number where one stands) behind `matters:renumber`, over `POST /api/v1/matters/{id}/renumber`,
offered only where the matter has been active; `renumberMatter` now refuses an intake or a
consultation (`matter-not-open`), since no matter number exists before a matter is active.

## Public

**Decide what your matter numbers look like.** Under Settings › Practice › Matter Numbering, write
the shape of your matter numbers and your consultation numbers as a list of parts: a prefix, the
year, your office or practice-area code, the client's code, and the counter that ticks up. Any part
taken from the matter can restart the count, so each year or each practice can have its own run.
Start from a common shape, watch the preview render as you go, and save. Numbers already drawn stay
as they are. A court's number or a number from your old system goes on a matter by hand from its
status window, under Number.
