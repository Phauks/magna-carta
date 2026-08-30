/*
 * Which tab a window opens on.
 *
 * Pure, and its own module, because it is the one decision in the window with more than one right
 * answer: a caller that wants a particular tab in front of the reader (a record that arrives with
 * something waiting in one) names it, and everything else falls back to the first tab. A named tab
 * that is not in the set is treated as absent rather than as an error — the tab set is data, it
 * changes with the record, and a window that refuses to open because a stale key was passed would
 * be a worse failure than opening on the first tab.
 */
import type { RecordWindowTab } from "./types.ts";

/** The key of the tab a window should open on, or an empty string when there are no tabs. */
export function openingTabKey(
  tabs: readonly RecordWindowTab[],
  defaultTab: string | undefined,
): string {
  if (defaultTab !== undefined && tabs.some((tab) => tab.key === defaultTab)) return defaultTab;
  return tabs[0]?.key ?? "";
}
