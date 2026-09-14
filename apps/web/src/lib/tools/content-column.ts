/*
 * How a tool's route tells the Tools layout who owns the content column's scrolling.
 *
 * The layout draws every tool inside the design system's NavigationLayout, whose content column
 * is the page's scroll region by default. A tool that stages its own full-height frame — the
 * File Workbench with its rail and panes, the Safe Website Viewer with its framed browser — owns
 * its scroller instead, and the column must be a bare full-height stack for it, or the page's
 * middle draws a second scrollbar inside a column that already reserved a gutter for one.
 *
 * The route says so through its page data, which is the one channel a page has to the layout
 * above it: the route's `+page.ts` returns `PAGE_OWNS_SCROLLER`, and the layout reads the merged
 * page data through `contentColumnScrolls`. A route that returns nothing scrolls in the column.
 */

/** What a route's load returns when the page stages its own header, scrolling middle and footer. */
export const PAGE_OWNS_SCROLLER = { contentScrolls: false } as const;

/** Whether the content column scrolls for the current page, read off the merged page data. */
export function contentColumnScrolls(data: Record<string, unknown>): boolean {
  return data["contentScrolls"] !== false;
}
