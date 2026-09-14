---
category: Changed
audience: public
---

**Tools and Reports are two-sided screens on the design system's `NavigationLayout`.** Each area's routes now render inside a layout (`apps/web/src/routes/(app)/tools/+layout.svelte`, `apps/web/src/routes/(app)/reports/+layout.svelte`) that draws the catalogue as a navigation column on the left and the chosen tool or report on the right, on the same component Settings adopted first — the owner's 2026-09-11 ruling that a screen with a navigational menu and a content area is one component, and that it reaches Tools and Reports.

The column is `$lib/tools/catalogue-navigation.svelte`, one component for both areas, and it reads the same projection each landing index renders (`tool-catalogue.ts`, `report-catalogue.ts`), so a registry entry reaches the column, the index and the command palette with no edit. The current entry is decided by `catalogue-navigation.ts` on the path boundary, so the workbench's password-recovery screen still lights the File Workbench. A soon entry stands in its group unlinked with its mark and its dependency on the hover title, never omitted. The landing route keeps its catalogue index in the content column, so the column is never beside nothing.

The content column is the page's scroll region unless the page claims it: the File Workbench and the Safe Website Viewer stage their own full-height frames and say so through their route data (`content-column.ts`), and the Tools layout hands them a bare column. Every tool and report keeps `back` on its own header; the column is a finding aid beside it, not a replacement for it.

## Public

**Tools and Reports now show the whole list beside whatever you have open.** Every tool, grouped by subject, stands in a column on the left of the Tools area, and every report, grouped by family, on the left of Reports; the one you are on is marked, and one click moves to another without going back to the index first. The index itself, with its search and its two views, is what you see on arriving. A tool or report marked Soon is listed in the column, greyed, so you can see what is coming.
