---
category: Fixed
audience: public
---

**`Sidebar.MenuTrigger` folds in the icon rail again.** In the collapsed rail it renders inside a tooltip trigger, and the tooltip's props were spread after the caller's `onclick`, replacing it; the fold's handler now runs last, after the tooltip's. The sidebar story's truncation step moved to the labelled rail, where marks show.

## Public

**A group in the sidebar, such as Internet, opens and closes again while the sidebar is collapsed to icons.**
