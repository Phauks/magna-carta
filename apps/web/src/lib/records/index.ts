/*
 * What every record surface holds in common: the frame it is laid out in, the menu it is
 * right-clicked with, and the models that decide that menu.
 *
 * One menu serves every table in the product. It is here rather than beside any one of those tables
 * because the moment a second table wrote its own, the two would start disagreeing about what a
 * right-click offers — and that disagreement is invisible until somebody corrects one of them.
 *
 * A surface imports the component and the catalogue its records belong to. A surface that needs a
 * verb nobody has yet adds it to a catalogue here, where every table gets it at once.
 */
export { default as RecordMenu } from "./record-menu.svelte";
export { default as LedgerPanes } from "./ledger-panes.svelte";
export { default as PaneToggle } from "./pane-toggle.svelte";

export {
  countedLabel,
  commandShortcut,
  plainShortcut,
  shortcutKeycaps,
  shortcutMatches,
  menuOf,
  menuItem,
  menuItems,
  isEnabled,
  oneRecordGesture,
  sharedMark,
  markShared,
  DOCUMENT_NOUN,
  FILE_NOUN,
  FOLDER_NOUN,
  ITEM_NOUN,
  type CountStyle,
  type CountedLabelParts,
  type KeyboardShortcut,
  type KeystrokeDescription,
  type NounPair,
  type RecordMenuAction,
  type RecordMenuChoice,
  type RecordMenuFlyout,
  type RecordMenuGroup,
  type RecordMenuItem,
  type RecordMenuModel,
} from "./record-menu-model.ts";

export {
  fileRecordMenu,
  folderRecordMenu,
  menuTargets,
  pasteDestination,
  recordNoun,
  type FileMenuContext,
  type FileRecord,
  type FileSurface,
} from "./file-record-menu.ts";

export {
  ledgerRecordMenu,
  type LedgerMenuContext,
  type LedgerRecord,
} from "./ledger-record-menu.ts";

export {
  isTypingTarget,
  shortcutAction,
  type Keystroke,
  type KeystrokeSurroundings,
} from "./record-menu-shortcuts.ts";
