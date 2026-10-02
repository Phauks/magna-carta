/*
 * The live stream's decisions, pinned without a browser.
 *
 * The test pool has no Browser Rendering binding, so everything the stream decides AROUND the
 * browser — what input reaches it, what a private address answers, how frames are paced to a slow
 * member, when a stream ends and whether the browser survives it — would otherwise be checkable only
 * by hand against the deployed service. The opener seam exists for this file.
 */
import { describe, expect, it } from "vitest";
import type { LiveSessionPlan } from "@magna-carta/safe-browse";
import {
  LIVE_SESSION_IDLE_MILLISECONDS,
  LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS,
} from "@magna-carta/safe-browse";
import type { LiveServerMessage } from "@magna-carta/safe-browse/live-stream-protocol";
import {
  LiveStream,
  type LiveBrowser,
  type LiveBrowserEvents,
  type LiveBrowserOpener,
} from "../src/safe-browse/live-stream.ts";

type Call = { method: string; argument?: unknown };

function fakeBrowser(calls: Call[]): LiveBrowser {
  const record =
    (method: string) =>
    async (argument?: unknown): Promise<void> => {
      calls.push({ method, argument });
    };
  return {
    sessionId: "session-1",
    navigate: record("navigate"),
    history: record("history"),
    reload: record("reload"),
    pointer: record("pointer"),
    wheel: record("wheel"),
    key: record("key"),
    insertText: record("insertText"),
    resize: record("resize"),
    async inspect(withScreenshot) {
      calls.push({ method: "inspect", argument: withScreenshot });
      return {
        requestedUrl: "https://a.example/",
        finalUrl: "https://a.example/",
        redirectChain: [],
        responseHeaders: {},
        screenshotBase64: withScreenshot ? "UE5H" : "",
        links: [],
      };
    },
    release: record("release"),
    close: record("close"),
  };
}

