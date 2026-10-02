---
number: 439
slug: a-number-set-by-hand-belongs-only-to-a-matter-that-has-been-active
status: Accepted
date: 2026-09-06
area: Matters
summary: "A matter number set by hand (a court's number, a legacy number, a correction) is accepted only on a matter that has been active: open, on hold, or closed after opening. An intake or a consultation cannot be renumbered, by the counter or by hand, because the owner's ruling is that no matter number exists before a matter is active. The renumber service refuses the unnumbered rungs with matter-not-open, and the status window offers Set Number only where the matter has opened. The numbering scheme editor ships under Settings · Matter Numbering over the routes that already existed, with the preview rendered by the server so the number a scheme produces is the number a matter gets."
---

**A number set by hand belongs only to a matter that has been active.**

**Context:** the renumber route accepted any matter, and the service test pinned that a
consultation could be given a manual number and would then reopen to consultation, not open. The
owner's ruling of 2026-09-06, made when adding the hold rung, was that "no matter number is assigned
until it becomes an active matter." A manual number on a consultation contradicts that as plainly
as a drawn one would: a consultation the firm declines would carry a matter number it never earned.

**Decision:** `renumberMatter` refuses a matter whose `opened_at` is null and whose `matter_number`
is null, with `matter-not-open`. A matter that has been active (open, on hold, or closed after
opening) accepts a manual number, which touches no counter and records the displaced number in the
audit trail. The status window's Number block offers Set Number, or Change Number, only on such a
matter; on an intake or a consultation it states that the number is drawn when the matter opens.

The scheme editor under Settings · Matter Numbering is the framework for the firm's numbers: one
editor per purpose (matter, consultation), the parts as the reader names them, scoping drawn as
"restarts the count", and the preview rendered by the server's own renderer against a sample matter
whose values are printed beside it, never composed on the client.

**Consequences:** the reopen path no longer needs to distinguish a manually numbered consultation
from an opened matter, since none can exist; the test that pinned that case is replaced by one that
pins the refusal. A firm migrating legacy matters records them as open first (drawing a number from
its scheme, or with no scheme set, refused) and then sets the legacy number by hand; a migration
path that bypasses the draw is a later concern for the import tooling, not for the renumber route.
