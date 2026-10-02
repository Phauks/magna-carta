// @vitest-environment happy-dom
/*
 * A recording of a meeting, as the people in the room meet it: the announcement, the mark, and the
 * control that starts and stops it.
 *
 * WHAT IS PINNED is the consent mechanism the owner ruled on, which no type can hold. The room's
 * announcement is what lights the mark — never the member's own press — and it goes out through
 * every channel at once: the tone, the words spoken, the banner, and the same sentence in an
 * assertive live region. It fires once per transition: a late arrival is told on their welcome, and a
 * connection that blinked and came back into the SAME recording is not told twice. The mark stays
 * until the room announces the stop. The Record control is drawn only for somebody holding the right
 * to record and a grant on the room, it asks before anything is sent, and the panel says that
 * everybody, guests included, will be told. A firm that has not switched recording on is told so in
 * one sentence.
 *
 * The first half drives the client against the same fakes the client's own suite uses; the second
 * drives the real room screen against a fake transport.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { client } from "@magna-carta/api-client/client";
import {
  MeetingClient,
  type MeetingClientSeams,
} from "$lib/meetings/client/meeting-client.svelte.ts";
import {
  ANNOUNCEMENT_REWRITE_MILLISECONDS,
  browserRecordingSounds,
  MeetingRecording,
  readRecordingAnnouncement,
  RECORDING_IN_PROGRESS,
  RECORDING_STOPPED,
  recordingRefusal,
  type MeetingRecordingSounds,
} from "$lib/meetings/client/recording.svelte.ts";
import { meetingProblemType } from "$lib/meetings/meetings-api.ts";
import type { Failure } from "$lib/api/problem.ts";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { page } from "./stubs/app-state.ts";
import { sessionPermissions } from "../src/lib/access/session-permissions.svelte.ts";
import Harness from "./meeting-room-harness.svelte";
import RecordingNotice from "../src/lib/meetings/screen/recording-notice.svelte";

const MEETING_ID = "meeting_1";
const ORIGIN = "https://app.example";

/** What the room broadcasts when a recording starts, as the protocol package builds it. */
function started(recordingId = "meetingRecording_1"): Record<string, unknown> {
  return {
    state: "started",
    recordingId,
    by: { userId: "usr_2", displayName: "Rosalind Chase" },
    at: "2026-09-20T15:00:00.000Z",
  };
}

/** What the room broadcasts when it stops. */
function stopped(recordingId = "meetingRecording_1"): Record<string, unknown> {
  return {
    state: "stopped",
    recordingId,
    by: { userId: "usr_2", displayName: "Rosalind Chase" },
    at: "2026-09-20T15:30:00.000Z",
  };
}

/**
 * Let the live region's rewrite land. The region is emptied at a transition and written after a
 * short wait, so a reader hears even a sentence worded like the last; this is that wait, on the real
 * clock, because the client under test keeps it with the browser's own timer.
 */
async function rewritten(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ANNOUNCEMENT_REWRITE_MILLISECONDS + 20));
}

/** The tone and the voice, counted rather than played. */
class FakeSounds implements MeetingRecordingSounds {
  readonly chimes: string[] = [];
  readonly spoken: string[] = [];
  released = 0;
  chime = (occasion: "started" | "stopped"): void => {
    this.chimes.push(occasion);
  };
  speak = (sentence: string): void => {
    this.spoken.push(sentence);
  };
  release = (): void => {
    this.released += 1;
  };
}

// ---------------------------------------------------------------------------------------------
// The client, against fakes.
// ---------------------------------------------------------------------------------------------

/** A socket the room speaks through, opened and closed as the client asks. */
class WireSocket {
  readonly sent: string[] = [];
  readonly #listeners = new Map<string, (event: { data: string }) => void>();
  addEventListener(name: string, handler: (event: { data: string }) => void): void {
    this.#listeners.set(name, handler);
  }
  send(frame: string): void {
    this.sent.push(frame);
  }
  close(): void {
    this.#listeners.get("close")?.({ data: "" });
  }
  accept(): void {
    this.#listeners.get("open")?.({ data: "" });
  }
  deliver(frame: Record<string, unknown>): void {
    this.#listeners.get("message")?.({ data: JSON.stringify(frame) });
  }
}

