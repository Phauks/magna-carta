/*
 * The collapse rule two surfaces share. It is a pure function precisely so that the Breadcrumb
 * component and the file manager's folder path — which draw the same fold as links and as buttons —
 * cannot disagree about which segments a reader keeps when a path outruns its room, and these are
 * the properties either presentation would be wrong without: the ends survive, the middle folds,
 * every segment is accounted for exactly once, and each one still knows its own place in the path.
 */
import { describe, expect, it } from "vitest";
import { collapseBreadcrumb } from "../src/lib/components/breadcrumb/collapse.ts";

const path = (depth: number) => Array.from({ length: depth }, (_, step) => `folder-${step}`);

describe("the breadcrumb collapse rule", () => {
  it("leaves a path that fits alone, every segment carrying its own index", () => {
    expect(collapseBreadcrumb(path(4), { maxItems: 4 })).toEqual([
      { kind: "item", entry: "folder-0", index: 0 },
      { kind: "item", entry: "folder-1", index: 1 },
      { kind: "item", entry: "folder-2", index: 2 },
      { kind: "item", entry: "folder-3", index: 3 },
    ]);
  });

  it("folds the middle of a deeper path, keeping the root and the current segment", () => {
    const parts = collapseBreadcrumb(path(6), { maxItems: 4 });

    expect(parts).toEqual([
      { kind: "item", entry: "folder-0", index: 0 },
      {
        kind: "ellipsis",
        hidden: [
          { entry: "folder-1", index: 1 },
          { entry: "folder-2", index: 2 },
          { entry: "folder-3", index: 3 },
          { entry: "folder-4", index: 4 },
        ],
      },
      { kind: "item", entry: "folder-5", index: 5 },
    ]);
  });

  it("keeps as many segments at each end as it is asked for", () => {
    const parts = collapseBreadcrumb(path(6), {
      maxItems: 4,
      itemsBeforeCollapse: 1,
      itemsAfterCollapse: 2,
    });

    expect(parts.map((part) => (part.kind === "ellipsis" ? "…" : part.entry))).toEqual([
      "folder-0",
      "…",
      "folder-4",
      "folder-5",
    ]);
  });

  // What the fold hides plus what it shows is the whole path, in order and once each — the property
  // that keeps an off-by-one from quietly dropping a folder out of a path a reader is navigating by.
  it("accounts for every segment exactly once, in the path's own order", () => {
    for (const depth of [1, 2, 5, 9, 40]) {
      const parts = collapseBreadcrumb(path(depth), { maxItems: 4, itemsAfterCollapse: 2 });
      const indexes = parts.flatMap((part) =>
        part.kind === "ellipsis" ? part.hidden.map(({ index }) => index) : [part.index],
      );
      expect(indexes).toEqual(path(depth).map((_, index) => index));
    }
  });

  it("never collapses when told not to, however deep the path runs", () => {
    expect(
      collapseBreadcrumb(path(40), { maxItems: 0 }).every((part) => part.kind === "item"),
    ).toBe(true);
  });

  it("has nothing to fold in an empty path", () => {
    expect(collapseBreadcrumb([], { maxItems: 4 })).toEqual([]);
  });
});
