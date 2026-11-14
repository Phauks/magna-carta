// @vitest-environment happy-dom
/*
 * The My Room card over a canned server. What it pins: looking at the card makes nothing (a member
 * with no room is offered Set Up, and only the press writes), and a room it has is drawn by its
 * address, with the two standing choices read off the room.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import Harness from "./my-room-card-harness.svelte";

const ORIGIN = "https://app.example";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
let asked: { method: string; path: string }[] = [];

const ROOM = {
  id: "meetingPersonalRoom_1",
  linkCode: "abcdefghjk",
  addressName: "trevor",
  medium: "video",
  lobby: "on",
  openMeetingId: null,
};

/** Answer the read with `room` until a POST makes one, then with the made room. */
function answerWith(initial: typeof ROOM | null): void {
  let room = initial;
  const stub = ((request: Request) => {
    const url = new URL(request.url);
    asked.push({ method: request.method, path: url.pathname });
    if (request.method === "POST") room = ROOM;
    return Promise.resolve(
      new Response(JSON.stringify({ room }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
}

/** One turn of the event loop, then a render: a read, a write and a re-read each take one. */
async function turn(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

async function settle(): Promise<void> {
  await turn();
  await turn();
  await turn();
  await turn();
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
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

function button(name: string): HTMLButtonElement | undefined {
  return [...target.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(name),
  );
}

describe("the My Room card", () => {
  it("makes nothing by being looked at, and sets the room up on the press", async () => {
    answerWith(null);
    instance = mount(Harness, { target, props: {} });
    await settle();

    expect(asked.every((call) => call.method === "GET")).toBe(true);
    const setUp = button("Set Up My Room");
    expect(setUp).toBeDefined();

    setUp?.click();
    await settle();

    expect(
      asked.some(
        (call) => call.method === "POST" && call.path === "/api/v1/meetings/personal-room",
      ),
    ).toBe(true);
    expect(target.textContent).toContain("/room/trevor");
  });

  it("draws a room by its address, with its settings behind the menu", async () => {
    answerWith(ROOM);
    instance = mount(Harness, { target, props: {} });
    await settle();

    expect(target.textContent).toContain("/room/trevor");
    expect(button("Open My Room")).toBeDefined();
    expect(button("Copy Link")).toBeDefined();
    // The settings are changed rarely, so they are behind "..." rather than on the card's face.
    expect(button("Get a New Link")).toBeUndefined();
    expect(target.querySelector("#my-room-lobby")).toBeNull();
    expect(target.querySelector('[aria-label="My Room settings"]')).not.toBeNull();
  });
});