class QuietPeerConnection {
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
  getStats(): Promise<Map<string, unknown>> {
    return Promise.resolve(new Map());
  }
  close(): void {}
}

const opened: MeetingClient[] = [];

function wired(): {
  client: MeetingClient;
  socket: WireSocket;
  sounds: FakeSounds;
  join: () => void;
} {
  const socket = new WireSocket();
  const sounds = new FakeSounds();
  const seams = {
    createPeerConnection: () => new QuietPeerConnection(),
    openSocket: () => socket,
    getUserMedia: () => Promise.reject(new Error("NotAllowedError")),
    getDisplayMedia: () => Promise.reject(new Error("NotAllowedError")),
    createMediaStream: () => ({ getTracks: () => [] }),
    createAudioLevelMeter: () => ({ start: () => {}, stop: () => {} }),
    createRecordingSounds: () => sounds,
  } as unknown as MeetingClientSeams;
  const meeting = new MeetingClient(seams);
  opened.push(meeting);
  const join = (): void => {
    meeting.join({
      meetingId: MEETING_ID,
      participantId: "attendance_1",
      iceServers: [],
      socketUrl: "wss://example.test/api/v1/meetings/meeting_1/socket",
    });
    socket.accept();
  };
  join();
  return { client: meeting, socket, sounds, join };
}

function welcome(socket: WireSocket, recording?: Record<string, unknown>): void {
  socket.deliver({
    v: 1,
    type: "welcome",
    participantId: "attendance_1",
    roster: [],
    ...(recording === undefined ? {} : { recording }),
  });
}

afterEach(() => {
  for (const meeting of opened.splice(0)) meeting.dispose();
});

describe("reading an announcement", () => {
  it("reads the room's shape whole, and refuses one that names no recording", () => {
    expect(readRecordingAnnouncement(started())).toEqual({
      state: "started",
      recordingId: "meetingRecording_1",
      by: { userId: "usr_2", displayName: "Rosalind Chase" },
      at: "2026-09-20T15:00:00.000Z",
    });
    // A guest's copy carries no member handle, and is still an announcement.
    expect(
      readRecordingAnnouncement({ ...started(), by: { userId: null, displayName: "Rosalind" } })
        ?.by,
    ).toEqual({ userId: null, displayName: "Rosalind" });
    expect(readRecordingAnnouncement({ ...started(), recordingId: undefined })).toBeNull();
    expect(readRecordingAnnouncement({ ...started(), state: "paused" })).toBeNull();
    expect(readRecordingAnnouncement(undefined)).toBeNull();
  });
});

describe("the announcement on start", () => {
  it("lights the mark and goes out through every channel at once", async () => {
    const { client: meeting, socket, sounds } = wired();
    welcome(socket);
    expect(meeting.recording.running).toBeNull();
    expect(sounds.chimes).toEqual([]);

    socket.deliver({ v: 1, type: "recording", ...started() });

    expect(meeting.recording.running?.recordingId).toBe("meetingRecording_1");
    await rewritten();
    expect(meeting.recording.announcement).toBe(RECORDING_IN_PROGRESS);
    expect(meeting.recording.notice?.title).toBe("Recording in Progress");
    expect(meeting.recording.notice?.sentence).toBe(
      "Rosalind Chase started recording this meeting.",
    );
    expect(sounds.chimes).toEqual(["started"]);
    expect(sounds.spoken).toEqual([RECORDING_IN_PROGRESS]);
  });

  it("fires once per transition, not once per copy of the same one", () => {
    const { client: meeting, socket, sounds } = wired();
    welcome(socket);
    socket.deliver({ v: 1, type: "recording", ...started() });
    socket.deliver({ v: 1, type: "recording", ...started() });
    expect(sounds.chimes).toEqual(["started"]);
    expect(meeting.recording.running?.recordingId).toBe("meetingRecording_1");
  });

  it("holds an announcement that arrives before the welcome, which carries the same thing", () => {
    const { client: meeting, socket, sounds } = wired();
    socket.deliver({ v: 1, type: "recording", ...started() });
    expect(meeting.recording.running).toBeNull();
    welcome(socket, started());
    expect(meeting.recording.running?.recordingId).toBe("meetingRecording_1");
    expect(sounds.chimes).toEqual(["started"]);
  });
});

