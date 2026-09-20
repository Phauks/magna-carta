// @vitest-environment happy-dom
/*
 * The meeting screen's two dangerous moments, driven through the real page against fakes for the
 * browser's own media objects.
 *
 * ARRIVING IS A WRITE, so the screen must never make it twice. The arrival is what OPENS the
 * member's stay, and it runs off "this browser is not in a meeting" — which is also exactly what
 * every departure leaves behind. On the way out of a tab those two facts collide: the departure lets
 * go of the meeting, the arrival sees somebody with no meeting, and a fresh join races the leave
 * that was sent a microsecond earlier. Whichever lands second wins, and when it is the join the firm
 * is left with a stay that no socket ever reaches.
 *
 * BEING SUPERSEDED IS NOT A FAULT. The room keeps one live socket per stay and the newest wins, so a
 * second tab closes the first — and the first must not offer to come back (that would take the stay
 * off the tab that is actually in the room) and must not close the stay on its way out (same harm,
 * by a different route). Both are asserted here rather than left to a reading of the screen.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { page } from "./stubs/app-state.ts";
import { sessionPermissions } from "../src/lib/access/session-permissions.svelte.ts";
import Harness from "./meeting-room-harness.svelte";

/** An origin for the client's relative operation paths, which Node cannot resolve on its own. */
const ORIGIN = "https://app.example";
const MEETING_ID = "meeting_1";

/** Every request the screen made, through either transport, in order. */
let requests: { method: string; path: string }[] = [];
let sockets: FakeSocket[] = [];
let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

const SUMMARY = {
  id: MEETING_ID,
  eventKind: "matter",
  eventId: "matterEvent_1",
  matterId: "matter_1",
  title: "Hearing preparation",
  startsOn: "2026-09-18",
  startsAtTime: "09:00",
  endsAtTime: "10:00",
  timeZone: "America/Denver",
  status: "live",
  startedAt: "2026-09-18T15:02:00.000Z",
  endedAt: null,
  medium: "video",
  liveCount: 1,
  configured: true,
};

/** The signaling socket, captured so a case can speak to the screen as the room would. */
class FakeSocket {
  readonly sent: string[] = [];
  readonly #listeners = new Map<string, (event: { data: string }) => void>();

  constructor() {
    sockets.push(this);
  }

  addEventListener(name: string, handler: (event: { data: string }) => void): void {
    this.#listeners.set(name, handler);
    if (name === "open") handler({ data: "" });
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {}

  deliver(frame: Record<string, unknown>): void {
    this.#listeners.get("message")?.({ data: JSON.stringify(frame) });
  }
}

class FakePeerConnection {
  localDescription = { type: "offer", sdp: "local-offer" };
  addTransceiver(): { mid: string } {
    return { mid: "0" };
  }
  getTransceivers(): [] {
    return [];
  }
  createOffer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "offer", sdp: "local-offer" });
  }
  createAnswer(): Promise<{ type: string; sdp: string }> {
    return Promise.resolve({ type: "answer", sdp: "local-answer" });
  }
  setLocalDescription(): Promise<void> {
    return Promise.resolve();
  }
  setRemoteDescription(): Promise<void> {
    return Promise.resolve();
  }
  close(): void {}
}

/*
 * Capture that declines, which is a real state of a real browser — a member who said no to the
 * camera is still in the room — and the one that needs no MediaStream at all. The tiles then hold
 * nothing, which is what these cases are about: arriving and leaving, not media.
 */
const declinedCapture = (): Promise<never> => Promise.reject(new Error("NotAllowedError"));

