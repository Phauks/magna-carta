---
category: Changed
audience: internal
---

The four financial ledgers' details panels become one shell, and a refused control says what it would have done.

Time, Costs, Fees and Billing each carried their own details panel, and the four were the same panel: the same three faces, the same header, the same ruled runs of facts, down to identical class strings. `$lib/details-panel` is the shell they now compose — Root, Header, Title, Subtitle, Close, Body, Section, Facts, Fact — and what stays in each surface is what only that surface knows. `DetailsPanel.Toggle` takes the pane control with it: four ledgers had written that out identically, copied comment included.

The shell keeps two deliberate seams rather than pretending they do not exist. `Fact` takes a snippet where a value is a mark rather than a figure, because the fee panel's standing badge is neither tabular nor right-aligned; and it takes a class where one figure has to carry a warning the column does not, because a bill past its due date is that case.

A refused control was explained in two competing sentences: seventeen call sites naming the act and the permission, and seven more naming only the permission. `permissionRefusal(act, permission)` is the one home. The seven that said only "This account does not hold the billing:credit capability" now also name the act, which is the half a reader can take to whoever administers their account — so those seven tooltips read differently than they did. One more said "capability" where the other twenty-four said "permission", and now says "permission" too.
