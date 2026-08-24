import { describe, expect, it } from "vitest";
import {
  ancestorIds,
  childrenOf,
  isWithin,
  pathTo,
  toTreeNodes,
} from "../src/lib/file-manager/folder-tree.ts";
import type { FolderSummary } from "../src/lib/file-manager/folder-api.ts";

/*
 * The folder tree's shape is where a matter's files can be lost: a folder dropped because its parent
 * is missing takes its files off the screen, and a cycle in the data hangs the renderer. Both are
 * server-shaped problems the client has to survive, so both are asserted here.
 */

const folder = (id: string, parentFolderId: string | null, name: string): FolderSummary => ({
  id,
  parentFolderId,
  name,
});

const TREE: FolderSummary[] = [
  folder("pleadings", null, "Pleadings"),
  folder("discovery", null, "Discovery"),
  folder("written", "discovery", "Written Discovery"),
  folder("photos", "discovery", "Site Photographs"),
];

describe("childrenOf", () => {
  it("orders siblings by name without case deciding it", () => {
    const roots = childrenOf([folder("a", null, "zoning"), folder("b", null, "Answers")], null);
    expect(roots.map((entry) => entry.name)).toEqual(["Answers", "zoning"]);
  });
});

describe("toTreeNodes", () => {
  it("nests children under their parent", () => {
    const nodes = toTreeNodes(TREE);
    expect(nodes.map((node) => node.label)).toEqual(["Discovery", "Pleadings"]);
    expect(nodes[0]?.children?.map((node) => node.label)).toEqual([
      "Site Photographs",
      "Written Discovery",
    ]);
  });

  it("keeps a folder whose parent is missing, as a root", () => {
    // Dropping it would take its files off the screen entirely, which is the worse failure.
    const orphaned = [...TREE, folder("stray", "gone", "Stray")];
    const labels = toTreeNodes(orphaned).map((node) => node.label);
    expect(labels).toContain("Stray");
  });

  it("terminates on a cycle instead of recursing until the stack gives out", () => {
    const cyclic = [folder("one", "two", "One"), folder("two", "one", "Two")];
    // Neither can be a root by its parent link, so the tree is empty rather than infinite.
    expect(toTreeNodes(cyclic)).toEqual([]);
  });
});

describe("pathTo and ancestorIds", () => {
  it("reads root-first and ends with the folder itself", () => {
    expect(pathTo(TREE, "written").map((entry) => entry.id)).toEqual(["discovery", "written"]);
    expect(ancestorIds(TREE, "written")).toEqual(["discovery"]);
  });

  it("is empty at the matter root", () => {
    expect(pathTo(TREE, null)).toEqual([]);
    expect(ancestorIds(TREE, null)).toEqual([]);
  });

  it("stops rather than looping when the data has a cycle", () => {
    const cyclic = [folder("one", "two", "One"), folder("two", "one", "Two")];
    expect(pathTo(cyclic, "one").map((entry) => entry.id)).toEqual(["two", "one"]);
  });
});

describe("isWithin", () => {
  it("catches a folder being moved into its own subtree", () => {
    expect(isWithin(TREE, "written", "discovery")).toBe(true);
    expect(isWithin(TREE, "discovery", "discovery")).toBe(true);
    expect(isWithin(TREE, "pleadings", "discovery")).toBe(false);
  });
});
