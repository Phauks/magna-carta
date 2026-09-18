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

/** Answer every read with one canned reply, and record what was asked for. */
function answerWith(status: number, body: unknown): void {
  const stub = ((request: Request) => {
    asked.push(new URL(request.url).pathname);
    return Promise.resolve(
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
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
});
