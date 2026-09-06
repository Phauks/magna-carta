/*
 * The component and, for convenience, everything it is built on.
 *
 * A module with no Svelte in it reaches for the leaf paths instead — `history-stack` and
 * `history-shortcuts` — because importing the CONTROL drags its whole component tree along, and a
 * plain module that does so stops loading anywhere a Svelte transform is not in play.
 */
import UndoRedoControls from "./undo-redo-controls.svelte";

export {
  historyAnnouncement,
  HistoryStack,
  irreversibleAnnouncement,
  STEPS_KEPT,
} from "./history-stack.svelte.ts";
export type { HistoryFailure, HistoryOutcome, HistoryStep } from "./history-stack.svelte.ts";
export { historyShortcuts } from "./history-shortcuts.ts";
export type { HistoryShortcutOptions } from "./history-shortcuts.ts";
export { UndoRedoControls };
export default UndoRedoControls;
