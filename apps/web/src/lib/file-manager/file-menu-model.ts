/*
 * What the right-click menu says, computed rather than written out per case.
 *
 * Pin, rename, copy, cut, download and delete are RIGHT-CLICK actions on this surface. They are not
 * buttons in a header bar and not buttons in the details panel, because an action that repeats per
 * row belongs where the row is.
 *
 * A MENU OVER A MULTIPLE SELECTION SPEAKS FOR THE WHOLE SELECTION. That is the rule this module
 * exists to hold, and it is stated per action rather than as a blanket:
 *
 *   - Download, Copy, Cut, Pin, Delete and Re-run carry COUNTS.
 *   - Set Document Type scopes to the files in the selection.
 *   - Colour and Mark scope to the folders, and offer a shared value only when all of them agree.
 *   - Open and Rename are one-item gestures: on many they render DISABLED with the reason, never
 *     absent, so the menu does not change shape under the pointer.
 *   - Convert and Browse Inside are omitted on many — an item that is absent from a menu is right
 *     where the act has no meaning at all, and disabled is right where it has one it cannot reach.
 *   - Cut, Copy and Paste are their OWN GROUP, bounded by the menu's rule, in every menu.
 *
 * A disabled item ALWAYS states its reason. A control that is off and silent is the one thing a
 * reader cannot argue with.
 */
import { countPhrase, selectionPhrase } from "./file-manager-vocabulary.ts";
import { waitingReason } from "./file-manager-availability.ts";
import type { FileManagerRow } from "./file-rows.ts";
import type { FileManagerView } from "./file-manager-state.svelte.ts";
import { nameLooksLikeBrowsableArchive } from "./archive-names.ts";

/** Every command a file menu can carry. The surface switches on this, never on a label. */
export type FileMenuCommand =
  | "open"
  | "download"
  | "downloadBundle"
  | "rescan"
  | "share"
  | "saveNewVersion"
  | "pin"
  | "unpin"
  | "rename"
  | "documentType"
  | "browseInside"
  | "convert"
  | "color"
  | "icon"
  | "copy"
  | "cut"
  | "paste"
  | "delete"
  | "newFolder"
  | "newDocument"
  | "upload"
  | "selectAll"
  | "filterToThis"
  | "ignoreIssues"
  | "unignoreIssues"
  | "makeExhibits";

export interface FileMenuItem {
  readonly kind: "item";
  readonly command: FileMenuCommand;
  readonly label: string;
  /** The keyboard gesture that does the same thing, shown at the item's end. */
  readonly shortcut?: string;
  /** Why it cannot be pressed. Present means disabled; a disabled item is never silent. */
  readonly disabledReason?: string;
  /** Whether the item carries the small "Soon" badge beside its label. */
  readonly soon?: boolean;
  /** The destructive item, which the menu tints. */
  readonly danger?: boolean;
  /** For Pin: whether the thing is pinned now, so the glyph fills and the label says the opposite. */
  readonly pinned?: boolean;
}

export interface FileMenuSeparator {
  readonly kind: "separator";
}

/** A flyout the surface renders itself: the colour squares, the marks, the type list. */
export interface FileMenuFlyout {
  readonly kind: "flyout";
  readonly command: Extract<FileMenuCommand, "color" | "icon" | "documentType" | "convert">;
  readonly label: string;
  readonly disabledReason?: string;
  readonly soon?: boolean;
}

export type FileMenuEntry = FileMenuItem | FileMenuSeparator | FileMenuFlyout;

export interface MenuScope {
  /** The rows the menu speaks for: the selection when the right-click landed inside it. */
  readonly rows: readonly FileManagerRow[];
  readonly view: FileManagerView;
  /** Whether every row in the scope is already pinned. */
  readonly allPinned: boolean;
  /** Whether anything is waiting on a paste. */
  readonly clipboardHolds: boolean;
  /** Whether this view has a folder to write into at all. */
  readonly hasDestination: boolean;
  /** Non-empty folders in the scope — the ones whose delete needs a decision first. */
  readonly nonEmptyFolderCount: number;
  /**
   * How many open findings the scope carries, and how many of them are already set aside. File
   * Analysis is the only view where these mean anything, so they default to nothing.
   */
  readonly openIssueCount?: number;
  readonly ignoredIssueCount?: number;
}

const separator: FileMenuSeparator = { kind: "separator" };

/** Why a one-item gesture is off over a multiple selection, in that gesture's own words. */
function oneItemOnly(gesture: string): string {
  return `${gesture} acts on one thing at a time. Select a single row.`;
}

