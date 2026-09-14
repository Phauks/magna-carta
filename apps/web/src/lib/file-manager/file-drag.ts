/*
 * Where a dragged row may land on this surface — the pure half of the gesture, kept out of the
 * screen so the refusals are testable without a pointer.
 *
 * The gesture itself is the design system's (`@magna-carta/design-system/item-drag`): the payload,
 * the mark, the refusal by silence and the clearing. What is here is the only part that is about
 * FILES AND FOLDERS rather than about dragging: which keys name a destination, and whether a
 * particular row has any business being moved into it.
 *
 * FOUR REFUSALS, and each is a different kind of wrong:
 *   - a destination that is not a folder at all — a file row, a changelog entry;
 *   - a folder into ITSELF, which is not a move;
 *   - a folder into its OWN DESCENDANT, which detaches the branch from the matter and leaves it
 *     reachable from nowhere — the one that actually loses documents;
 *   - anything into the folder it is ALREADY IN, which writes a move nobody made and would put a
 *     step on the undo stack for a gesture with no effect.
 *
 * A MIXED SELECTION IS NOT REFUSED FOR ITS WORST MEMBER. Dragging eight files onto a folder one of
 * them already sits in moves the other seven; refusing the whole gesture would make a selection
 * gathered from several folders undraggable, which is exactly the selection a reader is filing.
 */
import { FOLDER_KEY_PREFIX, type FileManagerRow, type MatterFileIndex } from "./file-rows.ts";
import { selectionPhrase } from "./file-manager-vocabulary.ts";

/**
 * The matter root as a destination. It is not a row, so it cannot borrow a row's key; the rail's
 * root and the breadcrumb's home crumb both stand for it and must name it the same way.
 */
export const MATTER_ROOT_DROP_KEY = "destination:matter-root";

/** What this surface calls a folder when it is a place something can be put. */
export function dropKeyOfFolder(folderId: string | null): string {
  return folderId === null ? MATTER_ROOT_DROP_KEY : FOLDER_KEY_PREFIX + folderId;
}

/**
 * The folder a destination key names — `null` for the matter root, and `undefined` where the key is
 * not a destination at all. The three answers are distinct on purpose: "the root" and "nowhere" are
 * different facts, and collapsing them would let a file row accept a drop and send it to the root.
 */
export function destinationFolderIdOf(key: string): string | null | undefined {
  if (key === MATTER_ROOT_DROP_KEY) return null;
  if (!key.startsWith(FOLDER_KEY_PREFIX)) return undefined;
  return key.slice(FOLDER_KEY_PREFIX.length);
}

/** Whether one row can be moved into one folder. */
export function canLandIn(
  index: MatterFileIndex,
  row: FileManagerRow,
  destinationFolderId: string | null,
): boolean {
  const origin = row.kind === "folder" ? row.folder.parentFolderId : row.file.folderId;
  if (origin === destinationFolderId) return false;
  if (row.kind === "file") return true;
  if (destinationFolderId === row.folder.id) return false;
  return (
    destinationFolderId === null ||
    !index.descendantFolderIds(row.folder.id).includes(destinationFolderId)
  );
}

/**
 * The keys of a drag that can actually land on this destination, in the order they were gathered.
 * Empty means the destination refuses the whole gesture, which is what the drag asks before it
 * marks anything.
 */
export function landableKeys(
  index: MatterFileIndex,
  keys: readonly string[],
  targetKey: string,
  rowOf: (key: string) => FileManagerRow | null,
): readonly string[] {
  const destination = destinationFolderIdOf(targetKey);
  if (destination === undefined) return [];
  return keys.filter((key) => {
    const row = rowOf(key);
    return row !== null && canLandIn(index, row, destination);
  });
}

/** What the drag image says over a selection: "3 files", "2 folders", "5 items". */
export function dragDescription(keys: readonly string[]): string {
  const folderCount = keys.filter((key) => key.startsWith(FOLDER_KEY_PREFIX)).length;
  return selectionPhrase(keys.length - folderCount, folderCount);
}
