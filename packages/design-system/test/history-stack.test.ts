import { describe, expect, it, vi } from "vitest";
import {
  historyAnnouncement,
  HistoryStack,
  irreversibleAnnouncement,
  STEPS_KEPT,
  type HistoryStep,
} from "../src/lib/components/history/history-stack.svelte.ts";

/*
 * The stack, pinned where a rendered control cannot show it: that a step moves only once its
 * inverse has answered, that a failure leaves it where a reader can try again, that the two sides
 * together stay bounded however far they are walked, and that nothing is announced about a change
 * that did not happen.
 */

/** A step that records the order its commands ran in, so a walk can be read back. */
function tracked(label: string, log: string[]): HistoryStep {
  return {
    label,
    undo: () => {
      log.push(`undo:${label}`);
    },
    redo: () => {
      log.push(`redo:${label}`);
    },
  };
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

function refusing(label: string, error: unknown = new Error("the write refused")): HistoryStep {
  return {
    label,
    undo: () => Promise.reject(error),
    redo: () => Promise.reject(error),
  };
}

describe("the history stack", () => {
  it("offers nothing until something is pushed", () => {
    const history = new HistoryStack();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoTitle).toBe("Nothing to undo yet");
    expect(history.redoTitle).toBe("Nothing to redo");
  });

  it("says what pressing will do, rather than wearing a bare arrow", () => {
    const history = new HistoryStack();
    history.push(tracked("moving 3 files to Discovery", []));
    expect(history.undoTitle).toBe("Undo moving 3 files to Discovery");
    expect(history.undoStackTitle).toBe("Show the last 1 change and walk back through them");
  });

  it("walks back through the steps newest first, and forward again in the same order", async () => {
    const log: string[] = [];
    const history = new HistoryStack();
    history.push(tracked("first", log));
    history.push(tracked("second", log));

    await history.undo(2);
    expect(log).toEqual(["undo:second", "undo:first"]);
    expect(history.canUndo).toBe(false);
    expect(history.redoLabels).toEqual(["first", "second"]);

    await history.redo(2);
    expect(log).toEqual(["undo:second", "undo:first", "redo:first", "redo:second"]);
    expect(history.undoLabels).toEqual(["second", "first"]);
  });

  it("lists the steps newest first, which is the order the dropdown offers them in", () => {
    const history = new HistoryStack();
    history.push(tracked("first", []));
    history.push(tracked("second", []));
    history.push(tracked("third", []));
    expect(history.undoLabels).toEqual(["third", "second", "first"]);
  });

  it("drops the redo branch when a new act is recorded — what was ahead is not ahead of this", async () => {
    const history = new HistoryStack();
    history.push(tracked("first", []));
    await history.undo();
    expect(history.canRedo).toBe(true);

    history.push(tracked("second", []));
    expect(history.canRedo).toBe(false);
    expect(history.redoLabels).toEqual([]);
  });

  it("moves a step only once its inverse has answered", async () => {
    const inverse = held();
    const history = new HistoryStack();
    history.push({ label: "the slow one", undo: () => inverse.promise, redo: () => {} });

    const walking = history.undo();
    expect(history.running).toBe(true);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);

    inverse.release();
    const outcome = await walking;
    expect(outcome.moved).toBe(1);
    expect(history.canRedo).toBe(true);
  });

  it("leaves a refusing step on the stack, so pressing again retries the same act", async () => {
    const history = new HistoryStack();
    history.push(tracked("the one beneath", []));
    history.push(refusing("the one that refuses"));

    const outcome = await history.undo();
    expect(outcome.moved).toBe(0);
    expect(outcome.failure?.label).toBe("the one that refuses");
    expect(history.nextUndoLabel).toBe("the one that refuses");
    expect(history.canRedo).toBe(false);
  });

  it("stops a multi-step walk at the refusal and reports what did move", async () => {
    const log: string[] = [];
    const history = new HistoryStack();
    history.push(tracked("first", log));
    history.push(refusing("second"));
    history.push(tracked("third", log));

    const outcome = await history.undo(3);
    expect(log).toEqual(["undo:third"]);
    expect(outcome.moved).toBe(1);
    expect(outcome.label).toBe("third");
    expect(outcome.failure?.label).toBe("second");
    expect(history.nextUndoLabel).toBe("second");
  });

  it("refuses a second walk while one is in flight rather than interleaving them", async () => {
    const inverse = held();
    const history = new HistoryStack();
    history.push({ label: "the slow one", undo: () => inverse.promise, redo: () => {} });

    const walking = history.undo();
    const refused = await history.undo();
    expect(refused.moved).toBe(0);
    expect(refused.failure).toBeNull();

    inverse.release();
    expect((await walking).moved).toBe(1);
  });

  it("walks as far as it can and no further when asked for more steps than it holds", async () => {
    const log: string[] = [];
    const history = new HistoryStack();
    history.push(tracked("only", log));
    const outcome = await history.undo(5);
    expect(outcome.moved).toBe(1);
    expect(log).toEqual(["undo:only"]);
  });

  it("drops the oldest step past the bound rather than growing without limit", () => {
    const history = new HistoryStack();
    for (let index = 0; index < STEPS_KEPT + 5; index += 1) {
      history.push(tracked(`step ${String(index)}`, []));
    }
    expect(history.undoLabels).toHaveLength(STEPS_KEPT);
    expect(history.undoLabels.at(-1)).toBe("step 5");
  });

  it("keeps the two sides bounded together however far they are walked", async () => {
    const history = new HistoryStack();
    for (let index = 0; index < STEPS_KEPT; index += 1) {
      history.push(tracked(`step ${String(index)}`, []));
    }
    await history.undo(STEPS_KEPT);
    await history.redo(STEPS_KEPT);
    expect(history.undoLabels).toHaveLength(STEPS_KEPT);
    expect(history.undoLabels.at(-1)).toBe("step 0");
  });

  it("forgets everything on a clear, for a surface that has been re-read", async () => {
    const history = new HistoryStack();
    history.push(tracked("first", []));
    await history.undo();
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});

describe("what a walk announces", () => {
  it("says nothing at all about a walk that moved nothing", () => {
    expect(
      historyAnnouncement({ direction: "undo", moved: 0, label: null, failure: null }),
    ).toBeNull();
  });

  it("names the one step it walked back", () => {
    expect(
      historyAnnouncement({ direction: "undo", moved: 1, label: "the rename", failure: null }),
    ).toBe("Undid the rename.");
  });

  it("counts a longer walk and names where it stopped", () => {
    expect(
      historyAnnouncement({ direction: "undo", moved: 3, label: "the first move", failure: null }),
    ).toBe("Undid 3 steps, back through the first move.");
    expect(
      historyAnnouncement({ direction: "redo", moved: 2, label: "the rename", failure: null }),
    ).toBe("Redid 2 steps, up through the rename.");
  });

  it("speaks on a failure even when nothing moved, because the reader pressed something", () => {
    expect(
      historyAnnouncement({
        direction: "undo",
        moved: 0,
        label: null,
        failure: { label: "the move", error: new Error("refused") },
      }),
    ).toBe("the move could not be undone. Nothing changed.");
  });

  it("says both halves when a walk moved and then stopped", () => {
    expect(
      historyAnnouncement({
        direction: "undo",
        moved: 2,
        label: "the rename",
        failure: { label: "the move", error: new Error("refused") },
      }),
    ).toBe("Undid 2 steps and stopped: the move could not be undone.");
  });
});

describe("what an act the stack cannot reach says", () => {
  it("names where the repair lives when there is one", () => {
    expect(
      irreversibleAnnouncement({
        what: "The entry was voided. It stays on the record and counts toward nothing.",
        repair: "restore it from the ledger or the record window.",
      }),
    ).toBe(
      "The entry was voided. It stays on record but doesn't count. Undo can't reverse this; restore it from the ledger or the entry window.",
    );
  });

  it("stops at the truth when there is no repair, rather than inventing one", () => {
    expect(irreversibleAnnouncement({ what: "The records were merged." })).toBe(
      "The records were merged. Undo does not reach it.",
    );
  });
});

describe("the failure a step throws", () => {
  it("is handed back untouched, for the surface's own failure surface to report", async () => {
    const error = { errorId: "error_01" };
    const history = new HistoryStack();
    history.push(refusing("the move", error));
    const outcome = await history.undo();
    expect(outcome.failure?.error).toBe(error);
  });

  it("does not reach the console — reporting is the surface's, through its own pipeline", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const history = new HistoryStack();
    history.push(refusing("the move"));
    await history.undo();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
