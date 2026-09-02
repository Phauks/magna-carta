---
category: Changed
audience: public
---

**Dropdown menus open on hover.** `DropdownMenu.Root` now owns a hover controller (`packages/design-system/src/lib/components/dropdown-menu/hover-open.ts`), shared with Trigger, Content, and SubContent through context: a mouse pointer resting on the Trigger for 120 ms opens the menu, the menu follows the pointer between the three, and it closes 250 ms after the pointer has left them all. A press, a key, or a tap opens the menu exactly as before and a menu opened that way is not hover's to close; a press on a hover-opened trigger keeps the menu rather than toggling it shut; a hover-opened menu leaves focus where it was unless focus has entered the panel; and hover-opening one menu closes another hover had opened, so Money and Record on the matter strip never overlap. On for every menu, `openOnHover={false}` keeps one click-only. Select and Combobox are unchanged: a form control that opened as the pointer crossed a form would fight the reader.

## Public

**Menus open as you point at them.** Resting the pointer on a menu control — Money or Record on a matter, a New or Actions button, the account menu — opens it without a click, and it closes once you move away. Clicking, tapping, and the keyboard still open a menu exactly as they did.
