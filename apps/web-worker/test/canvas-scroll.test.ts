/*
 * The work-canvas scroll policy, pinned. Forward navigations start the new page at its top;
 * back/forward restores the saved offset; a resolved hash anchor and the initial hydration are
 * left alone. The wiring core is exercised through injected dependencies with a clamping fake
 * canvas — the ordering contract matters: `afterNavigate` fires while <main> still holds the
 * OUTGOING page, so a restore offset must be applied AFTER the incoming page lays out, or the
 * browser clamps it against the wrong height.
 */
import { describe, expect, it } from "vitest";
import {
  CanvasScrollMemory,
  canvasScrollTarget,
  decideCanvasScroll,
  registerCanvasScrollRestoration,
  type CanvasNavigation,
  type ScrollableCanvas,
} from "../src/lib/navigation/canvas-scroll.ts";

describe("decideCanvasScroll", () => {
  it("resets to the top on a link click", () => {
    expect(
      decideCanvasScroll({ type: "link", hasResolvedHashTarget: false, restoredOffset: null }),
    ).toEqual({ kind: "reset" });
  });

  it("resets to the top on a goto", () => {
    expect(
      decideCanvasScroll({ type: "goto", hasResolvedHashTarget: false, restoredOffset: null }),
    ).toEqual({ kind: "reset" });
  });

  it("resets to the top on a GET form navigation", () => {
    expect(
      decideCanvasScroll({ type: "form", hasResolvedHashTarget: false, restoredOffset: null }),
    ).toEqual({ kind: "reset" });
  });

  it("resets on a same-route param change (still a forward link)", () => {
    // /matters/1 -> /matters/2 arrives as a link; a new page starts at its top.
    expect(
      decideCanvasScroll({ type: "link", hasResolvedHashTarget: false, restoredOffset: 640 }),
    ).toEqual({ kind: "reset" });
  });

  it("restores the saved offset on back/forward", () => {
    expect(
      decideCanvasScroll({ type: "popstate", hasResolvedHashTarget: false, restoredOffset: 820 }),
    ).toEqual({ kind: "restore", top: 820 });
  });

  it("restores a saved offset of zero rather than treating it as unknown", () => {
    expect(
      decideCanvasScroll({ type: "popstate", hasResolvedHashTarget: false, restoredOffset: 0 }),
    ).toEqual({ kind: "restore", top: 0 });
  });

  it("falls back to the top on back/forward with no saved offset", () => {
    expect(
      decideCanvasScroll({ type: "popstate", hasResolvedHashTarget: false, restoredOffset: null }),
    ).toEqual({ kind: "reset" });
  });

  it("leaves the canvas alone when a hash target resolves, over a forward reset", () => {
    expect(
      decideCanvasScroll({ type: "link", hasResolvedHashTarget: true, restoredOffset: null }),
    ).toEqual({ kind: "leaveAlone" });
  });

  it("leaves the canvas alone when a hash target resolves, over a popstate restore", () => {
    expect(
      decideCanvasScroll({ type: "popstate", hasResolvedHashTarget: true, restoredOffset: 500 }),
    ).toEqual({ kind: "leaveAlone" });
  });

  it("leaves the initial hydration alone", () => {
    expect(
      decideCanvasScroll({ type: "enter", hasResolvedHashTarget: false, restoredOffset: null }),
    ).toEqual({ kind: "leaveAlone" });
  });
});

describe("canvasScrollTarget", () => {
  it("targets the top for a reset", () => {
    expect(canvasScrollTarget({ kind: "reset" })).toBe(0);
  });

  it("targets the saved offset for a restore", () => {
    expect(canvasScrollTarget({ kind: "restore", top: 512 })).toBe(512);
  });

  it("targets nothing when the canvas is left alone", () => {
    expect(canvasScrollTarget({ kind: "leaveAlone" })).toBeNull();
  });
});

