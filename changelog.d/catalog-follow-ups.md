---
category: Fixed
---

**A staffing assignment's validity window is now recorded in whole days, and the last day counts.**
The dates a staffing assignment starts and ends are civil dates (YYYY-MM-DD) — anything else is
refused at the door rather than silently accepted, and a window that ends before it starts is
refused too. The merge engine now reads the window the way a person means it: an assignment
"through August 7" still staffs the matter for the whole of August 7, where before a document
assembled that day would already have dropped the member. Ending an assignment is unchanged — that
still takes effect at the exact moment it happens.

**When one member is staffed twice in the same role, the document result now says so.** An
assembled document that could not name "the supervising attorney" used to report "2 members" even
when both assignments were the same person; it now says the member is assigned twice and points at
ending the duplicate, and only counts members — never assignment rows — when the people genuinely
differ.
