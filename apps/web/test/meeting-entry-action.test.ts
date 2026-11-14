// @vitest-environment happy-dom
/*
 * The control on a calendar entry: whether it reads anything, and what it says once it has.
 *
 * The read is the part worth pinning. A member without `meetings:join` cannot be in a meeting and
 * cannot be told about one, so the control renders nothing for them — and, because the entry's
 * meeting is read behind that same permission, it must not ASK either. It did, once per entry
 * window opened, and every one of those was a refusal the member could do nothing about.
 *
 * The other half is the count. A meeting stays open until a host ends it, so an empty room is an
 * ordinary standing rather than a meeting that is over, and the control says how many people are in
 * it including none.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { sessionPermissions } from "../src/lib/access/session-permissions.svelte.ts";
import { browserMeetingSeams } from "../src/lib/meetings/client/meeting-client.svelte.ts";
import {
  MeetingRecording,
  readRecordingAnnouncement,
} from "../src/lib/meetings/client/recording.svelte.ts";
import { pageRecordingSounds } from "../src/lib/meetings/client/recording-sounds.ts";
import Harness from "./meeting-entry-harness.svelte";

/** An origin for the client's relative operation paths, which Node cannot resolve on its own. */
const ORIGIN = "https://app.example";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
let asked: string[] = [];
/** Every room this control asked the server to open, as it asked for it. */
let started: unknown[] = [];

