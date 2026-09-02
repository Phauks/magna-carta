---
category: Changed
audience: internal
---

Ten more panels — eight in billing, two in costs — open in `ActionDialog`.

Write off a balance, issue a credit note, draft a bill, finalize one, edit a line, record a delivery, void a draft, amend an agreement, kick back a cost, void a cost. Each lost its own open flag, its own busy flag, its own hand-built footer and its own `$effect` that reset the fields; each gained the guard that asks before Escape throws away a half-written correction.

Two of the twelve turned out not to belong here, and naming them is the point. `arrangement-dialog` reads a record — the fee arrangement in force, its terms and its version history — and its one act opens a different panel; that is `RecordWindow`'s shape, not this one's. `apply-trust-funds-dialog` is an act whose commit is not served yet: its control is wrapped in `SoonAffordance`, the product's own primitive for a designed-but-unbuilt capability, and it becomes a plain `ActionDialog` the day a route hands out a trust account. Both keep an allowance, but the allowance now names which shell they belong to and when rather than recording them as debt.

The commit's icon is gone from the eight that carried one. `RecordWindow`'s commit has always been text, and a glyph beside "Write Off" under a heading that already reads "Write Off a Balance" was decoration the two shells disagreed about. Where a footer carried an explanatory line — what opening a draft actually does, which permission finalizing needs — it moved into the body: the action bar is the shell's, and a sentence is content rather than a control.
