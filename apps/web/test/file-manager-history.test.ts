import { describe, expect, it } from "vitest";
import { HistoryStack } from "@magna-carta/design-system/history-stack";
import {
  deleteLabel,
  deleteStep,
  moveLabel,
  moveStep,
  pinLabel,
  pinStep,
  renameLabel,
  renameStep,
} from "../src/lib/file-manager/file-manager-history.ts";

/*
 * The undoable acts, one test each, because the owner reported the controls as not working and the
 * cause was never the control: only a move was ever recorded, so Undo sat disabled through a
 * morning of renaming, deleting and pinning.
 *
 * Each test asserts the CLAIM the control makes to a reader — that pressing Undo puts back exactly
 * what the act changed and nothing else — by handing the step a recorder in place of the writes and
 * reading back what it asked for. The steps are walked through the real stack, so what is pinned
 * here includes that a refused inverse leaves the step where a second press will find it.
 */

/** One call the surface made to a write, in the order it was made. */
type Written = string;

describe("moving rows between folders", () => {
  it("puts every key back where IT came from, not where the selection came from", async () => {
    const written: Written[] = [];
    const stack = new HistoryStack();
    stack.push(
      moveStep({
        label: moveLabel(2, "Discovery"),
        origins: new Map([
          ["file:a", "pleadings"],
          ["file:b", null],
        ]),
        destinationFolderId: "discovery",
        move: (key, folderId) => {
          written.push(`${key}->${folderId ?? "home"}`);
          return Promise.resolve();
        },
        settled: () => written.push("reload"),
      }),
    );

    await stack.undo();
    expect(written).toEqual(["file:a->pleadings", "file:b->home", "reload"]);

    written.length = 0;
    await stack.redo();
    expect(written).toEqual(["file:a->discovery", "file:b->discovery", "reload"]);
  });

  it("keeps the step on the stack when a write refuses, so the same act can be tried again", async () => {
    const stack = new HistoryStack();
    let attempts = 0;
    stack.push(
      moveStep({
        label: moveLabel(1, "Discovery"),
        origins: new Map([["file:a", "pleadings"]]),
        destinationFolderId: "discovery",
        move: () => {
          attempts += 1;
          return attempts === 1 ? Promise.reject(new Error("refused")) : Promise.resolve();
        },
        settled: () => undefined,
      }),
    );

    const refused = await stack.undo();
    expect(refused.failure?.label).toBe("moving 1 item to Discovery");
    expect(refused.moved).toBe(0);
    expect(stack.canUndo).toBe(true);

    const second = await stack.undo();
    expect(second.failure).toBeNull();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(true);
  });
});

describe("renaming", () => {
  it("writes the name back, and forward again, without reading the row", async () => {
    const written: Written[] = [];
    const stack = new HistoryStack();
    stack.push(
      renameStep({
        label: renameLabel("Motion.pdf", "Motion to Compel.pdf"),
        before: "Motion.pdf",
        after: "Motion to Compel.pdf",
        rename: (name) => {
          written.push(name);
          return Promise.resolve();
        },
        settled: () => written.push("reload"),
      }),
    );

    await stack.undo();
    await stack.redo();
    expect(written).toEqual(["Motion.pdf", "reload", "Motion to Compel.pdf", "reload"]);
  });

  it("names both sides, so the control says which rename it will take back", () => {
    expect(renameLabel("Motion.pdf", "Answer.pdf")).toBe("renaming Motion.pdf to Answer.pdf");
  });
});

describe("deleting files", () => {
  it("restores each file into the folder it came out of, never the matter root by default", async () => {
    const restored: Written[] = [];
    const removed: Written[] = [];
    const stack = new HistoryStack();
    stack.push(
      deleteStep({
        label: deleteLabel(2),
        removed: [
          { fileId: "a", folderId: "discovery" },
          { fileId: "b", folderId: null },
        ],
        remove: (fileId) => {
          removed.push(fileId);
          return Promise.resolve();
        },
        restore: (fileId, folderId) => {
          restored.push(`${fileId}->${folderId ?? "home"}`);
          return Promise.resolve();
        },
        settled: () => undefined,
      }),
    );

    await stack.undo();
    expect(restored).toEqual(["a->discovery", "b->home"]);

    await stack.redo();
    expect(removed).toEqual(["a", "b"]);
  });

  it("counts files, because a folder's delete is never on this step", () => {
    expect(deleteLabel(1)).toBe("deleting 1 file");
    expect(deleteLabel(3)).toBe("deleting 3 files");
  });
});

describe("pinning", () => {
  it("unpins exactly the keys the act pinned, and pins them again on the way forward", async () => {
    const written: Written[] = [];
    const stack = new HistoryStack();
    stack.push(
      pinStep({
        label: pinLabel(2, true),
        keys: ["file:a", "folder:b"],
        pinned: true,
        setPinned: (keys, pinned) => written.push(`${pinned ? "pin" : "unpin"}:${keys.join(",")}`),
      }),
    );

    await stack.undo();
    expect(written).toEqual(["unpin:file:a,folder:b"]);

    await stack.redo();
    expect(written).toEqual(["unpin:file:a,folder:b", "pin:file:a,folder:b"]);
  });

  it("says which direction it is taking back", () => {
    expect(pinLabel(1, true)).toBe("pinning 1 item");
    expect(pinLabel(4, false)).toBe("unpinning 4 items");
  });
});

describe("what a walk offers the reader", () => {
  it("names the act each press would reverse, so Undo is never a bare arrow", () => {
    const stack = new HistoryStack();
    const inert = { move: () => Promise.resolve(), settled: () => undefined };
    stack.push(
      moveStep({
        label: moveLabel(3, "Discovery"),
        origins: new Map([["file:a", null]]),
        destinationFolderId: "discovery",
        ...inert,
      }),
    );
    stack.push(
      renameStep({
        label: renameLabel("a.pdf", "b.pdf"),
        before: "a.pdf",
        after: "b.pdf",
        rename: () => Promise.resolve(),
        settled: () => undefined,
      }),
    );

    expect(stack.undoTitle).toBe("Undo renaming a.pdf to b.pdf");
    expect(stack.undoLabels).toEqual(["renaming a.pdf to b.pdf", "moving 3 items to Discovery"]);
  });
});