describe("the announcement on arrival", () => {
  it("tells somebody who arrives while a recording runs, from their own welcome", async () => {
    const { client: meeting, socket, sounds } = wired();
    welcome(socket, started());
    await rewritten();

    expect(meeting.recording.running?.recordingId).toBe("meetingRecording_1");
    expect(meeting.recording.notice?.occasion).toBe("arrival");
    expect(meeting.recording.notice?.sentence).toBe(
      "This meeting is being recorded. Rosalind Chase started the recording.",
    );
    expect(meeting.recording.announcement).toBe(RECORDING_IN_PROGRESS);
    expect(sounds.chimes).toEqual(["started"]);
    expect(sounds.spoken).toEqual([RECORDING_IN_PROGRESS]);
  });

  it("does not tell them again on a reconnect into the same recording, and restores the mark", () => {
    const { client: meeting, socket, sounds, join } = wired();
    welcome(socket, started());
    meeting.recording.dismiss();

    socket.close();
    expect(meeting.state).toBe("failed");
    // The mark goes with the socket: this browser no longer knows what the room is doing.
    expect(meeting.recording.running).toBeNull();

    join();
    welcome(socket, started());
    expect(meeting.recording.running?.recordingId).toBe("meetingRecording_1");
    expect(meeting.recording.notice).toBeNull();
    expect(sounds.chimes).toEqual(["started"]);
  });

  it("tells them on a reconnect into a DIFFERENT recording, and of a stop they missed", () => {
    const { client: meeting, socket, sounds, join } = wired();
    welcome(socket, started("meetingRecording_1"));

    socket.close();
    join();
    welcome(socket, started("meetingRecording_2"));
    expect(sounds.chimes).toEqual(["started", "started"]);

    socket.close();
    join();
    welcome(socket);
    expect(meeting.recording.running).toBeNull();
    expect(meeting.recording.notice?.occasion).toBe("stopped");
    expect(sounds.chimes).toEqual(["started", "started", "stopped"]);
  });
});

describe("the mark", () => {
  it("persists through everything else the room says, and clears on the stop", async () => {
    const { client: meeting, socket, sounds } = wired();
    welcome(socket);
    socket.deliver({ v: 1, type: "recording", ...started() });
    socket.deliver({ v: 1, type: "roster", participants: [] });
    socket.deliver({ v: 1, type: "room-state", spotlight: null, locked: true, lobby: "off" });
    meeting.recording.dismiss();
    expect(meeting.recording.running?.recordingId).toBe("meetingRecording_1");

    socket.deliver({ v: 1, type: "recording", ...stopped() });
    expect(meeting.recording.running).toBeNull();
    await rewritten();
    expect(meeting.recording.announcement).toBe(RECORDING_STOPPED);
    expect(meeting.recording.notice?.sentence).toBe("Rosalind Chase stopped the recording.");
    expect(sounds.chimes).toEqual(["started", "stopped"]);
    expect(sounds.spoken).toEqual([RECORDING_IN_PROGRESS, RECORDING_STOPPED]);
  });

  it("says nothing of a stop for a recording nobody here was told about", () => {
    const { client: meeting, socket, sounds } = wired();
    welcome(socket);
    socket.deliver({ v: 1, type: "recording", ...stopped() });
    expect(meeting.recording.notice).toBeNull();
    expect(sounds.chimes).toEqual([]);
  });

  it("goes when the member leaves, and lets go of the audio device", () => {
    const { client: meeting, socket, sounds } = wired();
    welcome(socket, started());
    meeting.leave();
    expect(meeting.recording.running).toBeNull();
    expect(meeting.recording.announcement).toBe("");
    expect(sounds.released).toBeGreaterThan(0);
  });
});

