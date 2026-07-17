---
category: Fixed
---

**Text on rotated pages lands on the visible content, on both the searchable-PDF layer and Bates
stamps.** The OCR engine reads the displayed (rotation-applied) page, so a recognized run's box is in
the displayed frame; the searchable-PDF writer now counter-rotates each run into unrotated user space
so that, once a viewer re-applies `/Rotate`, the invisible layer sits under the visible glyphs —
previously it was placed as if the page were unrotated, drifting the layer (and any selection or
position-based redaction) off the content on any rotated page.

This also fixes a latent error in the shared display-to-user coordinate matrix that both this writer and
Bates stamping use: for quarter-turn rotations (`/Rotate 90` and `270`) it swapped the page width and
height in the translation, so on a non-square page a stamp or layer was displaced by the
width–height difference — enough to push it off a portrait page entirely. The matrix now lives in one
place with the axes correct, guarded by two regression tests: a searchable-layer test and a Bates test
that each assert their text renders at the same displayed position whether the page is unrotated or
turned a quarter-turn either way.
