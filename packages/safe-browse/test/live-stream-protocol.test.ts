/*
 * The live stream's frames, pinned. The Worker side of the parse is the one that matters: every
 * frame arrives from a socket anybody holding the member's cookie could write to, so what it lets
 * through is what can reach the remote browser.
 */
import { describe, expect, it } from "vitest";
import {
  LIVE_VIEWPORT_MAXIMUM,
  LIVE_VIEWPORT_MINIMUM,
  MAXIMUM_INSERTED_TEXT,
  MODIFIER_SHIFT,
  clampToViewport,
  clampViewport,
  parseLiveClientMessage,
  parseLiveServerMessage,
} from "../src/live-stream-protocol.ts";

const frame = (value: unknown) => JSON.stringify(value);

describe("parseLiveClientMessage", () => {
  it("accepts each well-formed message", () => {
    expect(parseLiveClientMessage(frame({ type: "navigate", url: "https://a.example/" }))).toEqual({
      type: "navigate",
      url: "https://a.example/",
    });
    expect(parseLiveClientMessage(frame({ type: "history", direction: "back" }))).toEqual({
      type: "history",
      direction: "back",
    });
    expect(parseLiveClientMessage(frame({ type: "reload" }))).toEqual({ type: "reload" });
    expect(parseLiveClientMessage(frame({ type: "frameAck" }))).toEqual({ type: "frameAck" });
    expect(
      parseLiveClientMessage(
        frame({
          type: "pointer",
          action: "down",
          x: 10.5,
          y: 20,
          button: "left",
          clickCount: 2,
          modifiers: MODIFIER_SHIFT,
        }),
      ),
    ).toEqual({
      type: "pointer",
      action: "down",
      x: 10.5,
      y: 20,
      button: "left",
      clickCount: 2,
      modifiers: MODIFIER_SHIFT,
    });
    expect(
      parseLiveClientMessage(frame({ type: "key", action: "down", key: "Enter", code: "Enter" })),
    ).toEqual({ type: "key", action: "down", key: "Enter", code: "Enter", modifiers: 0 });
    expect(parseLiveClientMessage(frame({ type: "text", text: "hello" }))).toEqual({
      type: "text",
      text: "hello",
    });
  });

  it("drops anything that is not a known, bounded message", () => {
    const refused = [
      "not json",
      frame(["navigate"]),
      frame({ type: "evaluate", script: "alert(1)" }),
      frame({ type: "navigate", url: "" }),
      frame({ type: "navigate", url: "x".repeat(2049) }),
      frame({ type: "history", direction: "sideways" }),
      frame({ type: "pointer", action: "down", x: Number.NaN, y: 0 }),
      frame({ type: "pointer", action: "down", x: -1, y: 0 }),
      frame({ type: "pointer", action: "down", x: 0, y: 1e9 }),
      frame({ type: "pointer", action: "tap", x: 0, y: 0 }),
      frame({ type: "pointer", action: "down", x: 0, y: 0, button: "back" }),
      frame({ type: "pointer", action: "down", x: 0, y: 0, clickCount: 9 }),
      frame({ type: "wheel", x: 0, y: 0, deltaX: 0, deltaY: 1e7 }),
      frame({ type: "key", action: "down", key: "" }),
      frame({ type: "key", action: "down", key: "k".repeat(33) }),
      frame({ type: "key", action: "press", key: "a" }),
      frame({ type: "text", text: "" }),
      frame({ type: "text", text: "x".repeat(MAXIMUM_INSERTED_TEXT + 1) }),
      frame({ type: "viewport", width: "wide", height: 10 }),
      42,
    ];
    for (const raw of refused) expect(parseLiveClientMessage(raw)).toBeNull();
  });

  it("keeps only the four modifier bits", () => {
    const parsed = parseLiveClientMessage(
      frame({ type: "wheel", x: 1, y: 1, deltaX: 0, deltaY: 40, modifiers: 0xff }),
    );
    expect(parsed).toMatchObject({ modifiers: 15 });
  });
});

describe("clampViewport", () => {
  it("rounds and holds a requested size inside the bounds", () => {
    expect(clampViewport({ width: 1000.4, height: 700.6 })).toEqual({ width: 1000, height: 701 });
    expect(clampViewport({ width: 10, height: 10 })).toEqual(LIVE_VIEWPORT_MINIMUM);
    expect(clampViewport({ width: 99_999, height: 99_999 })).toEqual(LIVE_VIEWPORT_MAXIMUM);
  });
});

describe("clampToViewport", () => {
  it("keeps a point on the screen it is dispatched into", () => {
    expect(clampToViewport({ x: 5000, y: -3 }, { width: 800, height: 600 })).toEqual({
      x: 799,
      y: 0,
    });
  });
});

describe("parseLiveServerMessage", () => {
  it("accepts the Worker's frames and drops malformed ones", () => {
    expect(
      parseLiveServerMessage(frame({ type: "frame", data: "AA==", width: 800, height: 600 })),
    ).not.toBeNull();
    expect(parseLiveServerMessage(frame({ type: "frame", data: "AA==" }))).toBeNull();
    expect(parseLiveServerMessage(frame({ type: "details", view: {} }))).toBeNull();
    expect(parseLiveServerMessage(frame({ type: "unknown" }))).toBeNull();
    expect(parseLiveServerMessage("{")).toBeNull();
  });
});
