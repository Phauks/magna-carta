/*
 * Undo and redo for MOVEMENT — moves between folders, drag-and-drop, cut-and-paste. Every move on
 * this surface funnels through one recorded act, so each is undoable the same way and the control
 * can say what pressing it will undo rather than offering a bare arrow.
 *
 * Deliberately movement only. A delete is already recoverable through Deleted Files, and a rename
 * that undid itself while somebody was still typing the next one would be worse than no undo at
 * all. What is here is the class of act that is easy to perform by accident with a pointer.
 */

/** One move, as it is recorded: what moved, from where, to where. */
export interface RecordedMove {
  /** What the control says: "Undo moving 3 files to Discovery". */
  readonly description: string;
  /** Row keys that moved, in the order they were moved. */
  readonly keys: readonly string[];
  /** Where each key came from, so undoing puts every one back where it actually was. */
  readonly origins: ReadonlyMap<string, string | null>;
  readonly destinationFolderId: string | null;
}

export class MoveHistory {
  private readonly undoable: RecordedMove[] = [];
  private readonly redoable: RecordedMove[] = [];

  record(move: RecordedMove): void {
    this.undoable.push(move);
    // A new act invalidates the redo branch: what was ahead is not ahead of this any more.
    this.redoable.length = 0;
  }

  get canUndo(): boolean {
    return this.undoable.length > 0;
  }

  get canRedo(): boolean {
    return this.redoable.length > 0;
  }

  /** What Undo would reverse, for the control's own words. */
  get nextUndo(): RecordedMove | null {
    return this.undoable.at(-1) ?? null;
  }

  get nextRedo(): RecordedMove | null {
    return this.redoable.at(-1) ?? null;
  }

  /*
   * THE STACK IS READABLE, newest first. One step at a time is the button's job; a reader who
   * moved five things and wants the lot back should be able to see the five and choose, rather
   * than pressing Undo repeatedly and watching to see where it stops.
   */
  get undoDescriptions(): readonly string[] {
    return this.undoable.map((move) => move.description).toReversed();
  }

  get redoDescriptions(): readonly string[] {
    return this.redoable.map((move) => move.description).toReversed();
  }

  /** Pop the move to reverse. The caller performs the reversal and reports nothing back. */
  takeUndo(): RecordedMove | null {
    const move = this.undoable.pop();
    if (move === undefined) return null;
    this.redoable.push(move);
    return move;
  }

  takeRedo(): RecordedMove | null {
    const move = this.redoable.pop();
    if (move === undefined) return null;
    this.undoable.push(move);
    return move;
  }

  /** Nothing to undo any more — after a re-read that could have changed what a key means. */
  clear(): void {
    this.undoable.length = 0;
    this.redoable.length = 0;
  }
}

/** The words the Undo control wears. Never a bare "Undo": it says what it will undo. */
export function undoTitle(move: RecordedMove | null): string {
  return move === null ? "Nothing to undo yet" : `Undo ${move.description}`;
}

export function redoTitle(move: RecordedMove | null): string {
  return move === null ? "Nothing to redo" : `Redo ${move.description}`;
}
