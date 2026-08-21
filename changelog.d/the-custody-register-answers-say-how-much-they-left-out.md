---
category: Fixed
audience: internal
---

**The custody register's nine list endpoints each carried a different defect, and one fix would have
been wrong for most of them.** Traced individually rather than paged for symmetry.

The overdue check-out sweep and the holds report now page over the platform's keyset cursor. Both are
ascending, and the direction is the point: a page of the most overdue check-outs, or the oldest holds
still in force, is the answer a firm wants, and paging forward walks toward the merely late.

The holdings-per-owner report and the stocktake list are **capped with a signal** instead. Their
answers now carry a `capped` flag, true when the firm holds or has counted more than the response
names. Neither can take a cursor honestly: holdings-per-owner is ordered by `packets_held DESC`, a
count the query computes rather than a column any row carries, and a keyset over it would page by a
value that does not exist in the table. The stocktake list answers which count is running now and what
the last one found — a short answer was the right shape all along, and only the silence about it was
the defect.

The item-type vocabulary, the location tree, and the per-location occupancy report are recorded as
bounded by construction with what bounds each. The location tree is left whole for the same reason a
matter's folder tree is: its callers resolve a packet's shelf to a path through its ancestors, and
half a tree resolves to a wrong path rather than a short one.

Two are left as they were, with the reason written down: the sighting list orders on three columns and
the reminder collector merges two streams, and each needs a design decision rather than a fix applied
for consistency.
