---
category: Added
audience: public
---

**`files.list` had one order, written as a literal in the SQL, so a sortable file table could only
honestly sort the page it already held.** It now takes `sort=created|name|updated` and
`direction=asc|desc`.

Both optional, and both default to what the listing has always served — `created`, descending — so an
existing caller's request is byte-for-byte the request it made before and gets the same page.
`direction` defaults to each order's natural sense (newest-first for `created` and `updated`, A-Z for
`name`) rather than to one global value.

**`size` and `version` are refused, and the refusal is the answer rather than a deferral.** Both live
on the joined display version. No index on `file` can order by a column of a row it has to join to
find, so every page would materialise the whole matter into a temporary B-tree — and the display
version can change under a caller mid-scroll when a commit advances `current_version_id`, which moves
a row's sort value while the cursor is walking past it. That is precisely the defect a keyset cursor
exists to prevent. The refusal is a 422 from the request schema, which names the three orders a caller
may ask for instead. A content-modified sort has the same problem and the same way out: a
denormalised column maintained in the version-commit batch.

`updated` sorts on `file.updated_at`, which every metadata write bumps — including both co-editing
state transitions, so opening a document and closing it each move a file to the top without its
content changing. Honest as "last activity", dishonest as "Modified", and the route description says
so.

**The cursor now records the order it was issued under**, as a third key in the same opaque
`btoa(JSON)` token. A cursor with no tag decodes as `created:desc` — the only order there ever was —
so tokens in flight keep working, and a tagged cursor read by an older deploy decodes to the same
pair with the extra key ignored. A cursor presented against a **different** order is a
`422 cursor-sort-mismatch`, never a silent restart: the token is well-formed and this system minted
it, so the caller is mid-scroll, and handing them page one while their interface believes it is on
page four is the failure worth naming. A malformed cursor is still treated as the first page.

Four indexes on `file`, the first `COLLATE NOCASE` indexes in the per-firm lineage. The collation has
to be pinned in three places or the index is dead weight, and the spelling matters more than expected.
Putting the collation on the bound side of the row-value comparison plans as an index seek; putting it
on the column, and the equivalent OR form, are both correct and both plan as a scan of the whole matter
on every page. A test asserts the query plan for all six order-and-direction combinations, in both
matter and folder scope, and fails on a temporary B-tree.

Folders-first grouping is deliberately not here. `folders.list` already returns a matter's whole tree
unpaged, so it is a render decision over two lists the client holds — and a folder's children and its
files page independently, so the server could not promise the grouping across a cursor boundary anyway.

## Public

**File lists can now be sorted by name, by date added, or by last activity.** Pick a column and the
whole matter re-sorts, not just the rows already on screen, and paging through the results keeps that
order. Sorting by name ignores capitalisation, so `Contract.pdf` and `contract.pdf` sit together
rather than in separate blocks.

Sorting by file size or version number is not offered. Those belong to whichever version of a document
is currently on top, which can change while you are scrolling — a list ordered by them would quietly
skip or repeat files, so the sort is refused rather than shown as unreliable.