/** Answer every read with one canned reply, and record what was asked for. */
function answerWith(status: number, body: unknown): void {
  const stub = (async (request: Request) => {
    asked.push(new URL(request.url).pathname);
    if (request.method === "POST") {
      started.push(await request.clone().json());
      return new Response(JSON.stringify({ id: "meeting_9" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
}

/** The session as the shared reader holds it, set directly: this control never does the read. */
function sessionHolding(permissions: string[]): void {
  sessionPermissions.session = {
    user: { id: "usr_1", name: "Member", email: "member@example.com" },
    firm: { id: "firm_1", name: "Goldsmith and Associates" },
    permissions,
  } as unknown as typeof sessionPermissions.session;
  sessionPermissions.settled = true;
  sessionPermissions.failed = false;
}

const RUNNING_MEETING = {
  id: "meeting_1",
  eventKind: "matter",
  eventId: "matterEvent_1",
  matterId: "matter_1",
  title: "Case review",
  startsOn: "2026-09-18",
  startsAtTime: "09:00",
  endsAtTime: "10:00",
  timeZone: "America/New_York",
  status: "live",
  startedAt: "2026-09-18T13:00:00.000Z",
  endedAt: null,
  medium: "video",
  liveCount: 0,
  locked: false,
  configured: true,
};

async function draw(): Promise<HTMLElement> {
  instance = mount(Harness, { target, props: { eventKind: "matter", eventId: "matterEvent_1" } });
  flushSync();
  // The read is a round trip through the cache, so the render a case asserts on is the one after it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  return target;
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  asked = [];
  started = [];
  queryClient.clear();
  // THE MEETING'S OWN TAB, reserved on the press. happy-dom's window.open would load the room's
  // address over the network, which no test serves, and the refused fetch landed after the case as
  // an unhandled rejection. A browser that blocks the tab is the case this stands in for: the room
  // then opens in this tab, through the navigation stub.
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  sessionPermissions.session = null;
  sessionPermissions.settled = false;
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
  vi.restoreAllMocks();
});

describe("a member who may not join a meeting", () => {
  it("is neither offered one nor made to ask the server for one", async () => {
    sessionHolding(["matters:read"]);
    answerWith(200, RUNNING_MEETING);

    const rendered = await draw();

    expect(rendered.querySelector("button")).toBeNull();
    expect(rendered.querySelector("a")).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe("a member who may join", () => {
  it("is offered the room, with the number of people in it stated even when that is none", async () => {
    sessionHolding(["meetings:join"]);
    answerWith(200, RUNNING_MEETING);

    const rendered = await draw();

    expect(asked).toEqual(["/api/v1/events/matterEvent_1/meeting"]);
    const control = rendered.querySelector("button");
    expect(control?.textContent?.trim()).toBe("Join Meeting (0)");
  });

  it("is told which kind of room is running, because walking in differs", async () => {
    sessionHolding(["meetings:join"]);
    answerWith(200, { ...RUNNING_MEETING, medium: "audio" });

    const rendered = await draw();

    expect(rendered.querySelector("button")?.textContent?.trim()).toBe("Join Call (0)");
  });

  it("is shown the room's Recording mark beside Join while a recording runs, and not otherwise", async () => {
    sessionHolding(["meetings:join"]);
    answerWith(200, { ...RUNNING_MEETING, recordingState: "recording" });

    const rendered = await draw();

    expect(rendered.querySelector("[data-recording-mark]")?.textContent).toContain("Recording");
    expect(rendered.querySelector("button")?.textContent?.trim()).toBe("Join Meeting (0)");
  });

  it("carries no mark for a room whose recording has stopped", async () => {
    sessionHolding(["meetings:join"]);
    answerWith(200, { ...RUNNING_MEETING, recordingState: "composing" });

    const rendered = await draw();

    expect(rendered.querySelector("[data-recording-mark]")).toBeNull();
  });
});

describe("a room whose host has shut the door", () => {
  it("says so before the click rather than after it, and offers no way in", async () => {
    sessionHolding(["meetings:join"]);
    answerWith(200, { ...RUNNING_MEETING, locked: true });

    const rendered = await draw();

    // Disabled with the reason, not absent: the door opens again the moment a host unlocks it, and
    // a control that vanished would leave a reader wondering what they had missed.
    const control = rendered.querySelector("button");
    expect(control?.textContent?.trim()).toBe("Locked");
    expect(control?.disabled).toBe(true);
    expect(control?.getAttribute("title")).toContain("locked");
  });

  it("still says the room is being recorded: the people inside are, whoever may come in", async () => {
    sessionHolding(["meetings:join"]);
    answerWith(200, { ...RUNNING_MEETING, locked: true, recordingState: "recording" });

    const rendered = await draw();

    expect(rendered.querySelector("[data-recording-mark]")).not.toBeNull();
    expect(rendered.querySelector("button")?.textContent?.trim()).toBe("Locked");
  });
});

describe("a member who may host, on an entry with no room yet", () => {
  it("is offered both, side by side, rather than one with a choice hidden inside it", async () => {
    sessionHolding(["meetings:join", "meetings:host"]);
    // A 404 is the ordinary answer for an entry nobody has started anything on.
    answerWith(404, { type: "meeting-not-found", title: "No meeting", status: 404 });

    const rendered = await draw();

    // The lobby switch beside them carries no words of its own — its label is the line next to it —
    // so what is compared here is the controls that name something.
    const labels = [...rendered.querySelectorAll("button")]
      .map((control) => control.textContent?.trim())
      .filter((label) => label !== "");
    expect(labels).toEqual(["Start Meeting", "Start Call"]);
  });

  it("opens the kind that was pressed, saying so on the wire", async () => {
    sessionHolding(["meetings:join", "meetings:host"]);
    answerWith(404, { type: "meeting-not-found", title: "No meeting", status: 404 });
    const rendered = await draw();

    const call = [...rendered.querySelectorAll("button")].find(
      (control) => control.textContent?.trim() === "Start Call",
    );
    call?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toEqual([
      { eventKind: "matter", eventId: "matterEvent_1", medium: "audio", lobby: "off" },
    ]);
  });

  it("opens the door by default, and holds arrivals only where that was asked for", async () => {
    sessionHolding(["meetings:join", "meetings:host"]);
    answerWith(404, { type: "meeting-not-found", title: "No meeting", status: 404 });
    const rendered = await draw();

    // Off by default: every participant today is a firm member arriving at an event they are on,
    // and a lobby on by default would queue a colleague for every ordinary hearing.
    const hold = rendered.querySelector('[role="switch"]');
    expect(hold).not.toBeNull();
    expect(hold?.getAttribute("aria-checked")).toBe("false");
    expect(rendered.textContent).toContain("Hold arrivals in a lobby");

    (hold as HTMLElement | null)?.click();
    flushSync();
    expect(hold?.getAttribute("aria-checked")).toBe("true");

    const start = [...rendered.querySelectorAll("button")].find(
      (control) => control.textContent?.trim() === "Start Meeting",
    );
    start?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The standing the room OPENS with, sent with the medium: a host changes it from inside
    // afterwards, because who may come in has no bearing on what anybody already agreed to.
    expect(started).toEqual([
      { eventKind: "matter", eventId: "matterEvent_1", medium: "video", lobby: "on" },
    ]);
  });
});

/** A gain ramp the fake device accepts and ignores: what is counted is the note, not its shape. */
const noRamp = (): void => {};

/**
 * An audio device as Safari hands one to a page: suspended when made, running once a resume is
 * honoured — which a press in progress is — and counting every note asked of it.
 */
class FakeAudioContext {
  static made: FakeAudioContext[] = [];
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
    this.state = "running";
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

describe("the recording tone, woken by the press that leads into a room", () => {
  beforeEach(() => {
    FakeAudioContext.made = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    pageRecordingSounds.release();
    vi.unstubAllGlobals();
  });

  it("wakes the page's device on Join, and the room's first chime plays on that same device", async () => {
    sessionHolding(["meetings:join"]);
    answerWith(200, RUNNING_MEETING);
    const rendered = await draw();
    expect(FakeAudioContext.made).toHaveLength(0);

    rendered.querySelector("button")?.click();
    // Inside the press, before the navigation it causes: the room's arrival runs after it is over.
    expect(FakeAudioContext.made).toHaveLength(1);
    const device = FakeAudioContext.made[0];
    expect(device?.resumes).toBe(1);
    expect(device?.state).toBe("running");

    // The room's client takes its sounds from the browser's seams, and chimes on the woken device
    // rather than opening one of its own outside any press.
    const room = new MeetingRecording(browserMeetingSeams().createRecordingSounds?.());
    room.noteWelcome(
      readRecordingAnnouncement({
        state: "started",
        recordingId: "meetingRecording_1",
        by: { userId: "usr_2", displayName: "Rosalind Chase" },
        at: "2026-09-18T13:05:00.000Z",
      }),
    );
    expect(FakeAudioContext.made).toHaveLength(1);
    expect(device?.notes).toBe(2);
  });

  it("wakes it on Start too, before the room is asked for", async () => {
    sessionHolding(["meetings:join", "meetings:host"]);
    answerWith(404, { type: "meeting-not-found", title: "No meeting", status: 404 });
    const rendered = await draw();

    [...rendered.querySelectorAll("button")]
      .find((control) => control.textContent?.trim() === "Start Call")
      ?.click();
    expect(FakeAudioContext.made).toHaveLength(1);
    expect(FakeAudioContext.made[0]?.state).toBe("running");
  });
});
