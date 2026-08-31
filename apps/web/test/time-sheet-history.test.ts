/*
 * Undo and redo on the Time Sheet.
 *
 * The stack holds the state to RETURN to, under the name of the change that left it behind, which
 * is what lets one control do one step while its list offers several at once. The snapshot type is
 * the caller's, so this exercises it over a plain value rather than over a row.
 *
 * The stack over a plain value proves the ORDERING rules and nothing about the sheet. That the real
 * restore puts row values back and writes them through is proved where it actually happens, over
 * the store, in time-sheet-store.test.ts.
 */
import { describe, expect, it } from "vitest";
import { SheetHistory, historyAnnouncement } from "../src/lib/time/time-sheet-history.svelte.ts";

/** A stack over one held value, which is enough to prove every ordering rule. */
function stackOver(initial: string): {
  history: SheetHistory<string>;
  current: () => string;
  change: (label: string, next: string) => void;
} {
  let held = initial;
  const history = new SheetHistory<string>(
    () => held,
    (snapshot) => {
      held = snapshot;
    },
  );
  return {
    history,
    current: () => held,
    change: (label, next) => {
      history.push(label);
      held = next;
    },
  };
}

describe("a stack with nothing on it", () => {
  it("offers nothing, and says so rather than looking available", () => {
    const { history } = stackOver("a");
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoTitle).toBe("Nothing to undo");
    expect(history.redoStackTitle).toBe("Nothing to redo yet");
  });

  it("answers nothing rather than announcing a change that did not happen", () => {
    const { history } = stackOver("a");
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });
});

describe("walking back", () => {
  it("puts the value back the way it was, and names the change", () => {
    const sheet = stackOver("a");
    sheet.change("the description on this entry", "b");
    const outcome = sheet.history.undo();
    expect(sheet.current()).toBe("a");
    expect(outcome).toEqual({ label: "the description on this entry", steps: 1 });
  });

  it("walks several steps at once and reports how far it got", () => {
    const sheet = stackOver("a");
    sheet.change("one", "b");
    sheet.change("two", "c");
    sheet.change("three", "d");
    const outcome = sheet.history.undo(2);
    expect(sheet.current()).toBe("b");
    expect(outcome).toEqual({ label: "two", steps: 2 });
  });

  it("stops at the bottom rather than refusing the whole ask", () => {
    const sheet = stackOver("a");
    sheet.change("one", "b");
    const outcome = sheet.history.undo(5);
    expect(sheet.current()).toBe("a");
    expect(outcome).toEqual({ label: "one", steps: 1 });
  });
});

describe("walking forward again", () => {
  it("returns to where the undo came from", () => {
    const sheet = stackOver("a");
    sheet.change("one", "b");
    sheet.history.undo();
    sheet.history.redo();
    expect(sheet.current()).toBe("b");
  });

  it("is thrown away by a new change, because that future no longer exists", () => {
    const sheet = stackOver("a");
    sheet.change("one", "b");
    sheet.history.undo();
    expect(sheet.history.canRedo).toBe(true);
    sheet.change("something else", "z");
    expect(sheet.history.canRedo).toBe(false);
  });
});

describe("the list the control's dropdown shows", () => {
  it("puts the newest change first, so the first row is the one step", () => {
    const sheet = stackOver("a");
    sheet.change("one", "b");
    sheet.change("two", "c");
    expect(sheet.history.undoLabels).toEqual(["two", "one"]);
  });

  it("does not mutate the stack by being read", () => {
    const sheet = stackOver("a");
    sheet.change("one", "b");
    sheet.change("two", "c");
    expect(sheet.history.undoLabels).toEqual(["two", "one"]);
    expect(sheet.history.undoLabels).toEqual(["two", "one"]);
  });

  it("counts what it is offering on its hover", () => {
    const sheet = stackOver("a");
    sheet.change("one", "b");
    expect(sheet.history.undoStackTitle).toContain("last 1 change");
    sheet.change("two", "c");
    expect(sheet.history.undoStackTitle).toContain("last 2 changes");
  });
});

describe("what the sheet says once something has actually moved", () => {
  it("names one step by its own label", () => {
    expect(historyAnnouncement("Undid", { label: "the duration on this entry", steps: 1 })).toBe(
      "Undid the duration on this entry.",
    );
  });

  it("says which direction several steps went", () => {
    expect(historyAnnouncement("Undid", { label: "one", steps: 3 })).toContain("back through one");
    expect(historyAnnouncement("Redid", { label: "one", steps: 3 })).toContain("up through one");
  });
});

describe("the bound on how far back the stack goes", () => {
  /*
   * The bound was documented and unasserted: it could be set to four or to no bound at all and
   * nothing failed. It is a real behaviour — a session open all day must not hold every
   * intermediate state of every row — so it is pinned by its consequences rather than by reading
   * the constant back.
   */
  it("keeps forty steps and no more", () => {
    const sheet = stackOver("start");
    for (let index = 0; index < 45; index += 1)
      sheet.change(`step ${String(index)}`, `v${String(index)}`);

    expect(sheet.history.undoLabels).toHaveLength(40);
  });

  it("drops the OLDEST steps, so the newest forty are the ones kept", () => {
    const sheet = stackOver("start");
    for (let index = 0; index < 45; index += 1)
      sheet.change(`step ${String(index)}`, `v${String(index)}`);

    const labels = sheet.history.undoLabels;
    expect(labels[0]).toBe("step 44");
    expect(labels.at(-1)).toBe("step 5");
    expect(labels).not.toContain("step 4");
  });

  it("walks back exactly as far as it kept, and stops there", () => {
    const sheet = stackOver("start");
    for (let index = 0; index < 45; index += 1)
      sheet.change(`step ${String(index)}`, `v${String(index)}`);

    const outcome = sheet.history.undo(100);
    expect(outcome).toEqual({ label: "step 5", steps: 40 });
    // The state before step 5 is where the stack now bottoms out: "start" is unreachable.
    expect(sheet.current()).toBe("v4");
    expect(sheet.history.canUndo).toBe(false);
  });

  it("counts what it is offering rather than what was pushed", () => {
    const sheet = stackOver("start");
    for (let index = 0; index < 45; index += 1)
      sheet.change(`step ${String(index)}`, `v${String(index)}`);

    expect(sheet.history.undoStackTitle).toContain("last 40 changes");
  });
});

describe("forgetting", () => {
  it("drops both directions, for a sheet that has been read again", () => {
    const sheet = stackOver("a");
    sheet.change("one", "b");
    sheet.history.undo();
    sheet.history.clear();
    expect(sheet.history.canUndo).toBe(false);
    expect(sheet.history.canRedo).toBe(false);
  });
});
