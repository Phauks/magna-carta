---
category: Fixed
audience: internal
---

**Four reads answered without any bound at all, and a fifth was red on `main`.** The shrink-only
baseline of unpaged list endpoints was traced through to the statement behind each one. Twenty-two
already carry a limit and want only a cursor; four carried nothing, and each got the answer its own
shape calls for rather than one applied uniformly.

**Directory search was the worst of them,** because the size of its answer is chosen by the caller
rather than by the firm's history: a trigram FTS match over every non-deleted name, ordered by
relevance, `LIMIT` nowhere. It is now capped, and the cap reports itself — the response carries
`capped`, so a short answer and a complete one cannot be confused. Deliberately not cursor-paged: the
ordering key is bm25, a score recomputed per query rather than a column the row carries, so a keyset
over it would page by a value that does not exist in the table.

**A file's version history and a custom field's value history** are both append-only and both now
page over the platform's cursor. A document under daily revision for five years is close to two
thousand versions in one response.

**The folder tree was measured and deliberately left whole.** The load profile models 2 to 6 folders
per matter, and one of the three callers is the ZIP builder, which needs the complete tree to resolve
paths. Half a tree is not a tree. It moves to the recorded-bound list with that reasoning rather than
being paged for symmetry.

One trap worth naming: `version_number` is an INTEGER, and the shared keyset helper binds the cursor
value as the TEXT the cursor carries. SQLite orders across storage classes before comparing within
one, so every integer is less than every string — `version_number < '9'` would be true for every row
and the page would never advance. That predicate is written out with a numeric binding, and says why.

**Also fixed: a red test on `main`.** `packages/directory/test/schema-name-sync.test.ts` had been
failing since the matter Parties section landed — that slice added two projection aliases and never
widened the package's sanctioned-token list. The aliases are now listed individually rather than
matched by a pattern, because a rule like "anything ending `_display_name`" would wave through a
genuine typo in a real column.
