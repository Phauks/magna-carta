---
category: Fixed
audience: internal
---

**Two Storybook stories that were red on `main` are green again, one of them by teaching the header menu something it had lost.** When the column controls moved into each header's right-click menu, the trailing-pinned column's held pin did not come with them: the grid model already refused to toggle a `pinnedEnd` column, but the menu offered "Pin Status" as if it could, and the Time Sheet story still clicked a Columns button that no longer existed. The menu now shows a trailing-pinned column as pinned and disabled, with the title "always keeps its place at the trailing edge", and the story asserts that through the header menu. The masthead's "Compact density" story rendered two page banners for comparison, which axe rejects; the comparison masthead now sits inside a labelled section, where a header is that section's header rather than a second banner. Both failures had passed through the gate unseen because the gate ran nothing on `main` for a month.
