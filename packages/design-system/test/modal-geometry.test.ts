import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TOLERANCE,
  edgesOf,
  expandedViolations,
  formatEdges,
  windowedViolations,
} from "../modal-geometry/geometry.ts";
import { SPECIMENS, SPECIMEN_STORY_PREFIX, VIEWPORTS } from "../modal-geometry/matrix.ts";

/*
 * The sweep's arithmetic, pinned without a browser: what "keeps the gutter" and "fills the screen"
 * mean in numbers, so a change to either is a change here first.
 */

describe("edgesOf", () => {
  it("measures the panel's distance from each edge of the viewport", () => {
    expect(
      edgesOf({ x: 43, y: 32, width: 1280, height: 593 }, { width: 1366, height: 657 }),
    ).toEqual({
      left: 43,
      top: 32,
      right: 43,
      bottom: 32,
    });
  });
});

describe("a windowed panel", () => {
  const gutter = 32;

  it("passes when every edge keeps at least the gutter", () => {
    expect(windowedViolations({ left: 43, top: 32, right: 43, bottom: 32 }, gutter)).toEqual([]);
    expect(windowedViolations({ left: 640, top: 578, right: 640, bottom: 578 }, gutter)).toEqual(
      [],
    );
  });

  it("allows sub-pixel rounding", () => {
    expect(
      windowedViolations({ left: 32, top: 32 - TOLERANCE, right: 32, bottom: 32 }, gutter),
    ).toEqual([]);
  });

  it("names each edge that comes nearer than the gutter", () => {
    expect(windowedViolations({ left: 43, top: 0, right: 43, bottom: 0 }, gutter)).toEqual([
      "top edge is 0px from the screen; the gutter is 32px",
      "bottom edge is 0px from the screen; the gutter is 32px",
    ]);
  });

  it("refuses a missing gutter rather than passing vacuously", () => {
    expect(windowedViolations({ left: 0, top: 0, right: 0, bottom: 0 }, Number.NaN)).toHaveLength(
      1,
    );
    expect(windowedViolations({ left: 0, top: 0, right: 0, bottom: 0 }, 0)).toHaveLength(1);
  });
});

describe("an expanded panel", () => {
  it("passes only when it touches every edge", () => {
    expect(expandedViolations({ left: 0, top: 0, right: 0, bottom: 0 })).toEqual([]);
    expect(expandedViolations({ left: 0, top: 32, right: 0, bottom: 32 })).toEqual([
      "top edge is 32px from the screen; expanded, it should touch",
      "bottom edge is 32px from the screen; expanded, it should touch",
    ]);
  });
});

describe("the printed line", () => {
  it("rounds to whole pixels in edge order", () => {
    expect(formatEdges({ left: 42.6, top: 32, right: 43.4, bottom: 31.9 })).toBe("L43 T32 R43 B32");
  });
});

describe("the matrix", () => {
  it("names each row once, and every viewport is a real size", () => {
    const names = [...VIEWPORTS.map((row) => row.name), ...SPECIMENS.map((row) => row.name)];
    expect(new Set(names).size).toBe(names.length);
    for (const viewport of VIEWPORTS) {
      expect(viewport.width).toBeGreaterThan(0);
      expect(viewport.height).toBeGreaterThan(0);
      expect(viewport.stands_for).not.toBe("");
    }
  });

  it("names only specimen stories, and every specimen story is a row", () => {
    const specimenStories = readFileSync(
      join(import.meta.dirname, "../src/stories/modal-geometry.stories.svelte"),
      "utf8",
    );
    const storyNames = [...specimenStories.matchAll(/<Story name="([A-Za-z]+)"/g)].map((match) =>
      match[1]!.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),
    );
    expect(storyNames.length).toBeGreaterThan(0);
    expect(SPECIMENS.map((row) => row.storyId).toSorted()).toEqual(
      storyNames.map((name) => `${SPECIMEN_STORY_PREFIX}${name}`).toSorted(),
    );
  });

  it("covers both shells, a panel that cannot fit, and the expanded placement", () => {
    const names = SPECIMENS.map((row) => row.name);
    expect(names.some((name) => name.startsWith("record-window"))).toBe(true);
    expect(names.some((name) => name.startsWith("action-dialog"))).toBe(true);
    expect(names).toContain("alert-dialog");
    expect(names.some((name) => name.endsWith("too-long"))).toBe(true);
    expect(SPECIMENS.some((row) => row.expanded === true)).toBe(true);
  });
});
