---
category: Fixed
audience: internal
---

**Five corrections against the deployed file manager, one of which was never the file manager's.**

The toolbar's own search field is gone. The matter is searched from the matter header and nowhere else; this surface had a second field, and the ruling that put the search in the header predates the header having one. What reaches the file manager's Search Results view now is the query in the address (`?q=`), read the same way `?entry=` already hands a section a record, so a search still opens the view, losing it still leaves, and a search survives a reload.

The rail's "No folders yet" sentence is gone — the root row and the control that makes a folder had already said it. The table header menu's display settings moved out of the Columns submenu into the menu's own root: Columns holds columns, and a setting filed under a noun that does not name it is a setting nobody finds. The icon view's settings control moved to the LEFT of the list-or-icons swapper, so the swapper stops sliding sideways every time a reader changes view.

**The breadcrumb reading black in dark mode was a document-wide defect wearing a file manager costume.** The app declared no `color-scheme` and gave the root no text colour, so the browser painted its own light-mode system colours underneath every dark theme, and any element written without a colour took `canvastext` — black — however dark the band behind it was. The tokens were correct the whole time, which is why it looked like one screen's bug. `packages/design-system/src/lib/styles/base.css` declares both, in the `base` layer, imported by the app entry and the catalog preview alike; it also hands the browser the dark canvas behind an overscroll, dark scrollbars and dark form controls, none of which a token reaches. Measured before and after on the running app: an uncoloured element computed `rgb(0, 0, 0)` without it and the theme's ink with it.
