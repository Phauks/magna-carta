// @vitest-environment happy-dom
/*
 * Somebody from outside the firm, arriving from the link they were sent — driven through the real
 * page against a fake transport, fake devices and a fake room.
 *
 * WHAT IS PINNED is what the guest lane promises and no type can hold. Opening the link spends
 * nothing: the device preview runs and nothing is joined until the person presses Join. The name
 * at the door starts as the invited Directory name and is theirs to change, and what they typed is
 * what the arrival carries. Every guest call carries the credential in its header and no cookie.
 * The waiting surface is the member's, and the room is the member's with the identifiers taken out
 * and no host control anywhere. A link whose signature does not verify gets one flat sentence that
 * says nothing; one that verifies but cannot be used gets a sentence the person can act on.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { meetingProblemType } from "../src/lib/meetings/meetings-api.ts";
import type { GuestDeviceSeams } from "../src/lib/meetings/client/guest-devices.ts";
import Harness from "./guest-meeting-harness.svelte";

/** An origin for the client's relative operation paths, which Node cannot resolve on its own. */
const ORIGIN = "https://app.example";
const TOKEN = "token_for_acme";
const GRANT = "grant_for_jane";

const SUMMARY = {
  firmName: "Goldsmith and Associates",
  title: "Settlement conference",
  startsOn: "2026-09-24",
  startsAtTime: "14:00",
  endsAtTime: "15:00",
  timeZone: "America/New_York",
  medium: "video",
  status: "live",
  invitedName: "Acme Corporation",
};

const ARRIVAL = {
  waiting: true,
  participantId: "meetingGuestStay_1",
  displayName: "Jane Hollis",
  iceServers: [],
  medium: "video",
  guestGrant: GRANT,
};

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly guestHeader: string | null;
  readonly credentials: string;
  readonly body: unknown;
}

let requests: Recorded[] = [];
let sockets: FakeSocket[] = [];
let captures: MediaStreamConstraints[] = [];
let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

/** The signaling socket, captured so a case can speak to the page as the room would. */
class FakeSocket {
  readonly sent: string[] = [];
  readonly url: string;
  readonly #listeners = new Map<string, (event: { data: string }) => void>();

