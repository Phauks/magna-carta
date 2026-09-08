---
worktree: /home/user/magna-carta
area: Discovery's three screens take the product's shared search and create controls
status: building
touches: apps/web/src/lib/discovery, apps/web/src/routes/(app)/discovery, packages/design-system/src/lib/components/data-table, packages/design-system/test, apps/web/test, docs/user/features, changelog.d
---

Brings the discovery surface onto the two controls every other list screen already uses:
`ScreenSearch` in the action row of the register, the document list and the loads screen, and one
`CreateControl` menu on the loads screen in place of the two labelled buttons it shipped with.

The only shared-package edit is additive: `grid-search.ts` beside the data table's other pure
modules (`grid-columns`, `grid-filters`, `grid-rows`), holding the match rules for a query over a
grid's rows — the catalogue's grammar, matched against the text the column model renders. It is
exported from `@magna-carta/design-system/data-table` and nothing existing changed, so a stream
touching the data table collides only on `index.ts`'s export list.

Nothing on the server moves: no discovery listing takes a `search` parameter, so every one of these
narrows the rows already read, which is the scope the grid's own column filters run at. The document
screen says so on the control, because keyword search of a document's text is a different thing and
is still `soon` in `criteria.ts`.
