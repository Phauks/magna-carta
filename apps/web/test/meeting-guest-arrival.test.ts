// @vitest-environment happy-dom
/*
 * Somebody from outside the firm, arriving from the link they were sent — driven through the real
 * page against a fake transport, fake devices and a fake room.
 *
 * WHAT IS PINNED is what the guest lane promises and no type can hold. Opening the link spends
 * nothing: the device preview runs and nothing is joined until the person presses Join. The name
 * at the door starts as the invited Directory name and is theirs to change, and what they typed is
 * what the arrival carries. Every guest call carries the credential in its header and no cookie.
 * Nor a referrer: the page's own address is the link, so a referrer would carry its secret into
 * every request record. The socket carries the grant as its subprotocol and never in its address.
 * The waiting surface is the member's, and the room is the member's with the identifiers taken out
 * and no host control anywhere; a guest who comes back after being in the room comes back to the
 * door. A link whose signature does not verify gets one flat sentence that says nothing; one that
 * verifies but cannot be used gets a sentence the person can act on. And a page that breaks says
 * so without printing its own address or offering a way into the application.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { breadcrumbs, clearBreadcrumbs } from "$lib/diagnostics/breadcrumbs.ts";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { meetingProblemType } from "../src/lib/meetings/meetings-api.ts";
import {
  guestNameRefusal,
  MAX_GUEST_NAME_LENGTH,
  normalizeGuestName,
} from "../src/lib/meetings/guest-api.ts";
import { isGuestPageAddress } from "../src/lib/meetings/guest-render-boundary.svelte";
import type { GuestDeviceSeams } from "../src/lib/meetings/client/guest-devices.ts";
import { ANNOUNCEMENT_REWRITE_MILLISECONDS } from "../src/lib/meetings/client/recording.svelte.ts";
import { pageRecordingSounds } from "../src/lib/meetings/client/recording-sounds.ts";
import GuestErrorPage from "../src/routes/join/+error.svelte";
import { page } from "./stubs/app-state.ts";
import Harness from "./guest-meeting-harness.svelte";
import RootLayoutHarness from "./root-layout-harness.svelte";
import ThrowingPage from "./throwing-page.svelte";

/** An origin for the client's relative operation paths, which Node cannot resolve on its own. */
const ORIGIN = "https://app.example";
const TOKEN = "token_for_acme";
const GRANT = "grant_for_jane";
/** The grant a second arrival on the same link is answered with. */
const SECOND_GRANT = "grant_for_jane_again";

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
  readonly referrerPolicy: string;
  readonly body: unknown;
}

let requests: Recorded[] = [];
let sockets: FakeSocket[] = [];
let captures: MediaStreamConstraints[] = [];
/** How many times the ROOM asked for the microphone and camera, as distinct from the door's preview. */
let roomCaptures = 0;
let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

/** The signaling socket, captured so a case can speak to the page as the room would. */
class FakeSocket {
  readonly sent: string[] = [];
  readonly url: string;
  /** The subprotocols the page offered, which is where the grant travels. */
  readonly protocols: readonly string[];
  readonly #listeners = new Map<string, (event: { data: string }) => void>();

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols === undefined ? [] : [protocols].flat();
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

  /** The connection going away underneath the page, which is not anybody leaving. */
  drop(): void {
    this.#listeners.get("close")?.({ data: "" });
  }
}

/** A gain ramp the fake device accepts and ignores: what is counted is the note, not its shape. */
const noRamp = (): void => {};

/**
 * An audio device as Safari hands one to a page: suspended when it is made, running only once a
 * resume is honoured, and counting every note asked of it rather than playing it.
 */
