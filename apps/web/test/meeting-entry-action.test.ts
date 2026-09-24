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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { sessionPermissions } from "../src/lib/access/session-permissions.svelte.ts";
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
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  sessionPermissions.session = null;
  sessionPermissions.settled = false;
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
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
});

describe("a member who may host, on an entry with no room yet", () => {
  it("is offered both, side by side, rather than one with a choice hidden inside it", async () => {
    sessionHolding(["meetings:join", "meetings:host"]);
    // A 404 is the ordinary answer for an entry nobody has started anything on.
    answerWith(404, { type: "meeting-not-found", title: "No meeting", status: 404 });

    const rendered = await draw();

    const labels = [...rendered.querySelectorAll("button")].map((control) =>
      control.textContent?.trim(),
    );
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

    expect(started).toEqual([{ eventKind: "matter", eventId: "matterEvent_1", medium: "audio" }]);
  });
});
