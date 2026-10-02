/*
 * The page's half of a live stream, pinned with a fake socket: the stream opens only when an
 * address is entered, input waits for the browser to be ready, every frame is acknowledged once
 * drawn, and a stream that stops says why. The input arithmetic beside it — where a click lands on
 * a letterboxed screen, which keys belong to the remote page — is pinned here too.
 */
import { describe, expect, it } from "vitest";
import { MODIFIER_CONTROL, MODIFIER_SHIFT } from "@magna-carta/safe-browse/live-stream-protocol";
import {
  forwardsKey,
  isLeaveGesture,
  modifiersOf,
  pointerButton,
  remotePoint,
  wheelPixels,
} from "../src/lib/tools/safe-browse/live-input.ts";
import { LiveStreamClient } from "../src/lib/tools/safe-browse/live-stream-client.svelte.ts";

class FakeSocket {
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  closed = false;

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.closed = true;
  }
  // The server's side.
  deliver(message: unknown): void {
    this.readyState = 1;
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: JSON.stringify(message) });
    }
  }
  drop(): void {
    this.readyState = 3;
    for (const listener of this.listeners.get("close") ?? []) listener({});
  }
}

function client() {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const scheduled: (() => void)[] = [];
  const live = new LiveStreamClient({
    after: (_milliseconds, callback) => {
      scheduled.push(callback);
      return () => {};
    },
    openSocket: (url) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    socketUrl: (viewport) => `wss://app.example/stream?w=${viewport.width}&h=${viewport.height}`,
    now: () => 42,
  });
  // Runs the retry the client scheduled, as its timer would.
  const runScheduled = () => scheduled.shift()?.();
  return { live, sockets, urls, runScheduled };
}

const ready = (sessionContinued = false) => ({
  type: "ready",
  sessionContinued,
  viewport: { width: 800, height: 600 },
});

describe("LiveStreamClient", () => {
  it("opens nothing until an address is entered, then sends it once the browser is ready", () => {
    const { live, sockets, urls } = client();
    live.resize({ width: 900, height: 700 });
    expect(sockets).toHaveLength(0);

    live.navigate("https://example.com/");
    expect(live.status).toBe("connecting");
    expect(urls).toEqual(["wss://app.example/stream?w=900&h=700"]);
    expect(sockets[0]?.sent).toEqual([]);

    sockets[0]?.deliver(ready());
    expect(live.status).toBe("open");
    expect(sockets[0]?.sent).toEqual([{ type: "navigate", url: "https://example.com/" }]);
  });

  it("drops input sent before the browser is ready", () => {
    const { live, sockets } = client();
    live.navigate("https://example.com/");
    live.input({ type: "key", action: "down", key: "a", code: "KeyA", modifiers: 0 });
    sockets[0]?.deliver(ready());
    expect(sockets[0]?.sent.map((message) => message["type"])).toEqual(["navigate"]);
  });

  it("acknowledges each frame once the screen has drawn it", async () => {
    const { live, sockets } = client();
    const drawn: string[] = [];
    live.attachScreen(async (data) => {
      drawn.push(data);
    });
    live.navigate("https://example.com/");
    sockets[0]?.deliver(ready());
    sockets[0]?.deliver({ type: "frame", data: "AAAA", width: 800, height: 600 });
    await Promise.resolve();
    await Promise.resolve();
    expect(drawn).toEqual(["AAAA"]);
    expect(sockets[0]?.sent.at(-1)).toEqual({ type: "frameAck" });
    expect(live.showing).toBe(true);
    expect(live.frameSize).toEqual({ width: 800, height: 600 });
  });

  it("follows the remote browser's address and history", () => {
    const { live, sockets } = client();
    live.navigate("https://example.com/");
    sockets[0]?.deliver(ready());
    sockets[0]?.deliver({
      type: "location",
      url: "https://www.example.com/",
      title: "Example",
      canGoBack: true,
      canGoForward: false,
    });
    expect(live.location).toBe("https://www.example.com/");
    expect(live.canGoBack).toBe(true);
    live.history("back");
    expect(sockets[0]?.sent.at(-1)).toEqual({ type: "history", direction: "back" });
  });

  it("keeps the inspector's facts and answers a capture with the full view", async () => {
    const { live, sockets } = client();
    live.navigate("https://example.com/");
    sockets[0]?.deliver(ready());
    const view = {
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      redirectChain: [],
      responseHeaders: {},
      screenshotBase64: "",
      links: [],
    };
    sockets[0]?.deliver({ type: "details", view, elapsedMilliseconds: 900 });
    expect(live.details).toEqual({ view, receivedAt: 42, elapsedMilliseconds: 900 });

    const pending = live.capture();
    expect(sockets[0]?.sent.at(-1)).toEqual({ type: "capture" });
    sockets[0]?.deliver({ type: "capture", view: { ...view, screenshotBase64: "UE5H" } });
    expect((await pending)?.screenshotBase64).toBe("UE5H");
  });

  it("says why it stopped when the server ends it on purpose", () => {
    const told = client();
    told.live.navigate("https://example.com/");
    told.sockets[0]?.deliver(ready());
    told.sockets[0]?.deliver({ type: "ended", reason: "idle" });
    told.sockets[0]?.drop();
    expect(told.live.status).toBe("ended");
    expect(told.live.stopReason).toBe("idle");
    expect(told.live.failure).toBeNull();
    expect(told.live.showing).toBe(false);
  });

  it("retries a dropped connection visibly, reopening onto the same browser", () => {
    const run = client();
    run.live.navigate("https://example.com/");
    run.sockets[0]?.deliver(ready());
    run.sockets[0]?.drop();
    expect(run.live.status).toBe("connecting");
    expect(run.live.retrying).toEqual({ attempt: 2, maximumAttempts: 3 });
    run.runScheduled();
    expect(run.sockets).toHaveLength(2);
    run.sockets[1]?.deliver(ready(true));
    expect(run.live.status).toBe("open");
    expect(run.live.retrying).toBeNull();
    // Resumed, not restarted: nothing was navigated, and the cookies carried over.
    expect(run.sockets[1]?.sent).toEqual([]);
    expect(run.live.freshBrowserAfterEarlier).toBe(false);
  });

  it("reports a browser that could not be had, with its Error ID, once the retries are spent", () => {
    const run = client();
    run.live.navigate("https://example.com/");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      run.sockets[attempt]?.deliver({
        type: "ended",
        reason: "failed",
        errorId: `error_${attempt}`,
      });
      run.runScheduled();
    }
    expect(run.sockets).toHaveLength(3);
    expect(run.live.status).toBe("ended");
    expect(run.live.stopReason).toBe("failed");
    expect(run.live.failure?.problem?.errorId).toBe("error_2");
    expect(JSON.stringify(run.live.failure)).not.toContain("example.com");
  });

  it("holds the address through the retries and sends it once a browser is ready", () => {
    const run = client();
    run.live.navigate("https://example.com/held");
    run.sockets[0]?.deliver({ type: "ended", reason: "failed" });
    run.runScheduled();
    run.sockets[1]?.deliver(ready());
    expect(run.sockets[1]?.sent).toEqual([{ type: "navigate", url: "https://example.com/held" }]);
  });

  it("reports when a later stream had to start a fresh browser", () => {
    const { live, sockets } = client();
    live.navigate("https://example.com/");
    sockets[0]?.deliver(ready(false));
    expect(live.freshBrowserAfterEarlier).toBe(false);
    sockets[0]?.deliver({ type: "ended", reason: "idle" });
    sockets[0]?.drop();

    live.navigate("https://example.com/again");
    sockets[1]?.deliver(ready(false));
    expect(live.freshBrowserAfterEarlier).toBe(true);
  });

  it("closing forgets the page and stops the socket", () => {
    const { live, sockets } = client();
    live.navigate("https://example.com/");
    sockets[0]?.deliver(ready());
    sockets[0]?.deliver({
      type: "location",
      url: "https://example.com/",
      canGoBack: false,
      canGoForward: false,
    });
    live.close();
    expect(live.status).toBe("idle");
    expect(live.location).toBeNull();
    expect(sockets[0]?.closed).toBe(true);
  });
});