class FakeAudioContext {
  static made: FakeAudioContext[] = [];
  /** Whether a resume is honoured — as it is inside a press, and is not outside one on Safari. */
  static honoursResume = false;
  state: "suspended" | "running" | "closed" = "suspended";
  currentTime = 0;
  readonly destination = {};
  resumes = 0;
  notes = 0;
  constructor() {
    FakeAudioContext.made.push(this);
  }
  resume(): Promise<void> {
    this.resumes += 1;
    if (FakeAudioContext.honoursResume) this.state = "running";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
  createOscillator(): Record<string, unknown> {
    return {
      type: "",
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start: () => {
        this.notes += 1;
      },
      stop: () => {},
    };
  }
  createGain(): Record<string, unknown> {
    return {
      gain: {
        setValueAtTime: noRamp,
        linearRampToValueAtTime: noRamp,
        exponentialRampToValueAtTime: noRamp,
      },
      connect: (node: unknown) => node,
    };
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

/**
 * Answer the guest routes, and record every request made through either transport. `arrival` is one
 * answer for every arrival, or a list given out in order with the last one repeated.
 */
function serve(answers: { summary?: Answer; arrival?: Answer | readonly Answer[] } = {}): void {
  const arrivalAnswers = answers.arrival === undefined ? [] : [answers.arrival].flat();
  let arrivalsServed = 0;
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
      referrerPolicy: isRequest ? request.referrerPolicy : (init?.referrerPolicy ?? ""),
      body: text === "" ? null : JSON.parse(text),
    });
    if (path === "/api/v1/guest/meeting") {
      return respond(answers.summary ?? { status: 200, body: SUMMARY });
    }
    if (path === "/api/v1/guest/arrivals") {
      const answer = arrivalAnswers[Math.min(arrivalsServed, arrivalAnswers.length - 1)];
      arrivalsServed += 1;
      return respond(answer ?? { status: 201, body: ARRIVAL });
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

/** Type into the name field as a person would, replacing what is there. */
function typeName(name: string): void {
  const field = nameField();
  if (field !== null) {
    field.value = name;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  flushSync();
}

/** The arrivals the page has made, in order. */
function arrivals(): Recorded[] {
  return requests.filter((request) => request.path === "/api/v1/guest/arrivals");
}

/** Press a control on the page by what it says. */
function press(label: string): void {
  [...target.querySelectorAll("button")]
    .find((control) => control.textContent?.trim() === label)
    ?.click();
}

/** Knock, be let in, and be welcomed into an otherwise empty room. */
async function enterTheRoom(): Promise<FakeSocket | undefined> {
  pressJoin();
  await settle();
  const socket = sockets.at(-1);
  socket?.deliver({ v: 1, type: "admitted", at: "2026-09-24T18:02:00Z" });
  socket?.deliver({
    v: 1,
    type: "welcome",
    participantId: ARRIVAL.participantId,
    roster: [],
    roomState: { spotlight: null, locked: false },
  });
  await settle();
  return socket;
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

const declinedCapture = (): Promise<never> => {
  roomCaptures += 1;
  return Promise.reject(new Error("NotAllowedError"));
};

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  requests = [];
  sockets = [];
  captures = [];
  roomCaptures = 0;
  queryClient.clear();
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  vi.stubGlobal("WebSocket", FakeSocket);
  // The room's own capture after admission. Declined, which is a real state of a real browser and
  // needs no media at all: these cases are about the door and the roster, not about pictures.
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: declinedCapture,
      getDisplayMedia: declinedCapture,
      // What the browser can process a capture with, asked once as the room client is built.
      getSupportedConstraints: () => ({}),
    },
  });
  serve();
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  // The page's one tone device outlives a screen by design; each case starts with none open.
  pageRecordingSounds.release();
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
    // And no referrer: the page is at `/join/<token>`, so one would carry the link's secret.
    expect(requests[0]?.referrerPolicy).toBe("no-referrer");
  });

  it("tells the browser to send no referrer for anything the page loads", async () => {
    await draw();

    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    expect(meta?.content).toBe("no-referrer");
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

  it("keeps a name written outside the Basic Multilingual Plane whole, counting its characters", async () => {
    await draw();
    // Fifty-two characters and ninety-two UTF-16 units: over the limit by one count, well inside it
    // by the count the server keeps.
    const name = `Jane Hollis ${"\u{1F33B}".repeat(40)}`;
    expect(name.length).toBeGreaterThan(MAX_GUEST_NAME_LENGTH);

    typeName(name);
    pressJoin();
    await settle();

    expect(arrivals()[0]?.body).toEqual({ confirmedName: name });
  });

  it("strips the controls and invisible marks that make one name read as another", async () => {
    await draw();

    typeName("\u202EJane\u200B\u200D Hollis\u0007\tEsq.\uFEFF");
    pressJoin();
    await settle();

    expect(arrivals()[0]?.body).toEqual({ confirmedName: "Jane Hollis Esq." });
  });

  it("will not knock under a name made only of invisible characters, and says why", async () => {
    await draw();

    typeName("\u200B\u200C\u200D\u2060\uFEFF");
    pressJoin();
    await settle();

    expect(target.textContent).toContain("Enter the name the host will see at the door.");
    expect(arrivals()).toHaveLength(0);
  });

  it("will not knock under a name longer than the door holds, and says how long it may be", async () => {
    await draw();

    typeName("\u{1F33B}".repeat(MAX_GUEST_NAME_LENGTH + 1));
    pressJoin();
    await settle();

    expect(target.textContent).toContain("Enter a name of 80 characters or fewer.");
    expect(arrivals()).toHaveLength(0);
  });

  it("counts and cleans a name the way the server does", () => {
    expect(normalizeGuestName("  Jane \t\n Hollis  ")).toBe("Jane Hollis");
    expect(normalizeGuestName("\u200B")).toBe("");
    expect(guestNameRefusal("\u{1F33B}".repeat(MAX_GUEST_NAME_LENGTH))).toBeUndefined();
    expect(guestNameRefusal("a".repeat(MAX_GUEST_NAME_LENGTH + 1))).toBeDefined();
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
    // The grant rides the upgrade's subprotocol list, named first so the server can echo the name,
    // and never the address, which is what request logs write down. The meeting is not in the path
    // either: it is a fact of the grant.
    const address = new URL(socket?.url ?? "");
    expect(address.pathname).toBe("/api/v1/guest/meeting/socket");
    expect(address.search).toBe("");
    expect(socket?.url).not.toContain(GRANT);
    expect(socket?.protocols).toEqual(["meeting-guest", GRANT]);
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
    expect(departure?.referrerPolicy).toBe("no-referrer");
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
    expect(transcript?.referrerPolicy).toBe("no-referrer");
    const arrival = arrivals()[0];
    expect(arrival?.referrerPolicy).toBe("no-referrer");
    expect(arrival?.credentials).toBe("omit");
  });

  it("builds nothing from a poll or a question the room relays, and offers neither panel", async () => {
    await draw();
    const socket = await enterTheRoom();

    socket?.deliver({
      v: 1,
      type: "poll-opened",
      poll: {
        id: "meetingPoll_1",
        meetingId: "meeting_1",
        askedByUserId: null,
        question: "Which date works for the hearing?",
        anonymous: false,
        maxChoices: 1,
        openedAt: "2026-09-24T18:05:00.000Z",
        closedAt: null,
        closedByUserId: null,
        options: [
          { optionId: "meetingPollOption_1", position: 0, label: "Thursday", count: 0 },
          { optionId: "meetingPollOption_2", position: 1, label: "Friday", count: 0 },
        ],
        respondents: 0,
      },
    });
    socket?.deliver({
      v: 1,
      type: "question-asked",
      question: {
        id: "meetingQuestion_1",
        meetingId: "meeting_1",
        participantKind: "member",
        participantId: "attendance_2",
        userId: null,
        body: "When is the filing due?",
        askedAt: "2026-09-24T18:06:00.000Z",
        answeredAt: null,
        answeredByUserId: null,
        redactedAt: null,
        redactedByUserId: null,
        upvotes: 0,
      },
    });
    await settle();

    // Answering and asking are a member's routes, so a guest is shown neither, and nothing is read.
    const names = controlNames();
    expect(names.some((name) => name.startsWith("Polls"))).toBe(false);
    expect(names.some((name) => name.startsWith("Q&A") || name.startsWith("Questions"))).toBe(
      false,
    );
    expect(document.body.textContent).not.toContain("Which date works for the hearing?");
    expect(document.body.textContent).not.toContain("When is the filing due?");
    expect(document.body.textContent).not.toContain("A poll is open");
    expect(requests.some((request) => /polls|questions/.test(request.path))).toBe(false);
  });

  it("goes back to the door, not into the room, when a guest who was in it comes back", async () => {
    serve({
      arrival: [
        { status: 201, body: ARRIVAL },
        // The server puts a returning arrival on a stay that had been let in back at the door.
        { status: 201, body: { ...ARRIVAL, guestGrant: SECOND_GRANT } },
      ],
    });
    await draw();
    const first = await enterTheRoom();
    expect(controlNames()).toContain("Leave");
    const capturedInTheRoom = roomCaptures;

    first?.drop();
    await settle();
    expect(target.textContent).toContain("The Room Stopped Answering");
    press("Rejoin");
    await settle();

    // The same name, a fresh grant on a fresh socket, and the door rather than the room.
    expect(arrivals()).toHaveLength(2);
    expect(arrivals()[1]?.body).toEqual(arrivals()[0]?.body);
    const second = sockets.at(-1);
    expect(second).not.toBe(first);
    expect(second?.protocols).toEqual(["meeting-guest", SECOND_GRANT]);
    second?.deliver({ v: 1, type: "lobby", position: 1, waiting: 1, at: "2026-09-24T18:10:00Z" });
    await settle();

    expect(target.textContent).toContain("Waiting to Be Let In");
    expect(target.textContent).not.toContain("The Room Stopped Answering");
    expect(controlNames()).not.toContain("Mute your microphone");
    // Nothing is captured at the door, however recently this browser was in the room.
    expect(roomCaptures).toBe(capturedInTheRoom);

    // Let in again, the room comes back.
    second?.deliver({ v: 1, type: "admitted", at: "2026-09-24T18:11:00Z" });
    second?.deliver({
      v: 1,
      type: "welcome",
      participantId: ARRIVAL.participantId,
      roster: [],
      roomState: { spotlight: null, locked: false },
    });
    await settle();
    expect(target.textContent).not.toContain("Waiting to Be Let In");
    expect(controlNames()).toContain("Leave");
  });

  it("says the firm withdrew the link when the room lets a guest go for it, and offers no way back in", async () => {
    await draw();
    const socket = await enterTheRoom();
    expect(controlNames()).toContain("Leave");

    socket?.deliver({ v: 1, type: "refused", reason: "withdrawn" });
    await settle();

    // The link's own refusal, in the words the link says it in when pressed again.
    expect(target.textContent).toContain("This Link Was Withdrawn");
    expect(target.textContent).toContain("The firm withdrew this link.");
    // Neither the removal sentence nor the connection-lost surface: nobody took this guest out, and
    // nothing went wrong with the connection.
    expect(target.textContent).not.toContain("You Were Removed From This Meeting");
    expect(target.textContent).not.toContain("The Room Stopped Answering");
    expect(controlNames()).not.toContain("Rejoin");
    expect(controlNames()).not.toContain("Leave");

    // The grant went with the link, so leaving the page closes nothing a second time.
    if (instance !== undefined) void unmount(instance);
    instance = undefined;
    await settle();
    expect(requests.some((request) => request.path === "/api/v1/guest/departures")).toBe(false);
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

  it.each([
    [404, null],
    [401, null],
    [
      403,
      { type: "https://api.magnacarta.esq/problems/forbidden", title: "Forbidden", status: 403 },
    ],
  ])(
    "answered %i with no problem of the link's own gets the flat sentence",
    async (status, body) => {
      serve({ summary: { status, body } });
      const rendered = await draw();

      expect(rendered.textContent).toContain("This link does not open anything.");
      expect(rendered.textContent).not.toContain("Ask the firm");
      expect(nameField()).toBeNull();
    },
  );

  it("that has expired says so, and says to ask the firm for a new one", async () => {
    serve({
      summary: {
        status: 410,
        body: { type: meetingProblemType("guest-link-expired"), title: "Expired", status: 410 },
      },
    });
    const rendered = await draw();

    expect(rendered.textContent).toContain("This Link Has Expired");
    expect(rendered.textContent).toContain("This link has expired. Ask the firm for a new one.");
    expect(nameField()).toBeNull();
  });

  it("that the firm withdrew says so, and nothing more", async () => {
    serve({
      summary: {
        status: 410,
        body: { type: meetingProblemType("guest-link-revoked"), title: "Withdrawn", status: 410 },
      },
    });
    const rendered = await draw();

    expect(rendered.textContent).toContain("This Link Was Withdrawn");
    expect(rendered.textContent).toContain("The firm withdrew this link.");
    expect(nameField()).toBeNull();
  });

  it("that has been used too many times says so when Join is pressed, and replaces the door", async () => {
    serve({
      arrival: {
        status: 409,
        body: { type: meetingProblemType("guest-link-exhausted"), title: "Used up", status: 409 },
      },
    });
    await draw();
    pressJoin();
    await settle();

    expect(target.textContent).toContain(
      "This link has been used too many times. Ask the firm for a new one.",
    );
    expect(nameField()).toBeNull();
  });

  it("on a meeting that has ended says it is over rather than offering the door", async () => {
    serve({ summary: { status: 200, body: { ...SUMMARY, status: "ended" } } });
    const rendered = await draw();

    expect(rendered.textContent).toContain("This Meeting Has Ended");
    expect(nameField()).toBeNull();
  });
});

describe("a guest's page that breaks", () => {
  const ADDRESS = `https://magna-carta.test/join/${TOKEN}`;

  afterEach(() => {
    page.url = new URL("https://magna-carta.test/");
    page.error = null;
    clearBreadcrumbs();
    vi.restoreAllMocks();
  });

  it("knows a guest's address from the application's", () => {
    expect(isGuestPageAddress(`/join/${TOKEN}`)).toBe(true);
    expect(isGuestPageAddress("/join")).toBe(true);
    expect(isGuestPageAddress("/joinery")).toBe(false);
    expect(isGuestPageAddress("/meetings/meeting_1")).toBe(false);
  });

  it("says one sentence and the Error ID, and never prints the address or offers the application", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    page.url = new URL(ADDRESS);

    instance = mount(RootLayoutHarness, { target, props: { Page: ThrowingPage } });
    flushSync();
    const text = target.textContent ?? "";

    expect(text).toContain(
      "Something went wrong on this page. Reload, or ask the firm for a new link.",
    );
    expect(text).toMatch(/client_[0-9A-HJKMNP-TV-Z]{8}/u);
    // The address is the link: not on the screen, not in the markup, not in the breadcrumb.
    expect(target.innerHTML).not.toContain(TOKEN);
    expect(text).not.toContain("PAGE /join");
    expect(target.querySelectorAll("a")).toHaveLength(0);
    expect(target.innerHTML).not.toContain("/login");
    expect(controlNames()).not.toContain("Report a problem");
    const crumb = breadcrumbs().find((entry) => entry.label.startsWith("crash client_"));
    expect(crumb?.route).toBe("/join");
  });

  it("keeps the application's own crash screen everywhere else", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    page.url = new URL("https://magna-carta.test/meetings");

    instance = mount(RootLayoutHarness, { target, props: { Page: ThrowingPage } });
    flushSync();

    expect(target.textContent).toContain("PAGE /meetings");
    expect(target.textContent).not.toContain("ask the firm for a new link");
  });

  it("says the same when the page failed while it loaded", () => {
    page.url = new URL(ADDRESS);
    page.error = { message: "Internal Error", errorId: "client_ABCDEFGH" };

    instance = mount(GuestErrorPage, { target });
    flushSync();
    const text = target.textContent ?? "";

    expect(text).toContain(
      "Something went wrong on this page. Reload, or ask the firm for a new link.",
    );
    expect(text).toContain("client_ABCDEFGH");
    expect(target.innerHTML).not.toContain(TOKEN);
    expect(target.querySelectorAll("a")).toHaveLength(0);
  });
});

