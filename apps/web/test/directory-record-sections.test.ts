/*
 * A record read as one scrolling page: which section the rail lights, and how much of a long list
 * stands before "Show All".
 *
 * Each case is a way the rail could lie about where the reader is — lighting a section they have
 * scrolled past, never lighting a short last section at all — or a way a long list could bury
 * every section after it.
 */
import { describe, expect, it } from "vitest";
import {
  COLLAPSED_ROW_LIMIT,
  heldBackRows,
  sectionAt,
  SECTION_READING_LINE,
  visibleRows,
} from "../src/lib/directory/record-sections.ts";

const OFFSETS = [
  { id: "names", top: 0 },
  { id: "contact", top: 300 },
  { id: "address", top: 700 },
  { id: "matters", top: 1100 },
];

describe("the section the reader is in", () => {
  it("is the first section before anything has scrolled", () => {
    expect(sectionAt(OFFSETS, { top: 0, viewport: 500, content: 1300 })).toBe("names");
  });

  it("is the last section whose start has passed the reading line", () => {
    expect(sectionAt(OFFSETS, { top: 299, viewport: 500, content: 1300 })).toBe("contact");
    expect(
      sectionAt(OFFSETS, { top: 300 - SECTION_READING_LINE, viewport: 500, content: 1300 }),
    ).toBe("contact");
    expect(
      sectionAt(OFFSETS, { top: 300 - SECTION_READING_LINE - 1, viewport: 500, content: 1300 }),
    ).toBe("names");
  });

  it("is the last section once the page cannot scroll further, however short it is", () => {
    // 800 + 500 reaches the end of 1300 while the last section's start is still 300 below the top.
    expect(sectionAt(OFFSETS, { top: 800, viewport: 500, content: 1300 })).toBe("matters");
  });

  it("is the first section of a page too short to scroll", () => {
    expect(sectionAt(OFFSETS, { top: 0, viewport: 2000, content: 1300 })).toBe("names");
  });

  it("is nothing when there are no sections", () => {
    expect(sectionAt([], { top: 0, viewport: 500, content: 0 })).toBeNull();
  });
});

describe("a long list on the page", () => {
  const rows = Array.from({ length: COLLAPSED_ROW_LIMIT + 3 }, (_, index) => index);

  it("shows its first rows and says how many it is holding back", () => {
    expect(visibleRows(rows, false)).toEqual(rows.slice(0, COLLAPSED_ROW_LIMIT));
    expect(heldBackRows(rows, false)).toBe(3);
  });

  it("shows every row once opened", () => {
    expect(visibleRows(rows, true)).toEqual(rows);
    expect(heldBackRows(rows, true)).toBe(0);
  });

  it("holds nothing back from a list that already fits", () => {
    const short = rows.slice(0, COLLAPSED_ROW_LIMIT);
    expect(visibleRows(short, false)).toEqual(short);
    expect(heldBackRows(short, false)).toBe(0);
  });
});
