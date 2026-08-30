import { describe, expect, it } from "vitest";
import {
  canMoveFolder,
  descendantIdentifiers,
  parentIdentifier,
} from "../src/lib/components/folder-tree/move.ts";
import { FOLDER_COLORS, folderColorInk } from "../src/lib/components/folder-tree/colors.ts";
import type { FolderTreeNode } from "../src/lib/components/folder-tree/types.ts";

/*
 * The rail's two pure questions: where a folder may be dragged, and what the palette is. Both are
 * answered without a DOM, because both are about the shape of the data rather than about pixels.
 *
 * What is deliberately NOT here: the geometry (a swatch really being square as rendered) and the
 * marks. The first can only be measured on a laid-out page, and the second is a list of glyph
 * components, which this runner cannot import at all. Both are asserted in the story instead.
 */

const FOLDERS: FolderTreeNode[] = [
  {
    id: "discovery",
    label: "Discovery",
    children: [
      { id: "depositions", label: "Depositions" },
      {
        id: "photographs",
        label: "Site Photographs",
        children: [{ id: "north", label: "North Elevation" }],
      },
    ],
  },
  { id: "correspondence", label: "Correspondence" },
];

describe("where a folder sits", () => {
  it("names every folder inside one, at any depth", () => {
    expect([...descendantIdentifiers(FOLDERS, "discovery")].toSorted()).toEqual([
      "depositions",
      "north",
      "photographs",
    ]);
    expect([...descendantIdentifiers(FOLDERS, "correspondence")]).toEqual([]);
  });

  it("answers with nothing for a folder that is not in the tree", () => {
    expect([...descendantIdentifiers(FOLDERS, "nowhere")]).toEqual([]);
  });

  it("names the folder holding one, and null at the root", () => {
    expect(parentIdentifier(FOLDERS, "north")).toBe("photographs");
    expect(parentIdentifier(FOLDERS, "photographs")).toBe("discovery");
    expect(parentIdentifier(FOLDERS, "discovery")).toBeNull();
  });
});

describe("whether a folder can be dragged somewhere", () => {
  it("refuses a folder into itself", () => {
    expect(canMoveFolder(FOLDERS, "discovery", "discovery")).toBe(false);
  });

  it("refuses a folder into its own descendant, at any depth", () => {
    expect(canMoveFolder(FOLDERS, "discovery", "depositions")).toBe(false);
    expect(canMoveFolder(FOLDERS, "discovery", "north")).toBe(false);
  });

  it("refuses a move into the folder it is already in, which changes nothing", () => {
    expect(canMoveFolder(FOLDERS, "depositions", "discovery")).toBe(false);
    expect(canMoveFolder(FOLDERS, "discovery", null)).toBe(false);
  });

  it("allows a real move, including out to the root", () => {
    expect(canMoveFolder(FOLDERS, "photographs", "correspondence")).toBe(true);
    expect(canMoveFolder(FOLDERS, "photographs", null)).toBe(true);
    expect(canMoveFolder(FOLDERS, "north", "discovery")).toBe(true);
  });
});

describe("the palette", () => {
  it("runs the spectrum first and includes pink", () => {
    expect(FOLDER_COLORS.map((color) => color.name)).toEqual([
      "red",
      "orange",
      "yellow",
      "green",
      "blue",
      "purple",
      "pink",
      "brown",
      "grey",
      "black",
      "white",
    ]);
  });

  it("names every colour exactly once", () => {
    const names = FOLDER_COLORS.map((color) => color.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives the pale fills the dark ink, so a check inside one can be read", () => {
    expect(folderColorInk("yellow")).toBe("dark");
    expect(folderColorInk("pink")).toBe("dark");
    expect(folderColorInk("white")).toBe("dark");
    expect(folderColorInk("black")).toBe("light");
    expect(folderColorInk(undefined)).toBe("light");
  });
});
