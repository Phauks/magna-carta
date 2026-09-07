---
category: Fixed
audience: public
---

**Tasks and Time drew a second page inset inside the App Shell's own.** Both screens wrapped
themselves in `p-24` while `<main>` already carries it, so the two surfaces sat 48px from the chrome
where every other screen sits 24px. The wrappers now match the rest of the app
(`flex h-full min-h-0 flex-col gap-16`), and Tasks trades a `flex-1` that did nothing under a block
container for the `h-full` its list needs to hold its vertical space.

**The task list searched its own way.** It carried a hand-rolled `Input` with a leading Lucide
`Search` icon, a labelled box permanently occupying the control row, and a private 250ms debounce —
the exact defect `ScreenSearch` was built to end, and the reason its own header says a screen that
hand-rolls a search box is one. It now uses `ScreenSearch` with `searchOn="pause"`, which brings the
rest of the standing rules with it: the control rests as an icon and costs the row no vertical space,
opens focused into the field, keeps an accent hairline and an X while a query is live, and answers
Escape. The control row follows the ruling that the search and the create control travel together,
search first — search, New Task, then the clear-narrowing control as a `FunnelX` icon carrying a
summary of what it will undo, in place of the old text "Clear" button. Both surfaces on the shared
list move together: the member's own work list and the matter's Tasks section.

## Public

**Searching your tasks now works the way it does everywhere else.** The task list's search was its
own one-off: a box that sat open on the row whether or not you were using it, and that behaved
slightly differently from the search on Matters, Intake or the Custody register. It is now the same
control as the rest of the product — it rests as a magnifying glass, opens with your cursor already
in it, marks itself while a search is live, and clears with the X or the Escape key. The Tasks and
Time screens also sat further from the edge of the window than every other screen; they now line up.
