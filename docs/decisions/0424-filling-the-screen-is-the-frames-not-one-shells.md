---
number: 424
slug: filling-the-screen-is-the-frames-not-one-shells
status: Accepted
date: 2026-09-03
area: Design system
summary: "Full-screen is a capability of the modal frame both shells sit on, not of the record window alone. The record window's expand — its corner control, its session memory and the geometry that drops the width cap — moves beneath both shells as a shared internal, and ActionDialog gains the same control on its Dialog kinds, form and reading, and never on a question. Each shell keeps its own control in its own header set, because the header set is asserted at the source; each shell keeps its own session memory, because a reader who filled the screen with one form has said nothing about the next question. Both shells take a bindable expanded, which is how a panel opens expanded by design rather than as a hand-built window. The owner's ruling that full-screen is a design choice each time is kept and made cheap: the choice becomes one prop. The three surfaces that had been excluded as full-screen — one of which rebuilt the record window's expand by hand — migrate onto the frame opened expanded in the pass that follows."
---

**A capability that lives in one shell is a capability every other panel reinvents.**

**Context:** The record window has had a corner control that fills the viewport since it was
built, remembered for the session so the next record opens the same way. The action dialog had no
such control, and three surfaces sat outside both shells on the reading that they were "full-screen"
and therefore a separate design. Read against their source, they were three different things: the
time sheet had rebuilt the record window's expand by hand inside a raw dialog — its own flag, the
same two icons, the same three utilities; the safe-browse screenshot viewer was a reading panel that
opens filling the screen; and the cost review was not full-screen at all, but a queue walked one
cost at a time. What they had in common was that nothing beneath them offered what the record
window already had.

The owner asked whether full-screen should be an expansion available to every modal, and whether the
full-screen parts should be combined in a second pass. The answer to both is yes, and the tree says
why: the standing ruling that full-screen is a design choice each time had been read as "each
surface builds its own", when it can be read as "each surface decides whether to open that way".

**Decision:** The frame owns expand. `internal/frame-expansion.svelte.ts` holds the state, the two
names the control answers to, the expanded geometry, and one session memory per shell. Each shell
keeps its own control in its own header set — the record window's is asserted at the source by
`header-set`, and a control arriving through a shared component would leave that set unreadable
there — and each shell keeps its own memory: records at full viewport is a posture for a sitting;
a form filled to the screen is a choice about that form. `ActionDialog` offers the control on its
Dialog kinds, `form` and `reading`, and never on a `confirm` or `destructive` question, which has
nothing to gain from a screen's worth of room. Both shells take a bindable `expanded`; a caller's
binding wins over the memory, and handing it `expanded` is how a panel opens expanded by design.

**Consequences:** The record window's four frame-bearing stories are byte-identical before and
after, which is the standard for touching the frame. The time sheet, the screenshot viewer and the
cost review migrate in the pass that follows — the first two onto a shell opened expanded, the third
as a reading panel whose acts sit beside the facts they decide — and the time sheet's hand-built
expand is deleted with it. The owner's ruling stands, and costs one prop.
