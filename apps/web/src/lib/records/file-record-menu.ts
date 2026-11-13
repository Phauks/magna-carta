/*
 * The verbs of the file surfaces, and the rules about which of them a given selection gets.
 *
 * Six views share this one menu — browsing a folder, the deleted files, a search's results, the
 * matter's history, the analysis of every open finding, and the inside of an archive. They share it
 * because they are the same table showing the same records, and a menu that differed between them
 * would be a promise that something else differs too.
 *
 * What DOES differ is answered here, in three ways and no others:
 *
 *   PRESENCE   — a verb that has no meaning in a view is not built for it. Entering an archive is
 *                about one archive; converting bytes is about one file. Neither is a thing you do
 *                to twelve rows, so over a selection they are absent rather than greyed.
 *   SCOPE      — a verb counts what IT will touch, which is not always the selection. Setting a
 *                document type over three files and two folders acts on the three, and says so.
 *   REFUSAL    — a verb that this selection cannot take stays on screen and states why. That is the
 *                difference between a menu a reader can learn and a menu that keeps changing shape.
 *
 * The destination rule is the sharpest of them. "Paste", "New Folder", "Upload" all write into the
 * folder you are looking at, and three of these views are not folders at all: a search result set
 * spans many folders, an analysis list is a report, the inside of an archive is not a place a file
 * can be written to. Acting on the last folder somebody happened to browse is the defect this rule
 * exists to stop, so a destination verb is live only where a destination genuinely exists — with
 * the one exception that a FOLDER row is its own destination, whichever view it is showing in.
 */
import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
import PackageOpen from "@lucide/svelte/icons/package-open";
import Copy from "@lucide/svelte/icons/copy";
import Crosshair from "@lucide/svelte/icons/crosshair";
import Download from "@lucide/svelte/icons/download";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import Funnel from "@lucide/svelte/icons/funnel";
import Info from "@lucide/svelte/icons/info";
import Paste from "@lucide/svelte/icons/clipboard-paste";
import Palette from "@lucide/svelte/icons/palette";
import Pencil from "@lucide/svelte/icons/pencil";
import Pin from "@lucide/svelte/icons/pin";
import RotateCounterClockwise from "@lucide/svelte/icons/rotate-ccw";
import Scissors from "@lucide/svelte/icons/scissors";
import Shapes from "@lucide/svelte/icons/shapes";
import Share from "@lucide/svelte/icons/share-2";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Tag from "@lucide/svelte/icons/tag";
import Trash from "@lucide/svelte/icons/trash-2";
import Upload from "@lucide/svelte/icons/upload";
import WandSparkles from "@lucide/svelte/icons/wand-sparkles";
import FilePlus from "@lucide/svelte/icons/file-plus";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import ListCheck from "@lucide/svelte/icons/list-check";

import {
  commandShortcut,
  countedLabel,
  FILE_NOUN,
  FOLDER_NOUN,
  DOCUMENT_NOUN,
  ITEM_NOUN,
  markShared,
  menuOf,
  oneRecordGesture,
  plainShortcut,
  sharedMark,
  type NounPair,
  type RecordMenuAction,
  type RecordMenuChoice,
  type RecordMenuFlyout,
  type RecordMenuModel,
} from "./record-menu-model.ts";

// --- what a row is ----------------------------------------------------------------------------

/** One row the menu is speaking for. Everything a verb needs to decide itself about that row. */
export interface FileRecord {
  readonly identifier: string;
  readonly name: string;
  readonly isFolder: boolean;
  /** Whether this row is pinned above the rule. */
  readonly pinned: boolean;
  /** Folders only: whether anything is inside. An empty folder deletes with no question asked. */
  readonly hasContents: boolean;
  /** Whether this row is an archive a reader can step into. */
  readonly isArchive: boolean;
  /** The document type recorded on this file, or null where none is. */
  readonly documentType: string | null;
  /** Folders only: the colour and the icon it wears, or null where it wears the default. */
  readonly color: string | null;
  readonly icon: string | null;
  /**
   * The conversions this file's bytes honestly support, already worded as their target extension.
   * A kind with nothing honest to convert to carries none, and gets no Convert verb at all.
   */
  readonly convertTargets: readonly string[];
}

