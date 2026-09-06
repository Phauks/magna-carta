// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { historyShortcuts } from "../src/lib/components/history/history-shortcuts.ts";
import {
  HistoryStack,
  type HistoryOutcome,
} from "../src/lib/components/history/history-stack.svelte.ts";

/*
 * The keyboard half: which presses the surface claims, which it lets through, and the one option
 * that decides whether a press inside a cell means the cell or the sheet. The happy-dom pragma is
 * here for one reason — the text-field question is answered with `closest`, so the target has to be
 * a real element rather than a shape that resembles one.
 */

interface PressOptions {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly target?: EventTarget | null;
}

/** A keyboard event stand-in, so the handler can be exercised without a document. */
function press(options: PressOptions): KeyboardEvent & { defaultPrevented: boolean } {
  const event = {
    key: options.key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    target: options.target ?? null,
    defaultPrevented: false,
    preventDefault(): void {
      (this as { defaultPrevented: boolean }).defaultPrevented = true;
    },
  };
  return event as unknown as KeyboardEvent & { defaultPrevented: boolean };
}

/** A promise the test releases when it wants the inverse to answer, for the in-flight cases. */
function held(): { promise: Promise<void>; release: () => void } {
  // Assigned synchronously by the executor below, which is why the assertion is sound.
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function stackWithOneStep(): { history: HistoryStack; undone: string[] } {
  const undone: string[] = [];
  const history = new HistoryStack();
  history.push({
    label: "the change",
    undo: () => {
      undone.push("undo");
    },
    redo: () => {
      undone.push("redo");
    },
  });
  return { history, undone };
}

describe("the history shortcuts", () => {
  it("walks back on Ctrl+Z and claims the press", async () => {
    const { history, undone } = stackWithOneStep();
    const handler = historyShortcuts(history);
    const event = press({ key: "z", ctrlKey: true });
    handler(event);
    await vi.waitFor(() => expect(undone).toEqual(["undo"]));
    expect(event.defaultPrevented).toBe(true);
  });

  it("takes Cmd+Z the same way, for the platform that spells it that way", async () => {
    const { history, undone } = stackWithOneStep();
    historyShortcuts(history)(press({ key: "z", metaKey: true }));
    await vi.waitFor(() => expect(undone).toEqual(["undo"]));
  });

  /*
   * Each press waits for the OUTCOME rather than for the log, because a walk still in flight
   * refuses the next press by design — the log is written inside the inverse, before the walk has
   * finished, so driving off it would race the guard rather than test the keys.
   */
  it("walks forward on both spellings of redo", async () => {
    const { history, undone } = stackWithOneStep();
    const outcomes: HistoryOutcome[] = [];
    const handler = historyShortcuts(history, { onOutcome: (outcome) => outcomes.push(outcome) });
    const pressed = async (event: KeyboardEvent): Promise<void> => {
      const seen = outcomes.length;
      handler(event);
      await vi.waitFor(() => expect(outcomes.length).toBe(seen + 1));
    };

    await pressed(press({ key: "z", ctrlKey: true }));
    expect(undone).toEqual(["undo"]);
    await pressed(press({ key: "z", ctrlKey: true, shiftKey: true }));
    expect(undone).toEqual(["undo", "redo"]);
    await pressed(press({ key: "z", ctrlKey: true }));
    expect(undone).toEqual(["undo", "redo", "undo"]);
    await pressed(press({ key: "y", ctrlKey: true }));
    expect(undone).toEqual(["undo", "redo", "undo", "redo"]);
  });

  it("drops a press that lands while a walk is still in flight, rather than interleaving", async () => {
    const inverse = held();
    const walked: string[] = [];
    const history = new HistoryStack();
    history.push({
      label: "the slow one",
      undo: () => {
        walked.push("undo");
        return inverse.promise;
      },
      redo: () => {},
    });
    const outcomes: HistoryOutcome[] = [];
    const handler = historyShortcuts(history, { onOutcome: (outcome) => outcomes.push(outcome) });

    handler(press({ key: "z", ctrlKey: true }));
    await vi.waitFor(() => expect(walked).toEqual(["undo"]));
    handler(press({ key: "z", ctrlKey: true }));
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]?.moved).toBe(0);

    inverse.release();
    await vi.waitFor(() => expect(outcomes).toHaveLength(2));
    expect(walked).toEqual(["undo"]);
  });

  it("lets every press it does not claim through untouched", () => {
    const { history, undone } = stackWithOneStep();
    const handler = historyShortcuts(history);
    for (const event of [
      press({ key: "z" }),
      press({ key: "s", ctrlKey: true }),
      press({ key: "z", ctrlKey: true, altKey: true }),
    ]) {
      handler(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(undone).toEqual([]);
  });

  it("reaches inside a text field by default — on a grid the cell is not the surface", async () => {
    const { history, undone } = stackWithOneStep();
    historyShortcuts(history)(
      press({ key: "z", ctrlKey: true, target: document.createElement("input") }),
    );
    await vi.waitFor(() => expect(undone).toEqual(["undo"]));
  });

  it("hands the press back to the platform inside a text field when the surface yields", () => {
    const { history, undone } = stackWithOneStep();
    const event = press({ key: "z", ctrlKey: true, target: document.createElement("textarea") });
    historyShortcuts(history, { insideTextFields: "yield" })(event);
    expect(event.defaultPrevented).toBe(false);
    expect(undone).toEqual([]);
  });

  it("finds the field a press came from even when the target is inside one", () => {
    const { history, undone } = stackWithOneStep();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.append(inner);
    const event = press({ key: "z", ctrlKey: true, target: inner });
    historyShortcuts(history, { insideTextFields: "yield" })(event);
    expect(event.defaultPrevented).toBe(false);
    expect(undone).toEqual([]);
  });

  it("still claims a press outside any field when the surface yields inside them", async () => {
    const { history, undone } = stackWithOneStep();
    historyShortcuts(history, { insideTextFields: "yield" })(
      press({ key: "z", ctrlKey: true, target: document.createElement("div") }),
    );
    await vi.waitFor(() => expect(undone).toEqual(["undo"]));
  });

  it("hands the outcome on once the inverse has answered, never when the key was pressed", async () => {
    const outcomes: HistoryOutcome[] = [];
    const { history } = stackWithOneStep();
    historyShortcuts(history, { onOutcome: (outcome) => outcomes.push(outcome) })(
      press({ key: "z", ctrlKey: true }),
    );
    expect(outcomes).toEqual([]);
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]?.moved).toBe(1);
    expect(outcomes[0]?.label).toBe("the change");
  });
});
