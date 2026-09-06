/*
 * The undo and redo stack every surface with reversible gestures shares.
 *
 * A STEP IS A COMMAND WITH AN INVERSE, NEVER A SNAPSHOT. A snapshot restores a screen; an inverse
 * restores the record, which is what a reader means by undo. The difference is not academic: a
 * snapshot cannot say which fields moved, so putting one back means writing every row on the
 * surface — over rows the step never touched, and over whatever somebody changed in another window
 * meanwhile. An inverse writes back exactly what the act wrote.
 *
 * A STEP EXISTS ONLY WHERE ITS INVERSE IS REAL. The surface decides what to push, and the answer
 * is a property of the act rather than of the screen: a deletion that has a restore is steppable, a
 * void that has its own separate repair is not, and a merge is not reversible at all. What is
 * refused is refused OUT LOUD — `irreversibleAnnouncement` is the sentence for it, and it names
 * where the repair lives, because "undo does not reach this" is only half an answer when the other
 * half exists.
 *
 * THE ANNOUNCEMENT FOLLOWS THE INVERSE, NEVER THE POP. `undo` answers once the writes have
 * answered, and a failure leaves the step where it was: on the stack, still offered, with the
 * failure named. A stack that says a change went back before the write agreed has told the reader
 * something untrue about their record, which is worse than having no stack.
 *
 * UNDO DOES NOT REWIND THE RECORD'S HISTORY. Putting something back is itself a change the firm
 * made, and the audit records it as one. This module restores state; it never claims the change did
 * not happen.
 *
 * THE STACK IS BOUNDED, AND ONE PERSON'S. Older steps fall off the end rather than growing without
 * limit, and it is cleared by anything that could change what a step means — a re-read from the
 * server, a surface unmounting. It does not survive a reload: an inverse held across one would
 * promise more than it can honour once the subject may have moved, and putting a record back a day
 * later is the record's own repair rather than this stack's.
 */

/** How many steps are kept before the oldest falls off the end. */
export const STEPS_KEPT = 40;

/**
 * One reversible act: what it was, and the two commands that walk it back and forward.
 *
 * The label is what the control says, and it completes the sentence "Undo …" — so it is the act in
 * lower case and without a full stop ("moving 3 files to Discovery", "the description on line 4").
 * A bare "Undo" is never enough: a reader who moved five things needs to know which one is next.
 */
export interface HistoryStep {
  readonly label: string;
  readonly undo: () => void | Promise<void>;
  readonly redo: () => void | Promise<void>;
}

/** The step that refused, and what it threw. The surface reports the error through its own failure surface. */
export interface HistoryFailure {
  readonly label: string;
  readonly error: unknown;
}

/**
 * What a walk actually did.
 *
 * `moved` counts the steps whose inverse ANSWERED, so it is the number a reader can be told about.
 * `failure` is the step that stopped the walk, and it is still on the stack when this returns.
 */
export interface HistoryOutcome {
  readonly direction: "undo" | "redo";
  readonly moved: number;
  readonly label: string | null;
  readonly failure: HistoryFailure | null;
}

export class HistoryStack {
  #undoable = $state<readonly HistoryStep[]>([]);
  #redoable = $state<readonly HistoryStep[]>([]);
  /** A walk is in flight. A second one is refused rather than interleaved with it. */
  #running = $state(false);

  /**
   * Record a reversible act, under the name of that act.
   *
   * A new act invalidates the redo branch: what was ahead is not ahead of this any more.
   */
  push(step: HistoryStep): void {
    this.#undoable = [...this.#undoable, step].slice(-STEPS_KEPT);
    this.#redoable = [];
  }

  /*
   * Only `push` grows the stack. A walk MOVES a step from one side to the other, so the two sides
   * together never exceed what push already trimmed to — which is why neither walk trims, and why
   * walking back and forth cannot quietly drop the step at the far end.
   */

  get canUndo(): boolean {
    return this.#undoable.length > 0 && !this.#running;
  }

  get canRedo(): boolean {
    return this.#redoable.length > 0 && !this.#running;
  }

  /** A walk is in flight, so the controls are held rather than offered twice. */
  get running(): boolean {
    return this.#running;
  }

  /** The steps the undo dropdown lists, newest first. */
  get undoLabels(): readonly string[] {
    return this.#undoable.map((step) => step.label).toReversed();
  }

  /** The steps the redo dropdown lists, next first. */
  get redoLabels(): readonly string[] {
    return this.#redoable.map((step) => step.label).toReversed();
  }

  /** What one press of Undo would reverse, for the control's own words. */
  get nextUndoLabel(): string | null {
    return this.#undoable.at(-1)?.label ?? null;
  }