describe("the sounds a browser makes", () => {
  it("change nothing where the browser has no audio and no voice", () => {
    // Node has neither an AudioContext nor speechSynthesis, which is the browser with no voice.
    const sounds = browserRecordingSounds();
    expect(() => {
      sounds.chime("started");
      sounds.speak(RECORDING_IN_PROGRESS);
      sounds.release();
    }).not.toThrow();
  });

  it("are not the only channel: a client with none still announces on screen and to a reader", async () => {
    const recording = new MeetingRecording();
    recording.noteFrame(readRecordingAnnouncement(started()));
    await rewritten();
    expect(recording.announcement).toBe(RECORDING_IN_PROGRESS);
    expect(recording.notice?.title).toBe("Recording in Progress");
  });
});

/** A start the route refused with the named problem type. */
function failed(slug: string, status: number): Failure {
  return {
    problem: { status, type: meetingProblemType(slug) },
    request: "POST /api/v1/meetings/meeting_1/recording",
    failedAt: new Date("2026-09-20T15:00:00.000Z"),
  };
}

/** A wait driven by hand: what is waiting, and the way to let it run. */
class HandDelay {
  readonly waiting: { milliseconds: number; run: () => void; cancelled: boolean }[] = [];
  after = (milliseconds: number, run: () => void): (() => void) => {
    const entry = { milliseconds, run, cancelled: false };
    this.waiting.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  /** Run everything still waiting, as the clock passing would. */
  pass(): void {
    for (const entry of this.waiting.splice(0)) if (!entry.cancelled) entry.run();
  }
}

describe("the live region", () => {
  it("speaks two identical announcements in a row, by emptying before each one", () => {
    const delay = new HandDelay();
    const recording = new MeetingRecording(undefined, delay.after);
    const heard: string[] = [];
    const listen = (): void => {
      if (heard.at(-1) !== recording.announcement) heard.push(recording.announcement);
    };

    recording.noteFrame(readRecordingAnnouncement(started("meetingRecording_1")));
    listen();
    delay.pass();
    listen();
    // The connection blinks, and the welcome after it names a DIFFERENT recording: the same words,
    // and a transition the reader is owed.
    recording.noteDisconnected();
    recording.noteWelcome(readRecordingAnnouncement(started("meetingRecording_2")));
    listen();
    delay.pass();
    listen();

    expect(heard).toEqual(["", RECORDING_IN_PROGRESS, "", RECORDING_IN_PROGRESS]);
    expect(delay.waiting).toHaveLength(0);
  });

  it("waits the stated moment, and lets a later transition replace one still waiting", () => {
    const delay = new HandDelay();
    const recording = new MeetingRecording(undefined, delay.after);
    recording.noteFrame(readRecordingAnnouncement(started()));
    expect(delay.waiting[0]?.milliseconds).toBe(ANNOUNCEMENT_REWRITE_MILLISECONDS);

    recording.noteFrame(readRecordingAnnouncement(stopped()));
    delay.pass();
    expect(recording.announcement).toBe(RECORDING_STOPPED);
  });

  it("writes nothing after the meeting is over for this browser", () => {
    const delay = new HandDelay();
    const recording = new MeetingRecording(undefined, delay.after);
    recording.noteFrame(readRecordingAnnouncement(started()));
    recording.clear();
    delay.pass();
    expect(recording.announcement).toBe("");
  });
});

describe("the banner", () => {
  it("is one component: drawn from the concern, gone on Dismiss, and back on the next transition", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const recording = new MeetingRecording();
    const drawn = mount(RecordingNotice, { target: host, props: { recording } });
    flushSync();
    expect(host.querySelector("[data-recording-notice]")).toBeNull();

    recording.noteFrame(readRecordingAnnouncement(started()));
    flushSync();
    const banner = host.querySelector("[data-recording-notice]");
    expect(banner?.textContent).toContain("Recording in Progress");
    expect(banner?.textContent).toContain("Rosalind Chase started recording this meeting.");
    // Not a live region: the page's own region says the sentence, and saying it twice is noise.
    expect(banner?.querySelector("[aria-live]")).toBeNull();

    host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')?.click();
    flushSync();
    expect(host.querySelector("[data-recording-notice]")).toBeNull();

    recording.noteFrame(readRecordingAnnouncement(stopped()));
    flushSync();
    expect(host.querySelector("[data-recording-notice]")?.textContent).toContain(
      "Rosalind Chase stopped the recording.",
    );
    void unmount(drawn);
    host.remove();
  });
});