function harness(options: { plan?: LiveSessionPlan; failOpen?: boolean } = {}) {
  const sent: LiveServerMessage[] = [];
  const closes: string[] = [];
  const calls: Call[] = [];
  let events: LiveBrowserEvents | null = null;
  let clock = 1_000_000;
  const opener: LiveBrowserOpener = {
    async open(plan, _viewport, reported) {
      if (options.failOpen === true) throw new Error("no browser");
      events = reported;
      return { browser: fakeBrowser(calls), plan };
    },
  };
  const stream = new LiveStream({
    socket: {
      send: (data) => sent.push(JSON.parse(data) as LiveServerMessage),
      close: (_code, reason) => closes.push(reason ?? ""),
    },
    opener,
    now: () => clock,
  });
  return {
    stream,
    sent,
    closes,
    calls,
    events: () => {
      if (events === null) throw new Error("the browser was never opened");
      return events;
    },
    advance: (milliseconds: number) => {
      clock += milliseconds;
      return clock;
    },
    start: () =>
      stream.start(options.plan ?? { kind: "launch", reason: "none-recorded" }, null, () => clock),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const send = (value: unknown) => JSON.stringify(value);

describe("LiveStream", () => {
  it("tells the member when the browser is theirs, and whether it is the one they had", async () => {
    const fresh = harness();
    await fresh.start();
    expect(fresh.sent[0]).toMatchObject({ type: "ready", sessionContinued: false });

    const resumed = harness({ plan: { kind: "connect", sessionId: "session-1" } });
    await resumed.start();
    expect(resumed.sent[0]).toMatchObject({ type: "ready", sessionContinued: true });
  });

  it("ends as failed, with no browser to release, when none can be had", async () => {
    const run = harness({ failOpen: true });
    expect(await run.start()).toBeNull();
    expect(run.sent).toEqual([{ type: "ended", reason: "failed" }]);
    expect(run.closes).toEqual(["failed"]);
  });

  it("refuses a private address before the browser sees it", async () => {
    const run = harness();
    await run.start();
    run.stream.receive(send({ type: "navigate", url: "http://127.0.0.1/admin" }));
    run.stream.receive(send({ type: "navigate", url: "http://169.254.169.254/latest" }));
    await settle();
    expect(run.calls.filter((call) => call.method === "navigate")).toEqual([]);
    expect(run.sent.filter((message) => message.type === "refused")).toHaveLength(2);
  });

  it("passes a public address to the browser", async () => {
    const run = harness();
    await run.start();
    run.stream.receive(send({ type: "navigate", url: "https://example.com/path" }));
    await settle();
    expect(run.calls).toContainEqual({ method: "navigate", argument: "https://example.com/path" });
  });

  it("drops anything the parser does not accept, and anything sent before ready", async () => {
    const run = harness();
    run.stream.receive(send({ type: "key", action: "down", key: "a" }));
    await run.start();
    run.stream.receive(send({ type: "evaluate", script: "1" }));
    run.stream.receive("not json");
    await settle();
    expect(run.calls).toEqual([]);
  });

  it("dispatches input in the order it arrived", async () => {
    const run = harness();
    await run.start();
    const pointer = { type: "pointer", x: 5, y: 5, button: "left", clickCount: 1 };
    run.stream.receive(send({ ...pointer, action: "down" }));
    run.stream.receive(send({ ...pointer, action: "up" }));
    run.stream.receive(send({ type: "text", text: "hello" }));
    await settle();
    expect(run.calls.map((call) => call.method)).toEqual(["pointer", "pointer", "insertText"]);
    expect(run.calls.map((call) => (call.argument as { action?: string }).action)).toEqual([
      "down",
      "up",
      undefined,
    ]);
  });

  it("keeps one frame in flight, holding the newest until the member has drawn the last", async () => {
    const run = harness();
    await run.start();
    const acknowledged: string[] = [];
    const frame = (data: string) =>
      run.events().frame({ data, width: 800, height: 600 }, () => acknowledged.push(data));

    frame("one");
    frame("two");
    frame("three");
    const frames = () =>
      run.sent.filter((message) => message.type === "frame").map((message) => message.data);
    // Only the first went out; the second was superseded by the third and released to the browser.
    expect(frames()).toEqual(["one"]);
    expect(acknowledged).toEqual(["one", "two"]);

    run.stream.receive(send({ type: "frameAck" }));
    expect(frames()).toEqual(["one", "three"]);
    expect(acknowledged).toEqual(["one", "two", "three"]);
  });

  it("refreshes the inspector's facts on each load, without a screenshot", async () => {
    const run = harness();
    await run.start();
    run.events().loaded(1234);
    await settle();
    expect(run.calls).toContainEqual({ method: "inspect", argument: false });
    expect(run.sent).toContainEqual(
      expect.objectContaining({ type: "details", elapsedMilliseconds: 1234 }),
    );
  });

  it("answers a capture with the full view, screenshot included", async () => {
    const run = harness();
    await run.start();
    run.stream.receive(send({ type: "capture" }));
    await settle();
    const capture = run.sent.find((message) => message.type === "capture");
    expect(capture).toMatchObject({ view: { screenshotBase64: "UE5H" } });
  });

  it("goes idle only after the idle window with no input, and input restarts it", async () => {
    const run = harness();
    await run.start();
    expect(run.stream.dueReason(run.advance(LIVE_SESSION_IDLE_MILLISECONDS - 1))).toBeNull();
    run.stream.receive(send({ type: "wheel", x: 1, y: 1, deltaX: 0, deltaY: 40 }));
    expect(run.stream.dueReason(run.advance(LIVE_SESSION_IDLE_MILLISECONDS - 1))).toBeNull();
    expect(run.stream.dueReason(run.advance(1))).toBe("idle");
  });

  it("reaches the ceiling however busy the member is", async () => {
    const run = harness();
    await run.start();
    for (let elapsed = 0; elapsed < LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS; elapsed += 60_000) {
      run.advance(60_000);
      run.stream.receive(send({ type: "ping" }));
      run.stream.receive(send({ type: "pointer", action: "move", x: 1, y: 1 }));
    }
    expect(run.stream.dueReason(run.advance(0))).toBe("ceiling");
  });

  it("closes the browser when it ends for good, and releases it when handed over", async () => {
    const closed = harness();
    await closed.start();
    await closed.stream.end("idle", "close");
    expect(closed.calls.map((call) => call.method)).toContain("close");
    expect(closed.sent.at(-1)).toEqual({ type: "ended", reason: "idle" });

    const replaced = harness();
    await replaced.start();
    await replaced.stream.end("replaced", "release");
    expect(replaced.calls.map((call) => call.method)).toContain("release");
    expect(replaced.calls.map((call) => call.method)).not.toContain("close");
  });

  it("leaves the browser for a reconnect when the member's socket drops", async () => {
    const run = harness();
    await run.start();
    await run.stream.socketClosed();
    expect(run.calls.map((call) => call.method)).toEqual(["release"]);
    run.stream.receive(send({ type: "reload" }));
    await settle();
    expect(run.calls.map((call) => call.method)).toEqual(["release"]);
  });
});
