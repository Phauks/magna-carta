---
category: Fixed
audience: internal
---

**The read a firm uses to decide whether to trust a rule was counting from a sample.** The auto-file
review reports, per rule, how many messages it filed, how many it staged, and how many somebody has
since removed. It computed those by walking at most five hundred automatic links in the window and
tallying them in application code, which broke in two ways past that cap — and broke in the direction
that makes a rule look _less_ consequential than it is, on precisely the screen where a firm decides
to let rules file without confirmation.

Every count understated. And a matter whose links all fell past the cut was **absent from the answer
entirely**, not undercounted: the matter set handed to the access filter came from that same truncated
page, so a rule on such a matter contributed no entry at all.

The matter set now comes from the **rules**, not from the links. A rule is bound to one matter, so the
rule catalog names every matter a rule could have filed to — and it puts the ceiling on a quantity a
person controls (how many matters the firm has set rules on) rather than one that activity drives.
Revoked rules are included, because a rule that filed for three weeks and was then stopped is exactly
what a reviewer is looking for. The counting then happens in the database, grouped per rule over the
matters that survived the wall, so there is no ceiling on links at all and the numbers are exact.

`matterScopeCapped` on the response says when the firm holds rules on more matters than one answer
carries — a rule may then be missing from the list, which is a different and far rarer failure than a
count being wrong.

**Neither read is paged, and that is unchanged.** The existing argument stands: a cursor over a set the
access filter can shrink hands out short pages and calls it the end of the list. What was wrong was
never the absence of a cursor — it was the silence about the cut.
