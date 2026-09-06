/*
 * The keyboard half of the stack: Ctrl+Z, Ctrl+Y and Shift+Ctrl+Z, in one place.
 *
 * IT IS A HANDLER, NOT A GLOBAL LISTENER. The surface that owns the stack attaches it to its own
 * element, so a second surface with a stack of its own cannot receive the first one's keys. A
 * window-level listener would have to guess which stack a press meant, and it would guess wrong the
 * first time two surfaces were on screen together.
 *
 * IT REACHES INSIDE TEXT FIELDS BY DEFAULT, which is deliberate and is what both surfaces that
 * already have a stack do. On a rapid-entry grid the cell is not the surface — a reader who has
 * typed into six cells and presses Ctrl+Z means the sheet, not the caret. Where a surface is a long
 * text field with a real native history of its own, `insideTextFields: "yield"` hands the press
 * back to the platform.
 */
import type { HistoryOutcome, HistoryStack } from "./history-stack.svelte.ts";

/** Elements whose own undo the platform provides, for a surface that chooses to yield to it. */
const TEXT_FIELD_SELECTOR = "input, textarea, [contenteditable]:not([contenteditable='false'])";

export interface HistoryShortcutOptions {
  /**
   * Whether a press inside a text field reaches the stack (`"reach"`, the default) or is left to
   * the platform's own field-level undo (`"yield"`).
   */
  readonly insideTextFields?: "reach" | "yield";
  /** Told what the walk did, once the inverses have answered. The surface announces; this does not. */
  readonly onOutcome?: (outcome: HistoryOutcome) => void;
}

/**
 * The keydown handler for a surface that owns a stack.
 *
 * It acts only on a press it recognises, and only then does it call `preventDefault` — every other
 * key passes through untouched, including the modified presses this surface does not claim.
 */
export function historyShortcuts(
  history: HistoryStack,
  options: HistoryShortcutOptions = {},
): (event: KeyboardEvent) => void {
  const yieldsToFields = options.insideTextFields === "yield";
  return (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const pressed = event.key.toLowerCase();
    const direction =
      pressed === "z" ? (event.shiftKey ? "redo" : "undo") : pressed === "y" ? "redo" : null;
    if (direction === null) return;
    if (yieldsToFields && isTextField(event.target)) return;
    event.preventDefault();
    void (direction === "undo" ? history.undo(1) : history.redo(1)).then((outcome) => {
      options.onOutcome?.(outcome);
    });
  };
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_FIELD_SELECTOR) !== null;
}
