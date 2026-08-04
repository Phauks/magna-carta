---
category: Fixed
---

**Searchable-PDF writer: the invisible text layer is placed at its recognized box, not an order of
magnitude larger.** The writer applied the recognized font size twice — once through the text-font
operator and again on the text-matrix diagonal — so a run recognized at a 160×20 pt box was written
about ten times that size. Selection highlights and any position-based redaction landed far from the
visible glyphs. The text matrix is now a pure translation to the box's bottom-left; size comes from the
font operator and the width fit from the horizontal-scale operator alone. A geometry regression test
writes a run and asserts the extracted bounds sit around the recognized box.
