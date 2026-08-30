/*
 * FolderTree — the file manager's left rail, and the one tree that surface has. It extends Tree
 * rather than standing beside it: everything about moving between rows, the roving tabindex,
 * expansion and selection is Tree's, and what is added here is the rail.
 */
export { default } from "./folder-tree.svelte";
export { FOLDER_COLORS, folderColorInk } from "./colors.ts";
export type { FolderColor } from "./colors.ts";
export { FOLDER_ICONS, FOLDER_TREE_HOME_ICON, folderGlyph } from "./palette.ts";
export type { FolderIconChoice } from "./palette.ts";
export { canMoveFolder, descendantIdentifiers, parentIdentifier } from "./move.ts";
export type {
  FolderColorName,
  FolderIconComponent,
  FolderIconName,
  FolderTreeMenuTarget,
  FolderTreeMove,
  FolderTreeNode,
  FolderTreeView,
} from "./types.ts";