/** The six views this one menu serves. */
export type FileSurface =
  | "browse"
  | "deletedFiles"
  | "searchResults"
  | "history"
  | "fileAnalysis"
  | "archive";

export interface FileMenuContext {
  readonly surface: FileSurface;
  /**
   * The folder being looked at, where the view is a folder at all. Null everywhere else, which is
   * what makes "write into the current folder" impossible to get wrong in a view that has none.
   */
  readonly currentFolderName: string | null;
  /** What is waiting to be pasted, or null. */
  readonly clipboard: { readonly operation: "copy" | "cut"; readonly count: number } | null;
  /** The firm's document types, for the flyout that sets one. */
  readonly documentTypes: readonly { readonly identifier: string; readonly label: string }[];
  /** The folder palette, in the order it is drawn. */
  readonly folderColors: readonly { readonly identifier: string; readonly label: string }[];
  /** The folder icons a folder may wear instead of the default. */
  readonly folderIcons: readonly { readonly identifier: string; readonly label: string }[];
  /** Whether the archive being read is itself deleted, which changes what leaving it is called. */
  readonly archiveIsDeleted: boolean;
}

/** What the product waits on before a file can be shared outside the firm. */
const SHARING_DEPENDENCY = "client-portal document sharing";
/** What the product waits on before a file's bytes can be rewritten as another format. */
const CONVERSION_DEPENDENCY = "the conversion engine";
/** What the product waits on before anything can be written out of an archive. */
const EXTRACTION_DEPENDENCY = "the archive-extraction engine";

const NOTHING_ON_THE_CLIPBOARD = "Nothing is on the clipboard yet.";
const NO_CURRENT_FOLDER =
  "This view is not a folder, so there is nowhere here to paste into. Open a folder first.";

// --- the selection the menu speaks for ---------------------------------------------------------

/**
 * Which rows a right-click speaks for.
 *
 * Inside the selection, the menu speaks for all of it. Outside it, the click has re-aimed at that
 * one row — which is what a reader means by right-clicking somewhere they had not selected, and
 * the alternative (acting on rows they can no longer see the point of) is how a bulk delete goes
 * wrong.
 */
export function menuTargets(
  selection: readonly FileRecord[],
  row: FileRecord,
): readonly FileRecord[] {
  return selection.some((record) => record.identifier === row.identifier) ? selection : [row];
}

/** What to call a set of rows. Files and folders together are neither, so they are Items. */
export function recordNoun(records: readonly FileRecord[]): NounPair {
  if (records.length > 0 && records.every((record) => record.isFolder)) return FOLDER_NOUN;
  if (records.length > 0 && records.every((record) => !record.isFolder)) return FILE_NOUN;
  return ITEM_NOUN;
}

/** Where a paste would land, or null when there is nowhere. A folder row is its own destination. */
export function pasteDestination(
  records: readonly FileRecord[],
  context: FileMenuContext,
): string | null {
  const [only] = records;
  if (records.length === 1 && only !== undefined && only.isFolder) return only.name;
  return context.surface === "browse" ? context.currentFolderName : null;
}

// --- the row menu -----------------------------------------------------------------------------

/**
 * The menu for a selection of rows, on one of the file surfaces.
 *
 * `records` is what the menu speaks for; `target` is the row it was summoned over, which is always
 * one of them. Both are needed because a handful of verbs are about the row's own identity — is it
 * an archive, what can its bytes become — rather than about the selection's size.
 */
