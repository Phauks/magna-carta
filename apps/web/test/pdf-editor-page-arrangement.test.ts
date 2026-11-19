import { describe, expect, it } from "vitest";
import {
  buildPlan,
  extractedCopyName,
  initialArrangement,
  insertPages,
  insertionIndex,
  isUnchanged,
  movePages,
  nudgePages,
  pageListLabel,
  partName,
  removePages,
  splitAt,
  turnPages,
  wasInserted,
} from "../src/lib/pdf-editor/page-arrangement.ts";

const order = (pages: readonly { source: number }[]): number[] => pages.map((page) => page.source);

describe("arranging pages", () => {
  it("starts as the document stands, which counts as unchanged", () => {
    const pages = initialArrangement(4);
    expect(order(pages)).toEqual([0, 1, 2, 3]);
    expect(isUnchanged(pages, 4)).toBe(true);
  });

  it("turns only the chosen pages, and four quarter turns come back round", () => {
    let pages = turnPages(initialArrangement(3), new Set([1]), 90);
    expect(pages.map((page) => page.turn)).toEqual([0, 90, 0]);
    pages = turnPages(pages, new Set([1]), -90);
    pages = turnPages(pages, new Set([1]), -90);
    expect(pages[1]?.turn).toBe(270);
    expect(isUnchanged(turnPages(pages, new Set([1]), 90), 3)).toBe(true);
  });

  it("deletes the chosen pages", () => {
    expect(order(removePages(initialArrangement(5), new Set([1, 3])))).toEqual([0, 2, 4]);
  });

  it("drops a chosen block, in its own order, before the page aimed at", () => {
    const pages = initialArrangement(6);
    expect(order(movePages(pages, new Set([4, 1]), 0))).toEqual([1, 4, 0, 2, 3, 5]);
    expect(order(movePages(pages, new Set([0, 1]), 6))).toEqual([2, 3, 4, 5, 0, 1]);
  });

  it("nudges a block one place, and stops at either end", () => {
    const pages = initialArrangement(5);
    expect(order(nudgePages(pages, new Set([2, 3]), -1))).toEqual([0, 2, 3, 1, 4]);
    expect(order(nudgePages(pages, new Set([2, 3]), 1))).toEqual([0, 1, 4, 2, 3]);
    expect(order(nudgePages(pages, new Set([0]), -1))).toEqual([0, 1, 2, 3, 4]);
    expect(order(nudgePages(pages, new Set([4]), 1))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("the plan the engine is handed", () => {
  it("keeps runs of consecutive pages whole and groups turns by angle", () => {
    let pages = movePages(initialArrangement(6), new Set([4, 5]), 0);
    pages = turnPages(pages, new Set([5, 1]), 90);
    pages = turnPages(pages, new Set([2]), 90);
    pages = turnPages(pages, new Set([2]), 90);
    expect(buildPlan(pages)).toEqual({
      turns: [
        { angle: 90, pages: [1, 5] },
        { angle: 180, pages: [2] },
      ],
      runs: [
        { start: 4, end: 5 },
        { start: 0, end: 3 },
      ],
    });
  });

  it("is one run for a document only turned", () => {
    expect(buildPlan(turnPages(initialArrangement(3), new Set([0]), -90)).runs).toEqual([
      { start: 0, end: 2 },
    ]);
  });
});

describe("splitting and naming", () => {
  it("starts a new part at each chosen page, ignoring the first", () => {
    const parts = splitAt(initialArrangement(6), new Set([0, 2, 5]));
    expect(parts.map(order)).toEqual([[0, 1], [2, 3, 4], [5]]);
  });

  it("writes page numbers as a reader would", () => {
    expect(pageListLabel([4, 2, 3, 8])).toBe("3-5, 9");
    expect(pageListLabel([0])).toBe("1");
  });

  it("names extracted and split files after the original", () => {
    expect(extractedCopyName("Exhibits.pdf", [2, 3, 4])).toBe("Exhibits (Pages 3-5).pdf");
    expect(extractedCopyName("Exhibits.pdf", [6])).toBe("Exhibits (Page 7).pdf");
    expect(partName("Exhibits.pdf", 2, 3)).toBe("Exhibits (Part 2 of 3).pdf");
  });
});

describe("inserting pages from another file", () => {
  it("finds where the pages start for each place, holding a stale position to the ends", () => {
    const pages = initialArrangement(4);
    expect(insertionIndex(pages, { kind: "before", position: 1 })).toBe(0);
    expect(insertionIndex(pages, { kind: "after", position: 2 })).toBe(2);
    expect(insertionIndex(pages, { kind: "after", position: 4 })).toBe(4);
    expect(insertionIndex(pages, { kind: "end" })).toBe(4);
    expect(insertionIndex(pages, { kind: "before", position: 0 })).toBe(0);
    expect(insertionIndex(pages, { kind: "after", position: 99 })).toBe(4);
    expect(insertionIndex([], { kind: "before", position: 1 })).toBe(0);
  });

  it("numbers the inserted pages on past the original, in their own order, unturned", () => {
    const pages = insertPages(initialArrangement(3), 3, 2, { kind: "after", position: 1 });
    expect(order(pages)).toEqual([0, 3, 4, 1, 2]);
    expect(pages.every((page) => page.turn === 0)).toBe(true);
    expect(pages.map((page) => wasInserted(page, 3))).toEqual([false, true, true, false, false]);
  });

  it("counts as a change even at the end, where every page keeps its number", () => {
    const pages = insertPages(initialArrangement(3), 3, 1, { kind: "end" });
    expect(isUnchanged(pages, 3)).toBe(false);
  });

  it("plans the inserted pages as runs of the joined document", () => {
    let pages = insertPages(initialArrangement(4), 4, 3, { kind: "before", position: 3 });
    pages = turnPages(pages, new Set([5]), 90);
    expect(buildPlan(pages)).toEqual({
      turns: [{ angle: 90, pages: [5] }],
      runs: [
        { start: 0, end: 1 },
        { start: 4, end: 6 },
        { start: 2, end: 3 },
      ],
    });
  });

  it("keeps a second file's pages apart from the first's", () => {
    let pages = insertPages(initialArrangement(2), 2, 1, { kind: "end" });
    pages = insertPages(pages, 3, 2, { kind: "before", position: 1 });
    expect(order(pages)).toEqual([3, 4, 0, 1, 2]);
  });
});