describe("starting and stopping", () => {
  it("does not light the mark on the route's answer, only on the room's announcement", async () => {
    const recording = new MeetingRecording();
    recording.recordThrough({
      start: () => Promise.resolve({ kind: "ok", value: {} }),
      stop: () => Promise.resolve({ kind: "ok", value: {} }),
    });
    expect(await recording.start()).toBe("committed");
    expect(recording.running).toBeNull();
  });

  it("keeps a refusal, worded for the firm that has not switched recording on", async () => {
    const recording = new MeetingRecording();
    recording.recordThrough({
      start: () =>
        Promise.resolve({
          kind: "failed",
          failure: failed("meeting-recording-not-configured", 503),
        }),
      stop: () => Promise.resolve({ kind: "ok", value: {} }),
    });
    expect(await recording.start()).toBe("refused");
    expect(recording.refusedAct).toBe("start");
    expect(recordingRefusal(recording.writeFailure, "start").sentence).toBe(
      "Recording is not switched on for this firm yet.",
    );
  });

  it("refuses both acts without a request where the client was given no routes", async () => {
    const recording = new MeetingRecording();
    expect(await recording.start()).toBe("refused");
    expect(await recording.stop()).toBe(false);
    expect(recording.writeFailure).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The room screen, against a fake transport.
// ---------------------------------------------------------------------------------------------

let requests: { method: string; path: string }[] = [];
let sockets: ScreenSocket[] = [];
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
  lobby: "off",
  configured: true,
  recordingState: "none",
  recordingConfigured: true,
  captionsAvailable: false,
};

class ScreenSocket {
  readonly #listeners = new Map<string, (event: { data: string }) => void>();
  constructor() {
    sockets.push(this);
  }
  addEventListener(name: string, handler: (event: { data: string }) => void): void {
    this.#listeners.set(name, handler);
    if (name === "open") handler({ data: "" });
  }
  send(): void {}
  close(): void {}
  deliver(frame: Record<string, unknown>): void {
    this.#listeners.get("message")?.({ data: JSON.stringify(frame) });
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status < 400 ? "application/json" : "application/problem+json" },
  });

/** Answer the room's calls, and the start of a recording with whatever a case asks. */
function serve(
  startAnswer: () => Response = () => json({ id: "meetingRecording_1" }, 201),
  summary: Record<string, unknown> = SUMMARY,
): void {
  const answer = (method: string, path: string): Response => {
    requests.push({ method, path });
    if (method === "GET" && path === `/api/v1/meetings/${MEETING_ID}`) return json(summary);
    if (path.endsWith("/join")) {
      return json({
        participantId: "attendance_1",
        displayName: "You",
        waiting: false,
        iceServers: [],
      });
    }
    if (path.endsWith("/recording") && method === "POST") return startAnswer();
    if (method === "GET" && path.endsWith("/recordings"))
      return json({ data: [], nextCursor: null });
    if (method === "GET") return json({ data: [], nextCursor: null });
    return json({ ok: true });
  };
  const stub = ((request: Request | string, init?: RequestInit) => {
    if (typeof request === "string") {
      return Promise.resolve(answer(init?.method ?? "GET", new URL(request, ORIGIN).pathname));
    }
    return Promise.resolve(answer(request.method, new URL(request.url).pathname));
  }) as unknown as typeof fetch;
  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
  vi.stubGlobal("fetch", stub);
}

async function settle(remaining = 5): Promise<void> {
  if (remaining === 0) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  await settle(remaining - 1);
}

function signIn(permissions: readonly string[]): void {
  sessionPermissions.session = {
    user: { id: "usr_1", name: "Member", email: "member@example.com" },
    firm: { id: "firm_1", name: "Goldsmith and Associates" },
    permissions,
  } as unknown as typeof sessionPermissions.session;
  sessionPermissions.settled = true;
}

/** Draw the room, and let the room welcome this browser with its own grant, if any. */
async function enter(
  ownRole: "host" | "co-host" | null,
  recording?: Record<string, unknown>,
): Promise<HTMLElement> {
  instance = mount(Harness, { target, props: {} });
  flushSync();
  await settle();
  const socket = sockets[0];
  socket?.deliver({
    v: 1,
    type: "welcome",
    participantId: "attendance_1",
    roster: [],
    roomState: { spotlight: null, locked: false },
    ...(recording === undefined ? {} : { recording }),
  });
  socket?.deliver({
    v: 1,
    type: "roster",
    participants: [
      {
        participantId: "attendance_1",
        userId: "usr_1",
        displayName: "You",
        sfuSessionId: "session_1",
        tracks: [],
        hostRole: ownRole,
      },
    ],
  });
  await settle();
  return target;
}

function buttonsReading(label: string): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")].filter(
    (control) => control.textContent?.trim() === label,
  );
}

