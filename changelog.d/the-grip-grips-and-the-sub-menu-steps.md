---
category: Fixed
audience: internal
---

**Two corrections from the owner's pass over the deployed rail.**

The Customize row's **grip was inert**. `onpointerdown` sat on the row's label button and the grip
was its sibling, so the one thing on the row that says "move me" was the one thing that would not.
The press is caught on the row now — grip, glyph, name and badge all start the drag — with the
trailing eye/star/lock let out by `event.target.closest(".mc-sidebar-row-control")` rather than by a
handler on each, so a control added to that row later is covered without anybody remembering to. The
row takes `role="presentation"`: it is a layout box, and the accessible path is the button inside,
which keeps its role, its `aria-roledescription` and the Alt+Arrow it announces.

The **sub-menu step was too shallow to read**. The rail's rows carry an 8px inset of their own, so a
24px indent put a child's glyph barely a glyph's width right of its parent's and a cluster read as a
flat list with a hairline through it. It is 32px now — 20 of margin, which the hairline sits on, and
12 of padding, which keeps the rule off the rows.