  constructor(url: string) {
    this.url = url;
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

/** A device track as far as the check reads one: its kind, where it came from, and a way to stop. */
function track(kind: "audio" | "video", deviceId: string): MediaStreamTrack {
  return {
    kind,
    stop: () => undefined,
    getSettings: () => ({ deviceId }),
  } as unknown as MediaStreamTrack;
}

/** The devices a guest's browser offers: two microphones and a camera, all of them working. */
function fakeDevices(): GuestDeviceSeams {
  return {
    getUserMedia: (constraints) => {
      captures.push(constraints);
      return Promise.resolve(
        new MediaStream([track("audio", "microphone_1"), track("video", "camera_1")]),
      );
    },
    enumerateDevices: () =>
      Promise.resolve([
        { kind: "audioinput", deviceId: "microphone_1", label: "Built-in Microphone" },
        { kind: "audioinput", deviceId: "microphone_2", label: "Headset" },
        { kind: "videoinput", deviceId: "camera_1", label: "Built-in Camera" },
      ] as unknown as MediaDeviceInfo[]),
    createAudioLevelMeter: () => ({ start: () => undefined, stop: () => undefined }),
  };
}

/** How the transport answers one request. */
type Answer = { readonly status: number; readonly body: unknown };

/** One answer, as the transport would give it. */
function respond(answer: Answer): Response {
  return new Response(answer.body === null ? null : JSON.stringify(answer.body), {
    status: answer.status,
    headers: { "content-type": "application/json" },
  });
}

/** Answer the guest routes, and record every request made through either transport. */
function serve(answers: { summary?: Answer; arrival?: Answer } = {}): void {
  const stub = (async (request: Request | string, init?: RequestInit) => {
    const isRequest = typeof request !== "string";
    const method = isRequest ? request.method : (init?.method ?? "GET");
    const path = new URL(isRequest ? request.url : request, ORIGIN).pathname;
    const headers = new Headers(isRequest ? request.headers : init?.headers);
    const text = isRequest ? await request.clone().text() : "";
    requests.push({
      method,
      path,
      guestHeader: headers.get("x-meeting-guest"),
      credentials: isRequest ? request.credentials : (init?.credentials ?? ""),
      body: text === "" ? null : JSON.parse(text),
    });
    if (path === "/api/v1/guest/meeting") {
      return respond(answers.summary ?? { status: 200, body: SUMMARY });
    }
    if (path === "/api/v1/guest/arrivals") {
      return respond(answers.arrival ?? { status: 201, body: ARRIVAL });
    }
    if (path === "/api/v1/guest/meeting/messages") {
      return respond({ status: 200, body: { data: [], nextCursor: null, redacted: [] } });
    }
    return respond({ status: 200, body: { ok: true } });
  }) as unknown as typeof fetch;

  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
  vi.stubGlobal("fetch", stub);
}

/** Let the reads, the arrival and the socket settle; each is a few turns of the loop deep. */
async function settle(remaining = 6): Promise<void> {
  if (remaining === 0) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  await settle(remaining - 1);
}

async function draw(): Promise<HTMLElement> {
  instance = mount(Harness, { target, props: { token: TOKEN, deviceSeams: fakeDevices() } });
  flushSync();
  await settle();
  return target;
}

function nameField(): HTMLInputElement | null {
  return target.querySelector<HTMLInputElement>('input[autocomplete="name"]');
}

function pressJoin(): void {
  const join = [...target.querySelectorAll("button")].find(
    (control) => control.textContent?.trim() === "Join Meeting",
  );
  join?.click();
}

/** Every control's accessible name, wherever it is drawn. */
function controlNames(): string[] {
  return [...document.body.querySelectorAll("button")].map(
    (control) => control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "",
  );
}

const declinedCapture = (): Promise<never> => Promise.reject(new Error("NotAllowedError"));

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  requests = [];
  sockets = [];
  captures = [];
  queryClient.clear();
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  vi.stubGlobal("WebSocket", FakeSocket);
  // The room's own capture after admission. Declined, which is a real state of a real browser and
  // needs no media at all: these cases are about the door and the roster, not about pictures.
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: declinedCapture, getDisplayMedia: declinedCapture },
  });
  serve();
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  vi.unstubAllGlobals();
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("opening the link", () => {
  it("reads what the meeting is with the link's token, and spends nothing", async () => {
    const rendered = await draw();

    expect(rendered.textContent).toContain("Settlement conference");
    expect(rendered.textContent).toContain("Goldsmith and Associates");
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /api/v1/guest/meeting",
    ]);
    // The credential rides its header, and no cookie rides with it: a member session this browser
    // happens to hold has nothing to do with the person at this door.
    expect(requests[0]?.guestHeader).toBe(TOKEN);
    expect(requests[0]?.credentials).toBe("omit");
  });

  it("runs the device preview before anything is joined", async () => {
    await draw();

    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ audio: true, video: true });
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    expect(sockets).toHaveLength(0);
    // The pickers name what the browser offers, once it has been allowed to open something.
    expect(target.textContent).toContain("Microphone");
    expect(target.textContent).toContain("Camera");
  });

  it("asks for no camera in a call, and offers no camera to choose", async () => {
    serve({ summary: { status: 200, body: { ...SUMMARY, medium: "audio" } } });
    await draw();

    expect(captures[0]).toMatchObject({ audio: true, video: false });
    const labels = [...target.querySelectorAll("label")].map((label) => label.textContent?.trim());
    expect(labels).toContain("Microphone");
    expect(labels).not.toContain("Camera");
  });
});

