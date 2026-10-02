---
number: 423
slug: a-commit-that-stays-is-an-outcome-not-a-state-machine
status: Accepted
date: 2026-09-02
area: Design system
summary: "ActionOutcome gains a third value, done, for an act that happened and has something to show for it. The panel stays open as a panel with nothing left to ask: the commit leaves the bar, the dismissal reads Close, the unsaved-work guard stands down, and the fields and context snippets are handed done beside busy so one snippet renders the panel before and after. It is the reading kind's bar arrived at by acting, so it costs the shell one flag. The upload-destination panel needed it first — it saves a destination and stays while the batch lands — and two of the panels still to migrate show a reference or a made document after their commit. Without it each would hand-roll a state machine over the shell's open flag, which is the one thing a caller must never touch."
---

**A panel that stays after its act is a state the shell must own, or every caller will own it badly.**

**Context:** The shell closed on `"committed"` and stood on `"refused"`, and that covered the first
fifteen panels. The confirmation family brought the upload panel: it asks where a batch should land
while the files are already landing, and saving the destination is not the end of the panel — the
report beside the choice goes on until the last file settles, and the host closes the panel then.
Bug-report and new-document, still to migrate, have the same shape: the act happens and the reader
is shown a reference or the document that was made. Under the two-outcome contract, each would
have to keep the panel open by returning `"refused"` from a commit that succeeded, or by writing
`open` from outside — the one thing the contract forbids, because a close with two entrances is a
close the guard cannot cover.

**Decision:** `ActionOutcome` is `"committed" | "refused" | "done"`. On `"done"` the shell sets one
flag: the commit leaves the bar, the dismissal reads Close, the guard reports nothing to lose, and
`fields` and `context` receive `done` beside `busy`. The flag clears on the next opening, with the
caller's own reset. A host may still close a done panel by writing the bound `open` — that is a
prop changing, not a gesture, and runs no guard — which is how the upload panel leaves once its
batch has landed.

**Consequences:** The upload panel migrates whole, with its report as the context pane. The two
send panels migrate as plain forms when their turn comes. The footer-set rule is untouched, because
the commit control is the same source rendered under one more condition. The story that pins it
asserts the three things a caller relies on: the panel stays, the bar ends at Close, Escape leaves
at once.
