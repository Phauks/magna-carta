/*
 * The folder marks — the icon flyout's contents, and the glyph a folder row draws.
 *
 * COLOUR AND MARK ARE TWO SEPARATE CHOICES, so they are two separate modules here and two separate
 * flyouts on screen. Reaching a folder's mark by first opening its colour would make one of the two
 * a sub-decision of the other, which is not how anybody thinks about either. The colours live in
 * colors.ts, which holds no glyph and so can be read without a browser.
 */
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import FolderArchive from "@lucide/svelte/icons/folder-archive";
import FolderCheck from "@lucide/svelte/icons/folder-check";
import FolderClock from "@lucide/svelte/icons/folder-clock";
import FolderHeart from "@lucide/svelte/icons/folder-heart";
import FolderKey from "@lucide/svelte/icons/folder-key";
import FolderLock from "@lucide/svelte/icons/folder-lock";
import FolderSearch from "@lucide/svelte/icons/folder-search";
import FolderBookmark from "@lucide/svelte/icons/folder-bookmark";
import House from "@lucide/svelte/icons/house";
import type { FolderIconComponent, FolderIconName } from "./types.ts";

/**
 * The rail's root row glyph, exported so the breadcrumb that names the same place imports the same
 * component rather than picking a house of its own. Two homes for one glyph is how they drift.
 */
export const FOLDER_TREE_HOME_ICON: FolderIconComponent = House;

export type FolderIconChoice = {
  name: FolderIconName;
  /** What the mark IS, not what a firm might mean by it — the meaning is the folder's own. */
  label: string;
  closed: FolderIconComponent;
  /** The glyph while the folder is open. Only the plain folder has a second state to show. */
  open: FolderIconComponent;
};

/** The marks, in the order they render. */
export const FOLDER_ICONS: readonly FolderIconChoice[] = [
  { name: "plain", label: "Plain", closed: Folder, open: FolderOpen },
  { name: "archive", label: "Archive", closed: FolderArchive, open: FolderArchive },
  { name: "check", label: "Check", closed: FolderCheck, open: FolderCheck },
  { name: "clock", label: "Clock", closed: FolderClock, open: FolderClock },
  { name: "heart", label: "Heart", closed: FolderHeart, open: FolderHeart },
  { name: "key", label: "Key", closed: FolderKey, open: FolderKey },
  { name: "lock", label: "Lock", closed: FolderLock, open: FolderLock },
  { name: "search", label: "Search", closed: FolderSearch, open: FolderSearch },
  { name: "bookmark", label: "Bookmark", closed: FolderBookmark, open: FolderBookmark },
];

const ICON_BY_NAME = new Map(FOLDER_ICONS.map((choice) => [choice.name, choice]));

/** The glyph a folder row draws, given the mark it carries and whether it is open. */
export function folderGlyph(
  iconName: FolderIconName | undefined,
  expanded: boolean,
): FolderIconComponent {
  const choice = ICON_BY_NAME.get(iconName ?? "plain") ?? FOLDER_ICONS[0];
  if (choice === undefined) return Folder;
  return expanded ? choice.open : choice.closed;
}
