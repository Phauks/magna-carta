---
category: Fixed
audience: internal
---

**A matter's costs and a matter's time were read with no bound of any kind.** Both listings built a
bare `SELECT ... WHERE matter_id = ?1 ORDER BY ...` with no `LIMIT` at any layer, so a matter that had
been running for years answered with its entire record in one response and the size of that response
was governed by nothing but the firm's own history.

Both now page over the platform's existing keyset cursor, newest first, fifty to a page. The screens
gained a control that fetches the next page and states that a total covers only what is on screen —
so a partial view is visibly partial rather than quietly wrong.

The cost listing's sort tiebreak moved from `created_at` to the identifier. A keyset cursor needs a
TOTAL order and `created_at` is not one: two costs entered in the same batch share it, and paging over
it would skip or repeat rows at a page boundary. Costs sharing an incurred date now appear in a stable
arbitrary order rather than an unstable one — there was no order among them before, only the
appearance of one.

**The three matter sections that read a paged listing now share one piece of state.** The same effect
had been written three times, and the copies had already drifted once. `PagedList` owns the rows, the
cursor, the failure and the in-flight page in one tested place, and discards a page that resolves
after the reader moved to a different matter.

**A new fitness function refuses the next unpaged list endpoint.** The pagination contract states the
rule outright — every list endpoint returns the uniform `{ data, nextCursor }` envelope — and
forty-seven endpoints did not follow it, because nothing was checking. `pnpm run lint:list-pagination`
reads the emitted contract and compares it against a shrink-only baseline of the forty-five that
remain: a new one is refused, and an entry that has been fixed must be deleted, so the list cannot rot
into names nobody has re-read. Nothing in that baseline is asserted to be safe; telling a bounded
vocabulary from the same defect means tracing each route to its statement, and the baseline is what
makes that campaign finite and visible.
