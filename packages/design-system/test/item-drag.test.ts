import { describe, expect, it } from "vitest";
import {
  ITEM_DRAG_MEDIA_TYPE,
  carriesDraggedItems,
  carriesExternalFiles,
  decodeDraggedItems,
  encodeDraggedItems,
} from "../src/lib/components/item-drag/item-drag.ts";

/*
 * The one question every drop handler in the product asks first: whose drag is this?
 *
 * It is worth a test of its own because the two answers open completely different machinery — a
 * file dropped from the desktop opens the upload dialog, a row dragged from the list writes a move
 * and pushes an undo step — and both gestures land on the same square inch of the file manager. A
 * surface that got this wrong would either open an upload dialog for a file the reader was merely
 * filing, or silently move a row when they meant to upload.
 *
 * The gesture itself (what marks, what refuses, what clears) is not here: it needs a real
 * DataTransfer and a laid-out page. It is exercised in the story instead.
 */

/** Just enough of a DataTransfer for the two questions, which read `types` and nothing else. */
function transferCarrying(...types: string[]): DataTransfer {
  return { types } as unknown as DataTransfer;
}

describe("telling our own drag from a file dropped in from outside", () => {
  it("reads our own media type as a move", () => {
    const transfer = transferCarrying(ITEM_DRAG_MEDIA_TYPE);
    expect(carriesDraggedItems(transfer)).toBe(true);
    expect(carriesExternalFiles(transfer)).toBe(false);
  });

  it("reads a desktop file as an upload", () => {
    const transfer = transferCarrying("Files");
    expect(carriesExternalFiles(transfer)).toBe(true);
    expect(carriesDraggedItems(transfer)).toBe(false);
  });

  it("stays a move when the browser adds Files to a transfer we also wrote", () => {
    // The defect this prevents: an upload dialog opening over a row the reader was only filing.
    const transfer = transferCarrying(ITEM_DRAG_MEDIA_TYPE, "Files");
    expect(carriesDraggedItems(transfer)).toBe(true);
    expect(carriesExternalFiles(transfer)).toBe(false);
  });

  it("claims nothing for a drag of plain text, or for no transfer at all", () => {
    const text = transferCarrying("text/plain");
    expect(carriesDraggedItems(text)).toBe(false);
    expect(carriesExternalFiles(text)).toBe(false);
    expect(carriesDraggedItems(null)).toBe(false);
    expect(carriesExternalFiles(null)).toBe(false);
  });
});

describe("the keys a drag carries", () => {
  it("survives the round trip, in the order the surface gathered them", () => {
    const keys = ["file:b", "folder:a", "file:c"];
    expect(decodeDraggedItems(encodeDraggedItems(keys))).toEqual(keys);
  });

  it("answers with nothing for an empty payload", () => {
    expect(decodeDraggedItems("")).toEqual([]);
    expect(encodeDraggedItems([])).toBe("");
  });

  it("drops a stray separator rather than carrying an empty key", () => {
    expect(decodeDraggedItems("file:a\n\nfile:b\n")).toEqual(["file:a", "file:b"]);
  });
});
