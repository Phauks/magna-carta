// @vitest-environment happy-dom
/*
 * The Shared Rooms card: rooms the firm keeps for a place. What a host sees (Open Room, the "..."
 * menu, New Room) against what a member who only joins sees (Copy Link, and Join on an open room),
 * and what a room with nobody in it says.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import Harness from "./shared-rooms-card-harness.svelte";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { sharedRoomStatus } from "../src/lib/meetings/firm-rooms.ts";

const ORIGIN = "https://magna.example";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

const RED_ROOM = {
  id: "meetingPersonalRoom_red",
  name: "Red Room",
  addressName: "red-room",
  medium: "video",
  lobby: "on",
  setUpBy: "Ada Park",
  openMeetingId: null,
  inTheRoom: 0,
};

function answerWith(rooms: readonly (typeof RED_ROOM)[]): void {
  const stub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ rooms }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )) as unknown as typeof fetch;
  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  }
}

function button(name: string): HTMLButtonElement | HTMLAnchorElement | undefined {
  return [...target.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("button, a")].find(
    (element) => element.textContent?.trim() === name,
  );
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  queryClient.clear();
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("the Shared Rooms card", () => {
  it("gives a host Open Room, the room's settings and New Room", async () => {
    answerWith([RED_ROOM]);
    instance = mount(Harness, { target, props: { canHost: true } });
    await settle();

    expect(target.textContent).toContain("Red Room");
    expect(target.textContent).toContain("/room/red-room");
    expect(button("Open Room")).toBeDefined();
    expect(button("New Room")).toBeDefined();
    expect(target.querySelector('[aria-label="Red Room settings"]')).not.toBeNull();
  });

  it("gives a member who only joins the link, and Join only while the room is open", async () => {
    answerWith([RED_ROOM, { ...RED_ROOM, id: "meetingPersonalRoom_big", name: "Large Conference Room", addressName: "large-conference-room", openMeetingId: "meeting_1", inTheRoom: 3 }]);
    instance = mount(Harness, { target, props: { canHost: false } });
    await settle();

    expect(button("New Room")).toBeUndefined();
    expect(button("Open Room")).toBeUndefined();
    expect([...target.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "/room/large-conference-room",
    ]);
    expect(target.textContent).toContain("In a meeting, 3 people");
  });

  it("says when the firm has none yet", async () => {
    answerWith([]);
    instance = mount(Harness, { target, props: { canHost: true } });
    await settle();
    expect(target.textContent).toContain("No shared rooms yet.");
  });
});

describe("a row of the Shared Rooms list", () => {
  it("is not in a meeting until somebody is in it", () => {
    expect(sharedRoomStatus(RED_ROOM)).toEqual({ text: "Not in a meeting", open: false });
    expect(sharedRoomStatus({ ...RED_ROOM, openMeetingId: "meeting_1", inTheRoom: 1 })).toEqual({
      text: "In a meeting, 1 person",
      open: true,
    });
  });
});
