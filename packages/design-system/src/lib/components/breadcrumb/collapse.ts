/**
 * The collapse rule for a path: which segments stay visible when the path is deeper than the room
 * it has, and which fold behind the ellipsis. A pure function over the path, in a plain module, so
 * the surfaces that draw a path collapse IDENTICALLY without either of them owning the rule — the
 * Breadcrumb component draws links and reveals the folded segments in place; the matter file
 * manager draws buttons on its folder tree and reveals them in a menu. Same fold, two presentations.
 *
 * The root and the current segment are the two a reader needs — where the path starts and where
 * they are standing — so the fold always takes from the middle outwards and never from either end.
 */

/** One segment of a collapsed path: a visible entry, or the fold standing for the hidden ones. */
export type BreadcrumbSegment<Entry> =
  | { kind: "item"; entry: Entry; index: number }
  | { kind: "ellipsis"; hidden: { entry: Entry; index: number }[] };

export type BreadcrumbCollapseOptions = {
  /** Collapse the middle once the path has more than this many segments. `0` never collapses. */
  maxItems?: number;
  /** How many leading segments stay visible when collapsed (the root and beyond). */
  itemsBeforeCollapse?: number;
  /** How many trailing segments stay visible when collapsed (the current segment and beyond). */
  itemsAfterCollapse?: number;
};

export function collapseBreadcrumb<Entry>(
  items: readonly Entry[],
  { maxItems = 4, itemsBeforeCollapse = 1, itemsAfterCollapse = 1 }: BreadcrumbCollapseOptions = {},
): BreadcrumbSegment<Entry>[] {
  const numbered = items.map((entry, index) => ({ entry, index }));
  const before = Math.max(0, itemsBeforeCollapse);
  const after = Math.max(0, itemsAfterCollapse);
  const collapses = maxItems > 0 && items.length > maxItems && before + after < items.length;
  if (!collapses) {
    return numbered.map(({ entry, index }) => ({ kind: "item", entry, index }));
  }
  return [
    ...numbered.slice(0, before).map(({ entry, index }): BreadcrumbSegment<Entry> => {
      return { kind: "item", entry, index };
    }),
    { kind: "ellipsis", hidden: numbered.slice(before, items.length - after) },
    ...numbered.slice(items.length - after).map(({ entry, index }): BreadcrumbSegment<Entry> => {
      return { kind: "item", entry, index };
    }),
  ];
}