/** Answer the three calls this screen makes, and record every one of them. */
function serveTheRoom(summary: Record<string, unknown> = SUMMARY): void {
  const answer = (method: string, path: string): Response => {
    requests.push({ method, path });
    if (method === "GET" && path === `/api/v1/meetings/${MEETING_ID}`) {
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (path.endsWith("/join")) {
      return new Response(
        JSON.stringify({ participantId: "attendance_1", displayName: "You", iceServers: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const stub = ((request: Request | string, init?: RequestInit) => {
    // The generated client hands over a Request; the departure write, which cannot use that client,
    // hands over a path and an init. Both are the screen reaching the server and both are recorded.
    if (typeof request === "string") {
      return Promise.resolve(answer(init?.method ?? "GET", new URL(request, ORIGIN).pathname));
    }
    return Promise.resolve(answer(request.method, new URL(request.url).pathname));
  }) as unknown as typeof fetch;

  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
  vi.stubGlobal("fetch", stub);
}

function joinRequests(): { method: string; path: string }[] {
  return requests.filter((request) => request.path.endsWith("/join"));
}

function leaveRequests(): { method: string; path: string }[] {
  return requests.filter((request) => request.path.endsWith("/leave"));
}

/** Let the read, the join and the publish settle; each is a few turns of the loop deep. */
async function settle(remaining = 5): Promise<void> {
  if (remaining === 0) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  await settle(remaining - 1);
}

async function draw(): Promise<HTMLElement> {
  instance = mount(Harness, { target, props: {} });
  flushSync();
  await settle();
  return target;
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  requests = [];
  sockets = [];
  queryClient.clear();
  page.params = { id: MEETING_ID };
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  vi.stubGlobal("WebSocket", FakeSocket);
  // Defined on the navigator that is already there rather than replacing it: happy-dom's own
  // Navigator is a class instance, and a plain object standing in for it loses everything else the
  // document reads off it.
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: declinedCapture, getDisplayMedia: declinedCapture },
  });
  // The session, set directly: this screen does not read it for these cases, and a member who may
  // host is the fuller render — every control on the bar, including the one that ends the meeting.
  sessionPermissions.session = {
    user: { id: "usr_1", name: "Member", email: "member@example.com" },
    firm: { id: "firm_1", name: "Goldsmith and Associates" },
    permissions: ["meetings:join", "meetings:host"],
  } as unknown as typeof sessionPermissions.session;
  sessionPermissions.settled = true;
  serveTheRoom();
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  page.params = {};
  sessionPermissions.session = null;
  sessionPermissions.settled = false;
  vi.unstubAllGlobals();
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("arriving", () => {
  it("opens one stay, not one per render", async () => {
    await draw();
    expect(joinRequests()).toHaveLength(1);
  });
});

describe("closing the tab", () => {
  it("closes the stay and does not open another one on the way out", async () => {
    await draw();
    expect(joinRequests()).toHaveLength(1);

    window.dispatchEvent(new Event("pagehide"));
    await settle();

    // The departure is the last word: a second join here would race the leave beside it, and the
    // stay it opened would have no socket and nothing to close it but the server's own sweep.
    expect(joinRequests()).toHaveLength(1);
    expect(leaveRequests()).toHaveLength(1);
  });

  it("sends one departure however many times the browser announces the same one", async () => {
    await draw();

    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("beforeunload"));
    await settle();

    expect(leaveRequests()).toHaveLength(1);
    expect(joinRequests()).toHaveLength(1);
  });
});

describe("a call", () => {
  it("is named as one, and carries no control it could not honour", async () => {
    serveTheRoom({ ...SUMMARY, medium: "audio" });

    const rendered = await draw();

    // The header says which kind of room this is, beside the day and the count.
    expect(rendered.textContent).toContain("Call");
    const named = [...rendered.querySelectorAll("button")].map(
      (control) => control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "",
    );
    expect(named.some((label) => label.includes("camera"))).toBe(false);
    expect(named.some((label) => label.includes("screen"))).toBe(false);
    expect(named).toContain("Mute your microphone");
  });
});

describe("a newer socket for the same stay", () => {
  it("says the meeting moved, offers no way back in, and leaves the stay alone", async () => {
    const rendered = await draw();
    const socket = sockets[0];
    expect(socket).toBeDefined();

    socket?.deliver({ v: 1, type: "refused", reason: "superseded" });
    await settle();

    expect(rendered.textContent).toContain("another tab or window");
    const controls = [...rendered.querySelectorAll("button")].map((control) =>
      control.textContent?.trim(),
    );
    // Rejoining would take the stay off the tab that is actually in the room — the same collision
    // again, with the tabs swapped.
    expect(controls).not.toContain("Rejoin");

    // And nothing is closed on the way out: the stay is the newer socket's now.
    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(leaveRequests()).toHaveLength(0);
    expect(joinRequests()).toHaveLength(1);
  });
});

describe("a large room", () => {
  it("pages the gallery and states how much of the room is on screen", async () => {
    const rendered = await draw();
    const socket = sockets[0];
    expect(socket).toBeDefined();

    socket?.deliver({
      v: 1,
      type: "roster",
      participants: Array.from({ length: 40 }, (_unused, index) => {
        const participantId = `attendance_${index + 2}`;
        return {
          participantId,
          userId: `user_${index + 2}`,
          displayName: `Member ${index + 2}`,
          sfuSessionId: `session_${index + 2}`,
          tracks: [
            { trackName: `${participantId}:audio`, kind: "audio" },
            { trackName: `${participantId}:video`, kind: "video" },
          ],
        };
      }),
    });
    await settle();

    // Sixteen tiles of forty people: the gallery says so rather than silently showing a fraction.
    expect(rendered.textContent).toContain("Page 1 of 3");
    expect(rendered.textContent).toContain("Showing 17 of 40");
    expect(rendered.textContent).toContain("In the Room (40)");
  });
});