describe("remotePoint", () => {
  const frame = { width: 800, height: 600 };

  it("maps a click straight through when the screen fills the canvas", () => {
    expect(
      remotePoint(
        { clientX: 110, clientY: 70 },
        { left: 10, top: 20, width: 400, height: 300 },
        frame,
      ),
    ).toEqual({ x: 200, y: 100 });
  });

  it("allows for the letterbox, and ignores a click in it", () => {
    // A 1000x300 box shows the 800x600 frame at 400x300, centred with 300px bands either side.
    const box = { left: 0, top: 0, width: 1000, height: 300 };
    expect(remotePoint({ clientX: 500, clientY: 150 }, box, frame)).toEqual({ x: 400, y: 300 });
    expect(remotePoint({ clientX: 100, clientY: 150 }, box, frame)).toBeNull();
  });
});

describe("the input helpers", () => {
  it("builds the modifier bitmask and names buttons", () => {
    expect(modifiersOf({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: true })).toBe(
      MODIFIER_CONTROL | MODIFIER_SHIFT,
    );
    expect([0, 1, 2, 3].map(pointerButton)).toEqual(["left", "middle", "right", "none"]);
  });

  it("measures wheel travel in pixels whatever the device reported", () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 600)).toEqual({
      deltaX: 0,
      deltaY: 48,
    });
    expect(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 600).deltaY).toBe(600);
    expect(wheelPixels({ deltaX: 0, deltaY: 1e9, deltaMode: 0 }, 600).deltaY).toBe(10_000);
  });

  it("keeps the paste chord and unnameable keys for the member", () => {
    const press = (key: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean }> = {}) => ({
      key,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      ...extra,
    });
    expect(forwardsKey(press("a"))).toBe(true);
    expect(forwardsKey(press("Enter"))).toBe(true);
    expect(forwardsKey(press("v", { ctrlKey: true }))).toBe(false);
    expect(forwardsKey(press("V", { metaKey: true }))).toBe(false);
    expect(forwardsKey(press("Dead"))).toBe(false);
  });

  it("treats a quick second Escape as leaving the screen", () => {
    expect(isLeaveGesture("Escape", 1000, null)).toBe(false);
    expect(isLeaveGesture("Escape", 1400, 1000)).toBe(true);
    expect(isLeaveGesture("Escape", 2000, 1000)).toBe(false);
    expect(isLeaveGesture("a", 1100, 1000)).toBe(false);
  });
});
