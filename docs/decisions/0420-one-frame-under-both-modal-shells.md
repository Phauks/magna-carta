---
number: 420
slug: one-frame-under-both-modal-shells
status: Accepted
date: 2026-09-02
area: Design system
summary: "The record window's frame — the header band and its quiet controls, the body, the primary pane that stops at its measure beside a context pane that takes the rest, the notice band, the action bar of fixed geometry, and the fit-first/cap-second sizing rule they all obey — is extracted into an internal recipe both modal shells sit on, so that neither shell and no panel rebuilds it. RecordWindow keeps every class name as a hook and every pixel as it was, proven by byte-identical screenshots of its four frame-bearing stories before and after; ActionDialog moves onto the same frame, gains a context pane that is the record window's right pane lent to a form, and opens at the record width whenever it has one. The decision was forced by evidence rather than taste: the largest panel in the app had rebuilt the whole frame from utilities in 647 lines, quoting the record window's own doctrine in its comments, because there was nothing to reach for. A read-only variant of the modal was considered for the same gap and rejected — it would be a second answer to reading a thing, and would make the commit optional for every panel that has one."
---

**A pane system that lives in one shell is a pane system every other panel rebuilds — so it lives
in neither, and both sit on it.**

**Context:** The owner asked, after the modal shell landed, whether a pane system should be
implemented rather than built each time. The question had already been answered in the repository
by the largest panel in the app. `new-matter-dialog.svelte` opened with a header band, a separator,
a body that scrolled alone beneath bands that did not, and a two-pane grid at two-thirds and
one-third — the record window's frame, rebuilt from utilities in 647 lines, with a head comment
quoting the record window's own sizing doctrine as its reason. It is exactly what a careful author
does when the thing they need lives inside a shell they cannot use: they copy it, and the copy
drifts.

The same question arrived in a second form — should read-only panels be a variant of the modal —
and working through the two panels that looked read-only settled it the other way. One reads a
record with history and an action, which is the record window's shape; the other is an act whose
commit is not served yet. A read-only kind would have been a second answer to "read a thing" and
would have made the commit optional on every panel that has one, weakening the rule that the commit
owns the close. The gap the question pointed at was real. The pane system is what fills it.

**Decision:** The frame is one internal recipe, `styles/recipes/modal-frame.css`, and both shells
sit on it. It holds what the record window held alone: the panel, the header band and its quiet
controls, the identity, the body, the primary pane that stops at its measure beside the context pane
that takes the rest, the action bar of fixed geometry, and the rule that governs all of them — fit
first, then cap. Two rules are new because a second shell needed them: a primary pane with no
context beside it fills the frame, and the notice band sits outside the scroll directly above the
action bar, where the reader is looking when a commit comes back refused.

`RecordWindow` keeps every class name it had, on every element, as the hooks the catalog's geometry
assertions and the header-set rule read, and adds the frame's class beside each; its own recipe
shrinks to the tab strip only a record window has. `ActionDialog` gains a `context` snippet — the
record window's right pane, lent — and a context pane implies the record width whatever was asked,
because two panes have a geometry of their own and a caller should not discover that by eye.

**The standard a shared chassis has to meet is that the shell it was taken from cannot tell.** The
four record-window stories that show the frame were screenshotted from the static catalog before
the extraction and after it. All four are byte-identical.

**Consequences:** No panel builds a pane system again; a form that needs context beside its fields
hands over a snippet and gets the record window's own right pane. The new-matter window is the proof
and the first caller: 647 lines to 622, the hand-built bands and grid gone, the unsaved-work guard
gained. The header-set rule matches its group by class token rather than the whole attribute, so an
element may carry the frame's class beside its own. A third shell, should one ever be justified,
sits on the same frame or explains why it cannot.