export function fileRecordMenu(
  records: readonly FileRecord[],
  target: FileRecord,
  context: FileMenuContext,
): RecordMenuModel {
  const count = records.length;
  const noun = recordNoun(records);
  const files = records.filter((record) => !record.isFolder);
  const folders = records.filter((record) => record.isFolder);
  const single = count === 1;

  return menuOf([
    { identifier: "reach", items: [openVerb(), revealVerb(), browseInsideVerb()] },
    {
      identifier: "record",
      items: [
        downloadVerb(),
        renameVerb(),
        shareVerb(),
        convertFlyout(),
        documentTypeFlyout(),
        colorFlyout(),
        iconFlyout(),
        pinVerb(),
        safetyCheckVerb(),
      ],
    },
    { identifier: "clipboard", items: [cutVerb(), copyVerb(), pasteVerb()] },
    { identifier: "view", items: [restoreVerb(), detailsVerb(), filterVerb(), extractVerb()] },
    { identifier: "destructive", items: [deleteVerb()] },
  ]);

  /*
   * Open is the one gesture for every kind of row: a word-processing format opens the editor, a
   * folder opens itself, and everything else opens its preview. The views whose rows are not files
   * in a folder — an event on the history, a finding in the analysis — use Reveal instead, because
   * what a reader wants there is to be taken to the document, not to look at it in place.
   */
  function openVerb(): RecordMenuAction | null {
    if (context.surface === "history" || context.surface === "fileAnalysis") return null;
    if (context.surface === "deletedFiles") return null;
    return {
      kind: "action",
      identifier: "open",
      label: "Open",
      icon: FolderOpen,
      shortcut: plainShortcut("Enter"),
      ...oneRecordGesture(count, "Open works on one item at a time."),
    };
  }

  function revealVerb(): RecordMenuAction | null {
    if (context.surface !== "history" && context.surface !== "fileAnalysis") return null;
    return {
      kind: "action",
      identifier: "reveal",
      label: "Reveal",
      icon: Crosshair,
      ...oneRecordGesture(count, "Reveal takes you to one document at a time."),
    };
  }

  /*
   * Stepping into an archive is a gesture about that one archive, so it is absent over a selection
   * rather than present and refused: there is no reading of "browse inside" over four files that a
   * refusal would be explaining.
   */
  function browseInsideVerb(): RecordMenuAction | null {
    if (!single || !target.isArchive) return null;
    return {
      kind: "action",
      identifier: "browseInside",
      label: "Browse Inside",
      icon: PackageOpen,
    };
  }

  /*
   * The label is the verb and nothing else. Any acknowledgement a download needs is raised after
   * the click, where a reader can answer it — a label that carries the condition makes the menu
   * argue with the reader before they have asked for anything.
   */
  function downloadVerb(): RecordMenuAction {
    return {
      kind: "action",
      identifier: "download",
      label: countedLabel({ verb: "Download", count, noun }),
      icon: Download,
    };
  }

  function renameVerb(): RecordMenuAction {
    return {
      kind: "action",
      identifier: "rename",
      label: "Rename",
      icon: Pencil,
      ...oneRecordGesture(count, "Rename works on one item at a time."),
    };
  }

  function shareVerb(): RecordMenuAction {
    return {
      kind: "action",
      identifier: "share",
      label: countedLabel({ verb: "Share", count, noun }),
      icon: Share,
      soonDependency: SHARING_DEPENDENCY,
    };
  }

  /*
   * Converting is about one file's bytes, so it is absent over a selection. A file whose kind has
   * no honest target gets no Convert verb either: an empty flyout would be a promise of choices
   * that do not exist.
   */
  function convertFlyout(): RecordMenuFlyout | null {
    if (!single || target.isFolder || target.convertTargets.length === 0) return null;
    const choices: RecordMenuChoice[] = target.convertTargets.map((extension) => ({
      identifier: extension,
      label: `To ${extension}`,
      soonDependency: CONVERSION_DEPENDENCY,
    }));
    return {
      kind: "flyout",
      identifier: "convert",
      label: "Convert",
      icon: WandSparkles,
      choices: [
        ...choices,
        {
          identifier: "withOptions",
          label: "Convert With Options",
          soonDependency: CONVERSION_DEPENDENCY,
        },
      ],
    };
  }

  /* A document type is a fact about a file. Over a mixed selection the verb counts the files. */
  function documentTypeFlyout(): RecordMenuFlyout | null {
    if (files.length === 0) return null;
    const shared = sharedMark(files.map((record) => record.documentType));
    return {
      kind: "flyout",
      identifier: "setDocumentType",
      label: countedLabel({
        verb: "Set Document Type",
        count: files.length,
        noun: FILE_NOUN,
        preposition: "for",
      }),
      icon: Tag,
      choices: markShared(context.documentTypes, shared),
    };
  }

  /* Colour and icon are two separate flyouts; neither is reached by going through the other. */
  function colorFlyout(): RecordMenuFlyout | null {
    if (folders.length === 0) return null;
    return {
      kind: "flyout",
      identifier: "setColor",
      label: countedLabel({
        verb: "Color",
        count: folders.length,
        noun: FOLDER_NOUN,
        preposition: "for",
      }),
      icon: Palette,
      choices: markShared(context.folderColors, sharedMark(folders.map((record) => record.color))),
    };
  }

  function iconFlyout(): RecordMenuFlyout | null {
    if (folders.length === 0) return null;
    return {
      kind: "flyout",
      identifier: "setIcon",
      label: countedLabel({
        verb: "Icon",
        count: folders.length,
        noun: FOLDER_NOUN,
        preposition: "for",
      }),
      icon: Shapes,
      choices: markShared(context.folderIcons, sharedMark(folders.map((record) => record.icon))),
    };
  }

  /*
   * The label says what pressing it will do, so an already-pinned selection reads Unpin. Choosing
   * it does not close the menu: pinning is applied to several rows in a row, and a menu that shut
   * after the first would be reopened immediately.
   */
  function pinVerb(): RecordMenuAction {
    const allPinned = count > 0 && records.every((record) => record.pinned);
    return {
      kind: "action",
      identifier: "pin",
      label: countedLabel({ verb: allPinned ? "Unpin" : "Pin", count, noun }),
      icon: Pin,
      staysOpen: true,
      marked: allPinned,
    };
  }

  /*
   * The safety check runs on files. A folder is deliberately not offered one: a recursive re-scan
   * of everything beneath it is a different promise than re-running one file, and half of it would
   * be worse than none.
   */
  function safetyCheckVerb(): RecordMenuAction | null {
    if (files.length === 0) return null;
    return {
      kind: "action",
      identifier: "rerunSafetyCheck",
      label: countedLabel({
        verb: "Re-run Safety Check",
        count: files.length,
        noun: FILE_NOUN,
        preposition: "on",
      }),
      icon: ShieldCheck,
    };
  }

  function cutVerb(): RecordMenuAction {
    return {
      kind: "action",
      identifier: "cut",
      label: countedLabel({ verb: "Cut", count, noun }),
      icon: Scissors,
      shortcut: commandShortcut("x"),
    };
  }

  function copyVerb(): RecordMenuAction {
    return {
      kind: "action",
      identifier: "copy",
      label: countedLabel({ verb: "Copy", count, noun }),
      icon: Copy,
      shortcut: commandShortcut("c"),
    };
  }

  function pasteVerb(): RecordMenuAction {
    const destination = pasteDestination(records, context);
    return {
      kind: "action",
      identifier: "paste",
      label: "Paste",
      icon: Paste,
      shortcut: commandShortcut("v"),
      ...(destination === null
        ? { disabledReason: NO_CURRENT_FOLDER }
        : context.clipboard === null
          ? { disabledReason: NOTHING_ON_THE_CLIPBOARD }
          : {}),
    };
  }

  function restoreVerb(): RecordMenuAction | null {
    if (context.surface !== "deletedFiles") return null;
    return {
      kind: "action",
      identifier: "restore",
      label: countedLabel({ verb: "Restore", count, noun }),
      icon: RotateCounterClockwise,
    };
  }

  function detailsVerb(): RecordMenuAction | null {
    if (context.surface !== "deletedFiles") return null;
    return {
      kind: "action",
      identifier: "details",
      label: "Details",
      icon: Info,
      ...oneRecordGesture(count, "Details describes one file at a time."),
    };
  }

  /*
   * Narrowing the view to one document earns its place only where the view holds many rows ABOUT a
   * document — its events, or the places a search found it. Narrowing a folder listing to a row you
   * have already found is noise, so browsing, the deleted list and the analysis do not offer it.
   */
  function filterVerb(): RecordMenuAction | null {
    if (context.surface !== "history" && context.surface !== "searchResults") return null;
    const filterNoun = context.surface === "history" ? DOCUMENT_NOUN : FILE_NOUN;
    return {
      kind: "action",
      identifier: "filterToDocument",
      label: countedLabel({
        verb: "Filter to",
        count: 1,
        noun: filterNoun,
        style: "demonstrative",
      }),
      icon: Funnel,
      ...oneRecordGesture(count, "The view narrows to one document at a time."),
    };
  }

  /*
   * Taking a member out of an archive writes a new file into the matter, which is why it is not
   * called restoring when the archive is alive: nothing was lost. A deleted archive's member IS a
   * restore, and says so, while the archive itself stays deleted.
   */
  function extractVerb(): RecordMenuAction | null {
    if (context.surface !== "archive") return null;
    return {
      kind: "action",
      identifier: "extractIntoMatter",
      label: countedLabel({
        verb: context.archiveIsDeleted ? "Restore" : "Extract",
        count,
        noun: FILE_NOUN,
        style: "demonstrative",
        suffix: "Into the Matter…",
      }),
      icon: ArchiveRestore,
      soonDependency: EXTRACTION_DEPENDENCY,
    };
  }

  /*
   * A folder with contents is deleted on its own, because the question it raises — keep what is
   * inside, or take it too — is asked once about one folder. Folded into a selection of twelve
   * rows there is no honest way to ask it, so the verb refuses and says which.
   */
  function deleteVerb(): RecordMenuAction | null {
    if (context.surface === "deletedFiles" || context.surface === "archive") return null;
    if (context.surface === "history" || context.surface === "fileAnalysis") return null;
    const fullFolders = folders.filter((record) => record.hasContents);
    return {
      kind: "action",
      identifier: "delete",
      label: countedLabel({ verb: "Delete", count, noun }),
      icon: Trash,
      ...(count > 1 && fullFolders.length > 0
        ? {
            disabledReason: `Folders with contents are deleted one at a time, so you can decide what happens to what's inside. Deselect ${fullFolders.map((record) => record.name).join(", ")}.`,
          }
        : {}),
    };
  }
}

