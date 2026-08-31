/*
 * Undo and redo on the Time Sheet.
 *
 * A rapid-entry grid is a surface where a wrong keystroke costs real work, so every change that
 * touches the rows pushes the rows as they were, under a label saying what the change WAS. The
 * label is the whole point of keeping a stack rather than a single last-state: the control does one
 * step, and its dropdown lists the steps so several can be seen and walked back through at once.
 *
 * THE STACK IS BOUNDED, AND SAYS SO BY ITS BEHAVIOUR. Older steps fall off the end rather than
 * growing without limit, because a session that has been open all day should not be holding every
 * intermediate state of every row in memory.
 *
 * UNDO DOES NOT REWIND THE RECORD'S HISTORY. Putting a row back the way it was is itself a change
 * the firm made, and the audit records it as one. This module restores the sheet; it never claims
 * the change did not happen.
 *
 * The snapshot type is the caller's. This module knows only that a snapshot can be taken, held and
 * put back, which is what lets it be tested without a row anywhere near it.
 */

/** One reversible step: what it was, and the state to go back to. */
interface HistoryStep<TSnapshot> {
  readonly label: string;
  readonly snapshot: TSnapshot;
}

/** How many steps are kept before the oldest falls off the end. */
const STEPS_KEPT = 40;

export class SheetHistory<TSnapshot> {
  #undo = $state<readonly HistoryStep<TSnapshot>[]>([]);
  #redo = $state<readonly HistoryStep<TSnapshot>[]>([]);

  /** Take the snapshot the stack puts back. Supplied by the caller so nothing is copied twice. */
  readonly #take: () => TSnapshot;
  /** Put a snapshot back. */
  readonly #restore: (snapshot: TSnapshot) => void;

  constructor(take: () => TSnapshot, restore: (snapshot: TSnapshot) => void) {
    this.#take = take;
    this.#restore = restore;
  }

  /**
   * Record what the sheet looked like BEFORE a change, under the name of that change.
   *
   * Called before the change lands, never after: the stack holds the state to return to, and a
   * snapshot taken afterwards would return the reader to where they already are.
   */
  push(label: string): void {
    this.#undo = [...this.#undo, { label, snapshot: this.#take() }].slice(-STEPS_KEPT);
    this.#redo = [];
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** The steps the undo dropdown lists, newest first. */
  get undoLabels(): readonly string[] {
    return this.#undo.map((step) => step.label).toReversed();
  }

  /** The steps the redo dropdown lists, next first. */
  get redoLabels(): readonly string[] {
    return this.#redo.map((step) => step.label).toReversed();
  }

  /**
   * Walk back a number of steps, and say what was walked back through.
   *
   * Null means nothing moved, which is what the caller needs to know before it says anything: an
   * announcement about a change that did not happen is worse than silence.
   */
  undo(steps = 1): { readonly label: string; readonly steps: number } | null {
    let label: string | null = null;
    let walked = 0;
    for (let index = 0; index < steps; index += 1) {
      const top = this.#undo.at(-1);
      if (top === undefined) break;
      this.#undo = this.#undo.slice(0, -1);
      this.#redo = [...this.#redo, { label: top.label, snapshot: this.#take() }];
      this.#restore(top.snapshot);
      label = top.label;
      walked += 1;
    }
    return label === null ? null : { label, steps: walked };
  }

  /** Walk forward through what was undone, on the same terms. */
  redo(steps = 1): { readonly label: string; readonly steps: number } | null {
    let label: string | null = null;
    let walked = 0;
    for (let index = 0; index < steps; index += 1) {
      const top = this.#redo.at(-1);
      if (top === undefined) break;
      this.#redo = this.#redo.slice(0, -1);
      this.#undo = [...this.#undo, { label: top.label, snapshot: this.#take() }];
      this.#restore(top.snapshot);
      label = top.label;
      walked += 1;
    }
    return label === null ? null : { label, steps: walked };
  }

  /** Forget everything, for a sheet that has been re-read from the server. */
  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }

  /** What the undo control's hover says, whether or not there is anything to undo. */
  get undoTitle(): string {
    return this.canUndo ? "Undo one step" : "Nothing to undo";
  }

  get redoTitle(): string {
    return this.canRedo ? "Redo one step" : "Nothing to redo";
  }

  /** What the undo dropdown's hover says. */
  get undoStackTitle(): string {
    const count = this.#undo.length;
    if (count === 0) return "Nothing to undo yet";
    return `Show the last ${String(count)} ${count === 1 ? "change" : "changes"} and jump back through them`;
  }

  get redoStackTitle(): string {
    const count = this.#redo.length;
    if (count === 0) return "Nothing to redo yet";
    return `Show the ${String(count)} undone ${count === 1 ? "change" : "changes"} and jump forward through them`;
  }
}

/** What an undo or a redo announces once it has actually moved something. */
export function historyAnnouncement(
  direction: "Undid" | "Redid",
  outcome: { readonly label: string; readonly steps: number },
): string {
  if (outcome.steps === 1) return `${direction} ${outcome.label}.`;
  const through = direction === "Undid" ? "back through" : "up through";
  return `${direction} ${String(outcome.steps)} steps, ${through} ${outcome.label}.`;
}
