import { describe, expect, it } from "vitest";
import {
  boxBetween,
  engineRegions,
  inReadingOrder,
  isDeliberateMark,
  pointsToScreen,
  redactedCopyName,
  redactionLog,
  redactionLogCsv,
  screenToPoints,
  wholePageRect,
  type MarkedRedaction,
} from "../src/lib/pdf-editor/redactions.ts";

const LETTER = { widthPt: 612, heightPt: 792 };

function mark(key: string, page: number, x0: number, y1: number): MarkedRedaction {
  return {
    key,
    page,
    rect: { x0, y0: y1 - 10, x1: x0 + 50, y1 },
    reason: "Privileged",
    wholePage: false,
  };
}

describe("drawing a box", () => {
  it("is the same box whichever corner the drag starts from", () => {
    const forward = boxBetween({ x: 10, y: 20 }, { x: 110, y: 70 }, 816, 1056);
    const backward = boxBetween({ x: 110, y: 70 }, { x: 10, y: 20 }, 816, 1056);
    expect(forward).toEqual({ left: 10, top: 20, width: 100, height: 50 });
    expect(backward).toEqual(forward);
  });

  it("stops at the edge of the page", () => {
    expect(boxBetween({ x: -40, y: -5 }, { x: 900, y: 30 }, 816, 1056)).toEqual({
      left: 0,
      top: 0,
      width: 816,
      height: 30,
    });
  });

  it("treats a press that barely moved as a click, not a mark", () => {
    expect(isDeliberateMark({ left: 0, top: 0, width: 2, height: 40 })).toBe(false);
    expect(isDeliberateMark({ left: 0, top: 0, width: 40, height: 40 })).toBe(true);
  });
});

describe("converting between the screen and the page", () => {
  it("turns a screen box at 100% into points from the bottom-left corner", () => {
    // At zoom 1 a page is drawn at 96 pixels an inch; a PDF point is a 72nd of an inch.
    const rect = screenToPoints({ left: 96, top: 96, width: 96, height: 48 }, LETTER, 1);
    expect(rect).toEqual({ x0: 72, x1: 144, y1: 792 - 72, y0: 792 - 108 });
  });

  it("round-trips at any zoom, so changing the zoom never moves a mark", () => {
    const box = { left: 120, top: 300, width: 200, height: 40 };
    for (const zoom of [0.75, 1, 1.5, 2]) {
      const back = pointsToScreen(screenToPoints(box, LETTER, zoom), LETTER, zoom);
      expect(back.left).toBeCloseTo(box.left);
      expect(back.top).toBeCloseTo(box.top);
      expect(back.width).toBeCloseTo(box.width);
      expect(back.height).toBeCloseTo(box.height);
    }
  });

  it("covers the whole page for a whole-page mark", () => {
    expect(wholePageRect(LETTER)).toEqual({ x0: 0, y0: 0, x1: 612, y1: 792 });
  });
});

describe("ordering, the engine's regions and the log", () => {
  const marks = [
    mark("c", 1, 10, 700),
    mark("b", 0, 300, 500),
    mark("a", 0, 10, 700),
    mark("d", 0, 5, 500),
  ];

  it("numbers marks by page, then top to bottom, then left to right", () => {
    expect(inReadingOrder(marks).map((one) => one.key)).toEqual(["a", "d", "b", "c"]);
  });

  it("hands the engine one region per mark with its reason", () => {
    const regions = engineRegions(marks);
    expect(regions).toHaveLength(4);
    expect(regions[0]).toEqual({ page: 0, rect: marks[2]?.rect, reason: "Privileged" });
  });

  it("logs the page from one and the reason, never any text", () => {
    const log = redactionLog(marks);
    expect(log[3]).toEqual({ number: 4, page: 2, reason: "Privileged" });
    const csv = redactionLogCsv('Smith "Vol 1" (Redacted).pdf', log, "2026-11-12T20:00:00.000Z");
    expect(csv.split("\r\n")[0]).toBe("Document,Applied,Number,Page,Reason");
    expect(csv).toContain('"Smith ""Vol 1"" (Redacted).pdf"');
  });
});

describe("naming the redacted copy", () => {
  it("keeps the extension and says it is redacted", () => {
    expect(redactedCopyName("Smith Production Vol 1.pdf")).toBe(
      "Smith Production Vol 1 (Redacted).pdf",
    );
    expect(redactedCopyName("declaration")).toBe("declaration (Redacted).pdf");
  });
});
