---
category: Changed
audience: public
---

**The preview-before-save leaves the call log.** The owner's ruling of 2026-09-08 — where a record carries a reference number a person reads back, the panel states the number the next one would draw while it is still being filled in, and says that it is a preview rather than a reservation — was written generally and reached one file. The call log had the effect, the wording, the racing-reads guard and the reset, hand-written; every other panel that mints a number showed nothing.

`PreviewedNumber` (`@magna-carta/design-system/record-reference`) holds it once. Each domain keeps its own endpoint and its own scope key — a call's number is scoped to the UTC day it happened on, a matter's to the firm's numbering scheme, a packet's to the custody register — and folding those into one route would put every domain's numbering rules in one handler. What is shared is the shape of the answer, the guard against a stale read landing after a newer one, and the words the reader is told: the parts that were drifting. It knows nothing about how the answer is fetched, so the app's transport and failure model stay in the app.

Two creation panels state the honest half now. **New Matter** says which number the save will draw and that it will — a consultation draws its own tentative number, an open matter draws the matter number, and an intake draws neither, because no number of any kind exists before a matter is at least a consultation. **New Packet** previews the custody number, except where the packet was carried in from a paper deeds register, in which case the number already written on its physical label is the packet's real number and the save only records it.

## Public

**Numbers arrive before the save, not after it.** Opening a matter, recording a consultation or logging a custody packet now tells you which number the record will be filed under while you are still filling the form in — and says plainly that the number is drawn when you save, so nothing is held for you. Recording a call already worked this way; now the rest do.
