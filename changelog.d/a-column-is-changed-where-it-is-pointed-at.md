---
category: Changed
audience: public
---

**Every column control moves into the column header's own right-click menu.** Two controls are deleted, not moved: the surface's `Columns` button and the in-header filter funnel. `DataTable.GridColumnsMenu` is gone; `DataTable.Grid` renders `GridHeadMenu` per header cell instead, so there is nothing for a surface to place and no way for two surfaces to place it differently. The menu holds everything a column can be ASKED — `Filter {column}` (the same one mechanism parameterized by column type), `Hide {column}`, `Pin/Unpin {column}`, and a `Columns` submenu with the roster, the zebra setting, and any display settings the surface adds. What the header still does by direct gesture it keeps and the menu does not repeat: the label sorts, the grip resizes and double-click fits. A hidden column has no header to right-click, which is what the roster is for.

The header cell keeps the filter's MARK where the funnel used to sit — the same reserved slot and accent-subtle treatment, drawn only while a filter is in play, carrying nothing to press — so removing the control does not remove the answer to "is this column narrowed".

The header cell is the menu's trigger region, so it is rendered through Bits' `child` delegation (nothing may wrap a `<th>`); `ContextMenu.Trigger` stops stripping that prop for exactly this case. The cell also stops the contextmenu event, so a surface listening for a row's right-click over the same region — the file manager — never re-targets its selection off a header. Fields inside the filter submenu stop their own keydowns short of the menu: Bits runs typeahead and roving focus off any character or arrow reaching the menu content, which would otherwise pull focus out of a field mid-word. The resize grip now ignores anything but the primary button, so a right-click on it opens the menu instead of starting a drag.

Twelve surfaces lost the button: the matters docket, contacts, the time ledger and Time Sheet, the fee and cost ledgers, the bill register, the custody packet register, the conflicts hit list, the file workbench, the file manager, and the developer console's table states. The file manager's icon view has no table at all, so its two display settings keep a toolbar control there and only there.

## Public

**Columns are now changed from the column itself.** Right-click any column heading for everything it can be asked: **Filter** narrows by that column, or hide it, pin it so it holds its place when the table scrolls sideways, or open **Columns** for the full list — every column the table can show, row striping, and any settings that screen adds. The separate **Columns** button and the small funnel in each heading are both gone; a column that is being filtered is marked in its heading, and hovering the mark says what it is narrowed to.
