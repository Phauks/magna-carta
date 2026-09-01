---
category: Changed
audience: internal
---

The matter's section tabs move into the empty half of its header, and the Alpha pillboxes come off the product.

A matter spent two rows before any content: the masthead, whose inline-end half carried one overflow control and otherwise nothing, and then the section strip on a row of its own. Those are now one band. The actions sit on the title's row, the strip sits beneath them packed to the same end, and both share the band's bottom rule — so the gold active bar still lands on a rule rather than floating. The masthead keeps everything it had: the serif title at masthead scale, the ledger line, the citation. 152px of chrome becomes 111px.

Four arrangements were built and measured before this one was chosen, which is the only reason it holds up. An even split of the band was measured against a capped identity block and both against a wrapping one: wrapping the title at a 1024 canvas costs 27px, turning a 42px saving into a net loss, and capping the identity block starved the strip to a single tab. The shipped split truncates the title and the citation instead, so the band is 111px at 1600 and 111px at 1024 rather than growing as the window narrows. The citation became one joined string in the same change, because a flex row of separate entries cannot ellipsis and truncating each entry to its share gives four stubs and no citation.

Separately, `alpha` and `beta` stopped rendering a maturity mark anywhere — the matter tabs, the sidebar destinations, the tools listing, the contacts sections. A surface a member can open does not announce how finished it is, and the pill cost each tab about as much width as its own label. `soon` still marks, because it says there is nothing behind this yet. The stages are unchanged and still decide whether a destination is a live link or a stub.