/** "Download", "Download 3 Files", "Download 5 Items" — the count rides the label. */
function counted(verb: string, files: number, folders: number): string {
  const total = files + folders;
  if (total <= 1) return verb;
  const what = selectionPhrase(files, folders);
  // Title case, because a menu item is a header-shaped label.
  return `${verb} ${what.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())}`;
}

/**
 * The menu for a right-click that landed on one or more rows. `hasDestination` is what turns Paste
 * off outside the browse views: Search Results and File Analysis show rows from many folders, so
 * "the folder you are looking at now" would name a folder the view never shows.
 */
export function rowMenu(scope: MenuScope): FileMenuEntry[] {
  const files = scope.rows.filter((row) => row.kind === "file");
  const folders = scope.rows.filter((row) => row.kind === "folder");
  const many = scope.rows.length > 1;
  const onlyRow = scope.rows.length === 1 ? scope.rows[0] : undefined;
  const singleFile = onlyRow?.kind === "file" ? onlyRow.file : undefined;
  const isArchive = singleFile !== undefined && nameLooksLikeBrowsableArchive(singleFile.name);
  // A file with no committed clean version has no bytes to hand over. It is still listed, still
  // selectable, and everything else about it still works — nothing here is blocked, only honest.
  const undownloadable = files.filter(
    (row) => row.kind === "file" && row.file.currentVersionId === null,
  ).length;

  const entries: FileMenuEntry[] = [
    {
      kind: "item",
      command: "open",
      label: "Open",
      shortcut: "Enter",
      disabledReason: many ? oneItemOnly("Open") : undefined,
    },
    {
      kind: "item",
      command: "download",
      label: counted("Download", files.length, folders.length),
      disabledReason:
        undownloadable > 0 && undownloadable === files.length && folders.length === 0
          ? files.length === 1
            ? "This file has no committed version yet, so there are no bytes to download."
            : "None of these files has a committed version yet."
          : undefined,
    },
    {
      kind: "item",
      command: "downloadBundle",
      label: "Download as Bundle",
      disabledReason:
        undownloadable > 0 && undownloadable === files.length && folders.length === 0
          ? "Nothing selected has a committed version yet, so there is nothing to bundle."
          : undefined,
    },
    {
      kind: "item",
      command: "rescan",
      label: counted("Re-run Safety Check", files.length, 0),
      disabledReason:
        files.every((row) => row.file.currentVersionId === null) && files.length > 0
          ? files.length === 1
            ? "This file has no committed version yet, so there is nothing to check again."
            : "None of these files has a committed version yet."
          : undefined,
    },
    {
      kind: "item",
      command: "share",
      label: counted("Share", files.length, folders.length),
      disabledReason: waitingReason("share"),
      soon: true,
    },
  ];

  if (folders.length === 0) {
    entries.push({
      kind: "item",
      command: "saveNewVersion",
      label: "Save New Version",
      disabledReason: many ? oneItemOnly("Saving a new version") : undefined,
    });
  }

  if (scope.view === "analysis" && folders.length === 0) {
    // Ignoring is PER ISSUE, not per file: setting aside a missing document type says nothing
    // about the same file's scan. Each one is individually reversible, which is why both
    // directions are offered rather than one toggle.
    const open = scope.openIssueCount ?? 0;
    const ignored = scope.ignoredIssueCount ?? 0;
    entries.push({
      kind: "item",
      command: "ignoreIssues",
      label: open <= 1 ? "Ignore This Issue" : `Ignore ${countPhrase(open, "Issue")}`,
      disabledReason: open === 0 ? "Nothing here is open to set aside." : undefined,
    });
    entries.push({
      kind: "item",
      command: "unignoreIssues",
      label: ignored <= 1 ? "Take This Back" : `Take Back ${countPhrase(ignored, "Issue")}`,
      disabledReason: ignored === 0 ? "Nothing here has been set aside." : undefined,
    });
  }

  if (scope.view === "results" && folders.length === 0) {
    entries.push({
      kind: "item",
      command: "filterToThis",
      label: "Filter to This File",
      disabledReason: many ? oneItemOnly("Filtering to one file") : undefined,
    });
  }

  entries.push(separator);

  entries.push({
    kind: "item",
    command: scope.allPinned ? "unpin" : "pin",
    label: scope.allPinned
      ? counted("Unpin", files.length, folders.length)
      : `${counted("Pin", files.length, folders.length)} to Top`,
    pinned: scope.allPinned,
  });

  entries.push({
    kind: "item",
    command: "rename",
    label: "Rename",
    shortcut: "F2",
    disabledReason: many ? oneItemOnly("Renaming") : undefined,
  });

  if (files.length > 0) {
    entries.push({
      kind: "flyout",
      command: "documentType",
      label: many
        ? `Set Document Type on ${countPhrase(files.length, "File")}`
        : "Set Document Type",
    });
  }

  // Absent, not disabled: browsing inside a thing that is not an archive has no meaning at all,
  // and a menu that lists every act the product has ever had is unreadable.
  if (!many && isArchive) {
    entries.push({
      kind: "item",
      command: "browseInside",
      label: "Browse Inside",
      disabledReason:
        singleFile?.currentVersionId === null
          ? "This file has no committed version yet, so there is nothing to read inside."
          : undefined,
    });
  }

  if (!many && singleFile !== undefined) {
    entries.push({
      kind: "flyout",
      command: "convert",
      label: "Convert",
      disabledReason: waitingReason("convert"),
      soon: true,
    });
  }

  if (!many && folders.length === 1) {
    // A folder of a filing's documents is where an exhibit set starts: its files become Exhibit A,
    // B, C in name order, and the set follows the folder until it is filed.
    entries.push(separator);
    entries.push({ kind: "item", command: "makeExhibits", label: "Make Exhibits" });
  }

  if (folders.length > 0) {
    entries.push(separator);
    // Colour and Mark are two decisions, so they are two items. Reaching a folder's mark by first
    // opening its colour would make one a sub-decision of the other, which is not how anyone thinks
    // about either.
    entries.push({
      kind: "flyout",
      command: "color",
      label: many ? `Color ${countPhrase(folders.length, "Folder")}` : "Color",
    });
    entries.push({
      kind: "flyout",
      command: "icon",
      label: many ? `Mark ${countPhrase(folders.length, "Folder")}` : "Mark",
    });
  }

  entries.push(separator);
  entries.push({
    kind: "item",
    command: "copy",
    label: counted("Copy", files.length, folders.length),
    shortcut: "Ctrl C",
    disabledReason: waitingReason("copy-paste"),
    soon: true,
  });
  entries.push({
    kind: "item",
    command: "cut",
    label: counted("Cut", files.length, folders.length),
    shortcut: "Ctrl X",
  });
  entries.push({
    kind: "item",
    command: "paste",
    label: "Paste",
    shortcut: "Ctrl V",
    disabledReason: pasteReason(scope),
  });

  entries.push(separator);
  entries.push({
    kind: "item",
    command: "delete",
    label: counted("Delete", files.length, folders.length),
    danger: true,
    disabledReason:
      many && scope.nonEmptyFolderCount > 0
        ? `${countPhrase(scope.nonEmptyFolderCount, "folder")} in this selection isn't empty. Delete folders one at a time, so you can decide what happens to their contents.`
        : undefined,
  });

  return entries;
}

