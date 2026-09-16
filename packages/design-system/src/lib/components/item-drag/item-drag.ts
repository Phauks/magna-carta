/*
 * Dragging the product's OWN items from one place to another — the payload, and the one question
 * every drop handler in the product has to answer first: whose drag is this?
 *
 * TWO GESTURES SHARE ONE EVENT, AND THEY ARE TOLD APART BY THE PAYLOAD, NEVER BY THE TARGET. A drop
 * carrying `Files` came from the operating system and is an UPLOAD; a drop carrying the media type
 * below came from a row on this page and is a MOVE. A surface that offers both — the file manager
 * offers both on the same square inch — asks the payload, so an upload can never be mistaken for a
 * move or the other way round. `Dropzone` reads `carriesExternalFiles`; every move target reads
 * `carriesDraggedItems`.
 *
 * THE MEDIA TYPE IS OURS AND IS NOT `text/plain`. A plain-text payload is readable by, and
 * writable by, every other page and every text field; a vendor media type cannot be forged by a
 * file dropped from a desktop and cannot be read by a field that only understands text. The keys
 * themselves are the surface's own vocabulary — this module never interprets one.
 *
 * WHAT IS ON THE TRANSFER DURING A DRAG IS ONLY THE TYPE LIST. A browser withholds `getData` until
 * the drop, on purpose: a page must not be able to read what is being dragged over it. So the
 * decision a target takes DURING the gesture ("may this land here?") is taken against the keys the
 * page itself recorded at `dragstart`, and the media type is what says the recording belongs to
 * this drag rather than to a drag begun in another window.
 */

/** The transfer type a drag of our own items carries. Vendor-specific, so nothing else writes it. */
export const ITEM_DRAG_MEDIA_TYPE = "application/x-magna-carta-item-drag";

/** The attribute naming the item an element can be dragged AS. Its value is the caller's key. */
export const ITEM_DRAG_KEY_ATTRIBUTE = "data-item-drag-key";

/** The attribute naming the destination an element stands for. Its value is the caller's key. */
export const ITEM_DROP_KEY_ATTRIBUTE = "data-item-drop-key";

/** Set on the destination under the pointer while a drop there would be accepted. */
export const ITEM_DROP_MARK_ATTRIBUTE = "data-item-drop-marked";

/** The keys carried by a drag, in the order the surface gathered them. */
export function encodeDraggedItems(keys: readonly string[]): string {
  return keys.join("\n");
}

/** The keys back out of a payload. Empty entries are dropped, so a stray newline costs nothing. */
export function decodeDraggedItems(payload: string): readonly string[] {
  return payload.split("\n").filter((key) => key !== "");
}

/** Whether this drag carries our own items — a move, never an upload. */
export function carriesDraggedItems(transfer: DataTransfer | null): boolean {
  return transfer !== null && [...transfer.types].includes(ITEM_DRAG_MEDIA_TYPE);
}

/**
 * Whether this drag carries files from OUTSIDE the page — an upload.
 *
 * Our own drag is excluded explicitly rather than by omission: a browser is free to add `Files` to
 * a transfer we also wrote to, and a surface that only asked "does it carry Files?" would then open
 * its upload dialog on a row the reader was merely moving.
 */
export function carriesExternalFiles(transfer: DataTransfer | null): boolean {
  if (transfer === null || carriesDraggedItems(transfer)) return false;
  return [...transfer.types].includes("Files");
}