// --- the menu the empty space opens ------------------------------------------------------------

/**
 * The menu over the list's empty space, which is a menu about the FOLDER rather than about a row.
 *
 * Every verb but the last one writes into the folder being looked at, so all of them are gated on
 * that folder existing. Selecting everything is not — it acts on what is on screen, which is true
 * of every view.
 */
export function folderRecordMenu(context: FileMenuContext): RecordMenuModel {
  const destination = context.surface === "browse" ? context.currentFolderName : null;
  const noDestination = destination === null ? { disabledReason: NO_CURRENT_FOLDER } : {};

  return menuOf([
    {
      identifier: "create",
      items: [
        {
          kind: "action",
          identifier: "newFolder",
          label: "New Folder",
          icon: FolderPlus,
          ...noDestination,
        },
        {
          kind: "action",
          identifier: "newDocument",
          label: "New Document",
          icon: FilePlus,
          ...noDestination,
        },
        { kind: "action", identifier: "upload", label: "Upload", icon: Upload, ...noDestination },
      ],
    },
    {
      identifier: "clipboard",
      items: [
        {
          kind: "action",
          identifier: "paste",
          label: "Paste",
          icon: Paste,
          shortcut: commandShortcut("v"),
          ...(destination === null
            ? { disabledReason: NO_CURRENT_FOLDER }
            : context.clipboard === null
              ? { disabledReason: NOTHING_ON_THE_CLIPBOARD }
              : {}),
        },
      ],
    },
    {
      identifier: "selection",
      items: [
        {
          kind: "action",
          identifier: "selectAll",
          label: "Select All",
          icon: ListCheck,
          shortcut: commandShortcut("a"),
        },
      ],
    },
  ]);
}
