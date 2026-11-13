---
category: Added
audience: public
---

**Text Size works, and the Font Family list shows each face in itself.** Settings, then Text, now offers a live Text Size, a percentage from 50% to 200% (offered in steps of ten), that applies at once, across every open tab, and from the first paint of the next visit. It is written as the root font size on `<html>` (`magna-carta.textSize` in storage, mirrored by the boot script), so every interface type size follows while spacing and control heights stay where they are, and it stacks with the browser's own text-size setting. The Font Family list drops the describing line after each name and instead sets every option in its own face, through new element-scoped `[data-typeface-sample]` blocks in the design tokens.

## Public

**Text Size now works, and Font Family shows each typeface in itself.** In Settings, then Text, you can set interface text anywhere from 50% to 200% of its normal size; it changes at once and stays your choice on this browser. The Font Family list now shows each typeface in that typeface, so you can see it before you pick it.