function mark(): Element | null {
  return target.querySelector("[data-recording-mark]");
}

function liveRegion(): Element | undefined {
  return [...target.querySelectorAll('[aria-live="assertive"]')][0];
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  requests = [];
  sockets = [];
  queryClient.clear();
  page.params = { id: MEETING_ID };
  vi.stubGlobal("RTCPeerConnection", QuietPeerConnection);
  vi.stubGlobal("WebSocket", ScreenSocket);
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () => Promise.reject(new Error("NotAllowedError")),
      getDisplayMedia: () => Promise.reject(new Error("NotAllowedError")),
    },
  });
  signIn(["meetings:join", "meetings:host", "meetings:record"]);
  serve();
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

describe("the room screen's mark", () => {
  it("is in the header from the announcement until the stop, and the live region says each", async () => {
    await enter(null);
    expect(mark()).toBeNull();

    sockets[0]?.deliver({ v: 1, type: "recording", ...started() });
    await settle();
    await rewritten();
    await settle();
    expect(mark()?.textContent).toContain("Recording");
    expect(liveRegion()?.textContent?.trim()).toBe(RECORDING_IN_PROGRESS);
    expect(target.querySelector("[data-recording-notice]")?.textContent).toContain(
      "Recording in Progress",
    );

    // Dismissing the banner leaves the mark: the mark is what lasts as long as the recording.
    buttonsReading("")
      .find((control) => control.getAttribute("aria-label") === "Dismiss")
      ?.click();
    await settle();
    expect(target.querySelector("[data-recording-notice]")).toBeNull();
    expect(mark()).not.toBeNull();

    sockets[0]?.deliver({ v: 1, type: "recording", ...stopped() });
    await settle();
    await rewritten();
    await settle();
    expect(mark()).toBeNull();
    expect(liveRegion()?.textContent?.trim()).toBe(RECORDING_STOPPED);
  });

  it("changes the live region for each of two identical announcements in a row", async () => {
    await enter(null);
    const region = liveRegion();
    expect(region).toBeDefined();
    const held: string[] = [];
    const observer = new MutationObserver(() => {
      const text = region?.textContent?.trim() ?? "";
      if (held.at(-1) !== text) held.push(text);
    });
    if (region !== undefined) {
      observer.observe(region, { childList: true, characterData: true, subtree: true });
    }

    sockets[0]?.deliver({ v: 1, type: "recording", ...started("meetingRecording_1") });
    await settle();
    await rewritten();
    await settle();
    // A second recording announced with no stop heard between: the same sentence, a new fact.
    sockets[0]?.deliver({ v: 1, type: "recording", ...started("meetingRecording_2") });
    await settle();
    await rewritten();
    await settle();
    observer.disconnect();

    expect(held.filter((text) => text === RECORDING_IN_PROGRESS)).toHaveLength(2);
    expect(held.slice(-3)).toEqual([RECORDING_IN_PROGRESS, "", RECORDING_IN_PROGRESS]);
  });

  it("is there from the welcome for somebody arriving mid-recording, with the banner", async () => {
    await enter(null, started());
    await rewritten();
    await settle();
    expect(mark()).not.toBeNull();
    expect(target.querySelector("[data-recording-notice]")?.textContent).toContain(
      "This meeting is being recorded.",
    );
    expect(liveRegion()?.textContent?.trim()).toBe(RECORDING_IN_PROGRESS);
  });
});