  get nextRedoLabel(): string | null {
    return this.#redoable.at(-1)?.label ?? null;
  }

  /** Walk back a number of steps, and say what actually moved. */
  undo(steps = 1): Promise<HistoryOutcome> {
    return this.#walk("undo", steps);
  }

  /** Walk forward through what was undone, on the same terms. */
  redo(steps = 1): Promise<HistoryOutcome> {
    return this.#walk("redo", steps);
  }

  async #walk(direction: "undo" | "redo", steps: number): Promise<HistoryOutcome> {
    if (this.#running) return { direction, moved: 0, label: null, failure: null };
    this.#running = true;
    let moved = 0;
    let label: string | null = null;
    let failure: HistoryFailure | null = null;
    try {
      // Strictly one at a time, and deliberately so: the inverses are ordered, each undoes an act
      // that landed after the one beneath it, and running them together would write them back in
      // whatever order the server answered.
      for (let index = 0; index < steps; index += 1) {
        const top = (direction === "undo" ? this.#undoable : this.#redoable).at(-1);
        if (top === undefined) break;
        try {
          await (direction === "undo" ? top.undo() : top.redo());
        } catch (error) {
          // The step stays where it was. A reader who presses Undo again gets another attempt at
          // the same act rather than the one beneath it, which is what they asked for.
          failure = { label: top.label, error };
          break;
        }
        if (direction === "undo") {
          this.#undoable = this.#undoable.slice(0, -1);
          this.#redoable = [...this.#redoable, top];
        } else {
          this.#redoable = this.#redoable.slice(0, -1);
          this.#undoable = [...this.#undoable, top];
        }
        moved += 1;
        label = top.label;
      }
    } finally {
      this.#running = false;
    }
    return { direction, moved, label, failure };
  }

  /** Forget everything — after a re-read that could change what a step means, or on unmount. */
  clear(): void {
    this.#undoable = [];
    this.#redoable = [];
  }

  /** What the undo control's hover and accessible name say: what pressing it will do. */
  get undoTitle(): string {
    const label = this.nextUndoLabel;
    return label === null ? "Nothing to undo yet" : `Undo ${label}`;
  }

  get redoTitle(): string {
    const label = this.nextRedoLabel;
    return label === null ? "Nothing to redo" : `Redo ${label}`;
  }

  /** What the undo dropdown's hover says, whether or not there is anything in it. */
  get undoStackTitle(): string {
    const count = this.#undoable.length;
    if (count === 0) return "Nothing to undo yet";
    return `Show the last ${String(count)} ${count === 1 ? "change" : "changes"} and walk back through them`;
  }

  get redoStackTitle(): string {
    const count = this.#redoable.length;
    if (count === 0) return "Nothing to redo";
    return `Show the ${String(count)} undone ${count === 1 ? "change" : "changes"} and walk forward through them`;
  }
}

/**
 * What a walk announces, or null when there is nothing to say.
 *
 * Null is the answer to a walk that moved nothing and failed at nothing — an announcement about a
 * change that did not happen is worse than silence. A failure always speaks, because the reader
 * pressed something and needs to know the record did not move.
 */
export function historyAnnouncement(outcome: HistoryOutcome): string | null {
  const undoing = outcome.direction === "undo";
  const verb = undoing ? "Undid" : "Redid";
  if (outcome.failure !== null) {
    const stopped = `${outcome.failure.label} could not be ${undoing ? "undone" : "redone"}.`;
    if (outcome.moved === 0) return `${stopped} Nothing changed.`;
    const walked = `${verb} ${String(outcome.moved)} ${outcome.moved === 1 ? "step" : "steps"}`;
    return `${walked} and stopped: ${stopped}`;
  }
  if (outcome.moved === 0 || outcome.label === null) return null;
  if (outcome.moved === 1) return `${verb} ${outcome.label}.`;
  const through = undoing ? "back through" : "up through";
  return `${verb} ${String(outcome.moved)} steps, ${through} ${outcome.label}.`;
}

/**
 * What an act the stack cannot reach says at the moment it happens.
 *
 * Both halves of the truth, in one sentence: undo will not reach this, and — where one exists —
 * where the repair that does reach it lives. A surface that offers a step and then announces a
 * reversal that never ran is the worse failure, because the reader believes the record went back.
 *
 * `what` states what just happened and ends with a full stop; `repair` names the other gesture and
 * ends with one too.
 */
export function irreversibleAnnouncement(input: {
  readonly what: string;
  readonly repair?: string;
}): string {
  const reach = "Undo does not reach it";
  return input.repair === undefined
    ? `${input.what} ${reach}.`
    : `${input.what} ${reach}: ${input.repair}`;
}
