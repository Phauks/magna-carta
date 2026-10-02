---
number: 421
slug: a-reading-kind-is-an-arm-of-the-union-not-an-optional-commit
status: Accepted
date: 2026-09-02
area: Design system
summary: "ActionDialog gains a fourth kind, reading, for a panel that states a fact and seats any step it offers in the body beside that fact rather than in the action bar — the matter-status window is the model. This reverses the position taken a day earlier that a read-only variant would be a second answer to reading a thing and would weaken the type for every panel that commits. The reversal is on evidence: a panel arrived that was neither a record (no tabs, history or editing mode) nor an act asked of a reader (nothing to commit), and the alternative was a hand-composed Dialog.Content that the one-implementation rule rightly refused. The type is not weakened: the props are a discriminated union on kind, where the acting arm still requires commitLabel and onCommit and the reading arm forbids them. The reading kind renders on Dialog with the corner dismiss, is dismissed by a press outside, runs no unsaved-work guard unless told there is something to lose, and its one bar control says Close — nothing was begun, so nothing is cancelled. It is explicitly not a read-only RecordWindow; a record still opens in the record window."
---

**A position held against a hypothetical is reversed against a panel, and the type is the proof
that the reversal cost nothing.**

**Context:** The owner asked, while the pane system was being extracted, whether read-only panels
should be a variant of the modal. The answer given was no, and it was reasoned from the two panels
that looked read-only at the time: one was a record with history and an action, which is
`RecordWindow`'s shape, and the other was an act whose commit is not served yet. A read-only kind
would have made `commitLabel` and `onCommit` optional, and an optional commit is a weaker contract
for the thirty panels that have one. The pane system was what those two panels had been rebuilding,
so the pane system was built and the variant was not.

The next day the matter-status window merged. It opens from the seal in a matter's header, states
the matter's status, and — when the reader has the right — offers the step, Close Matter or Reopen,
seated in the body beside the status it changes. That placement is a design decision, not an
omission: somebody may have opened the window to read the physical-file pane beside it, and the
corner is where a hand goes by habit. Its action bar has nothing to commit. It is not a record;
`RecordWindow` would have given it tabs and an editing mode it has no use for. It is not a form;
`kind="form"` would have forced a commit button into a bar its design had rejected. So it composed
`Dialog.Content` by hand, the `hand-composed-modal` rule refused it, and `main` went red because
nothing before merge had run the rule.

**Decision:** `ActionDialog` has four kinds, and the fourth is `reading`. The props are a
discriminated union on `kind`: the acting arm (`form`, `confirm`, `destructive`) requires
`commitLabel` and `onCommit` exactly as before, and the reading arm types both as `never`. The
objection that a read-only variant weakens the type is answered by the union rather than argued
away — no arm got weaker to admit the other, and a caller that names `kind="reading"` and then
hands over a commit is a type error, as is a form that omits one.

The kind table gains a row rather than the template gaining a branch: `reading` is `commitVariant:
null`, and the action bar renders its commit only when the variant is not null. The dismissal on
that bar says **Close**, held as a second constant beside "Cancel"; the reading kind sits on
`Dialog` with the corner dismiss and is dismissed by a press outside; and it runs no unsaved-work
guard unless the caller says `unsavedChanges`, because a panel that asks for nothing has nothing to
discard. A context pane implies the record width here as it does for a form.

What the reading kind is not: a way to read a record outside the record window. The two shells
draw a line — read and change a record; be asked for an act — and the reading kind is a third
clause on the same line: read a fact and take a step from where it sits. A panel with tabs, a
history or an editing mode is still a `RecordWindow`.

**Consequences:** The status window migrates instead of taking an allowance, and `main` is green
on the rule again. The `footer-set` rule still asserts both bar markers in the shell's source,
because the source still carries both. Two wording changes reach users on that window: its bar's
control reads "Close" where it read "Done", and the control is no longer disabled while a step is
in flight, because the shell owns the dismissal and a reader may leave a panel that is working.
Two further panels of this shape are known and will take the kind when they migrate. The reversal
is recorded in the design (section 11.4) in place of the position it replaces, so the reasoning
that was wrong stays readable beside the evidence that overturned it.
