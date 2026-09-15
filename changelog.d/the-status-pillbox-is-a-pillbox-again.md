---
category: Changed
audience: public
---

**The matter status seal is a pillbox again, and one control changes the status.** The dropdown of lifecycle steps that shipped three days earlier is gone: `matter-status-dialog.svelte` renders the Badge inside a plain button that opens the status window, and the window's status row carries one `Change Status` beside the seal. That opens `matter-status-change-dialog.svelte`, an `ActionDialog` of `ChoiceRow`s — one per step the lifecycle allows from where the matter stands, each carrying the block sentence or the standing line, with the chosen step's consequence and requirement rows beneath and the footer commit reading that step's own verb.

The checks moved with it. The close, open and graduate readiness reads, their requirement lists and the hold's reason field are in the change panel; the number, the engagement and the paper file stay in the window, because they are standing facts about the record rather than anything a step does. `matterStepStanding` in `matter-lifecycle.ts` answers where any step stands from one readiness record, so the panel renders one structure where the window rendered three shapes, and every step gained a `consequence` sentence while `takenFrom`/`confirmation` went with the separate confirm panel. The lifecycle contract is untouched.

## Public

**A matter's status is changed from one control, in a panel that says what each step requires.** The status badge at the top left of a matter states the status and opens the matter's status window; beside the status there, one control reads **Change Status**.

It opens a panel listing the steps the matter can take from where it stands, each with one line saying where it stands: nothing in its way, a requirement not met, or a permission this account does not hold. Choose one and the panel states what it would do to the record and lists everything it requires, already answered by the firm's own rules, and the button at the foot reads that step's own verb. A hold asks for its reason there. A step you may not take is shown refused with the reason rather than hidden.

The checks moved with the change. What closing requires, what the firm's intake procedure still wants and the hold's reason are read where the decision is taken; the matter's number, its engagement and where the firm keeps its paper file stay in the window that reads the record, because they are true whatever the status is.
