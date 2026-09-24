/*
 * The capture history's stepping rules, pinned. The tricky cases: pushing after stepping back
 * must drop the forward branch (capturing from the past starts a new walk), a refresh must
 * replace the current entry rather than grow the stack, and stepping past either end must be a
 * no-op rather than an out-of-range read.
 */
import { describe, expect, it } from "vitest";
import {
  back,
  canGoBack,
  canGoForward,
  currentEntry,
  emptyHistory,
  forward,
  pushCapture,
  replaceCurrent,
  type CaptureHistory,
} from "../src/lib/tools/safe-browse/capture-history.ts";

// The stack is generic over the view; a string stands in for a captured view here. The timing
// fields ride every entry (the Overview tab reads them back), so the helper carries fixed values.
function entry(name: string) {
  return {
    enteredUrl: `https://${name}.example/`,
    view: name,
    capturedAt: 1700000000000,
    elapsedMs: 1200,
    mode: "static" as const,
  };
}

function walked(names: string[]): CaptureHistory<string> {
  return names.reduce((history, name) => pushCapture(history, entry(name)), emptyHistory<string>());
}

describe("emptyHistory", () => {
  it("has no current entry and can step nowhere", () => {
    const history = emptyHistory<string>();
    expect(currentEntry(history)).toBeNull();
    expect(canGoBack(history)).toBe(false);
    expect(canGoForward(history)).toBe(false);
  });
});

describe("pushCapture", () => {
  it("makes the pushed entry current", () => {
    const history = pushCapture(emptyHistory<string>(), entry("first"));
    expect(currentEntry(history)).toEqual(entry("first"));
    expect(history.index).toBe(0);
  });

  it("keeps earlier entries reachable behind the new one", () => {
    const history = walked(["first", "second"]);
    expect(currentEntry(history)).toEqual(entry("second"));
    expect(canGoBack(history)).toBe(true);
    expect(canGoForward(history)).toBe(false);
  });

  it("drops the forward branch when pushing after stepping back", () => {
    const history = pushCapture(back(walked(["first", "second", "third"])), entry("fourth"));
    expect(history.entries.map((held) => held.view)).toEqual(["first", "second", "fourth"]);
    expect(currentEntry(history)).toEqual(entry("fourth"));
    expect(canGoForward(history)).toBe(false);
  });

  it("returns a new history rather than mutating the given one", () => {
    const before = walked(["first"]);
    pushCapture(before, entry("second"));
    expect(before.entries).toHaveLength(1);
    expect(before.index).toBe(0);
  });

  it("keeps each entry's own completion time and duration through pushes and stepping", () => {
    const first = {
      enteredUrl: "https://a.example/",
      view: "a",
      capturedAt: 100,
      elapsedMs: 40,
      mode: "static" as const,
    };
    const second = {
      enteredUrl: "https://b.example/",
      view: "b",
      capturedAt: 200,
      elapsedMs: 60,
      mode: "static" as const,
    };
    const history = pushCapture(pushCapture(emptyHistory<string>(), first), second);
    expect(currentEntry(history)?.capturedAt).toBe(200);
    expect(currentEntry(history)?.elapsedMs).toBe(60);
    expect(currentEntry(back(history))?.capturedAt).toBe(100);
    expect(currentEntry(back(history))?.elapsedMs).toBe(40);
  });
});

describe("replaceCurrent", () => {
  it("swaps the current entry without growing the stack", () => {
    const history = replaceCurrent(walked(["first", "second"]), entry("second-again"));
    expect(history.entries.map((held) => held.view)).toEqual(["first", "second-again"]);
    expect(history.index).toBe(1);
  });

  it("keeps the forward branch when replacing a past position", () => {
    const history = replaceCurrent(back(walked(["first", "second"])), entry("first-again"));
    expect(history.entries.map((held) => held.view)).toEqual(["first-again", "second"]);
    expect(canGoForward(history)).toBe(true);
  });

  it("behaves as a push on an empty history", () => {
    const history = replaceCurrent(emptyHistory<string>(), entry("first"));
    expect(currentEntry(history)).toEqual(entry("first"));
    expect(history.entries).toHaveLength(1);
  });
});

describe("back and forward", () => {
  it("step through stored entries and report reach at each position", () => {
    const atSecond = back(walked(["first", "second", "third"]));
    expect(currentEntry(atSecond)).toEqual(entry("second"));
    expect(canGoBack(atSecond)).toBe(true);
    expect(canGoForward(atSecond)).toBe(true);

    const atFirst = back(atSecond);
    expect(currentEntry(atFirst)).toEqual(entry("first"));
    expect(canGoBack(atFirst)).toBe(false);

    const returned = forward(atFirst);
    expect(currentEntry(returned)).toEqual(entry("second"));
  });

  it("stepping past either end is a no-op", () => {
    const single = walked(["only"]);
    expect(back(single)).toBe(single);
    expect(forward(single)).toBe(single);
    const empty = emptyHistory<string>();
    expect(back(empty)).toBe(empty);
    expect(forward(empty)).toBe(empty);
  });
});