describe("the Record control", () => {
  it("is absent for a member who holds the right to record but no grant on the room", async () => {
    await enter(null);
    expect(buttonsReading("Record")).toHaveLength(0);
  });

  it("is absent for a member hosting the room without the right to record", async () => {
    signIn(["meetings:join", "meetings:host"]);
    await enter("host");
    expect(buttonsReading("Record")).toHaveLength(0);
  });

  it("is offered to a member with both, and Stop replaces it while a recording runs", async () => {
    await enter("co-host");
    expect(buttonsReading("Record")).toHaveLength(1);

    sockets[0]?.deliver({ v: 1, type: "recording", ...started() });
    await settle();
    expect(buttonsReading("Record")).toHaveLength(0);
    expect(buttonsReading("Stop Recording")).toHaveLength(1);
  });

  it("offers Stop to a host without the right to record, because ending the meeting stops it", async () => {
    signIn(["meetings:join", "meetings:host"]);
    await enter("host", started());
    expect(buttonsReading("Stop Recording")).toHaveLength(1);
  });

  it("asks first, says everybody including guests is told, and starts only on the commit", async () => {
    await enter("host");
    buttonsReading("Record")[0]?.click();
    await settle();

    const panel = [...document.body.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find(
      (candidate) => candidate.textContent?.includes("Record This Meeting"),
    );
    expect(panel).toBeDefined();
    expect(panel?.textContent).toContain("guests included");
    // Nothing is sent by opening the panel.
    expect(requests.filter((request) => request.path.endsWith("/recording"))).toHaveLength(0);

    const commit = [...(panel?.querySelectorAll("button") ?? [])].find(
      (control) => control.textContent?.trim() === "Record",
    );
    commit?.click();
    await settle();

    expect(
      requests.filter(
        (request) => request.method === "POST" && request.path.endsWith("/recording"),
      ),
    ).toHaveLength(1);
    // The route answered, and the mark is still not lit: that is the room's announcement to make.
    expect(mark()).toBeNull();
  });

  it("says in place of the control that a firm has not switched recording on, and sends nothing", async () => {
    serve(undefined, { ...SUMMARY, recordingConfigured: false });
    await enter("host");

    const control = buttonsReading("Record")[0];
    expect(control?.disabled).toBe(true);
    expect(target.textContent).toContain("Recording is not switched on for this firm yet.");
    control?.click();
    await settle();
    expect(requests.filter((request) => request.path.endsWith("/recording"))).toHaveLength(0);
  });

  it("says a firm that has not switched recording on has not, inside the panel", async () => {
    serve(() =>
      json(
        {
          type: meetingProblemType("meeting-recording-not-configured"),
          title: "Recording is not configured",
          status: 503,
        },
        503,
      ),
    );
    await enter("host");
    buttonsReading("Record")[0]?.click();
    await settle();
    const panel = [...document.body.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find(
      (candidate) => candidate.textContent?.includes("Record This Meeting"),
    );
    [...(panel?.querySelectorAll("button") ?? [])]
      .find((control) => control.textContent?.trim() === "Record")
      ?.click();
    await settle();

    expect(panel?.textContent).toContain("Recording is not switched on for this firm yet.");
    expect(mark()).toBeNull();
  });
});
