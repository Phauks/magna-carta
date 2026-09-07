---
category: Fixed
audience: public
---

**Three screens drew a second page inset inside the App Shell's own.** Tasks, Time and Magnus each
wrapped themselves in `p-24` while `<main>` already carries it, so all three sat 48px from the chrome
where every other screen sits 24px. Each was written from a copy of the last, which is how one
mistake became three. The wrappers now match the rest of the app (`flex h-full min-h-0 flex-col
gap-16`), and Tasks and Magnus trade a `flex-1` that did nothing under a block container for the
`h-full` their lists need to hold their vertical space.

**`pnpm run lint:page-inset` now holds the line.** A fitness function over the route tree: for every
screen that renders into the App Shell's `<main>`, no top-level element may carry a uniform padding
(`p-*`, or a whole axis as `px-*`/`py-*`) or an inert `flex-1`. It derives both premises from the
shell's own markup rather than hardcoding them — that `<main>` pads itself, and that it lays out no
children — and fails on the premise if either stops holding, so it can never go on enforcing a rule
whose ground has moved. A one-sided padding is deliberately left alone: the home screen's closing
quote takes `pt-12` off its own `border-t`, which is spacing between the things on a screen and not
an inset. It reads the markup with a scanner rather than a pattern, because the time sheet declares a
snippet as `{#snippet cell({ row }: GridCellContext<TimeEntrySummary>)}` and a pattern reads that
type argument as an opening tag that never closes — which made the first draft of this scan report
the page clean. The rule is recorded under _Spacing and rhythm_ in
`docs/conventions/design-corrections.md`.

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

**Tasks, Time and Magnus now line up with every other screen.** All three sat further from the edge
of the window than the rest of the product; they no longer do.

**Searching your tasks works the way it does everywhere else.** The task list's search was its own
one-off: a box that sat open on the row whether or not you were using it, and that behaved slightly
differently from the search on Matters, Intake or the Custody register. It is now the same control as
the rest of the product — it rests as a magnifying glass, opens with your cursor already in it, marks
itself while a search is live, and clears with the X or the Escape key.
