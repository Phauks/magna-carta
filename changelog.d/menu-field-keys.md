---
category: Fixed
audience: public
---

**A field inside a menu keeps its own keys (`cd9d082ef`).** Bits menu typeahead and roving focus no longer steal characters and arrow keys from a form control hosted in a menu: `keepMenuFieldKeys` (`packages/design-system/src/lib/components/context-menu/menu-field-keys.ts`) guards the data grid's per-column filter submenu and the file manager's document-type flyout. Escape and Tab still reach the menu. Drafted by the docs-sync routine from the merge.

## Public

- Typing in a field inside a menu, such as a column filter or the document-type picker, no longer jumps to a menu item.
