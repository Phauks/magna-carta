import type Folder from "@lucide/svelte/icons/folder";

/**
 * The folder rail's data, kept in a plain module (not the .svelte) so the types re-export and
 * import under plain tsc; a `type` re-exported from a `*.svelte` file resolves only under
 * svelte-check.
 */

/** A Lucide icon component, as imported from `@lucide/svelte/icons/*`. */
export type FolderIconComponent = typeof Folder;

/**
 * The colours a folder can be given. Rainbow first, then the achromatics — the order is the palette
 * the reader sees, and it is the order this array is written in, so there is nowhere else for a
 * sort to disagree with it.
 */
export type FolderColorName =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "brown"
  | "grey"
  | "black"
  | "white";

/** The marks a folder can carry instead of the plain one. */
export type FolderIconName =
  | "plain"
  | "archive"
  | "check"
  | "clock"
  | "heart"
  | "key"
  | "lock"
  | "search"
  | "bookmark";

/**
 * One folder in the rail. `children` nests; everything else is the folder's own presentation and is
 * optional, because a folder that has never been given a colour or a mark is the common case.
 */
export type FolderTreeNode = {
  /** Stable identity — the selection value, the expansion key, and what a move names. */
  id: string;
  /** The folder's name, as typed. */
  label: string;
  /** Folders inside this one. */
  children?: FolderTreeNode[];
  /** The colour the folder was given, if any. */
  color?: FolderColorName;
  /** The mark the folder was given, if any. */
  icon?: FolderIconName;
  /** How many files the folder holds, for the rail's counts. */
  fileCount?: number;
};

/** One row in the rail's second group: a view of the matter that is not a place in the folders. */
export type FolderTreeView = {
  /** Stable identity — what `currentViewIdentifier` matches and what a press reports. */
  id: string;
  /** The row's own words. The rows are self-describing; the group carries no heading. */
  label: string;
  /** The row's glyph. */
  icon: FolderIconComponent;
  /**
   * Why the view cannot be opened right now, when it cannot. The row still renders — a capability
   * that is coming is shown, disabled, saying what it waits on, never quietly removed.
   */
  disabledReason?: string;
};

/** What a right-click in the rail was on, handed to the caller's own menu items. */
export type FolderTreeMenuTarget = {
  /** The folder that was right-clicked, or `null` for the rail's own root row. */
  folderId: string | null;
  /** That folder's name, so a menu item can speak it. */
  label: string;
};

/** A folder move, as the rail reports it. `null` means the move is out to the root. */
export type FolderTreeMove = {
  folderId: string;
  destinationFolderId: string | null;
};
