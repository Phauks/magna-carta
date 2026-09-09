---
category: Added
audience: public
---

**The gilt scroll-edge rule is now the member's own choice.** `Settings · Accessibility` carries a Scroll Edge Markers switch, on the theme-preference seam beside contrast, motion and density: `magna-carta.scrollEdgeHints`, stamped on the document as `data-scroll-edge-hints="hidden"`, with "shown" removing the attribute exactly as a resolved "full" motion and a "comfortable" density do.

**Suppressed in the recipe, not threaded as a prop.** `ScrollEdgeHint` is drawn by the sidebar's nav list and by every register's grid, so a preference carried as a prop would have to be threaded through both and through everything after them. One rule in `scroll-edge-hint.css` keyed on the root attribute reaches all of it, and the component stays a component that knows about scrollports and nothing about members.

**Reduced motion is a different answer to a different question.** The recipe already shortens the rule's draw to instant under `prefers-reduced-motion`, and that stays: wanting less movement is not the same as wanting less information about where a list ends. So this axis has no OS signal to seed from and no "system" encoding — shown or hidden, and the seed-then-own contract contrast uses does not apply.

**It is the one appearance axis the no-FOUC boot script does not mirror**, and the mirror test now asserts that rather than leaving its absence to read as an oversight. The boot script exists to dress the first paint; nothing paints a scroll-edge rule before the application mounts, because the hint renders only once its scrollport reports there is more content that way.

## Public

**You can turn off the gold marks at the edges of lists and tables.** Settings · Accessibility · Scroll Edge Markers.

They are the thin gold lines that appear above and below the sidebar, and to the left and right of a table, while there is more to see that way — useful when a list hides its scrollbar, and one more thing moving at the corner of your eye when you would rather it did not. Turning them off changes nothing else; scrolling works exactly as before.
