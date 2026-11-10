---
category: Fixed
audience: internal
---

**A filled form field shows all of its text.** `fill_form` (`crates/pdf-core/src/forms.rs`) drew every text field as one centred line, so a field declared to hold several lines (an address, a notes box) showed its whole value on a single line running out of the box. Such a field is now wrapped to the box's width and set from the top down, breaking at the value's own line breaks and between words, and a word wider than the box is broken between characters instead of lost off the side (`multiline_text_appearance`, `wrap_lines`). A field that sizes its own text shrinks it until the value fits, down to 4 points: across the width for a single line, down the height for several. A field with a fixed size keeps it and is clipped by its box, as a viewer clips it. The stored value of a field is now written as a PDF text string, UTF-16 when it is not ASCII; it was written as UTF-8 bytes, which a viewer and this engine's own `read_form` both read back as "JosÃ©" for "José". Alignment set on a parent field is inherited by the fields under it.
