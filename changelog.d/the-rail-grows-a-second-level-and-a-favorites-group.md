---
category: Added
audience: internal
---

**`Sidebar.MenuTrigger` + `Sidebar.MenuSub` — the rail's second level**, and a general cluster
mechanism over them (`navigation/clusters.ts`). A destination names a `cluster`, the render tree
folds it there, and a cluster holding a single row is seated as a plain row instead. A cluster is a
fold and never a screen: it has no address, and pressing it opens the rows. The collapsed icon rail
draws every row flat, folds and all, because a rail with no labels has nothing to fold by.

**`navigation/favorites.svelte.ts` — the member's own shortcuts**, as the rail's first group. A
favorite is any pathname plus the title the screen had when it was saved; the glyph is resolved at
render time from the area the address sits under, so nothing has to be kept in step. The gesture
lives in `screen-header.svelte`, which is the one component every screen builds its title from, so it
reaches every page in the product without a screen opting in (`favoritable={false}` opts out).

**`Destination.permission`** — the gate a few destinations carry now that Firm Usage is one of them,
applied in the rail and in the palette alike. **`Sidebar.MenuButton`'s `trailing` snippet** — a grid
column sized to its contents that never shrinks, which is what stopped a long label clipping its own
maturity badge.