describe("CanvasScrollMemory", () => {
  it("returns null for an entry it has never seen", () => {
    expect(new CanvasScrollMemory().peek(3)).toBeNull();
  });

  it("returns the saved offset for a known entry", () => {
    const memory = new CanvasScrollMemory();
    memory.save(3, 420);
    expect(memory.peek(3)).toBe(420);
  });

  it("keeps a saved zero distinct from an unknown entry", () => {
    const memory = new CanvasScrollMemory();
    memory.save(7, 0);
    expect(memory.peek(7)).toBe(0);
    expect(memory.peek(8)).toBeNull();
  });

  it("does not consume the offset on peek, so repeated back/forward keeps restoring", () => {
    const memory = new CanvasScrollMemory();
    memory.save(2, 300);
    expect(memory.peek(2)).toBe(300);
    expect(memory.peek(2)).toBe(300);
  });

  it("keeps offsets per entry and overwrites on re-save", () => {
    const memory = new CanvasScrollMemory();
    memory.save(1, 100);
    memory.save(2, 200);
    memory.save(1, 150);
    expect(memory.peek(1)).toBe(150);
    expect(memory.peek(2)).toBe(200);
  });
});

/**
 * A scroll container that clamps like a real element: scrollTop can never exceed
 * `scrollHeight - clientHeight`. This is what makes the ordering contract observable — assigning a
 * restore offset while the height is the outgoing page's produces a short landing.
 */
class ClampingCanvas implements ScrollableCanvas {
  scrollHeight: number;
  clientHeight: number;
  #scrollTop = 0;

  constructor(scrollHeight: number, clientHeight = 600) {
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
  }

  get scrollTop(): number {
    return this.#scrollTop;
  }

  set scrollTop(value: number) {
    const max = Math.max(0, this.scrollHeight - this.clientHeight);
    this.#scrollTop = Math.min(Math.max(value, 0), max);
  }
}

interface RestorationHarness {
  before: () => void;
  after: (navigation: CanvasNavigation) => void;
  flushLayout: () => void;
}

function harness(
  canvas: ScrollableCanvas | null | undefined,
  historyIndex: { value: number | null },
  hashResolves = false,
): RestorationHarness {
  let before: () => void = () => {};
  let after: (navigation: CanvasNavigation) => void = () => {};
  const layoutQueue: Array<() => void> = [];
  registerCanvasScrollRestoration({
    onBeforeNavigate: (callback) => (before = callback),
    onAfterNavigate: (callback) => (after = callback),
    getCanvas: () => canvas,
    // Reads the live index at call time — modelling SvelteKit, which has ALREADY advanced
    // history.state to the destination entry by the time `beforeNavigate` fires. The tests move
    // `historyIndex.value` to the destination BEFORE calling `before()` for exactly that reason;
    // a correct implementation must not read this inside `beforeNavigate`.
    currentHistoryIndex: () => historyIndex.value,
    hasResolvedHashTarget: () => hashResolves,
    afterLayout: (callback) => layoutQueue.push(callback),
  });
  return {
    before,
    after,
    flushLayout: () => {
      for (const callback of layoutQueue.splice(0)) callback();
    },
  };
}

const noHash: CanvasNavigation["to"] = { url: { hash: "" } };

// The /tools listing entry and the tool page entry. Real SvelteKit indices are timestamps; two
// stable, distinct values are all the ordering contract needs.
const LISTING_ENTRY = 820;
const TOOL_ENTRY = 821;