describe("a recording, as a guest meets it", () => {
  const recording = {
    state: "started",
    // A guest's copy of the announcement names no firm record: no handle for the recording, and no
    // member handle for who started it. The mark, the banner and the tone are owed all the same.
    recordingId: null,
    by: { userId: null, displayName: "Rosalind Chase" },
    at: "2026-09-24T18:05:00Z",
  };

  function recordingMark(): Element | null {
    return target.querySelector("[data-recording-mark]");
  }

  /** Let the live region's rewrite land: it is emptied at a transition and written a moment later. */
  async function rewritten(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ANNOUNCEMENT_REWRITE_MILLISECONDS + 20));
    await settle();
  }

  it("is marked in the guest's header from the announcement until the stop, and announced", async () => {
    await draw();
    const socket = await enterTheRoom();
    expect(recordingMark()).toBeNull();

    socket?.deliver({ v: 1, type: "recording", ...recording });
    await settle();
    await rewritten();
    expect(recordingMark()?.textContent).toContain("Recording");
    expect(target.querySelector("[data-recording-notice]")?.textContent).toContain(
      "Rosalind Chase started recording this meeting.",
    );
    expect(target.querySelector('[aria-live="assertive"]')?.textContent?.trim()).toBe(
      "Recording in progress",
    );
    expect(document.body.innerHTML).not.toContain("meetingRecording_");
    // A guest holds no grant on the room, so neither act is offered to them.
    const names = controlNames();
    expect(names).not.toContain("Record");
    expect(names).not.toContain("Stop Recording");
    expect(document.body.innerHTML).not.toContain("usr_");

    // The member's own banner component: Dismiss takes the banner and leaves the mark.
    target
      .querySelector<HTMLButtonElement>('[data-recording-notice] button[aria-label="Dismiss"]')
      ?.click();
    await settle();
    expect(target.querySelector("[data-recording-notice]")).toBeNull();
    expect(recordingMark()).not.toBeNull();

    socket?.deliver({ v: 1, type: "recording", ...recording, state: "stopped" });
    await settle();
    await rewritten();
    expect(recordingMark()).toBeNull();
    expect(target.querySelector('[aria-live="assertive"]')?.textContent?.trim()).toBe(
      "Recording stopped",
    );
  });

  it("is told on being let in while a recording runs, from the welcome", async () => {
    await draw();
    pressJoin();
    await settle();
    const socket = sockets.at(-1);
    socket?.deliver({ v: 1, type: "admitted", at: "2026-09-24T18:06:00Z" });
    socket?.deliver({
      v: 1,
      type: "welcome",
      participantId: ARRIVAL.participantId,
      roster: [],
      roomState: { spotlight: null, locked: false },
      recording,
    });
    await settle();
    await rewritten();

    expect(recordingMark()).not.toBeNull();
    expect(target.querySelector("[data-recording-notice]")?.textContent).toContain(
      "This meeting is being recorded.",
    );
    expect(target.querySelector('[aria-live="assertive"]')?.textContent?.trim()).toBe(
      "Recording in progress",
    );
  });

  /** Let a guest in on the newest socket, with a welcome that carries the running recording. */
  async function admitIntoTheRecording(): Promise<FakeSocket | undefined> {
    const socket = sockets.at(-1);
    socket?.deliver({ v: 1, type: "admitted", at: "2026-09-24T18:06:00Z" });
    socket?.deliver({
      v: 1,
      type: "welcome",
      participantId: ARRIVAL.participantId,
      roster: [],
      roomState: { spotlight: null, locked: false },
      recording,
    });
    await settle();
    await rewritten();
    return socket;
  }

  it("opens and resumes the tone's audio inside the Join press, and plays no tone it cannot play now", async () => {
    FakeAudioContext.made = [];
    FakeAudioContext.honoursResume = false;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    await draw();
    expect(FakeAudioContext.made).toHaveLength(0);

    pressJoin();
    // Inside the press itself, before the arrival's write is answered.
    expect(FakeAudioContext.made).toHaveLength(1);
    const device = FakeAudioContext.made[0];
    expect(device?.resumes).toBe(1);

    await settle();
    await admitIntoTheRecording();
    // Still suspended: the announcement is on screen and in the region, and the tone is not played.
    expect(device?.notes).toBe(0);
    expect(target.querySelector("[data-recording-notice]")).not.toBeNull();
    expect(target.querySelector('[aria-live="assertive"]')?.textContent?.trim()).toBe(
      "Recording in progress",
    );

    // A press in the room wakes it, and the tone that could not sound then is not played late.
    FakeAudioContext.honoursResume = true;
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(device?.state).toBe("running");
    await settle();
    expect(device?.notes).toBe(0);
  });

  it("is told again on screen after a reconnect into the same recording, without a second tone", async () => {
    FakeAudioContext.made = [];
    FakeAudioContext.honoursResume = true;
    vi.stubGlobal("AudioContext", FakeAudioContext);
    await draw();
    pressJoin();
    await settle();
    const first = await admitIntoTheRecording();
    const device = FakeAudioContext.made[0];
    // The two rising notes of the arrival, once.
    expect(device?.notes).toBe(2);
    target
      .querySelector<HTMLButtonElement>('[data-recording-notice] button[aria-label="Dismiss"]')
      ?.click();
    await settle();
    expect(target.querySelector("[data-recording-notice]")).toBeNull();

    first?.drop();
    await settle();
    press("Rejoin");
    await settle();
    await admitIntoTheRecording();

    // The room wrote this welcome down as another occasion the guest was told, and so does the page.
    expect(target.querySelector("[data-recording-notice]")?.textContent).toContain(
      "This meeting is being recorded.",
    );
    expect(target.querySelector('[aria-live="assertive"]')?.textContent?.trim()).toBe(
      "Recording in progress",
    );
    expect(device?.notes).toBe(2);
  });
});
