---
category: Changed
audience: public
---

**A consultation can be put on hold or closed, and the status seal is a menu of the steps a matter
can take.** The lifecycle graph gave `consultation` one edge, Open Matter, and the hold route
refused anything but an open matter. Now `holdMatter` and its in-batch guard accept `open` or
`consultation`; `releaseMatter` returns the matter to where the hold found it, reading `opened_at`
as the one honest signal rather than assuming `open`; and the close, which the service already
accepted for a consultation, is offered from the consultation's own seal as Close Consultation. A
closed or held consultation keeps its tentative number and draws no matter number. The seal on the
matter header is a `DropdownMenu` over the Badge listing the steps available from where the matter
stands (never the five statuses; the "steps, never a picker" comment in `matter-lifecycle.ts` now
says why a dropdown of steps is not a picker), with the status window as its last item. Each step
declares how it is taken (`takenFrom`): the hold, the close, the open and the intake's completion
open the window at the step; the release and the reopen ask once in the confirm panel and run. The
seal reads the session through the shared `sessionPermissions` store as the pointer reaches it.
Route descriptions, the OpenAPI snapshot and the generated client are updated.

## Public

**Park or decline a consultation from its own page, and change any matter's status from its
badge.** A consultation the prospect is still thinking over can be put on hold, with a reason, and
released back to a consultation; one the firm decides against is closed with Close Consultation and
keeps its consultation number without using up a matter number. Pressing the status badge on any
matter now opens a short menu of what the matter can do from where it is — open, hold, close,
release or reopen — and the step you choose either opens the status window at that step or, where
nothing needs reading first, simply asks and goes. The status window is still there, one item down
the same menu, for the number, the engagement and the physical file.
