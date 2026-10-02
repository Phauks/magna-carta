---
number: 418
slug: one-shell-for-an-act-asked-of-a-reader
status: Accepted
date: 2026-09-01
area: Design system
summary: "Every modal panel in the product is one of two shells and never a third: RecordWindow, already built, for reading and changing a record, and a new ActionDialog for an act asked of a reader. ActionDialog is domain-blind and failure-blind in the manner RecordWindow already is — a caller hands it a heading, a subtitle, a fields snippet, a notice snippet, one commit verb, one refusal string and one async commit returning committed-or-refused, and the shell owns the open flag, the reset, the busy flag, the footer's geometry and the order of its two controls, the dismissal verb, whether a corner dismiss shows, and the single close path every exit runs through. Its `kind` — form, confirm or destructive — is what selects the underlying primitive, so the Dialog-versus-AlertDialog split stops being decided per file. Its seams are a closed set: the fields and notice snippets, kind, a closed width union, and the commit's outcome; no class prop, no footer override, no showClose. The unsaved-work guard that record-window.svelte already implements is lifted to a shared internal both shells consume, which is what finally gives all thirty panels a dismissal that asks before it discards. Enforced on both halves. In the source, a new lint-one-ui rule with three signals — a composed Dialog/AlertDialog/Sheet panel outside a declared shell's home, a scrim written as Tailwind utilities at the modal layer, and a reach for the platform's own modal — where WHICH homes may compose a panel is declared in registry.json beside the component register rather than hardcoded in the rule, so adding a shell is a reviewed edit to the file that already answers what is in the system; being a registered component is deliberately not enough on its own. A second rule asserts the shell's own action bar the way the header set has always been asserted against the record window. In the rendered DOM, both shells stamp data-modal-shell, which is the only thing that catches a panel whose parts were aliased on import or chosen at runtime. The thirty-seven existing panels are carried as printed allowances that must be deleted as each is migrated."
---

**A shared surface is built once, and the modal that asks somebody to do something was the last
one nobody had built.**

**Context:** The product settled this argument twice already and both times it stuck.
`RecordWindow` is the one window a record opens in; `RecordMenu` is the one menu a table
right-clicks into; a source scan fails the build when a second implementation of either appears,
because a second implementation is the most expensive defect this product can ship and the
quietest — it renders correctly, it typechecks, it reads fine in review, and it surfaces a round
later when a correction is applied to one copy and not the other.

The doctrine was never extended to the panel that asks for an act, and thirty-four files in
`apps/web` now compose one by hand — 7,753 lines of them on `Dialog` alone. Each re-derives the
same seven mechanics, and they have already drifted in every way drift is available: thirteen say
"Cancel" where five say "Close" for the identical gesture, eighteen suppress the corner dismiss
where twelve keep it, five still render a raw `Alert` where nineteen render the failure band.
**None of the thirty guards its own dismissal** — every one discards a half-written write-off,
credit note or new matter on a stray Escape, silently, which is the exact failure `RecordWindow`
was given a guard to prevent and which no author of a single panel would think to solve alone.

The rate is the argument for deciding now rather than later. Two branches opened in the same week
added four more hand-composed panels between them, and one renders its failure through the very
construct a cross-cutting sweep merged days earlier to remove — a sweep that, having thirty
independent panels to reach, left five of them still doing it. Nothing told either author the
other existed, because nothing in the repository held the answer, and nothing gave the sweep one
place to change. A shell costs one component and one rule; every week without one costs two more
panels and widens the migration by two.

**Decision:** Two shells, no third. `ActionDialog` joins `RecordWindow` in the design system,
built the same way and for the same reason: it renders a heading, a subtitle, a body, a notice and
an action bar, and it does not know or care what any of them contain. A field that named one kind
of act would be the first crack in the rule, so the contract admits none.

What the shell owns is not a set of defaults but the absence of props: the footer's geometry and
the order of its two controls, the dismissal's word, the busy state raised around the commit,
whether the corner dismiss shows, and the one close path that the corner dismiss, Escape and a
press outside all run through — because a second exit that skipped the unsaved-work question would
make the question decorative. What a caller may differ on is a closed set: the fields snippet, the
notice snippet, `kind`, a closed width union, and the commit's outcome.

Two of those seams carry most of the design's weight. `kind` — form, confirm or destructive — is
what selects the primitive beneath, so a caller declares what it is asking and the shell decides
what that implies; today four panels sit on `AlertDialog` and twenty-six do not, with no rule
behind the split. And `notice` is a place without a content: the design system cannot know what a
failure reads like, so the shell reserves the slot and the app puts its failure band in it. That
keeps `packages/design-system` from ever learning about the app's problem model while still
denying thirty callers the freedom to each decide where a failure sits.

Enforcement is the repository's existing machine, not a new one. The name is taken in the
one-implementation registry when the contract is accepted rather than when the home is built —
which is precisely the window in which this week's four panels were written — and a new rule fails
a hand-composed `Dialog.Content` or `AlertDialog.Content` under `apps/web`. All thirty-four
existing panels are carried as allowances, each with its reason, printed on every run; the
registry's standing discipline that an allowance outliving its violation is itself a failure is
what makes that ledger shrink instead of rot.

**Settled by the owner on 2026-09-02, and the settling is itself the argument.** The dismissal verb
is "Cancel" for every kind of ask, held as one constant rather than a per-kind field so no kind can
drift back to a word of its own; a form keeps its corner dismiss and a question still has none; and a
full-screen surface stays a design choice each time rather than becoming a third shell. Each of those
was one edit to one table, which is the whole claim this decision makes: before the shell, the same
three rulings would have been thirty-odd files.

**Consequences:** New work is bitten immediately and nothing in flight is blocked, so the shell
can land with a gallery and no adopters. Twenty-six panels are in scope; the other eight are named
and excluded rather than left to be discovered mid-migration — the launcher, the four directory
panes, the two full-screen surfaces, and the create-a-matter panel, whose right answer is
`RecordWindow` opened in its editing mode rather than any dialog at all. The guard is extracted
first and the shell is built on it, which is possible only because every branch that held
`record-window.svelte` open has now merged; read through the ahead/behind counts those branches
still show, the same window would have looked closed and the guard would have been written twice
and reconciled later, for nothing.
