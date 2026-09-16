---
category: Fixed
audience: internal
---

**Dragging a sidebar row to reorder it stuttered, and it was three faults stacked.**

The slot size came from the pressed element's own height, but rows are separated by a gap, so every
slot was measured short and travel of two rows read as travel of two-and-a-bit. `Math.round` flipped
the landing index at exactly half a row, which is precisely where a hand rests while it is deciding,
so the whole list reflowed on every tremor. And each `pointermove` wrote state — several times per
frame on a high-rate mouse — reflowing the list between two paintings of it.

`DragReorderController` measures the real PITCH from two rows marked `data-reorder-row`, moves the
landing index only once the pointer is six tenths of a row past the boundary (and four tenths back,
so a boundary is crossed once), and coalesces the offset into one write per animation frame. The rows
also carry a grip now: the grab cursor only answers once the pointer is already on the row, which is
an answer to a question nobody asked.