describe("the name at the door", () => {
  it("starts as the invited name, and what the person types is what the arrival carries", async () => {
    await draw();

    const field = nameField();
    expect(field?.value).toBe("Acme Corporation");

    if (field !== null) {
      field.value = "  Jane    Hollis ";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    flushSync();
    pressJoin();
    await settle();

    const arrival = requests.find((request) => request.path === "/api/v1/guest/arrivals");
    expect(arrival?.method).toBe("POST");
    expect(arrival?.body).toEqual({ confirmedName: "Jane Hollis" });
    expect(arrival?.guestHeader).toBe(TOKEN);
  });

  it("will not knock with no name at all, and says why", async () => {
    await draw();

    const field = nameField();
    if (field !== null) {
      field.value = "   ";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    flushSync();
    pressJoin();
    await settle();

    expect(target.textContent).toContain("Enter the name the host will see at the door.");
    expect(requests.some((request) => request.path === "/api/v1/guest/arrivals")).toBe(false);
  });
});

describe("after pressing Join", () => {
  it("waits at the door on the member's own waiting surface, over a socket carrying the grant", async () => {
    await draw();
    pressJoin();
    await settle();

    const socket = sockets[0];
    // The grant rides the upgrade's address, the one place a browser lets a socket carry it, and
    // the meeting is not in the path: it is a fact of the grant.
    const address = new URL(socket?.url ?? "");
    expect(address.pathname).toBe("/api/v1/guest/meeting/socket");
    expect(address.searchParams.get("guest")).toBe(GRANT);
    socket?.deliver({ v: 1, type: "lobby", position: 2, waiting: 2, at: "2026-09-24T18:00:00Z" });
    await settle();

    expect(target.textContent).toContain("Waiting to Be Let In");
    expect(target.textContent).toContain("1 person is ahead of you.");
    // The door carries nothing but the way out: no tiles, no roster, no microphone.
    expect(controlNames()).not.toContain("Mute your microphone");
  });

  it("closes its own stay with the grant when the guest gives up at the door", async () => {
    await draw();
    pressJoin();
    await settle();

    [...target.querySelectorAll("button")]
      .find((control) => control.textContent?.trim() === "Leave")
      ?.click();
    await settle();

    const departure = requests.find((request) => request.path === "/api/v1/guest/departures");
    expect(departure?.method).toBe("POST");
    expect(departure?.guestHeader).toBe(GRANT);
    expect(target.textContent).toContain("You Left the Meeting");

    // Leaving spent nothing: the link still opens the door, and the name is asked for again.
    [...target.querySelectorAll("button")]
      .find((control) => control.textContent?.trim() === "Go Back to the Door")
      ?.click();
    await settle();
    expect(nameField()).not.toBeNull();
    expect(target.textContent).not.toContain("This Meeting Has Ended");
  });

  it("renders the room once admitted, with the identifiers absent and no host control", async () => {
    await draw();
    pressJoin();
    await settle();

    const socket = sockets[0];
    socket?.deliver({ v: 1, type: "admitted", at: "2026-09-24T18:02:00Z" });
    socket?.deliver({
      v: 1,
      type: "welcome",
      participantId: ARRIVAL.participantId,
      roster: [],
      roomState: { spotlight: null, locked: false },
    });
    // The room sends a guest's roster with every member handle taken out.
    socket?.deliver({
      v: 1,
      type: "roster",
      participants: [
        {
          participantId: ARRIVAL.participantId,
          userId: null,
          displayName: "Jane Hollis",
          sfuSessionId: null,
          tracks: [],
          hostRole: null,
        },
        {
          participantId: "attendance_2",
          userId: null,
          displayName: "Rosalind Chase",
          sfuSessionId: "session_2",
          tracks: [],
          hostRole: "host",
        },
      ],
    });
    await settle();

    expect(target.textContent).toContain("In the Room (2)");
    expect(target.textContent).toContain("Rosalind Chase");
    const names = controlNames();
    expect(names).toContain("Leave");
    expect(names).not.toContain("End Meeting");
    expect(names).not.toContain("Host controls");
    expect(names).not.toContain("Lobby");
    // No per-row host menu anywhere on the rail, and no member handle anywhere on the page.
    expect(names.some((name) => name.startsWith("Host controls for"))).toBe(false);
    expect(document.body.innerHTML).not.toContain("usr_");
    // The room's chat is read on the guest's own route, with the grant, once they are in the room.
    const transcript = requests.find(
      (request) => request.path === "/api/v1/guest/meeting/messages",
    );
    expect(transcript?.guestHeader).toBe(GRANT);
    expect(transcript?.credentials).toBe("omit");
  });

  it("says a locked room is locked under the control, and leaves the door standing", async () => {
    serve({
      arrival: {
        status: 409,
        body: { type: meetingProblemType("meeting-locked"), title: "Locked", status: 409 },
      },
    });
    await draw();
    pressJoin();
    await settle();

    expect(target.textContent).toContain("A host has locked this meeting");
    expect(nameField()).not.toBeNull();
  });
});

describe("a link that cannot be used", () => {
  it("whose signature does not verify gets one flat sentence and nothing else", async () => {
    serve({ summary: { status: 404, body: null } });
    const rendered = await draw();

    expect(rendered.textContent).toContain("This Link Cannot Be Used");
    expect(rendered.textContent).toContain("This link does not open anything.");
    expect(rendered.textContent).not.toContain("Ask the firm");
    expect(nameField()).toBeNull();
    expect(captures).toHaveLength(0);
  });

  it("that has expired says so, and says to ask the firm for a new one", async () => {
    serve({
      summary: {
        status: 410,
        body: { type: meetingProblemType("guest-link-expired"), title: "Expired", status: 410 },
      },
    });
    const rendered = await draw();

    expect(rendered.textContent).toContain("This Link Has Expired");
    expect(rendered.textContent).toContain("Ask the firm for a new link.");
    expect(nameField()).toBeNull();
  });

  it("on a meeting that has ended says it is over rather than offering the door", async () => {
    serve({ summary: { status: 200, body: { ...SUMMARY, status: "ended" } } });
    const rendered = await draw();

    expect(rendered.textContent).toContain("This Meeting Has Ended");
    expect(nameField()).toBeNull();
  });
});