/** The menu for a right-click on the empty space beneath the rows: the folder itself is the target. */
export function backgroundMenu(
  scope: Pick<MenuScope, "clipboardHolds" | "hasDestination" | "view">,
): FileMenuEntry[] {
  const destinationReason = scope.hasDestination
    ? undefined
    : "This view has no current folder to write into.";
  return [
    {
      kind: "item",
      command: "newFolder",
      label: "New Folder",
      disabledReason: destinationReason,
    },
    {
      kind: "item",
      command: "newDocument",
      label: "New Document",
      disabledReason: destinationReason,
    },
    { kind: "item", command: "upload", label: "Upload", disabledReason: destinationReason },
    separator,
    // Nothing is selected on the empty space, and an empty selection is the whole matter.
    { kind: "item", command: "downloadBundle", label: "Download Matter as Bundle" },
    separator,
    {
      kind: "item",
      command: "paste",
      label: "Paste",
      shortcut: "Ctrl V",
      disabledReason: pasteReason({ ...scope, clipboardHolds: scope.clipboardHolds }),
    },
    separator,
    { kind: "item", command: "selectAll", label: "Select All", shortcut: "Ctrl A" },
  ];
}

function pasteReason(
  scope: Pick<MenuScope, "clipboardHolds" | "hasDestination">,
): string | undefined {
  if (!scope.clipboardHolds) return "Nothing is on the clipboard yet.";
  if (!scope.hasDestination) return "This view has no current folder to paste into.";
  return undefined;
}
