---
category: Fixed
---

**Searchable-PDF writer: correctness hardening from an adversarial review.** Three defects in the
invisible-text-layer writer, found before it ships:

- A non-BMP character (an emoji, or a CJK Extension-B ideograph — the kind that appears in Chinese and
  Japanese proper names) was silently dropped from the searchable layer: its `ToUnicode` mapping was
  built per UTF-16 code unit, so a surrogate pair became two undecodable halves and the character
  vanished from extracted text — which redaction reads, so a name the writer could not represent could
  not be redacted. Each character now maps to one code with a correct multi-unit `ToUnicode` destination.
- The layer's font could overwrite a page's own font if that page happened to carry a resource under the
  same name; the writer now picks a name proven free on every target page.
- A single degenerate (zero-area) word box no longer drops that one word — the line falls back to
  whole-line placement so every recognized word survives.

Known remaining gap: on a page with a non-zero `/Rotate`, the invisible layer is placed in the
unrotated frame, so selection geometry is off (the text is still searchable). A rotation-aware placement
is a tracked follow-up.
