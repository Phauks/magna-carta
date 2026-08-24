---
category: Changed
audience: internal
---

**The file manager's search results were a second, poorer list. They are the matter's own table now,
and the query re-runs when you come back to it.**

Results were rendered as bare rows carrying a name, a folder and a Show button. Everything the matter
table does — sorting, filtering, the column set, right-click, selection, the footer — was absent, so
acting on a result meant navigating away from the result set. That is also why "download all matches"
had been asked for: with no way to select a result, a bulk button was the only exit.

Results now render through `cellFor`, the same renderer the browse table uses, so a result is a row
in every sense. Selecting several and using the existing download action replaces the bulk button
entirely.

**Three defects went with it.**

The dropdown rendered only on `input`. Re-opening the field with a query already in it showed nothing
until a character was added or removed — the query looked lost when it was merely unrendered. Focus
and click now run the same render.

"Open Full Results" sat below the hit list, so it moved every time the list changed length. It rides
the scope line at the top, and is disabled rather than absent while the query is empty.

The panel stayed hidden until a character arrived, which put the scope selector — the one control a
person sets _before_ typing — out of reach. Opening the field opens the panel.

The search field also appears in the results header, where the query is stated, so refining a search
does not mean returning to the masthead. Re-rendering replaces that input, so focus and caret are
restored on each keystroke; without it, typing reverses itself.

Harness: 51 → 56 checks.
