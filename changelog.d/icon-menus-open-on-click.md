---
category: Changed
audience: public
---

**A DropdownMenu behind an icon-only trigger no longer opens on hover.** `DropdownMenu.Trigger` checks its own text when the pointer arrives: a trigger with no words (every "..." menu, a cog, any button named only by its `aria-label`) skips the hover controller and opens by press, key or tap. Menus behind a word keep hover opening. Pinned by the DropdownMenu story "An icon-only trigger opens only when pressed".

## Public

**The "..." menus open only when you click them.** Moving the pointer over a "..." button no longer drops its menu over the page; click it, or press Enter on it, to open it. Menus with a name, such as Money on a matter, still open when you point at them.