describe("registerCanvasScrollRestoration", () => {
  it("resets a forward link to the top", () => {
    const canvas = new ClampingCanvas(1101);
    canvas.scrollTop = 900;
    const historyIndex = { value: 11 };
    const restoration = harness(canvas, historyIndex);

    restoration.after({ type: "link", to: noHash });
    restoration.flushLayout();

    expect(canvas.scrollTop).toBe(0);
  });

  it("banks the offset under the entry being LEFT even though the index has already advanced, and restores it after the incoming page lays out", () => {
    // Reproduces the coordinator's browser measurement AND the history-index ordering that a fake
    // reading the index at afterNavigate-time would hide. clientHeight 600 makes the maxima line up
    // with the report exactly (1101 - 600 = 501; 1805 - 600 = 1205). This test FAILS against an
    // implementation that reads the index inside `beforeNavigate`: that banks 1205 under the tool
    // entry, so Back finds nothing under the listing entry, decides `reset`, and lands at 0.
    const canvas = new ClampingCanvas(1805);
    const historyIndex = { value: LISTING_ENTRY };
    const restoration = harness(canvas, historyIndex);

    // The reader scrolls the /tools listing to the bottom.
    canvas.scrollTop = 1205;
    expect(canvas.scrollTop).toBe(1205);

    // Click a tool link. SvelteKit advances history.state to the tool entry FIRST, then fires
    // beforeNavigate — so the offset must be banked under the listing entry we tracked, not the
    // tool entry the index now reads.
    historyIndex.value = TOOL_ENTRY;
    restoration.before();

    // afterNavigate on the tool page: the new page starts at its top; we now track the tool entry.
    canvas.scrollHeight = 1101;
    canvas.scrollTop = 0;
    restoration.after({ type: "link", to: noHash });
    restoration.flushLayout();
    expect(canvas.scrollTop).toBe(0);

    // Browser BACK: history.state returns to the listing entry before beforeNavigate fires.
    historyIndex.value = LISTING_ENTRY;
    restoration.before();
    restoration.after({ type: "popstate", to: noHash });
    // The immediate apply is clamped against the OLD (tool page) height — the 501 the coordinator saw.
    expect(canvas.scrollTop).toBe(501);

    // The listing lays out (height back to 1805); the post-layout apply now lands the full offset.
    canvas.scrollHeight = 1805;
    restoration.flushLayout();
    expect(canvas.scrollTop).toBe(1205);
  });

  it("returns a later forward navigation to that page's own top, not the listing's offset", () => {
    // The coordinator's decisive symptom: with the offset banked under the wrong entry, a forward
    // navigation restored 1205 onto the tool page and clamped it to that page's max (501). Here the
    // tool entry only ever holds the tool page's own offset (0), so Forward returns to the top.
    const canvas = new ClampingCanvas(1805);
    const historyIndex = { value: LISTING_ENTRY };
    const restoration = harness(canvas, historyIndex);

    // /tools scrolled to the bottom, then open a tool (index advances before beforeNavigate).
    canvas.scrollTop = 1205;
    historyIndex.value = TOOL_ENTRY;
    restoration.before();
    canvas.scrollHeight = 1101;
    canvas.scrollTop = 0;
    restoration.after({ type: "link", to: noHash });
    restoration.flushLayout();

    // Back to /tools: banks the tool page's 0 under the tool entry, restores 1205 on the listing.
    historyIndex.value = LISTING_ENTRY;
    restoration.before();
    restoration.after({ type: "popstate", to: noHash });
    canvas.scrollHeight = 1805;
    restoration.flushLayout();
    expect(canvas.scrollTop).toBe(1205);

    // Forward again to the tool page. The browser carries the listing's offset over (clamped to the
    // tool page's max of 501); the restoration must correct it to the tool page's own top.
    historyIndex.value = TOOL_ENTRY;
    restoration.before();
    canvas.scrollHeight = 1101;
    canvas.scrollTop = 1205;
    restoration.after({ type: "popstate", to: noHash });
    restoration.flushLayout();
    expect(canvas.scrollTop).toBe(0);
  });

  it("clamps a restore legitimately when the destination is genuinely shorter", () => {
    const canvas = new ClampingCanvas(1805);
    const historyIndex = { value: 4 };
    const restoration = harness(canvas, historyIndex);

    // Leaving entry 4: the index advances to 5 before beforeNavigate, so the 1205 must bank under 4.
    canvas.scrollTop = 1205;
    historyIndex.value = 5;
    restoration.before();
    restoration.after({ type: "link", to: noHash });
    restoration.flushLayout();

    // Back to entry 4, but the page is now genuinely short (its content shrank): max scroll is 100.
    historyIndex.value = 4;
    canvas.scrollHeight = 700;
    canvas.scrollTop = 0;
    restoration.after({ type: "popstate", to: noHash });
    restoration.flushLayout();
    expect(canvas.scrollTop).toBe(100); // the clamp is legitimate; we set once and do not fight it
  });

  it("leaves the canvas alone when the destination hash resolves", () => {
    const canvas = new ClampingCanvas(1805);
    const historyIndex = { value: 1 };
    const restoration = harness(canvas, historyIndex, true);

    canvas.scrollTop = 900;
    restoration.after({ type: "link", to: { url: { hash: "#section" } } });
    restoration.flushLayout();

    expect(canvas.scrollTop).toBe(900);
  });

  it("does nothing and never throws when the canvas has not mounted yet", () => {
    const historyIndex = { value: 1 };
    const restoration = harness(undefined, historyIndex);

    expect(() => {
      restoration.before();
      restoration.after({ type: "popstate", to: noHash });
      restoration.flushLayout();
    }).not.toThrow();
  });
});
