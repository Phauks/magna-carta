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
  locked: false,
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

/** Say hello, then state the room's roster, in the order a browser is allowed to read them. */
function welcomeWith(
  socket: FakeSocket | undefined,
  participants: Record<string, unknown>[],
  roomState: Record<string, unknown> = { spotlight: null, locked: false },
): void {
  socket?.deliver({ v: 1, type: "welcome", participantId: "attendance_1", roster: [], roomState });
  socket?.deliver({ v: 1, type: "roster", participants });
}

/** This browser and one colleague, with whatever grants a case is about. */
function roomOfTwo(own: string | null): Record<string, unknown>[] {
  return [
    {
      participantId: "attendance_1",
      userId: "usr_1",
      displayName: "You",
      sfuSessionId: "session_1",
      tracks: [],
      hostRole: own,
    },
    {
      participantId: "attendance_2",
      userId: "usr_2",
      displayName: "Rosalind Chase",
      sfuSessionId: "session_2",
      tracks: [],
      hostRole: null,
    },
  ];
}

describe("running the meeting", () => {
  it("offers nothing of it to a member who is not hosting", async () => {
    const rendered = await draw();
    welcomeWith(sockets[0], roomOfTwo(null));
    await settle();

    const named = [...rendered.querySelectorAll("button")].map((control) =>
      control.getAttribute("aria-label"),
    );
    // Absent, not disabled: for a member who is not running the meeting, none of it could happen.
    expect(named).not.toContain("Host controls");
    expect(named).not.toContain("Host controls for Rosalind Chase");
  });

  it("offers the room's menu and every person's, to a member who is", async () => {
    const rendered = await draw();
    welcomeWith(sockets[0], roomOfTwo("host"));
    await settle();

    const named = [...rendered.querySelectorAll("button")].map((control) =>
      control.getAttribute("aria-label"),
    );
    expect(named).toContain("Host controls");
    // On the rail as well as on the tile, which is where a host of a large room finds somebody.
    expect(
      named.filter((label) => label === "Host controls for Rosalind Chase").length,
    ).toBeGreaterThan(0);
    // And the badge is drawn for everybody, whoever is reading.
    expect(rendered.textContent).toContain("Host");
  });

  it("says on the header's own line when the door has been shut", async () => {
    const rendered = await draw();
    welcomeWith(sockets[0], roomOfTwo("host"), { spotlight: null, locked: true });
    await settle();

    expect(rendered.textContent).toContain("Locked");
  });
});

describe("a member a host put out of the room", () => {
  it("is told what happened and offered no way back in", async () => {
    const rendered = await draw();
    const socket = sockets[0];
    expect(socket).toBeDefined();

    socket?.deliver({ v: 1, type: "refused", reason: "removed" });
    await settle();

    expect(rendered.textContent).toContain("You Were Removed From This Meeting");
    const controls = [...rendered.querySelectorAll("button")].map((control) =>
      control.textContent?.trim(),
    );
    // The join would be refused while the meeting runs, and offering it would be the screen
    // inviting a member to be told no.
    expect(controls).not.toContain("Rejoin");
    expect(rendered.textContent).toContain("Back to the Event");
  });
});

describe("ending a meeting somebody else is running", () => {
  it("answers with the authority question and the one remedy that is open", async () => {
    const answer = (method: string, path: string): Response => {
      requests.push({ method, path });
      if (method === "GET" && path === `/api/v1/meetings/${MEETING_ID}`) {
        return new Response(JSON.stringify(SUMMARY), {
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
      if (path.endsWith("/end")) {
        return new Response(
          JSON.stringify({
            type: "https://api.magnacarta.esq/problems/meeting-not-host",
            title: "You are not hosting this meeting",
            status: 403,
          }),
          { status: 403, headers: { "content-type": "application/problem+json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const stub = ((request: Request | string, init?: RequestInit) => {
      if (typeof request === "string") {
        return Promise.resolve(answer(init?.method ?? "GET", new URL(request, ORIGIN).pathname));
      }
      return Promise.resolve(answer(request.method, new URL(request.url).pathname));
    }) as unknown as typeof fetch;
    client.setConfig({ baseUrl: ORIGIN, fetch: stub });
    vi.stubGlobal("fetch", stub);

    const rendered = await draw();
    // Nobody in this room holds a grant, which is the state a claim exists to end.
    welcomeWith(sockets[0], roomOfTwo(null));
    await settle();

    const open = [...rendered.querySelectorAll("button")].find(
      (control) => control.textContent?.trim() === "End Meeting",
    );
    open?.click();
    await settle();

    // The panel's own commit, not the band's control of the same name: both read "End Meeting",
    // which is the point of the verb appearing in both places.
    const panel = document.body.querySelector('[role="alertdialog"]');
    const commit = [...(panel?.querySelectorAll("button") ?? [])].find(
      (control) => control.textContent?.trim() === "End Meeting",
    );
    expect(commit).toBeDefined();
    commit?.click();
    await settle();

    // Holding the key is not holding the room. The remedy is somebody handing it over — or, in a
    // room nobody is running, taking it.
    expect(panel?.textContent).toContain("You Are Not Hosting This Meeting");
    const offered = [...document.body.querySelectorAll("button")].map((control) =>
      control.textContent?.trim(),
    );
    expect(offered).toContain("Claim Hosting");
  });
});

describe("somebody following a link back to a meeting they are barred from", () => {
  it("is told, at the door, without a way to try again", async () => {
    const answer = (method: string, path: string): Response => {
      requests.push({ method, path });
      if (method === "GET" && path === `/api/v1/meetings/${MEETING_ID}`) {
        return new Response(JSON.stringify(SUMMARY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (path.endsWith("/join")) {
        return new Response(
          JSON.stringify({
            type: "https://api.magnacarta.esq/problems/meeting-removed",
            title: "You were removed from this meeting",
            status: 409,
          }),
          { status: 409, headers: { "content-type": "application/problem+json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const stub = ((request: Request | string, init?: RequestInit) => {
      if (typeof request === "string") {
        return Promise.resolve(answer(init?.method ?? "GET", new URL(request, ORIGIN).pathname));
      }
      return Promise.resolve(answer(request.method, new URL(request.url).pathname));
    }) as unknown as typeof fetch;
    client.setConfig({ baseUrl: ORIGIN, fetch: stub });
    vi.stubGlobal("fetch", stub);

    const rendered = await draw();

    // The same state the socket's own refusal settles on: one sentence, the way back to the event,
    // and no Rejoin — the join has just been refused and pressing it again would be refused too.
    expect(rendered.textContent).toContain("You Were Removed From This Meeting");
    const controls = [...rendered.querySelectorAll("button")].map((control) =>
      control.textContent?.trim(),
    );
    expect(controls).not.toContain("Rejoin");
  });
});

describe("a large room", () => {
  it("pages the gallery and states how much of the room is on screen", async () => {
    const rendered = await draw();
    const socket = sockets[0];
    expect(socket).toBeDefined();

    // The room says hello before it says anything about who is in it, and the screen reads it in
    // that order: nothing about the room's contents is taken from a socket that has not been
    // welcomed, because a frame landing in that gap names people an empty roster cannot hold.
    socket?.deliver({ v: 1, type: "welcome", participantId: "attendance_1", roster: [] });
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
